/* ---------------------------------------------------------------------
   tax.js — tax periods: summarise output tax (sales) and input tax
   (bills) into one return per period, then settle it. Period boundaries
   are driven by the tax period setup in Settings (monthly/quarterly,
   fiscal year start month) rather than a free date-range picker.
--------------------------------------------------------------------- */

(function(){

  function render(params){
    setPageTitle('Tax', 'Accounting');
    renderNav();
    const vo = Auth.isViewOnly();
    const periods = Store.all('taxPeriods').slice().sort((a,b)=>b.toDate.localeCompare(a.toDate));
    const taxAccId = Store.acctId('2100');
    const currentBalance = Ledger.accountBalance(taxAccId);
    const freq = Store.settings.taxPeriodFrequency||'MONTHLY';
    qs('#content').innerHTML = `
      <div class="grid grid-3 mb-16">
        <div class="stat"><div class="label">Tax payable balance (all time)</div><div class="value">${fmtMoney(currentBalance)}</div><div class="sub">Positive = owed to the tax authority</div></div>
        <div class="stat"><div class="label">Default rate</div><div class="value">${Store.settings.defaultTaxRate||0}%</div><div class="sub">Set per package, or use this default</div></div>
        <div class="stat"><div class="label">Period frequency</div><div class="value" style="font-size:16px">${freq==='QUARTERLY'?'Quarterly':'Monthly'}</div><div class="sub">Set in Settings → General</div></div>
      </div>
      <div class="toolbar"><div class="spacer"></div>${vo?'':`<button class="btn btn-primary" id="tx-new">+ Close next period</button>`}</div>
      <div class="table-wrap"><table class="t">
        <thead><tr><th>Period</th><th>Range</th><th class="num">Output tax</th><th class="num">Input tax</th><th class="num">Net payable</th><th>Status</th><th></th></tr></thead>
        <tbody>
        ${periods.length ? periods.map(p=>`<tr>
          <td><strong>${esc(p.periodLabel)}</strong></td><td>${fmtDate(p.fromDate)} – ${fmtDate(p.toDate)}</td>
          <td class="num">${fmtMoney(p.outputTax)}</td><td class="num">${fmtMoney(p.inputTax)}</td><td class="num">${fmtMoney(p.netPayable)}</td>
          <td>${statusBadge(p.status)}</td>
          <td class="row-actions">
            <button class="btn btn-sm" data-in="${p.id}">Input tax (CSV)</button>
            <button class="btn btn-sm" data-out="${p.id}">Output tax (CSV)</button>
            ${p.status==='CLOSED' && !vo ?`<button class="btn btn-sm btn-primary" data-pay="${p.id}">Pay</button>`:''}
          </td>
        </tr>`).join('') : `<tr><td colspan="7" class="table-empty">No tax periods yet.</td></tr>`}
        </tbody>
      </table></div>
    `;
    if(qs('#tx-new')) qs('#tx-new').addEventListener('click', ()=>openPeriodForm());
    qsa('[data-pay]').forEach(b=>b.addEventListener('click', ()=>payPeriod(Store.find('taxPeriods', b.dataset.pay))));
    qsa('[data-in]').forEach(b=>b.addEventListener('click', ()=>exportInputTaxStatement(Store.find('taxPeriods', b.dataset.in))));
    qsa('[data-out]').forEach(b=>b.addEventListener('click', ()=>exportOutputTaxStatement(Store.find('taxPeriods', b.dataset.out))));
  }

  // MIRA's own statements use a d-mmm-yy cell format (e.g. 23-Sep-26) —
  // match it exactly rather than an ISO date, so a pasted/opened CSV looks
  // right without reformatting.
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  function miraDate(iso){
    if(!iso) return '';
    const d = new Date(iso+'T00:00:00');
    if(isNaN(d)) return iso;
    return `${d.getDate()}-${MONTHS[d.getMonth()]}-${String(d.getFullYear()).slice(-2)}`;
  }
  function activityName(){ return Store.settings.taxableActivityName || Store.settings.companyName || ''; }
  function slug(s){ return String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,''); }

  /* ---- Input Tax Statement — one row per vendor bill in the period, split
     into a Revenue-expense row and/or a Capital(fixed-asset) row when a
     single bill's lines mix the two, with GST allocated proportionally
     between them. Matches MIRA's Input Tax Statement template exactly:
     #, Supplier TIN, Supplier Name, Supplier Invoice Number, Invoice Date,
     Invoice Total (excluding GST), GST Charged at 8%, Your Taxable
     Activity Name, Revenue / Capital. ---- */
  function inputTaxRows(fromDate, toDate){
    const bills = Store.all('bills').filter(b=>b.billDate>=fromDate && b.billDate<=toDate && (b.taxAmount||0)>0.004)
      .sort((a,b)=>a.billDate.localeCompare(b.billDate));
    const rows = [];
    let n = 0;
    bills.forEach(b=>{
      const vendor = Store.find('vendors', b.vendorId);
      let revNet=0, capNet=0;
      (b.lines||[]).forEach(l=>{
        const acct = Store.find('accounts', l.accountId);
        if(acct && acct.type==='ASSET') capNet += (l.amount||0); else revNet += (l.amount||0);
      });
      const totalNet = Ledger.round2(revNet+capNet);
      if(totalNet<=0.004) return;
      const groups = [];
      if(revNet>0.004) groups.push({ net: Ledger.round2(revNet), label:'Revenue' });
      if(capNet>0.004) groups.push({ net: Ledger.round2(capNet), label:'Capital' });
      groups.forEach(g=>{
        const tax = Ledger.round2(b.taxAmount * g.net/totalNet);
        n++;
        rows.push([ n, vendor?(vendor.taxNo||''):'', vendor?vendor.name:'—', b.vendorRef||b.billNo, miraDate(b.billDate),
          g.net.toFixed(2), tax.toFixed(2), activityName(), g.label ]);
      });
    });
    return rows;
  }

  function exportInputTaxStatement(period){
    if(!period) return;
    const rows = inputTaxRows(period.fromDate, period.toDate);
    const csv = toCsv(['#','Supplier TIN','Supplier Name','Supplier Invoice Number','Invoice Date','Invoice Total (excluding GST)','GST Charged at 8%','Your Taxable Activity Name','Revenue / Capital'], rows);
    downloadFile(`input-tax-statement-${slug(period.periodLabel)}.csv`, csv, 'text/csv');
    if(!rows.length) toast('No vendor bills with GST in this period — exported with headers only.', 'ok');
  }

  /* ---- Output Tax Statement — TaxInvoices: one row per sales invoice in
     the period, splitting each invoice's lines into the taxed portion
     (Value of Supplies Subject to GST) and the untaxed portion (treated as
     Exempt — this app doesn't yet distinguish zero-rated or out-of-scope
     supplies from a plain 0%-taxed/exempt package, so those two columns
     always export as 0.00; review them before filing if you sell anything
     genuinely zero-rated or out-of-scope). OtherTransactions has no source
     in this app (every sale here is an invoiced booking) so it exports
     with headers only, ready for you to fill in by hand if needed. ---- */
  function outputTaxInvoiceRows(fromDate, toDate){
    const invoices = Store.all('salesInvoices').filter(i=>i.date>=fromDate && i.date<=toDate).sort((a,b)=>a.date.localeCompare(b.date));
    return invoices.map(inv=>{
      const customer = Store.find('customers', inv.customerId);
      const taxed = Ledger.round2((inv.lines||[]).filter(l=>(l.taxBase||0)>0.004).reduce((s,l)=>s+(l.amountBase||0),0));
      const exempt = Ledger.round2((inv.lines||[]).filter(l=>(l.taxBase||0)<=0.004).reduce((s,l)=>s+(l.amountBase||0),0));
      return [ customer?(customer.taxNo||''):'', inv.customerName||'—', inv.invoiceNo, miraDate(inv.date),
        taxed.toFixed(2), (0).toFixed(2), exempt.toFixed(2), (0).toFixed(2), activityName() ];
    });
  }

  function exportOutputTaxStatement(period){
    if(!period) return;
    const rows = outputTaxInvoiceRows(period.fromDate, period.toDate);
    const csv = toCsv(['Customer TIN','Customer Name','Invoice No.','Invoice Date','Value of Supplies Subject to GST at 8% or 17% (excluding GST)','Value of Zero-Rated Supplies','Value of Exempt Supplies','Value of Out-of-Scope Supplies','Your Taxable Activity Name'], rows);
    downloadFile(`output-tax-statement-taxinvoices-${slug(period.periodLabel)}.csv`, csv, 'text/csv');
    const otherCsv = toCsv(['Your Taxable Activity Name','Value of Supplies Subject to GST at 8% or 17% (excluding GST)','Value of Zero-Rated Supplies','Value of Exempt Supplies','Value of Out-of-Scope Supplies'], []);
    downloadFile(`output-tax-statement-othertransactions-${slug(period.periodLabel)}.csv`, otherCsv, 'text/csv');
    if(!rows.length) toast('No sales invoices in this period — exported with headers only.', 'ok');
  }

  function statusBadge(s){
    return s==='PAID' ? '<span class="badge badge-green">Paid</span>' : s==='CLOSED' ? '<span class="badge badge-teal">Closed</span>' : '<span class="badge badge-gray">Open</span>';
  }

  function taxMovement(fromDate, toDate){
    const accId = Store.acctId('2100');
    let output=0, input=0;
    Store.all('journalEntries').forEach(je=>{
      if(je.date<fromDate || je.date>toDate) return;
      je.lines.forEach(l=>{
        if(l.accountId!==accId) return;
        if(je.sourceType==='booking') output += l.credit;
        else if(je.sourceType==='bill') input += l.debit;
      });
    });
    return { output: Ledger.round2(output), input: Ledger.round2(input) };
  }

  function iso(d){ return d.toISOString().slice(0,10); }

  // Finds the settings-aligned period bucket [from,to] that contains `date`.
  function periodContaining(date, freq, startMonth){
    const unit = freq==='QUARTERLY' ? 3 : 1;
    let from = new Date(date.getFullYear()-1, startMonth-1, 1);
    while(true){
      const to = new Date(from); to.setMonth(to.getMonth()+unit);
      if(date < to){
        const toInclusive = new Date(to); toInclusive.setDate(toInclusive.getDate()-1);
        return { fromDate: iso(from), toDate: iso(toInclusive) };
      }
      from = to;
    }
  }

  // The next period after the latest closed one, following the settings-driven
  // frequency/fiscal-year-start; the very first period is whichever bucket today falls in.
  function nextPeriodRange(){
    const freq = Store.settings.taxPeriodFrequency||'MONTHLY';
    const startMonth = Store.settings.taxYearStartMonth||1;
    const periods = Store.all('taxPeriods').slice().sort((a,b)=>b.toDate.localeCompare(a.toDate));
    const last = periods[0];
    if(last){
      const d = new Date(last.toDate+'T00:00:00'); d.setDate(d.getDate()+1);
      const unit = freq==='QUARTERLY' ? 3 : 1;
      const to = new Date(d); to.setMonth(to.getMonth()+unit); to.setDate(to.getDate()-1);
      return { fromDate: iso(d), toDate: iso(to) };
    }
    return periodContaining(new Date(), freq, startMonth);
  }

  function openPeriodForm(){
    if(!Auth.can('CLOSE_TAX_PERIOD')){ toast('Only an accountant or admin can close a tax period.', 'err'); return; }
    const range = nextPeriodRange();
    const label = `${fmtDate(range.fromDate)} – ${fmtDate(range.toDate)}`;
    openModal({
      title:'Close next tax period',
      bodyHtml: `
        <p class="small muted mb-8">Period boundaries follow the tax period setup in Settings (${(Store.settings.taxPeriodFrequency||'MONTHLY')==='QUARTERLY'?'quarterly':'monthly'}, fiscal year starting month ${Store.settings.taxYearStartMonth||1}).</p>
        <div class="field"><label>Label</label><input id="tp-label" type="text" value="${esc(label)}"></div>
        <dl class="kv"><dt>From</dt><dd>${fmtDate(range.fromDate)}</dd><dt>To</dt><dd>${fmtDate(range.toDate)}</dd></dl>
      `,
      footerHtml: `<button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="tp-save">Close period &amp; compute</button>`,
      onMount(modal){
        qs('#tp-save', modal).addEventListener('click', ()=>{
          const { output, input } = taxMovement(range.fromDate, range.toDate);
          Store.insert('taxPeriods', {
            periodLabel: qs('#tp-label', modal).value.trim()||label,
            fromDate: range.fromDate, toDate: range.toDate, outputTax: output, inputTax: input, netPayable: Ledger.round2(output-input), status:'CLOSED'
          });
          closeModal(); toast('Tax period closed', 'ok'); render({});
        });
      }
    });
  }

  // Tax is paid the same way a vendor bill is: through a payment voucher
  // (Bank/Cash, Payment type GL since there's no vendor/bill behind it),
  // debiting Tax Payable and crediting whichever account it's paid through.
  function payPeriod(period){
    if(!period) return;
    if(!Auth.can('APPROVE_VOUCHER')){ toast('Only an accountant or admin can pay this.', 'err'); return; }
    VouchersModule.openForm({
      kind:'BANK_CASH', payee:'Tax authority', memo: period.periodLabel,
      glLine: { accountId: Store.acctId('2100'), description:'Tax — '+period.periodLabel, amount: period.netPayable },
      onPaid: ()=>{ Store.update('taxPeriods', period.id, { status:'PAID' }); render({}); }
    });
  }

  Router.on('/tax', render);
})();
