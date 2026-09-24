/* ---------------------------------------------------------------------
   bills.js — vendor bill entry. A bill posts the expense and the
   payable at entry; a payment voucher later clears the payable.
--------------------------------------------------------------------- */

(function(){

  function render(params){
    setPageTitle('Bills', 'Finance');
    renderNav();
    const vo = Auth.isViewOnly();
    const rows = Store.all('bills').slice().sort((a,b)=>b.billDate.localeCompare(a.billDate));
    qs('#content').innerHTML = `
      <div class="toolbar"><div class="spacer"></div>${vo?'':`<button class="btn btn-primary" id="bl-add">+ Enter bill</button>`}</div>
      <div class="table-wrap"><table class="t">
        <thead><tr><th>Bill #</th><th>Vendor</th><th>Bill date</th><th>Due</th><th>Trip</th><th>Status</th><th class="num">Total</th><th class="num">Paid</th><th></th></tr></thead>
        <tbody>
        ${rows.length ? rows.map(b=>{
          const v = Store.find('vendors', b.vendorId);
          const trip = b.tripId ? Store.find('trips', b.tripId) : null;
          const due = Ledger.round2(b.totalAmount-(b.paidAmount||0));
          return `<tr>
            <td><a onclick="Router.navigate('vendors/${b.vendorId}')">${esc(b.billNo)}</a></td>
            <td>${esc(v?v.name:'—')}</td><td>${fmtDate(b.billDate)}</td><td>${fmtDate(b.dueDate)}</td>
            <td>${trip?esc(trip.tripNo||''):'—'}</td>
            <td>${statusBadge(b.status)}</td><td class="num">${fmtMoney(b.totalAmount)}</td><td class="num">${fmtMoney(b.paidAmount||0)}</td>
            <td class="row-actions">
              ${!b.approved && !vo ? `<button class="btn btn-sm" data-approve="${b.id}">Approve</button>` : ''}
              ${b.approved && due>0.01 && !vo ? `<button class="btn btn-sm btn-primary" data-pay="${b.id}">Pay</button>` : ''}
            </td>
          </tr>`;
        }).join('') : `<tr><td colspan="9" class="table-empty">No bills yet.</td></tr>`}
        </tbody>
      </table></div>
    `;
    if(qs('#bl-add')) qs('#bl-add').addEventListener('click', ()=>openForm());
    qsa('[data-approve]').forEach(b=>b.addEventListener('click', ()=>approve(b.dataset.approve)));
    qsa('[data-pay]').forEach(b=>b.addEventListener('click', ()=>{
      const bill = Store.find('bills', b.dataset.pay);
      const vend = Store.find('vendors', bill.vendorId);
      VouchersModule.openForm({ kind:'BANK_CASH', billId: bill.id, vendorId: bill.vendorId, payee: vend?vend.name:'' });
    }));
  }

  function statusBadge(s){
    const map = { DRAFT:'badge-gray', APPROVED:'badge-teal', PARTIAL:'badge-amber', PAID:'badge-green' };
    return `<span class="badge ${map[s]||'badge-gray'}">${esc(s)}</span>`;
  }

  function approve(id){
    if(!Auth.can('APPROVE_BILL')){ toast('Only an accountant or admin can approve a bill.', 'err'); return; }
    Store.update('bills', id, { approved:true, approvedBy: Auth.currentUser().name, status:'APPROVED' });
    toast('Bill approved', 'ok'); render({});
  }

  function openForm(prefill){
    prefill = prefill || {};
    const vendors = Store.all('vendors');
    const expenseAccounts = Store.all('accounts').filter(a=>['EXPENSE','ASSET'].includes(a.type) && a.active);
    const trips = Store.all('trips').slice().sort((a,b)=>b.tripDate.localeCompare(a.tripDate)).slice(0,200);
    if(!vendors.length){ toast('Add a vendor first.', 'err'); return; }
    let lines = prefill.lines || [{ accountId: (prefill.accountId||(expenseAccounts[0]?expenseAccounts[0].id:'')), description: prefill.description||'', amount: prefill.amount||0 }];

    openModal({
      title: prefill.title || 'Enter bill', size:'lg',
      bodyHtml: `
        <div class="form-row">
          <div class="field"><label>Vendor</label><select id="bf-vendor">${vendors.map(v=>`<option value="${v.id}" ${prefill.vendorId===v.id?'selected':''}>${esc(v.name)}</option>`).join('')}</select></div>
          <div class="field"><label>Bill number / reference</label><input id="bf-ref" type="text" value="${esc(prefill.vendorRef||'')}"></div>
        </div>
        <div class="form-row">
          <div class="field"><label>Bill date</label><input id="bf-date" type="date" value="${todayISO()}"></div>
          <div class="field"><label>Due date</label><input id="bf-due" type="date" value="${todayISO()}"></div>
          <div class="field"><label>Trip <span class="hint">(optional — for cost allocation)</span></label>
            <select id="bf-trip"><option value="">—</option>${trips.map(t=>`<option value="${t.id}" ${prefill.tripId===t.id?'selected':''}>${esc(t.tripNo||'')} ${fmtDate(t.tripDate)}</option>`).join('')}</select>
          </div>
        </div>
        <div class="section-title">Lines</div>
        <div id="bf-lines"></div>
        <button type="button" class="btn btn-sm" id="bf-add-line">+ Add line</button>
        <div class="form-row mt-16">
          <div class="field"><label>Tax amount</label><input id="bf-tax" type="number" min="0" step="0.01" value="0"></div>
          <div class="field"><label>Total</label><input id="bf-total" type="text" readonly style="background:#f4f2ea;font-weight:600"></div>
        </div>
      `,
      footerHtml: `<button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="bf-save">Save bill</button>`,
      onMount(modal){
        function renderLines(){
          qs('#bf-lines', modal).innerHTML = lines.map((l,i)=>`
            <div class="form-row" data-line="${i}">
              <div class="field"><select data-l-acct="${i}">${expenseAccounts.map(a=>`<option value="${a.id}" ${l.accountId===a.id?'selected':''}>${esc(a.code)} — ${esc(a.name)}</option>`).join('')}</select></div>
              <div class="field"><input type="text" placeholder="Description" data-l-desc="${i}" value="${esc(l.description)}"></div>
              <div class="field" style="max-width:120px"><input type="number" min="0" step="0.01" data-l-amt="${i}" value="${l.amount}"></div>
              <button type="button" class="btn btn-icon btn-ghost" data-l-del="${i}">&times;</button>
            </div>`).join('');
          qsa('[data-l-acct]', modal).forEach(s=>s.addEventListener('change', e=>{ lines[+e.target.dataset.lAcct].accountId = e.target.value; }));
          qsa('[data-l-desc]', modal).forEach(s=>s.addEventListener('input', e=>{ lines[+e.target.dataset.lDesc].description = e.target.value; }));
          qsa('[data-l-amt]', modal).forEach(s=>s.addEventListener('input', e=>{ lines[+e.target.dataset.lAmt].amount = parseFloat(e.target.value)||0; updateTotal(); }));
          qsa('[data-l-del]', modal).forEach(b=>b.addEventListener('click', e=>{ lines.splice(+e.target.dataset.lDel,1); renderLines(); updateTotal(); }));
        }
        function updateTotal(){
          const sub = lines.reduce((s,l)=>s+(l.amount||0),0);
          const tax = parseFloat(qs('#bf-tax', modal).value)||0;
          qs('#bf-total', modal).value = fmtMoney(Ledger.round2(sub+tax));
        }
        qs('#bf-add-line', modal).addEventListener('click', ()=>{ lines.push({accountId:expenseAccounts[0]?expenseAccounts[0].id:'', description:'', amount:0}); renderLines(); });
        qs('#bf-tax', modal).addEventListener('input', updateTotal);
        renderLines(); updateTotal();

        qs('#bf-save', modal).addEventListener('click', ()=>{
          const vendorId = qs('#bf-vendor', modal).value;
          const sub = lines.reduce((s,l)=>s+(l.amount||0),0);
          const tax = parseFloat(qs('#bf-tax', modal).value)||0;
          if(!sub){ toast('Add at least one line with an amount.', 'err'); return; }
          const bill = {
            billNo: Store.docNo('BL','bill'), vendorRef: qs('#bf-ref', modal).value.trim(), vendorId,
            billDate: qs('#bf-date', modal).value||todayISO(), dueDate: qs('#bf-due', modal).value||todayISO(),
            tripId: qs('#bf-trip', modal).value||null,
            lines: lines.filter(l=>l.amount), taxAmount: tax, totalAmount: Ledger.round2(sub+tax),
            paidAmount:0, status:'DRAFT', approved:false
          };
          const saved = Store.insert('bills', bill);
          try{ Posting.postBill(saved); }catch(e){ toast(e.message, 'err'); Store.remove('bills', saved.id); return; }
          closeModal(); toast('Bill saved', 'ok');
          if(prefill.onSaved) prefill.onSaved(saved);
          render({});
        });
      }
    });
  }

  Router.on('/bills', render);
  window.BillsModule = { openForm };
})();
