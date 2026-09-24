/* ---------------------------------------------------------------------
   posting.js — turns business documents into journal entries.
   This is the only place that should call Ledger.post for these
   document types, so the mapping from event to accounts stays in one
   spot.

   Collections flow through clearing accounts rather than straight into
   Cash on Hand / Bank: a CASH receipt lands in 1050 Undeposited Funds,
   a CARD receipt in 1020 Card Clearing, a BANK receipt goes straight to
   1100 (it is already at the bank). The day-end close (below) counts
   and locks each method's clearing balance for the day; a separate
   Deposit (postDeposit) later sweeps undeposited/card-clearing amounts
   into the real Cash on Hand or Bank account once they're banked.
--------------------------------------------------------------------- */

const Posting = (function(){

  function taxRateFor(pkg){
    if(!pkg) return 0;
    if(pkg.taxCode==='EXEMPT') return 0;
    if(pkg.taxCode==='CUSTOM') return (pkg.customTaxRate||0)/100;
    return (Store.settings.defaultTaxRate||0)/100;
  }

  function methodDef(methodId){
    return (Store.settings.paymentMethods||[]).find(m=>m.id===methodId) || null;
  }

  // Resolves the GL account a given payment method (and, for the built-in
  // CASH method, currency) settles to. CASH is the only method with separate
  // per-currency control accounts (1000 MVR / 1001 USD / 1002 EUR) — every
  // other method (card, bank, a shop's own custom methods) settles to one
  // account regardless of the receipt's currency. FOB never resolves to a
  // cash/bank account at all (see postReceipt).
  function resolveMethodAccountId(methodId, currency){
    const m = methodDef(methodId);
    if(m && m.kind==='CASH'){
      const code = currency==='USD' ? '1011' : currency==='EUR' ? '1012' : '1010';
      return Store.acctId(code);
    }
    if(m && m.accountId) return m.accountId;
    if(m && m.accountCode) return Store.acctId(m.accountCode);
    // unknown/legacy method id — fall back to the old clearing-account behaviour
    if(methodId==='CARD') return Store.acctId('1030');
    if(methodId==='BANK') return Store.acctId('1060');
    return Store.acctId('1040');
  }

  // Kept for any caller still using the old name/signature (CASH/CARD/BANK only).
  function clearingAccountForMethod(method){
    return resolveMethodAccountId(method, null);
  }

  /* ---- Booking invoice: posts once, when a booking's guest lines are
     first confirmed with prices. Idempotent via booking.invoiceJournalId. ---- */
  function postBookingInvoice(booking){
    if(booking.invoiceJournalId) return Store.find('journalEntries', booking.invoiceJournalId);
    const customer = Store.find('customers', booking.customerId);
    if(!customer) throw new Error('Booking has no customer.');
    const lines = billableLines(booking);
    if(!lines.length) return null;

    const arAccount = customer.type==='AGENT' ? Store.acctId('1110') : Store.acctId('1120');
    const taxAccount = Store.acctId('2100');
    const byRevenueAccount = {};
    let taxTotal = 0, subTotal = 0;

    lines.forEach(l=>{
      const pkg = Store.find('packages', l.packageId);
      const revAcct = (pkg && pkg.revenueAccountId) || Store.acctId(pkg && pkg.kind==='ADDON' ? '4010' : '4000');
      byRevenueAccount[revAcct] = (byRevenueAccount[revAcct]||0) + l.amount;
      subTotal += l.amount;
      taxTotal += Ledger.round2(l.amount * taxRateFor(pkg));
    });

    const jeLines = [{ accountId: arAccount, debit: Ledger.round2(subTotal+taxTotal), credit:0, partyType:'customer', partyId:customer.id, memo:'Booking '+booking.bookingNo }];
    Object.entries(byRevenueAccount).forEach(([acctId, amt])=>{
      jeLines.push({ accountId: acctId, debit:0, credit: Ledger.round2(amt), memo:'Booking '+booking.bookingNo });
    });
    if(taxTotal>0.004) jeLines.push({ accountId: taxAccount, debit:0, credit: taxTotal, memo:'Output tax — booking '+booking.bookingNo });

    const je = Ledger.post({
      date: booking.tripDateForInvoice || todayISO(),
      ref: booking.bookingNo, description: `Invoice for booking ${booking.bookingNo} (${customer.name})`,
      sourceType:'booking', sourceId: booking.id, lines: jeLines
    });
    Store.update('bookings', booking.id, { invoiceJournalId: je.id, invoiceTotal: Ledger.round2(subTotal+taxTotal), invoiceTax: taxTotal, invoiceSub: subTotal });
    return je;
  }

  // Each billable line carries its ORIGINAL currency/amount for display and a
  // `base` amount (MVR) for the ledger. Guest lines added through the multi-currency
  // booking form freeze both at add-time; lines without that info (addons, older
  // data) are assumed to already be in the base currency.
  // A guest line's `qty` is a pure billing multiplier (e.g. dives on the same
  // trip) — `unitPrice`/`display` stay per-unit, and `amount` is the extended
  // total (unitPriceBase × qty) that actually posts to the ledger.
  function billableLines(booking){
    const out = [];
    (booking.guestLines||[]).forEach(gl=>{
      if(['CANCELLED','EXPIRED'].includes(gl.status)) return;
      const qty = gl.qty||1;
      const unitBase = (gl.unitPriceBase!=null ? gl.unitPriceBase : gl.unitPrice)||0;
      out.push({ packageId: gl.packageId, amount: Ledger.round2(unitBase*qty), guestId: gl.guestId, guestLineId: gl.id,
        display: gl.unitPrice||0, unitPrice: gl.unitPrice||0, qty, currency: gl.currency||Pricing.baseCurrency(), fxRate: gl.fxRate||1 });
      (gl.addons||[]).forEach(ad=>{
        const amt = (ad.unitPrice||0)*(ad.qty||1);
        out.push({ packageId: ad.packageId, amount: amt, guestId: gl.guestId, guestLineId: gl.id, display: ad.unitPrice||0, unitPrice: ad.unitPrice||0, currency: Pricing.baseCurrency(), fxRate:1, isAddon:true, qty: ad.qty||1 });
      });
    });
    return out;
  }

  /* ---- Sales invoice document(s): a printable record of a confirmed
     booking, generated alongside the invoice posting. Not itself a ledger
     posting — the booking's guests all still share ONE journal entry/AR
     line (booking.invoiceJournalId, from postBookingInvoice above), since
     they're the same customer account either way. What this generates is
     one DOCUMENT per distinct guest on the booking, each showing only that
     guest's own lines/totals, so a multi-guest booking hands each guest
     their own invoice to take away rather than one bundled document naming
     everyone. Idempotent via booking.salesInvoiceIds.
     The ledger/AR side (subTotal/tax/total, and each line's amountBase) is
     always base-currency, matching the journal entry — but when the booking
     was sold in a foreign currency, each invoice ALSO carries a face-value
     set (currency/subTotalDisplay/taxDisplay/totalDisplay, and each line's
     netFace/taxFace) so the document the guest/agent sees matches the
     currency they were quoted in, not the shop's own ledger currency. ---- */
  function generateSalesInvoice(booking){
    if(booking.salesInvoiceIds && booking.salesInvoiceIds.length){
      return booking.salesInvoiceIds.map(id=>Store.find('salesInvoices', id)).filter(Boolean);
    }
    const customer = Store.find('customers', booking.customerId);
    // "Customer" is the account the booking is on (e.g. the agent); "Bill to"
    // is who/where the invoice is actually addressed — often the same, but
    // can be a specific contact person at that account. Defaults from the
    // customer's contact person and is editable afterwards on the invoice
    // without touching the customer record itself.
    const billTo = customer && customer.contact ? customer.contact : (customer ? customer.name : '');
    const currency = booking.currency || Pricing.baseCurrency();
    const allLines = billableLines(booking).map(l=>{
      const pkg = Store.find('packages', l.packageId);
      const guest = Store.find('guests', l.guestId);
      const unitPrice = l.unitPrice!=null ? l.unitPrice : l.display;
      const rate = taxRateFor(pkg);
      const netFace = Ledger.round2(unitPrice*(l.qty||1));
      return {
        guestId: l.guestId,
        packageName: pkg ? pkg.name : (l.isAddon?'Add-on':'—'),
        guestName: guest ? guest.name : '—',
        currency: l.currency, fxRate: l.fxRate,
        unitPrice, qty: l.qty||1, amountBase: l.amount, isAddon: !!l.isAddon,
        netFace, taxFace: Ledger.round2(netFace*rate), taxBase: Ledger.round2(l.amount*rate)
      };
    });
    const guestIds = [...new Set(allLines.map(l=>l.guestId))];
    const createdIds = guestIds.map(gid=>{
      const lines = allLines.filter(l=>l.guestId===gid);
      const guest = Store.find('guests', gid);
      const subTotalBase = Ledger.round2(lines.reduce((s,l)=>s+l.amountBase,0));
      const taxBase = Ledger.round2(lines.reduce((s,l)=>s+l.taxBase,0));
      const totalBase = Ledger.round2(subTotalBase+taxBase);
      // Face-value totals in the booking's own currency, same logic as the
      // combined booking totals used to (see bookingDisplayTotal in
      // bookings.js) but scoped to just this guest's lines.
      const subTotalDisplay = currency===Pricing.baseCurrency() ? subTotalBase : Ledger.round2(lines.reduce((s,l)=>s+l.netFace,0));
      const taxDisplay = currency===Pricing.baseCurrency() ? taxBase : Ledger.round2(lines.reduce((s,l)=>s+l.taxFace,0));
      const totalDisplay = Ledger.round2(subTotalDisplay+taxDisplay);
      const inv = Store.insert('salesInvoices', {
        invoiceNo: Store.docNo('INV','salesInvoice'),
        bookingId: booking.id, bookingNo: booking.bookingNo,
        customerId: booking.customerId, customerName: customer?customer.name:'—',
        guestId: gid, guestName: guest?guest.name:'—',
        billTo,
        date: booking.tripDateForInvoice || todayISO(),
        lines, subTotal: subTotalBase, tax: taxBase, total: totalBase,
        baseCurrency: Pricing.baseCurrency(),
        currency, subTotalDisplay, taxDisplay, totalDisplay
      });
      return inv.id;
    });
    Store.update('bookings', booking.id, { salesInvoiceIds: createdIds });
    return createdIds.map(id=>Store.find('salesInvoices', id));
  }

  /* ---- Receipt from a customer (deposit or balance). CASH lands in the
     currency-specific Cash on Hand control account, CARD/BANK/custom methods
     settle to their configured clearing/bank account. FOB ("free of bill" —
     a comped/complimentary service) never touches cash or bank at all: it
     writes the amount off to a complimentary/promotional expense account so
     the books stay balanced without pretending money was received. ---- */
  // Per-currency CASH control accounts (1010/1011/1012) hold the actual
  // physical till count in that currency — not a base-currency equivalent —
  // so a receipt posts its face amount straight through on both sides, same
  // as every other document type in this app. amountBase is kept on the
  // receipt record for display only, when set.
  function postReceipt(receipt){
    const customer = Store.find('customers', receipt.customerId);
    const arAccount = customer && customer.type==='AGENT' ? Store.acctId('1110') : Store.acctId('1120');
    const m = methodDef(receipt.method);
    const isFob = m && m.kind==='FOB';
    const settleAccount = isFob ? Store.acctId('6500') : resolveMethodAccountId(receipt.method, receipt.currency);
    const je = Ledger.post({
      date: receipt.date, ref: receipt.receiptNo,
      description: `${isFob?'Complimentary write-off':'Receipt'} ${receipt.receiptNo} — ${customer?customer.name:'customer'}`,
      sourceType:'receipt', sourceId: receipt.id,
      lines: [
        { accountId: settleAccount, debit: receipt.amount, credit:0, memo: receipt.receiptNo },
        { accountId: arAccount, debit:0, credit: receipt.amount, partyType:'customer', partyId: receipt.customerId, memo: receipt.receiptNo }
      ]
    });
    Store.update('receipts', receipt.id, { journalId: je.id });
    return je;
  }

  // Posts the agent-commission liability created when a guest on an agent's
  // booking pays the dive shop directly at the Direct rate instead of the
  // agent settling at their own (lower) rate: the shop now owes the agent the
  // gap between what the guest paid and what the agent would have been
  // charged. Dr Agent Commission (reduces the agent channel's net revenue),
  // Cr Agent Commission Payable, tagged to the agent's customer account.
  function postAgentCommission(booking, gl, commissionBase, agentCustomerId){
    if(!commissionBase || commissionBase<=0.004) return null;
    const je = Ledger.post({
      date: todayISO(), ref: booking.bookingNo,
      description: `Agent commission — guest paid direct rate — booking ${booking.bookingNo}`,
      sourceType:'agentCommission', sourceId: gl.id,
      lines: [
        { accountId: Store.acctId('4900'), debit: Ledger.round2(commissionBase), credit:0, memo:'Direct-collect commission — '+booking.bookingNo },
        { accountId: Store.acctId('2150'), debit:0, credit: Ledger.round2(commissionBase), partyType:'customer', partyId: agentCustomerId, memo:'Direct-collect commission — '+booking.bookingNo }
      ]
    });
    return je;
  }

  /* ---- Vendor bill (AP) ---- */
  function postBill(bill){
    const apAccount = Store.acctId('2000');
    const taxAccount = Store.acctId('2100');
    const lines = (bill.lines||[]).map(l=>({ accountId: l.accountId, debit: Ledger.round2(l.amount), credit:0, memo: l.description||'' }));
    const taxAmt = Ledger.round2(bill.taxAmount||0);
    const je = Ledger.post({
      date: bill.billDate, ref: bill.billNo,
      description: `Bill ${bill.billNo} — ${(Store.find('vendors', bill.vendorId)||{}).name||''}`,
      sourceType:'bill', sourceId: bill.id,
      lines: [
        ...lines,
        ...(taxAmt>0.004 ? [{ accountId: taxAccount, debit: taxAmt, credit:0, memo:'Input tax — '+bill.billNo }] : []),
        { accountId: apAccount, debit:0, credit: Ledger.round2(bill.totalAmount), partyType:'vendor', partyId: bill.vendorId, memo: bill.billNo }
      ]
    });
    Store.update('bills', bill.id, { journalId: je.id });
    return je;
  }

  /* ---- Payment voucher — posted once approved & paid.
     Two kinds:
       BANK_CASH — pays from Cash on Hand or Bank; its GL lines can hit any account
                   (this is how a petty cash float itself gets funded/replenished:
                   a BANK_CASH voucher, method Bank, debiting that float's own
                   sub-account under 1020 Petty Cash).
       PETTY     — pays out of a specific petty cash float's box; its direct GL
                   lines are restricted to EXPENSE accounts only. voucher.floatId
                   picks which float (see pettycash.js); if omitted, falls back
                   to the first active float, for older callers that only ever
                   dealt with one box.
     Every voucher has one payee and can carry several lines, each either a {kind:'BILL'}
     line (settling a specific vendor bill — bills from different vendors can sit on
     the same voucher) or a {kind:'GL'} line posting straight to an account. ---- */
  // voucher.currency (MVR/USD/EUR) lets a BANK_CASH voucher pay out in any of
  // the three currencies — the Cash method already has per-currency control
  // accounts (1010/1011/1012), which (like every other document in this app)
  // hold face-value amounts in their own currency, not a base-currency
  // equivalent. A Bank payment always settles to the one Bank account
  // regardless of currency. Petty cash is always base currency.
  function pettyFloatFor(voucher){
    const byId = voucher.floatId ? Store.find('pettyCashFloats', voucher.floatId) : null;
    return byId || Store.all('pettyCashFloats').find(f=>f.active!==false) || null;
  }
  function postVoucher(voucher){
    const lines = voucher.lines || [];
    if(!lines.length) throw new Error('Voucher has no lines.');
    const currency = voucher.kind==='PETTY' ? Pricing.baseCurrency() : (voucher.currency || Pricing.baseCurrency());
    // voucher.payThroughAccountId is the explicit "payment through account"
    // chosen on the redesigned voucher form — it wins whenever present.
    // Older/system-generated vouchers (petty cash funding, payroll, tax,
    // gear-repair, freelancer commission, etc.) never set it, so they keep
    // falling back to the old method/currency/float inference below.
    let payAccount = voucher.payThroughAccountId || null;
    if(!payAccount){
      if(voucher.kind==='PETTY'){
        const float = pettyFloatFor(voucher);
        if(!float || !float.accountId) throw new Error('Set up a petty cash float before recording a petty cash payment.');
        payAccount = float.accountId;
      } else {
        payAccount = voucher.method==='BANK' ? Store.acctId('1060') : resolveMethodAccountId('CASH', currency);
      }
    }

    const jeLines = [];
    let total = 0;
    lines.forEach(l=>{
      const amt = Ledger.round2(l.amount||0);
      if(amt<=0) return;
      total += amt;
      if(l.kind==='BILL'){
        const bill = Store.find('bills', l.billId);
        if(!bill) throw new Error('Voucher references a bill that no longer exists.');
        jeLines.push({ accountId: Store.acctId('2000'), debit: amt, credit:0, partyType:'vendor', partyId: bill.vendorId, memo: bill.billNo });
      } else {
        const acct = Store.find('accounts', l.accountId);
        if(!acct) throw new Error('Voucher GL line has no account.');
        if(voucher.kind==='PETTY' && acct.type!=='EXPENSE'){
          throw new Error('A petty cash voucher can only post direct GL lines to an expense account.');
        }
        // GL-type vouchers built from the payment voucher form are guarded
        // the same way there (expense/liability only); system-generated
        // BANK_CASH GL vouchers with no paymentType (petty cash funding,
        // payroll, tax, etc.) are exempt — they legitimately debit other
        // account types (e.g. a petty cash float's own asset account).
        if(voucher.kind==='BANK_CASH' && voucher.paymentType==='GL' && !['EXPENSE','LIABILITY'].includes(acct.type)){
          throw new Error('A GL payment can only post to an expense or liability account.');
        }
        jeLines.push({ accountId: l.accountId, debit: amt, credit:0, memo: l.description || voucher.memo || '' });
      }
    });
    if(total<=0) throw new Error('Voucher has no amount.');
    jeLines.push({ accountId: payAccount, debit:0, credit: Ledger.round2(total), memo: voucher.voucherNo });

    const desc = `${voucher.kind==='PETTY'?'Petty cash payment':'Payment'} — voucher ${voucher.voucherNo} to ${voucher.payee||'—'}`;
    const je = Ledger.post({
      date: voucher.date, ref: voucher.voucherNo, description: voucher.memo ? `${desc} — ${voucher.memo}` : desc,
      sourceType:'voucher', sourceId: voucher.id,
      lines: jeLines
    });
    Store.update('vouchers', voucher.id, { journalId: je.id, amount: Ledger.round2(total) });

    // settle any bill lines
    lines.forEach(l=>{
      if(l.kind!=='BILL') return;
      const bill = Store.find('bills', l.billId);
      if(!bill) return;
      const paid = Ledger.round2((bill.paidAmount||0) + Ledger.round2(l.amount||0));
      Store.update('bills', bill.id, { paidAmount: paid, status: paid>=bill.totalAmount-0.01 ? 'PAID' : 'PARTIAL' });
    });
    return je;
  }

  /* ---- Staff advance ---- */
  function postAdvance(advance){
    const cashAccount = advance.method==='BANK' ? Store.acctId('1060') : Store.acctId('1010');
    const je = Ledger.post({
      date: advance.date, ref: 'ADV-'+advance.id.slice(-5),
      description: `Advance to ${(Store.find('staff', advance.staffId)||{}).name||'staff'}`,
      sourceType:'advance', sourceId: advance.id,
      lines: [
        { accountId: Store.acctId('1200'), debit: advance.amount, credit:0, partyType:'staff', partyId: advance.staffId },
        { accountId: cashAccount, debit:0, credit: advance.amount }
      ]
    });
    Store.update('advances', advance.id, { journalId: je.id });
    return je;
  }

  /* ---- Payroll run — structured packages with local-staff pension.
     Each staff line: basic + allowances[] + bonuses[] = gross. Deductions[]
     and any advance recovery reduce net pay. A pensionable local staff member
     also has a 7% staff pension withheld (liability, not an expense) and a
     matching 7% company contribution (a separate expense + liability — never
     deducted from the employee). ---- */
  function postPayrollRun(run){
    const lines = run.staffLines||[];
    const sum = (k)=> Ledger.round2(lines.reduce((s,l)=>s+(l[k]||0),0));
    const grossTotal = sum('grossPay');
    const deductionTotal = Ledger.round2(lines.reduce((s,l)=>s+(l.advanceDeduction||0)+(l.otherDeductions||0),0));
    const staffPensionTotal = sum('staffPension');
    const companyPensionTotal = sum('companyPension');
    const netTotal = Ledger.round2(grossTotal-deductionTotal-staffPensionTotal);

    const jeLines = [
      { accountId: Store.acctId('5100'), debit: grossTotal, credit:0, memo:'Payroll '+run.period },
    ];
    if(companyPensionTotal>0.004) jeLines.push({ accountId: Store.acctId('5110'), debit: companyPensionTotal, credit:0, memo:'Company pension — '+run.period });
    if(deductionTotal>0.004) jeLines.push({ accountId: Store.acctId('1200'), debit:0, credit: deductionTotal, memo:'Advance recovery — '+run.period });
    if((staffPensionTotal+companyPensionTotal)>0.004) jeLines.push({ accountId: Store.acctId('2210'), debit:0, credit: Ledger.round2(staffPensionTotal+companyPensionTotal), memo:'Pension payable — '+run.period });
    jeLines.push({ accountId: Store.acctId('2200'), debit:0, credit: netTotal, memo:'Salaries payable — '+run.period });

    const je = Ledger.post({
      date: run.postDate || todayISO(), ref: run.period,
      description: `Payroll for ${run.period}`,
      sourceType:'payroll', sourceId: run.id,
      lines: jeLines
    });
    Store.update('payrollRuns', run.id, { journalId: je.id, status:'POSTED', grossTotal, deductionTotal, staffPensionTotal, companyPensionTotal, netTotal });
    return je;
  }

  /* ---- Day-end close: per payment-method expected vs. counted, then lock
     the date. Any variance posts against Cash Over/Short (4900) for that
     method's clearing account, in one balanced journal entry. ---- */
  function postDayEndClose(close){
    const jeLines = [];
    (close.methods||[]).forEach(m=>{
      const variance = Ledger.round2((m.counted||0) - (m.expected||0));
      if(Math.abs(variance) <= 0.004) return;
      if(variance>0){
        jeLines.push({ accountId: m.accountId, debit: variance, credit:0, memo:`${m.method} over — ${close.date}` });
        jeLines.push({ accountId: Store.acctId('7000'), debit:0, credit: variance, memo:`${m.method} over — ${close.date}` });
      } else {
        jeLines.push({ accountId: Store.acctId('7000'), debit: -variance, credit:0, memo:`${m.method} short — ${close.date}` });
        jeLines.push({ accountId: m.accountId, debit:0, credit: -variance, memo:`${m.method} short — ${close.date}` });
      }
    });
    let je = null;
    if(jeLines.length){
      je = Ledger.post({
        date: close.date, ref: 'EOD-'+close.date, description: `Day-end cash over/short — ${close.date}`,
        sourceType:'dayend', sourceId: close.id, allowLocked:true,
        lines: jeLines
      });
    }
    Store.update('dayEndCloses', close.id, { status:'LOCKED', journalId: je && je.id, lockedAt: nowISO() });
    return je;
  }

  /* ---- Deposit / bank reconciliation: sweeps Undeposited Funds and/or Card
     Clearing balances into the real Cash on Hand or Bank account once banked. ---- */
  function postDeposit(deposit){
    const lines = deposit.lines||[];
    if(!lines.length) throw new Error('Pick at least one amount to deposit.');
    const total = Ledger.round2(lines.reduce((s,l)=>s+(l.amount||0),0));
    if(total<=0) throw new Error('Nothing to deposit.');
    const jeLines = lines.map(l=>({ accountId: l.fromAccountId, debit:0, credit: Ledger.round2(l.amount), memo: 'Deposit '+deposit.depositNo }));
    jeLines.push({ accountId: deposit.toAccountId, debit: total, credit:0, memo: 'Deposit '+deposit.depositNo });
    const je = Ledger.post({
      date: deposit.date, ref: deposit.depositNo, description: `Deposit ${deposit.depositNo} to ${(Store.find('accounts', deposit.toAccountId)||{}).name||'bank'}`,
      sourceType:'deposit', sourceId: deposit.id,
      lines: jeLines
    });
    Store.update('deposits', deposit.id, { journalId: je.id, amount: total });
    return je;
  }

  function todayISO(){ return new Date().toISOString().slice(0,10); }
  function nowISO(){ return new Date().toISOString(); }

  return { postBookingInvoice, generateSalesInvoice, postReceipt, postAgentCommission, postBill, postVoucher, postAdvance, postPayrollRun,
           postDayEndClose, postDeposit, taxRateFor, billableLines, clearingAccountForMethod, resolveMethodAccountId, methodDef, pettyFloatFor };
})();

window.Posting = Posting;
