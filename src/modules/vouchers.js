/* ---------------------------------------------------------------------
   vouchers.js — payment vouchers: the document that authorizes any
   money going out.

   Voucher type (kind):
     BANK_CASH — paid from Cash on Hand or Bank; its GL lines can hit any
                 expense/liability account (this is also how a petty cash
                 float is funded and replenished internally — see
                 pettycash.js — those system vouchers aren't built from
                 this form, so they're free to debit the float's own
                 asset account instead).
     PETTY     — paid out of one petty cash float's box (voucher.floatId);
                 its GL lines are restricted to expense accounts only, and
                 its payment type is always GL (a float never settles a
                 vendor bill directly).

   Every voucher header carries: voucher type, payment method (Cash/Bank —
   PETTY implies Cash from the box), payment date, currency, the account
   actually credited ("payment through account"), and a payment type:
     Vendor — settles one or more of a single vendor's unpaid bills. Each
              line is Bill No / Bill date / Bill amount (due) / Amount to
              pay (entered by the user, up to the due amount). Posts a
              debit to Accounts Payable per bill and credits the payment-
              through account.
     GL     — a direct expense/liability payment with no vendor bill.
              Each line is GL account / Memo / Payment amount. Posts a
              debit to the chosen account per line and credits the
              payment-through account.
--------------------------------------------------------------------- */

(function(){

  const KIND_LABEL = { BANK_CASH:'Bank / cash payment', PETTY:'Petty cash payment' };
  const PAYTYPE_LABEL = { VENDOR:'Vendor', GL:'GL (direct expense/liability)' };

  function render(params){
    setPageTitle('Payment vouchers', 'Finance');
    renderNav();
    const vo = Auth.isViewOnly();
    const rows = Store.all('vouchers').slice().sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
    qs('#content').innerHTML = `
      <div class="toolbar"><div class="spacer"></div>${vo?'':`<button class="btn btn-primary" id="vo-add">+ New voucher</button>`}</div>
      <div class="table-wrap"><table class="t">
        <thead><tr><th>Voucher #</th><th>Kind</th><th>Type</th><th>Payee</th><th>Date</th><th>Method</th><th class="num">Amount</th><th>Status</th><th></th></tr></thead>
        <tbody>
        ${rows.length ? rows.map(v=>{
          const vend = v.paymentType==='VENDOR' && v.vendorId ? Store.find('vendors', v.vendorId) : null;
          return `<tr>
          <td><strong>${esc(v.voucherNo)}</strong></td><td>${KIND_LABEL[v.kind]||v.kind}</td>
          <td>${v.paymentType?esc(PAYTYPE_LABEL[v.paymentType]||v.paymentType):'—'}${vend?' — '+esc(vend.name):''}</td>
          <td>${esc(v.payee||'—')}</td>
          <td>${fmtDate(v.date)}</td><td>${esc(v.kind==='PETTY'?'Petty cash':v.method)}${v.kind!=='PETTY'&&v.currency&&v.currency!==Pricing.baseCurrency()?' <span class="badge badge-gray small">'+esc(v.currency)+'</span>':''}</td><td class="num">${fmtMoney(v.amount)}</td>
          <td>${statusBadge(v.status)}</td>
          <td class="row-actions">${v.status==='DRAFT' && !vo ?`<button class="btn btn-sm btn-primary" data-pay="${v.id}">Approve &amp; pay</button>`:''}</td>
        </tr>`;
        }).join('') : `<tr><td colspan="9" class="table-empty">No vouchers yet.</td></tr>`}
        </tbody>
      </table></div>
    `;
    if(qs('#vo-add')) qs('#vo-add').addEventListener('click', ()=>openForm());
    qsa('[data-pay]').forEach(b=>b.addEventListener('click', ()=>approveAndPay(b.dataset.pay)));
  }

  function statusBadge(s){
    return s==='PAID' ? '<span class="badge badge-green">Paid</span>' : '<span class="badge badge-amber">Draft — needs approval</span>';
  }

  function approveAndPay(id){
    if(!Auth.can('APPROVE_VOUCHER')){ toast('Only an accountant or admin can approve and pay a voucher.', 'err'); return; }
    const v = Store.find('vouchers', id);
    if(!v) return;
    try{
      Posting.postVoucher(v);
      Store.update('vouchers', v.id, { status:'PAID', approvedBy: Auth.currentUser().name });
      toast('Voucher paid', 'ok');
      Router.render();
    }catch(e){ toast(e.message, 'err'); }
  }

  // Real bank accounts the voucher can pay from — excludes the per-currency
  // Cash on Hand control accounts and every petty cash float's own
  // sub-account (both are tagged subtype CASH), so only 1060 Bank Account
  // and any further bank accounts the shop adds show up here.
  function bankAccounts(){
    return Store.all('accounts').filter(a=>a.active && a.accountType==='Bank' && a.subtype!=='CASH');
  }

  // opts: { kind, payee, memo, billId (prefill a bill line), vendorId, tripId,
  //         glLine (prefill the default GL line: {accountId, description, amount}),
  //         onPaid(voucher) }
  function openForm(opts){
    opts = opts || {};
    const vendors = Store.all('vendors');
    const glAccountsFor = (kind)=> Store.all('accounts').filter(a=>a.active && (kind==='PETTY' ? a.type==='EXPENSE' : ['EXPENSE','LIABILITY'].includes(a.type)));
    const unpaidBills = Store.all('bills').filter(b=>b.status!=='PAID' && (b.status==='APPROVED'||b.status==='PARTIAL'));
    const activeFloats = Store.all('pettyCashFloats').filter(f=>f.active!==false);
    const banks = bankAccounts();

    let prefillVendorId = opts.vendorId || null;
    let paymentType = opts.billId || prefillVendorId ? 'VENDOR' : 'GL';
    let lines = [];
    if(opts.billId){
      const bill = Store.find('bills', opts.billId);
      if(bill){ lines.push({ kind:'BILL', billId: bill.id, vendorId: bill.vendorId, amount: Ledger.round2(bill.totalAmount-(bill.paidAmount||0)) }); prefillVendorId = bill.vendorId; }
    }
    if(!lines.length && paymentType==='GL'){
      if(opts.glLine){
        lines.push({ kind:'GL', accountId: opts.glLine.accountId, description: opts.glLine.description||'', amount: opts.glLine.amount||0 });
      } else {
        const g = glAccountsFor(opts.kind||'BANK_CASH');
        lines.push({ kind:'GL', accountId: g[0]?g[0].id:'', description:'', amount:0 });
      }
    }

    openModal({
      title: 'New payment voucher', size:'lg',
      bodyHtml: `
        <div class="form-row">
          <div class="field"><label>Voucher type</label>
            <select id="vf-kind">
              <option value="BANK_CASH" ${(!opts.kind||opts.kind==='BANK_CASH')?'selected':''}>${KIND_LABEL.BANK_CASH}</option>
              <option value="PETTY" ${opts.kind==='PETTY'?'selected':''}>${KIND_LABEL.PETTY}</option>
            </select>
          </div>
          <div class="field" id="vf-method-wrap"><label>Payment method</label>
            <select id="vf-method"><option value="CASH">Cash</option><option value="BANK">Bank</option></select>
          </div>
          <div class="field"><label>Payment date</label><input id="vf-date" type="date" value="${opts.date||todayISO()}"></div>
        </div>
        <div class="form-row">
          <div class="field" id="vf-currency-wrap"><label>Currency</label>
            <select id="vf-currency">${['MVR','USD','EUR'].map(c=>`<option value="${c}" ${c===Pricing.baseCurrency()?'selected':''}>${c}</option>`).join('')}</select>
          </div>
          <div class="field" id="vf-float-wrap" style="display:none"><label>Payment through — float</label>
            <select id="vf-float">${activeFloats.map(f=>`<option value="${f.id}">${esc(f.floatNo)} — ${esc(f.custodian||f.purpose||'')}</option>`).join('')||'<option value="">No floats set up</option>'}</select>
          </div>
          <div class="field" id="vf-payaccount-wrap"><label>Payment through account</label>
            <select id="vf-payaccount"></select>
          </div>
        </div>
        <div class="form-row">
          <div class="field"><label>Payment type</label>
            <select id="vf-paytype">
              <option value="VENDOR" ${paymentType==='VENDOR'?'selected':''}>${PAYTYPE_LABEL.VENDOR}</option>
              <option value="GL" ${paymentType==='GL'?'selected':''}>${PAYTYPE_LABEL.GL}</option>
            </select>
          </div>
          <div class="field" id="vf-vendor-wrap"><label>Vendor</label>
            <select id="vf-vendor">${vendors.map(v=>`<option value="${v.id}" ${v.id===prefillVendorId?'selected':''}>${esc(v.name)}</option>`).join('')||'<option value="">No vendors yet</option>'}</select>
          </div>
          <div class="field"><label>Payee</label><input id="vf-payee" type="text" value="${esc(opts.payee||'')}" placeholder="Who is this paid to?"></div>
        </div>
        <div class="field"><label>Payment description</label><input id="vf-memo" type="text" value="${esc(opts.memo||'')}"></div>
        <div class="section-title">Lines</div>
        <p class="small muted mb-8" id="vf-petty-hint" style="display:none">Petty cash vouchers can only post direct GL lines to an expense account.</p>
        <div id="vf-lines"></div>
        <button type="button" class="btn btn-sm" id="vf-add-bill-line">+ Add bill line</button>
        <button type="button" class="btn btn-sm" id="vf-add-gl-line">+ Add GL line</button>
        <div class="form-row mt-16">
          <div class="field"><label>Total</label><input id="vf-total" type="text" readonly style="background:#f4f2ea;font-weight:600"></div>
        </div>
      `,
      footerHtml: `<button class="btn" data-close>Cancel</button><button class="btn" id="vf-draft">Save as draft</button><button class="btn btn-primary" id="vf-pay">Approve &amp; pay now</button>`,
      onMount(modal){
        const kindSel = qs('#vf-kind', modal), methodSel = qs('#vf-method', modal), methodWrap = qs('#vf-method-wrap', modal), pettyHint = qs('#vf-petty-hint', modal);
        const currWrap = qs('#vf-currency-wrap', modal), currSel = qs('#vf-currency', modal), floatWrap = qs('#vf-float-wrap', modal);
        const payAcctWrap = qs('#vf-payaccount-wrap', modal), payAcctSel = qs('#vf-payaccount', modal);
        const paytypeSel = qs('#vf-paytype', modal), vendorWrap = qs('#vf-vendor-wrap', modal), vendorSel = qs('#vf-vendor', modal);
        const addBillBtn = qs('#vf-add-bill-line', modal), addGlBtn = qs('#vf-add-gl-line', modal);

        function eligibleGlAccounts(){ return glAccountsFor(kindSel.value); }

        // Populates the "Payment through account" dropdown for the current
        // kind/method/currency. Petty cash pays through the selected
        // float instead (see vf-float-wrap), so this stays hidden then.
        function updatePayAccountOptions(){
          if(kindSel.value==='PETTY'){ payAcctWrap.style.display = 'none'; return; }
          payAcctWrap.style.display = '';
          if(methodSel.value==='BANK'){
            payAcctSel.disabled = false;
            payAcctSel.innerHTML = banks.map(a=>`<option value="${a.id}">${esc(a.code)} — ${esc(a.name)}</option>`).join('') || '<option value="">No bank account set up</option>';
          } else {
            const acct = Store.find('accounts', Posting.resolveMethodAccountId('CASH', currSel.value));
            payAcctSel.innerHTML = acct ? `<option value="${acct.id}">${esc(acct.code)} — ${esc(acct.name)}</option>` : '<option value="">—</option>';
            payAcctSel.disabled = true; // fixed 1:1 with currency — nothing to choose
          }
        }

        function updateKindUi(){
          const isPetty = kindSel.value==='PETTY';
          methodWrap.style.display = isPetty ? 'none' : '';
          currWrap.style.display = isPetty ? 'none' : (paytypeSel.value==='VENDOR' ? 'none' : '');
          floatWrap.style.display = isPetty ? '' : 'none';
          pettyHint.style.display = isPetty ? '' : 'none';
          if(isPetty){
            paytypeSel.value = 'GL'; paytypeSel.disabled = true;
          } else {
            paytypeSel.disabled = false;
          }
          updatePayTypeUi();
          updatePayAccountOptions();
        }

        function updatePayTypeUi(){
          const isVendor = paytypeSel.value==='VENDOR';
          vendorWrap.style.display = isVendor ? '' : 'none';
          addBillBtn.style.display = isVendor ? '' : 'none';
          addGlBtn.style.display = isVendor ? 'none' : '';
          currWrap.style.display = kindSel.value==='PETTY' ? 'none' : (isVendor ? 'none' : '');
        }

        function currentVendorId(){ return vendorSel.value || null; }

        function renderLines(){
          const isVendor = paytypeSel.value==='VENDOR';
          qs('#vf-lines', modal).innerHTML = lines.map((l,i)=>{
            if(l.kind==='BILL'){
              const vId = currentVendorId();
              const vendorBills = unpaidBills.filter(b=>b.vendorId===vId);
              const bill = Store.find('bills', l.billId);
              const due = bill ? Ledger.round2(bill.totalAmount-(bill.paidAmount||0)) : 0;
              return `<div class="form-row" data-line="${i}">
                <div class="field"><span class="small muted">Bill no</span><select data-l-bill="${i}">${vendorBills.map(b=>{
                  const d = Ledger.round2(b.totalAmount-(b.paidAmount||0));
                  return `<option value="${b.id}" ${b.id===l.billId?'selected':''} data-amt="${d}">${esc(b.billNo)} (${fmtMoney(d)} due)</option>`;
                }).join('')||'<option value="">No unpaid bills for this vendor</option>'}</select></div>
                <div class="field" style="max-width:110px"><span class="small muted">Bill date</span><input type="text" readonly value="${bill?fmtDate(bill.billDate):'—'}"></div>
                <div class="field" style="max-width:110px"><span class="small muted">Bill amount</span><input type="text" readonly value="${fmtMoney(due)}"></div>
                <div class="field" style="max-width:130px"><span class="small muted">Amount to pay</span><input type="number" min="0" step="0.01" max="${due}" data-l-amt="${i}" value="${l.amount}"></div>
                <button type="button" class="btn btn-icon btn-ghost" data-l-del="${i}">&times;</button>
              </div>`;
            }
            const opts2 = eligibleGlAccounts();
            return `<div class="form-row" data-line="${i}">
              <div class="field"><span class="small muted">GL account</span><select data-l-acct="${i}">${opts2.map(a=>`<option value="${a.id}" ${l.accountId===a.id?'selected':''}>${esc(a.code)} — ${esc(a.name)}</option>`).join('')}</select></div>
              <div class="field"><span class="small muted">Memo</span><input type="text" data-l-desc="${i}" value="${esc(l.description||'')}"></div>
              <div class="field" style="max-width:130px"><span class="small muted">Payment amount</span><input type="number" min="0" step="0.01" data-l-amt="${i}" value="${l.amount}"></div>
              <button type="button" class="btn btn-icon btn-ghost" data-l-del="${i}">&times;</button>
            </div>`;
          }).join('') || `<p class="muted small">No lines yet — add a ${isVendor?'bill':'GL'} line.</p>`;
          qsa('[data-l-bill]', modal).forEach(s=>s.addEventListener('change', e=>{
            const i=+e.target.dataset.lBill, o=e.target.selectedOptions[0];
            lines[i].billId = e.target.value; lines[i].vendorId = currentVendorId();
            if(o && o.dataset.amt) lines[i].amount = parseFloat(o.dataset.amt)||0;
            renderLines(); updateTotal();
          }));
          qsa('[data-l-acct]', modal).forEach(s=>s.addEventListener('change', e=>{ lines[+e.target.dataset.lAcct].accountId = e.target.value; }));
          qsa('[data-l-desc]', modal).forEach(s=>s.addEventListener('input', e=>{ lines[+e.target.dataset.lDesc].description = e.target.value; }));
          qsa('[data-l-amt]', modal).forEach(s=>s.addEventListener('input', e=>{ lines[+e.target.dataset.lAmt].amount = parseFloat(e.target.value)||0; updateTotal(); }));
          qsa('[data-l-del]', modal).forEach(b=>b.addEventListener('click', e=>{ lines.splice(+e.target.dataset.lDel,1); renderLines(); updateTotal(); }));
        }
        function updateTotal(){
          const sum = Ledger.round2(lines.reduce((s,l)=>s+(l.amount||0),0));
          qs('#vf-total', modal).value = fmtMoney(sum);
        }

        kindSel.addEventListener('change', ()=>{ updateKindUi(); renderLines(); updateTotal(); });
        methodSel.addEventListener('change', updatePayAccountOptions);
        // Payee auto-fills to the chosen vendor's name as a convenience, but
        // only until the user actually types their own payee — after that
        // we never clobber what they typed, even if they switch vendors.
        let payeeAutoFilled = true;
        qs('#vf-payee', modal).addEventListener('input', ()=>{ payeeAutoFilled = false; });
        function autoFillPayee(vId){
          const v = Store.find('vendors', vId);
          if(v && payeeAutoFilled){ qs('#vf-payee', modal).value = v.name; }
        }
        currSel.addEventListener('change', updatePayAccountOptions);
        paytypeSel.addEventListener('change', ()=>{
          // switching payment type starts the lines over — mixing bill and
          // GL lines under one payment type no longer makes sense.
          if(paytypeSel.value==='VENDOR'){
            const vId = currentVendorId();
            const vb = unpaidBills.filter(b=>b.vendorId===vId);
            lines = vb[0] ? [{ kind:'BILL', billId: vb[0].id, vendorId: vId, amount: Ledger.round2(vb[0].totalAmount-(vb[0].paidAmount||0)) }] : [];
            autoFillPayee(vId);
          } else {
            const g = eligibleGlAccounts();
            lines = [{ kind:'GL', accountId: g[0]?g[0].id:'', description:'', amount:0 }];
          }
          updatePayTypeUi(); renderLines(); updateTotal();
        });
        vendorSel.addEventListener('change', ()=>{
          const vId = currentVendorId();
          const vb = unpaidBills.filter(b=>b.vendorId===vId);
          lines = vb[0] ? [{ kind:'BILL', billId: vb[0].id, vendorId: vId, amount: Ledger.round2(vb[0].totalAmount-(vb[0].paidAmount||0)) }] : [];
          autoFillPayee(vId);
          renderLines(); updateTotal();
        });
        addBillBtn.addEventListener('click', ()=>{
          const vId = currentVendorId();
          const taken = new Set(lines.filter(l=>l.kind==='BILL').map(l=>l.billId));
          const next = unpaidBills.find(b=>b.vendorId===vId && !taken.has(b.id));
          lines.push({kind:'BILL', billId: next?next.id:'', vendorId: vId, amount: next?Ledger.round2(next.totalAmount-(next.paidAmount||0)):0});
          renderLines(); updateTotal();
        });
        addGlBtn.addEventListener('click', ()=>{ const accts=eligibleGlAccounts(); lines.push({kind:'GL', accountId: accts[0]?accts[0].id:'', description:'', amount:0}); renderLines(); updateTotal(); });
        updateKindUi(); renderLines(); updateTotal();

        function collect(){
          const kind = kindSel.value;
          const paymentType = paytypeSel.value;
          const payee = qs('#vf-payee', modal).value.trim();
          const date = qs('#vf-date', modal).value || todayISO();
          const method = kind==='PETTY' ? 'CASH' : methodSel.value;
          const currency = (kind==='PETTY' || paymentType==='VENDOR') ? Pricing.baseCurrency() : currSel.value;
          const memo = qs('#vf-memo', modal).value.trim();
          const cleanLines = lines.filter(l=>l.amount>0 && (l.kind==='BILL' ? l.billId : l.accountId));
          if(!payee){ toast('Enter a payee.', 'err'); return null; }
          if(!cleanLines.length){ toast('Add at least one line with an amount.', 'err'); return null; }
          let floatId = null, vendorId = null, payThroughAccountId = null;
          if(kind==='PETTY'){
            const bad = cleanLines.find(l=>l.kind==='GL' && (Store.find('accounts', l.accountId)||{}).type!=='EXPENSE');
            if(bad){ toast('Petty cash GL lines must be an expense account.', 'err'); return null; }
            floatId = qs('#vf-float', modal).value;
            if(!floatId){ toast('Set up a petty cash float first (Petty cash page).', 'err'); return null; }
            payThroughAccountId = (Store.find('pettyCashFloats', floatId)||{}).accountId;
          } else {
            payThroughAccountId = payAcctSel.value;
            if(!payThroughAccountId){ toast('Pick which account this pays through.', 'err'); return null; }
          }
          if(paymentType==='VENDOR'){
            vendorId = currentVendorId();
            if(!vendorId){ toast('Pick a vendor.', 'err'); return null; }
            const badVendor = cleanLines.find(l=>l.kind!=='BILL' || l.vendorId!==vendorId);
            if(badVendor){ toast('A vendor voucher can only settle that vendor\'s own bills.', 'err'); return null; }
            const over = cleanLines.find(l=>{ const b=Store.find('bills', l.billId); return b && l.amount > Ledger.round2(b.totalAmount-(b.paidAmount||0))+0.004; });
            if(over){ toast('Amount to pay can\'t exceed a bill\'s outstanding balance.', 'err'); return null; }
          } else {
            const bad = cleanLines.find(l=>l.kind!=='GL' || !['EXPENSE','LIABILITY'].includes((Store.find('accounts', l.accountId)||{}).type));
            if(bad){ toast('GL payment lines must be an expense or liability account.', 'err'); return null; }
          }
          const amount = Ledger.round2(cleanLines.reduce((s,l)=>s+(l.amount||0),0));
          return { voucherNo: Store.docNo('PV','voucher'), kind, paymentType, vendorId, payee, date, method, currency, memo, amount, lines: cleanLines, tripId: opts.tripId||null, floatId, payThroughAccountId };
        }

        qs('#vf-draft', modal).addEventListener('click', ()=>{
          const data = collect(); if(!data) return;
          Store.insert('vouchers', Object.assign(data, {status:'DRAFT'}));
          closeModal(); toast('Voucher saved as draft', 'ok'); Router.render();
        });
        qs('#vf-pay', modal).addEventListener('click', ()=>{
          if(!Auth.can('APPROVE_VOUCHER')){ toast('Only an accountant or admin can approve and pay.', 'err'); return; }
          const data = collect(); if(!data) return;
          const v = Store.insert('vouchers', Object.assign(data, {status:'DRAFT'}));
          try{ Posting.postVoucher(v); Store.update('vouchers', v.id, {status:'PAID', approvedBy: Auth.currentUser().name}); closeModal(); toast('Voucher paid', 'ok'); Router.render(); if(opts.onPaid) opts.onPaid(v); }
          catch(e){ toast(e.message, 'err'); Store.remove('vouchers', v.id); }
        });
      }
    });
  }

  // Programmatic single-line voucher creation used by payroll/tax/pettycash/etc.
  // Bypasses the payment-type/vendor rules above (they're a form-level
  // guardrail for user-entered vouchers) — data.lines/data.method/
  // data.payThroughAccountId drive Posting.postVoucher directly.
  // data: { payee, date, method, memo, lines:[{kind:'GL'|'BILL', accountId/billId, amount, description}], tripId, floatId, payThroughAccountId }
  function quickCreate(kind, data, payNow){
    const lines = data.lines || [];
    const amount = Ledger.round2(lines.reduce((s,l)=>s+(l.amount||0),0));
    const v = Store.insert('vouchers', Object.assign({
      voucherNo: Store.docNo('PV','voucher'), status:'DRAFT', date: todayISO(), method:'CASH', currency: Pricing.baseCurrency()
    }, data, { kind, amount, lines }));
    if(payNow){ Posting.postVoucher(v); Store.update('vouchers', v.id, {status:'PAID', approvedBy: Auth.currentUser().name}); }
    return v;
  }

  Router.on('/vouchers', render);
  window.VouchersModule = { openForm, quickCreate, KIND_LABEL };
})();
