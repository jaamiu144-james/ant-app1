/* ---------------------------------------------------------------------
   customers.js — customer register: agents plus the locked Direct
   Booking record. Every booking belongs to exactly one customer.
--------------------------------------------------------------------- */

(function(){

  function render(params){
    setPageTitle('Customers', 'Directory');
    renderNav();
    const q = (params.q||'').toLowerCase();
    let rows = Store.all('customers').slice().sort((a,b)=> (a.type==='DIRECT'?-1:1) - (b.type==='DIRECT'?-1:1) || a.name.localeCompare(b.name));
    if(q) rows = rows.filter(c=> c.name.toLowerCase().includes(q) || (c.email||'').toLowerCase().includes(q));

    const vo = Auth.isViewOnly();
    qs('#content').innerHTML = `
      <div class="toolbar">
        <input class="search-input" id="c-search" type="text" placeholder="Search customers…" value="${esc(params.q||'')}">
        <div class="spacer"></div>
        ${vo?'':`<button class="btn btn-primary" id="c-add">+ Add agent</button>`}
      </div>
      <div class="table-wrap">
        <table class="t">
          <thead><tr><th>Name</th><th>Type</th><th>Price list</th><th>Credit limit</th><th class="num">Balance</th><th></th></tr></thead>
          <tbody>
            ${rows.length ? rows.map(rowHtml).join('') : `<tr><td colspan="6" class="table-empty">No customers yet. Direct Booking should always be here — add your agents with the button above.</td></tr>`}
          </tbody>
        </table>
      </div>
    `;
    qs('#c-search').addEventListener('input', debounce(e=>Router.navigate('customers?q='+encodeURIComponent(e.target.value))));
    if(qs('#c-add')) qs('#c-add').addEventListener('click', ()=>openCustomerForm());
    qsa('[data-view]').forEach(b=>b.addEventListener('click', ()=>Router.navigate('customers/'+b.dataset.view)));
    qsa('[data-edit]').forEach(b=>b.addEventListener('click', e=>{ e.stopPropagation(); openCustomerForm(Store.find('customers', b.dataset.edit)); }));
  }

  function rowHtml(c){
    const arAccountCode = c.type==='AGENT' ? '1110':'1120';
    const bal = Ledger.partyBalance('customer', c.id);
    const vo = Auth.isViewOnly();
    return `<tr style="cursor:pointer" data-view="${c.id}">
      <td><strong>${esc(c.name)}</strong>${c.locked?` <span class="locked-tag">🔒 built-in</span>`:''}</td>
      <td>${c.type==='DIRECT'?'<span class="badge badge-gray">Direct</span>':'<span class="badge badge-teal">Agent</span>'}</td>
      <td>${c.priceListId ? esc((Store.find('priceLists', c.priceListId)||{}).name||'—') : '<span class="muted">Direct rate</span>'}</td>
      <td>${c.type==='AGENT'?fmtMoney(c.creditLimit):'—'}</td>
      <td class="num">${fmtMoney(bal)}</td>
      <td class="row-actions">${vo?'':`<button class="btn btn-sm" data-edit="${c.id}">Edit</button>`}</td>
    </tr>`;
  }

  function detail(params){
    const c = Store.find('customers', params.id);
    if(!c){ Router.navigate('customers'); return; }
    setPageTitle(c.name, 'Customers');
    renderNav();
    const bookings = Store.all('bookings').filter(b=>b.customerId===c.id).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
    const entries = Ledger.partyEntries('customer', c.id);
    const bal = Ledger.partyBalance('customer', c.id);
    const agentPrices = c.type==='AGENT' ? Store.all('agentPrices').filter(ap=>ap.customerId===c.id) : [];

    qs('#content').innerHTML = `
      <div class="toolbar">
        <button class="btn" onclick="Router.navigate('customers')">&larr; All customers</button>
        <div class="spacer"></div>
        ${!c.locked && !Auth.isViewOnly() ?`<button class="btn" id="c-edit">Edit</button>`:''}
      </div>
      <div class="grid grid-3 mb-16">
        <div class="stat"><div class="label">Type</div><div class="value" style="font-size:16px">${c.type==='DIRECT'?'Direct Booking':'Agent'}</div></div>
        <div class="stat"><div class="label">Outstanding balance</div><div class="value">${fmtMoney(bal)}</div><div class="sub">${c.type==='AGENT'?`Credit limit ${fmtMoney(c.creditLimit)}`:'Settled at the counter'}</div></div>
        <div class="stat"><div class="label">Bookings</div><div class="value">${bookings.length}</div></div>
      </div>

      <div class="card">
        <div class="card-head"><h2>Details</h2></div>
        <dl class="kv">
          <dt>Contact</dt><dd>${esc(c.contact||'—')}</dd>
          <dt>Phone</dt><dd>${esc(c.phone||'—')}</dd>
          <dt>Email</dt><dd>${esc(c.email||'—')}</dd>
          <dt>Address</dt><dd>${esc(c.address||'—')}</dd>
          <dt>Tax number</dt><dd>${esc(c.taxNo||'—')}</dd>
          ${c.type==='AGENT'?`<dt>Commission</dt><dd>${c.commissionPct||0}% <span class="muted small">(reference only — not auto-posted; use a price list or special price instead)</span></dd>`:''}
          <dt>Price list</dt><dd>${c.priceListId?esc((Store.find('priceLists',c.priceListId)||{}).name||'—'):'Uses Direct rate'}</dd>
        </dl>
      </div>

      ${c.type==='AGENT' ? `
      <div class="card">
        <div class="card-head"><h2>Special prices</h2>${Auth.isViewOnly()?'':'<button class="btn btn-sm" id="ap-add">+ Add special price</button>'}</div>
        <div class="table-wrap"><table class="t">
          <thead><tr><th>Package</th><th class="num">Net price (${esc(Store.settings.baseCurrency||'MVR')})</th><th class="num">USD</th><th class="num">EUR</th><th></th></tr></thead>
          <tbody>
          ${agentPrices.length ? agentPrices.map(ap=>{
            const pkg = Store.find('packages', ap.packageId);
            return `<tr><td>${esc(pkg?pkg.name:'—')}</td><td class="num">${fmtMoney(ap.amount)}</td>
              <td class="num">${ap.amountUSD!=null?ap.amountUSD.toFixed(2):'—'}</td><td class="num">${ap.amountEUR!=null?ap.amountEUR.toFixed(2):'—'}</td>
              <td class="row-actions"><button class="btn btn-sm btn-ghost" data-del-ap="${ap.id}">Remove</button></td></tr>`;
          }).join('') : `<tr><td colspan="5" class="table-empty">No special prices. This agent uses their price list, or the Direct rate.</td></tr>`}
          </tbody>
        </table></div>
      </div>` : ''}

      <div class="card">
        <div class="card-head"><h2>Statement</h2><div class="sub">All postings for this customer</div></div>
        <div class="table-wrap"><table class="t">
          <thead><tr><th>Date</th><th>Description</th><th class="num">Debit</th><th class="num">Credit</th></tr></thead>
          <tbody>
          ${entries.length ? entries.map(({je,line})=>`<tr><td>${fmtDate(je.date)}</td><td>${esc(je.description)}</td>
            <td class="num">${line.debit?fmtMoney(line.debit):''}</td><td class="num">${line.credit?fmtMoney(line.credit):''}</td></tr>`).join('')
            : `<tr><td colspan="4" class="table-empty">No activity yet.</td></tr>`}
          </tbody>
        </table></div>
      </div>

      <div class="card">
        <div class="card-head"><h2>Bookings</h2></div>
        <div class="table-wrap"><table class="t">
          <thead><tr><th>Booking #</th><th>Created</th><th>Status</th><th class="num">Total</th></tr></thead>
          <tbody>
          ${bookings.length ? bookings.map(b=>`<tr style="cursor:pointer" onclick="Router.navigate('bookings/${b.id}')"><td><strong>${esc(b.bookingNo)}</strong></td><td>${fmtDate(b.createdAt.slice(0,10))}</td><td>${statusBadge(b.status)}</td><td class="num">${fmtMoney(b.invoiceTotal||0)}</td></tr>`).join('')
            : `<tr><td colspan="4" class="table-empty">No bookings yet.</td></tr>`}
          </tbody>
        </table></div>
      </div>
    `;
    if(qs('#c-edit')) qs('#c-edit').addEventListener('click', ()=>openCustomerForm(c));
    if(qs('#ap-add')) qs('#ap-add').addEventListener('click', ()=>openAgentPriceForm(c));
    qsa('[data-del-ap]').forEach(b=>b.addEventListener('click', ()=>{ Store.remove('agentPrices', b.dataset.delAp); toast('Special price removed'); detail(params); }));
  }

  function statusBadge(s){
    const map = { OPEN:'badge-amber', CONFIRMED:'badge-teal', COMPLETED:'badge-green', CANCELLED:'badge-red' };
    return `<span class="badge ${map[s]||'badge-gray'}">${esc(s||'').replace('_',' ')}</span>`;
  }

  function openAgentPriceForm(customer){
    const packages = Store.all('packages').filter(p=>p.active!==false);
    openModal({
      title: `Special price for ${customer.name}`,
      bodyHtml: `
        <div class="field"><label>Package</label><select id="ap-pkg">${packages.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></div>
        <p class="hint mb-8">A net price must be set in all three currencies — bookings are priced straight off this in whichever currency they're created in.</p>
        <div class="form-row">
          <div class="field"><label>Net price (${esc(Store.settings.baseCurrency||'MVR')})</label><input id="ap-amt" type="number" min="0" step="0.01"></div>
          <div class="field"><label>USD</label><input id="ap-amt-usd" type="number" min="0" step="0.01"></div>
          <div class="field"><label>EUR</label><input id="ap-amt-eur" type="number" min="0" step="0.01"></div>
        </div>
        <p class="hint" id="ap-fx-hint"></p>
      `,
      footerHtml: `<button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="ap-save">Save</button>`,
      onMount(modal){
        const amtInp = qs('#ap-amt', modal), usdInp = qs('#ap-amt-usd', modal), eurInp = qs('#ap-amt-eur', modal);
        const rate = Pricing.rateOnDate(todayISO());
        qs('#ap-fx-hint', modal).textContent = rate.date ? `Suggested from the exchange rate on ${fmtDate(rate.date)} — feel free to override either.` : 'No exchange rate set yet (Settings → Currency & tax) — enter each currency by hand.';
        let usdTouched = false, eurTouched = false;
        usdInp.addEventListener('input', ()=>{ usdTouched = true; });
        eurInp.addEventListener('input', ()=>{ eurTouched = true; });
        amtInp.addEventListener('input', ()=>{
          const mvr = parseFloat(amtInp.value);
          if(isNaN(mvr)) return;
          if(!usdTouched && rate.usdToMvr) usdInp.value = (mvr/rate.usdToMvr).toFixed(2);
          if(!eurTouched && rate.eurToMvr) eurInp.value = (mvr/rate.eurToMvr).toFixed(2);
        });
        qs('#ap-save', modal).addEventListener('click', ()=>{
          const packageId = qs('#ap-pkg', modal).value, amount = parseFloat(amtInp.value);
          const amountUSD = parseFloat(usdInp.value), amountEUR = parseFloat(eurInp.value);
          if(!packageId || isNaN(amount) || isNaN(amountUSD) || isNaN(amountEUR)){ toast('Pick a package and enter a price in all three currencies.', 'err'); return; }
          const existing = Store.all('agentPrices').find(a=>a.customerId===customer.id && a.packageId===packageId);
          const data = { amount, amountUSD, amountEUR };
          if(existing) Store.update('agentPrices', existing.id, data);
          else Store.insert('agentPrices', Object.assign({ customerId: customer.id, packageId }, data));
          closeModal(); toast('Special price saved', 'ok'); detail({id:customer.id});
        });
      }
    });
  }

  function openCustomerForm(existing){
    const priceLists = Store.all('priceLists');
    openModal({
      title: existing ? 'Edit agent' : 'Add agent',
      bodyHtml: `
        <div class="field"><label>Agent / company name</label><input id="cf-name" type="text" value="${esc(existing?existing.name:'')}"></div>
        <div class="form-row">
          <div class="field"><label>Contact person</label><input id="cf-contact" type="text" value="${esc(existing?existing.contact:'')}"></div>
          <div class="field"><label>Phone</label><input id="cf-phone" type="text" value="${esc(existing?existing.phone:'')}"></div>
        </div>
        <div class="form-row">
          <div class="field"><label>Email</label><input id="cf-email" type="email" value="${esc(existing?existing.email:'')}"></div>
          <div class="field"><label>Tax number</label><input id="cf-tax" type="text" value="${esc(existing?existing.taxNo:'')}"></div>
        </div>
        <div class="field"><label>Address</label><textarea id="cf-addr">${esc(existing?existing.address:'')}</textarea></div>
        <div class="form-row">
          <div class="field"><label>Credit limit</label><input id="cf-credit" type="number" min="0" step="0.01" value="${existing?existing.creditLimit:0}"></div>
          <div class="field"><label>Commission % <span class="hint">(reference only)</span></label><input id="cf-comm" type="number" min="0" step="0.01" value="${existing?existing.commissionPct:0}"></div>
        </div>
        <div class="field"><label>Price list</label>
          <select id="cf-pl"><option value="">Direct rate (no list)</option>
            ${priceLists.map(pl=>`<option value="${pl.id}" ${existing&&existing.priceListId===pl.id?'selected':''}>${esc(pl.name)}</option>`).join('')}
          </select>
          <div class="hint">Add price lists under Catalog → Price lists.</div>
        </div>
      `,
      footerHtml: `<button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="cf-save">Save</button>`,
      onMount(){
        qs('#cf-save').addEventListener('click', ()=>{
          const name = qs('#cf-name').value.trim();
          if(!name){ toast('Enter a name.', 'err'); return; }
          const data = {
            name, contact: qs('#cf-contact').value.trim(), phone: qs('#cf-phone').value.trim(),
            email: qs('#cf-email').value.trim(), taxNo: qs('#cf-tax').value.trim(), address: qs('#cf-addr').value.trim(),
            creditLimit: parseFloat(qs('#cf-credit').value)||0, commissionPct: parseFloat(qs('#cf-comm').value)||0,
            priceListId: qs('#cf-pl').value||null, type:'AGENT', active:true
          };
          if(existing) Store.update('customers', existing.id, data);
          else Store.insert('customers', data);
          closeModal(); toast('Agent saved', 'ok'); Router.render();
        });
      }
    });
  }

  Router.on('/customers', (p)=> p.id ? detail(p) : render(p));
})();
