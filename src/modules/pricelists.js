/* ---------------------------------------------------------------------
   pricelists.js — price lists. One list should be marked "default";
   that is the Direct rate every Direct Booking guest resolves to, and
   the fallback for any agent whose own list has no entry for a package.
--------------------------------------------------------------------- */

(function(){

  function render(params){
    setPageTitle('Price lists', 'Catalog');
    renderNav();
    const lists = Store.all('priceLists');
    const vo = Auth.isViewOnly();
    qs('#content').innerHTML = `
      <div class="toolbar"><div class="spacer"></div>${vo?'':`<button class="btn btn-primary" id="pl-add">+ Add price list</button>`}</div>
      ${lists.length===0 ? `<div class="empty-state card"><h3>No price lists yet</h3><p>Create your Direct list first and mark it default — every Direct Booking guest and any agent without their own list uses it.</p></div>` : ''}
      <div class="grid grid-2">
        ${lists.map(pl=>`
          <div class="card" style="cursor:pointer" data-view="${pl.id}">
            <div class="card-head">
              <h2>${esc(pl.name)} ${pl.isDefault?'<span class="badge badge-teal">Default / Direct</span>':''}</h2>
              <span class="muted small">${(pl.items||[]).length} price${(pl.items||[]).length===1?'':'s'}</span>
            </div>
            <p class="small muted">Used by ${customersUsing(pl.id)} customer(s)${pl.isDefault?' plus Direct Booking':''}.</p>
          </div>
        `).join('')}
      </div>
    `;
    if(qs('#pl-add')) qs('#pl-add').addEventListener('click', ()=>openListForm());
    qsa('[data-view]').forEach(c=>c.addEventListener('click', ()=>detail({id:c.dataset.view})));
  }

  function customersUsing(plId){
    return Store.where('customers', c=>c.priceListId===plId).length;
  }

  function openListForm(existing){
    openModal({
      title: existing ? 'Edit price list' : 'Add price list',
      bodyHtml: `
        <div class="field"><label>Name</label><input id="pl-name" type="text" value="${esc(existing?existing.name:'')}" placeholder="e.g. Direct, Wholesale agents, Premium partner"></div>
        <label class="checkline"><input type="checkbox" id="pl-default" ${existing&&existing.isDefault?'checked':''}> This is the Direct list (the fallback for everyone)</label>
        <p class="hint mt-8">Only one list can be Direct — setting this will unset it on any other list.</p>
      `,
      footerHtml: `<button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="pl-save">Save</button>`,
      onMount(){
        qs('#pl-save').addEventListener('click', ()=>{
          const name = qs('#pl-name').value.trim();
          if(!name){ toast('Enter a name.', 'err'); return; }
          const isDefault = qs('#pl-default').checked;
          if(isDefault) Store.all('priceLists').forEach(pl=>{ if(pl.isDefault) Store.update('priceLists', pl.id, {isDefault:false}); });
          if(existing) Store.update('priceLists', existing.id, { name, isDefault });
          else Store.insert('priceLists', { name, isDefault, items: [] });
          closeModal(); toast('Price list saved', 'ok'); render({});
        });
      }
    });
  }

  function detail(params){
    const pl = Store.find('priceLists', params.id);
    if(!pl){ Router.navigate('pricelists'); return; }
    setPageTitle(pl.name, 'Price lists');
    renderNav();
    const packages = Store.all('packages').filter(p=>p.active!==false);
    const vo = Auth.isViewOnly();
    qs('#content').innerHTML = `
      <div class="toolbar"><button class="btn" onclick="Router.navigate('pricelists')">&larr; All price lists</button><div class="spacer"></div>
        ${vo?'':`<button class="btn" id="pl-edit">Edit</button>
        <button class="btn btn-primary" id="pl-item-add">+ Add price</button>`}
      </div>
      <div class="table-wrap"><table class="t">
        <thead><tr><th>Package</th><th class="num">Price (${esc(Store.settings.baseCurrency||'MVR')})</th><th class="num">USD</th><th class="num">EUR</th><th>Valid from</th><th>Valid to</th><th></th></tr></thead>
        <tbody>
        ${(pl.items||[]).length ? pl.items.map((it,i)=>{
          const pkg = Store.find('packages', it.packageId);
          return `<tr><td>${esc(pkg?pkg.name:'Unknown package')}</td><td class="num">${fmtMoney(it.amount)}</td>
            <td class="num">${it.amountUSD!=null?it.amountUSD.toFixed(2):'—'}</td><td class="num">${it.amountEUR!=null?it.amountEUR.toFixed(2):'—'}</td>
            <td>${it.validFrom?fmtDate(it.validFrom):'Always'}</td><td>${it.validTo?fmtDate(it.validTo):'Always'}</td>
            <td class="row-actions"><button class="btn btn-sm" data-edit-item="${i}">Edit</button><button class="btn btn-sm btn-ghost" data-del-item="${i}">Remove</button></td></tr>`;
        }).join('') : `<tr><td colspan="7" class="table-empty">No prices yet. Add one for each package this list covers.</td></tr>`}
        </tbody>
      </table></div>
    `;
    if(qs('#pl-edit')) qs('#pl-edit').addEventListener('click', ()=>openListForm(pl));
    if(qs('#pl-item-add')) qs('#pl-item-add').addEventListener('click', ()=>openItemForm(pl, packages));
    qsa('[data-edit-item]').forEach(b=>b.addEventListener('click', ()=>openItemForm(pl, packages, +b.dataset.editItem)));
    qsa('[data-del-item]').forEach(b=>b.addEventListener('click', ()=>{
      pl.items.splice(+b.dataset.delItem, 1);
      Store.update('priceLists', pl.id, { items: pl.items });
      detail(params);
    }));
  }

  function openItemForm(pl, packages, idx){
    const existing = idx!==undefined ? pl.items[idx] : null;
    openModal({
      title: existing ? 'Edit price' : 'Add price',
      bodyHtml: `
        <div class="field"><label>Package</label><select id="pi-pkg">${packages.map(p=>`<option value="${p.id}" ${existing&&existing.packageId===p.id?'selected':''}>${esc(p.name)}</option>`).join('')}</select></div>
        <p class="hint mb-8">A price must be set in all three currencies — every booking is priced straight off this list in whichever currency it was created in, so a missing currency would leave that booking with no rate.</p>
        <div class="form-row">
          <div class="field"><label>Price (${esc(Store.settings.baseCurrency||'MVR')})</label><input id="pi-amt" type="number" min="0" step="0.01" value="${existing?existing.amount:''}"></div>
          <div class="field"><label>Price in USD</label><input id="pi-amt-usd" type="number" min="0" step="0.01" value="${existing&&existing.amountUSD!=null?existing.amountUSD:''}"></div>
          <div class="field"><label>Price in EUR</label><input id="pi-amt-eur" type="number" min="0" step="0.01" value="${existing&&existing.amountEUR!=null?existing.amountEUR:''}"></div>
        </div>
        <p class="hint mb-8" id="pi-fx-hint"></p>
        <div class="form-row">
          <div class="field"><label>Valid from <span class="hint">(optional)</span></label><input id="pi-from" type="date" value="${existing&&existing.validFrom?existing.validFrom:''}"></div>
          <div class="field"><label>Valid to <span class="hint">(optional)</span></label><input id="pi-to" type="date" value="${existing&&existing.validTo?existing.validTo:''}"></div>
        </div>
      `,
      footerHtml: `<button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="pi-save">Save</button>`,
      onMount(modal){
        const amtInp = qs('#pi-amt', modal), usdInp = qs('#pi-amt-usd', modal), eurInp = qs('#pi-amt-eur', modal);
        const rate = Pricing.rateOnDate(todayISO());
        qs('#pi-fx-hint', modal).textContent = rate.date ? `Suggested from the exchange rate on ${fmtDate(rate.date)} (1 USD = ${rate.usdToMvr} ${esc(Store.settings.baseCurrency||'MVR')}, 1 EUR = ${rate.eurToMvr}) — feel free to override either.` : 'No exchange rate set yet (Settings → Currency & tax) — enter each currency\'s price by hand.';
        // Auto-suggest USD/EUR from the MVR price using the latest exchange rate,
        // but only while the person hasn't typed their own figure into that field.
        let usdTouched = existing && existing.amountUSD!=null, eurTouched = existing && existing.amountEUR!=null;
        usdInp.addEventListener('input', ()=>{ usdTouched = true; });
        eurInp.addEventListener('input', ()=>{ eurTouched = true; });
        amtInp.addEventListener('input', ()=>{
          const mvr = parseFloat(amtInp.value);
          if(isNaN(mvr)) return;
          if(!usdTouched && rate.usdToMvr) usdInp.value = (mvr/rate.usdToMvr).toFixed(2);
          if(!eurTouched && rate.eurToMvr) eurInp.value = (mvr/rate.eurToMvr).toFixed(2);
        });
        qs('#pi-save', modal).addEventListener('click', ()=>{
          const amount = parseFloat(amtInp.value);
          const amountUSD = parseFloat(usdInp.value);
          const amountEUR = parseFloat(eurInp.value);
          if(isNaN(amount) || isNaN(amountUSD) || isNaN(amountEUR)){ toast('Enter a price in all three currencies — MVR, USD and EUR.', 'err'); return; }
          const item = { packageId: qs('#pi-pkg', modal).value, amount, amountUSD, amountEUR,
            validFrom: qs('#pi-from', modal).value||null, validTo: qs('#pi-to', modal).value||null };
          if(!pl.items) pl.items = [];
          if(existing) pl.items[idx] = item; else pl.items.push(item);
          Store.update('priceLists', pl.id, { items: pl.items });
          closeModal(); toast('Price saved', 'ok'); detail({id:pl.id});
        });
      }
    });
  }

  Router.on('/pricelists', (p)=> p.id ? detail(p) : render(p));
})();
