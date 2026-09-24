/* ---------------------------------------------------------------------
   vendors.js — vendor register. Every bill belongs to exactly one vendor.
--------------------------------------------------------------------- */

(function(){

  function render(params){
    setPageTitle('Vendors', 'Directory');
    renderNav();
    const q = (params.q||'').toLowerCase();
    let rows = Store.all('vendors').slice().sort((a,b)=>a.name.localeCompare(b.name));
    if(q) rows = rows.filter(v=>v.name.toLowerCase().includes(q));

    const vo = Auth.isViewOnly();
    qs('#content').innerHTML = `
      <div class="toolbar">
        <input class="search-input" id="v-search" type="text" placeholder="Search vendors…" value="${esc(params.q||'')}">
        <div class="spacer"></div>
        ${vo?'':`<button class="btn btn-primary" id="v-add">+ Add vendor</button>`}
      </div>
      <div class="table-wrap">
        <table class="t">
          <thead><tr><th>Name</th><th>Terms</th><th>Tax number</th><th class="num">Balance owed</th><th></th></tr></thead>
          <tbody>
            ${rows.length ? rows.map(rowHtml).join('') : `<tr><td colspan="5" class="table-empty">No vendors yet.</td></tr>`}
          </tbody>
        </table>
      </div>
    `;
    qs('#v-search').addEventListener('input', debounce(e=>Router.navigate('vendors?q='+encodeURIComponent(e.target.value))));
    if(qs('#v-add')) qs('#v-add').addEventListener('click', ()=>openVendorForm());
    qsa('[data-view]').forEach(b=>b.addEventListener('click', ()=>Router.navigate('vendors/'+b.dataset.view)));
    qsa('[data-edit]').forEach(b=>b.addEventListener('click', e=>{ e.stopPropagation(); openVendorForm(Store.find('vendors', b.dataset.edit)); }));
  }

  function rowHtml(v){
    const bal = -Ledger.partyBalance('vendor', v.id); // AP is credit-natural; show as positive owed
    return `<tr style="cursor:pointer" data-view="${v.id}">
      <td><strong>${esc(v.name)}</strong></td>
      <td>${esc(v.terms||'—')}</td>
      <td>${esc(v.taxNo||'—')}</td>
      <td class="num">${fmtMoney(bal)}</td>
      <td class="row-actions">${Auth.isViewOnly()?'':`<button class="btn btn-sm" data-edit="${v.id}">Edit</button>`}</td>
    </tr>`;
  }

  function detail(params){
    const v = Store.find('vendors', params.id);
    if(!v){ Router.navigate('vendors'); return; }
    setPageTitle(v.name, 'Vendors');
    renderNav();
    const bills = Store.all('bills').filter(b=>b.vendorId===v.id).sort((a,b)=>b.billDate.localeCompare(a.billDate));
    const entries = Ledger.partyEntries('vendor', v.id);
    const bal = -Ledger.partyBalance('vendor', v.id);

    qs('#content').innerHTML = `
      <div class="toolbar"><button class="btn" onclick="Router.navigate('vendors')">&larr; All vendors</button><div class="spacer"></div>${Auth.isViewOnly()?'':'<button class="btn" id="v-edit">Edit</button>'}</div>
      <div class="grid grid-3 mb-16">
        <div class="stat"><div class="label">Amount owed</div><div class="value">${fmtMoney(bal)}</div></div>
        <div class="stat"><div class="label">Bills</div><div class="value">${bills.length}</div></div>
        <div class="stat"><div class="label">Terms</div><div class="value" style="font-size:16px">${esc(v.terms||'—')}</div></div>
      </div>
      <div class="card">
        <div class="card-head"><h2>Details</h2></div>
        <dl class="kv">
          <dt>Contact</dt><dd>${esc(v.contact||'—')}</dd>
          <dt>Phone</dt><dd>${esc(v.phone||'—')}</dd>
          <dt>Email</dt><dd>${esc(v.email||'—')}</dd>
          <dt>Address</dt><dd>${esc(v.address||'—')}</dd>
          <dt>Tax number</dt><dd>${esc(v.taxNo||'—')}</dd>
        </dl>
      </div>
      <div class="card">
        <div class="card-head"><h2>Bills</h2></div>
        <div class="table-wrap"><table class="t">
          <thead><tr><th>Bill #</th><th>Date</th><th>Due</th><th>Status</th><th class="num">Total</th><th class="num">Paid</th></tr></thead>
          <tbody>
          ${bills.length ? bills.map(b=>`<tr style="cursor:pointer" onclick="Router.navigate('bills/${b.id}')"><td><strong>${esc(b.billNo)}</strong></td><td>${fmtDate(b.billDate)}</td><td>${fmtDate(b.dueDate)}</td><td>${esc(b.status)}</td><td class="num">${fmtMoney(b.totalAmount)}</td><td class="num">${fmtMoney(b.paidAmount||0)}</td></tr>`).join('')
            : `<tr><td colspan="6" class="table-empty">No bills yet.</td></tr>`}
          </tbody>
        </table></div>
      </div>
      <div class="card">
        <div class="card-head"><h2>Vendor ledger</h2></div>
        <div class="table-wrap"><table class="t">
          <thead><tr><th>Date</th><th>Description</th><th class="num">Debit</th><th class="num">Credit</th></tr></thead>
          <tbody>
          ${entries.length ? entries.map(({je,line})=>`<tr><td>${fmtDate(je.date)}</td><td>${esc(je.description)}</td><td class="num">${line.debit?fmtMoney(line.debit):''}</td><td class="num">${line.credit?fmtMoney(line.credit):''}</td></tr>`).join('')
            : `<tr><td colspan="4" class="table-empty">No activity yet.</td></tr>`}
          </tbody>
        </table></div>
      </div>
    `;
    if(qs('#v-edit')) qs('#v-edit').addEventListener('click', ()=>openVendorForm(v));
  }

  function openVendorForm(existing){
    openModal({
      title: existing ? 'Edit vendor' : 'Add vendor',
      bodyHtml: `
        <div class="field"><label>Vendor name</label><input id="vf-name" type="text" value="${esc(existing?existing.name:'')}"></div>
        <div class="form-row">
          <div class="field"><label>Contact person</label><input id="vf-contact" type="text" value="${esc(existing?existing.contact:'')}"></div>
          <div class="field"><label>Phone</label><input id="vf-phone" type="text" value="${esc(existing?existing.phone:'')}"></div>
        </div>
        <div class="form-row">
          <div class="field"><label>Email</label><input id="vf-email" type="email" value="${esc(existing?existing.email:'')}"></div>
          <div class="field"><label>Tax number</label><input id="vf-tax" type="text" value="${esc(existing?existing.taxNo:'')}"></div>
        </div>
        <div class="field"><label>Payment terms</label><input id="vf-terms" type="text" placeholder="e.g. Net 30" value="${esc(existing?existing.terms:'')}"></div>
        <div class="field"><label>Address</label><textarea id="vf-addr">${esc(existing?existing.address:'')}</textarea></div>
      `,
      footerHtml: `<button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="vf-save">Save</button>`,
      onMount(){
        qs('#vf-save').addEventListener('click', ()=>{
          const name = qs('#vf-name').value.trim();
          if(!name){ toast('Enter a name.', 'err'); return; }
          const data = {
            name, contact: qs('#vf-contact').value.trim(), phone: qs('#vf-phone').value.trim(),
            email: qs('#vf-email').value.trim(), taxNo: qs('#vf-tax').value.trim(),
            terms: qs('#vf-terms').value.trim(), address: qs('#vf-addr').value.trim(), active:true
          };
          if(existing) Store.update('vendors', existing.id, data);
          else Store.insert('vendors', data);
          closeModal(); toast('Vendor saved', 'ok'); Router.render();
        });
      }
    });
  }

  Router.on('/vendors', (p)=> p.id ? detail(p) : render(p));
})();
