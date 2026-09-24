/* ---------------------------------------------------------------------
   packages.js — packages and add-ons. Every package's equipment kit is
   built by hand when you create it: pick gear types from your own
   equipment register and set a quantity per guest. Nothing is preset,
   and a kit can be empty. Gear is included in the price, never charged
   separately — add-ons carry their own price and no kit at all.
--------------------------------------------------------------------- */

(function(){

  let draftKit = []; // [{equipmentTypeId, qtyPerGuest}] while the form is open

  function render(params){
    setPageTitle('Packages & kits', 'Catalog');
    renderNav();
    const rows = Store.all('packages').slice().sort((a,b)=> (a.kind==='ADDON'?1:0)-(b.kind==='ADDON'?1:0) || a.name.localeCompare(b.name));
    const vo = Auth.isViewOnly();
    qs('#content').innerHTML = `
      <div class="toolbar"><div class="spacer"></div>${vo?'':`<button class="btn btn-primary" id="p-add">+ Add package or add-on</button>`}</div>
      <div class="table-wrap"><table class="t">
        <thead><tr><th>Name</th><th>Kind</th><th>Dives</th><th>Min. cert.</th><th>Kit items</th><th>Status</th><th></th></tr></thead>
        <tbody>
        ${rows.length ? rows.map(p=>`<tr>
          <td><strong>${esc(p.name)}</strong> ${p.code?`<span class="muted small mono">${esc(p.code)}</span>`:''}</td>
          <td>${p.kind==='ADDON'?'<span class="badge badge-sand">Add-on</span>':'<span class="badge badge-teal">Package</span>'}</td>
          <td>${p.kind==='ADDON'?'—':(p.diveCount||0)}</td>
          <td>${esc(p.minCert||'—')}</td>
          <td>${p.kind==='ADDON' ? '<span class="muted">No kit</span>' : ((p.kit||[]).length ? `${p.kit.length} gear type${p.kit.length>1?'s':''}` : '<span class="muted">Empty kit</span>')}</td>
          <td>${p.active===false?'<span class="badge badge-gray">Inactive</span>':'<span class="badge badge-green">Active</span>'}</td>
          <td class="row-actions">${vo?'':`<button class="btn btn-sm" data-edit="${p.id}">Edit</button><button class="btn btn-sm btn-ghost" data-copy="${p.id}">Duplicate</button>`}</td>
        </tr>`).join('') : `<tr><td colspan="7" class="table-empty">No packages yet. Build your first one — its gear kit is whatever you add to it.</td></tr>`}
        </tbody>
      </table></div>
    `;
    if(qs('#p-add')) qs('#p-add').addEventListener('click', ()=>openForm());
    qsa('[data-edit]').forEach(b=>b.addEventListener('click', ()=>openForm(Store.find('packages', b.dataset.edit))));
    qsa('[data-copy]').forEach(b=>b.addEventListener('click', ()=>{
      const src = Store.find('packages', b.dataset.copy);
      openForm(null, src);
    }));
  }

  function kitRowsHtml(){
    const types = Store.all('equipmentTypes').filter(t=>t.active!==false);
    if(!draftKit.length) return `<p class="muted small">No gear in this kit yet.</p>`;
    return `<div class="inline-list" id="kit-rows">` + draftKit.map((row,i)=>{
      const t = Store.find('equipmentTypes', row.equipmentTypeId);
      return `<div class="inline-item">
        <span class="grow">${esc(t?t.name:'Unknown type')}</span>
        <label class="small muted">Qty / guest</label>
        <input type="number" min="1" value="${row.qtyPerGuest}" style="width:70px" data-kit-qty="${i}">
        <button class="btn btn-icon btn-ghost" data-kit-del="${i}" title="Remove" type="button">&times;</button>
      </div>`;
    }).join('') + `</div>`;
  }

  function bindKitEvents(container){
    qsa('[data-kit-qty]', container).forEach(inp=>inp.addEventListener('input', ()=>{
      draftKit[+inp.dataset.kitQty].qtyPerGuest = Math.max(1, parseInt(inp.value)||1);
    }));
    qsa('[data-kit-del]', container).forEach(btn=>btn.addEventListener('click', ()=>{
      draftKit.splice(+btn.dataset.kitDel, 1);
      refreshKitUi();
    }));
  }

  function refreshKitUi(){
    const holder = qs('#kit-holder');
    if(!holder) return;
    holder.innerHTML = kitRowsHtml();
    bindKitEvents(holder);
  }

  function openForm(existing, copyFrom){
    draftKit = existing ? JSON.parse(JSON.stringify(existing.kit||[])) : (copyFrom ? JSON.parse(JSON.stringify(copyFrom.kit||[])) : []);
    const types = Store.all('equipmentTypes').filter(t=>t.active!==false);
    const otherPackages = Store.all('packages').filter(p=>p.kind!=='ADDON' && p.id!==(existing&&existing.id));
    const accounts = Store.all('accounts').filter(a=>a.type==='REVENUE' && a.active);
    const src = existing || copyFrom || {};
    const levels = Store.settings.certLevels||[];

    openModal({
      title: existing ? 'Edit package' : (copyFrom ? `Duplicate "${copyFrom.name}"` : 'Add package or add-on'),
      size:'lg',
      bodyHtml: `
        <div class="form-row">
          <div class="field"><label>Kind</label>
            <select id="pf-kind">
              <option value="PACKAGE" ${src.kind!=='ADDON'?'selected':''}>Package (a dive product)</option>
              <option value="ADDON" ${src.kind==='ADDON'?'selected':''}>Add-on (extra, no gear kit)</option>
            </select>
          </div>
          <div class="field"><label>Code <span class="hint">(optional)</span></label><input id="pf-code" type="text" value="${esc(src.code||'')}"></div>
        </div>
        <div class="field"><label>Name</label><input id="pf-name" type="text" value="${esc(src.name||'')}" placeholder="e.g. Fun dive, Night dive, Discover Scuba"></div>
        <div class="form-row">
          <div class="field"><label>Number of dives</label><input id="pf-dives" type="number" min="0" value="${src.diveCount||0}"></div>
          <div class="field"><label>Minimum certification</label>
            ${levels.length ? `<select id="pf-cert"><option value="">None required</option>${levels.map(l=>`<option ${src.minCert===l?'selected':''}>${esc(l)}</option>`).join('')}</select>`
                             : `<input id="pf-cert" type="text" value="${esc(src.minCert||'')}" placeholder="e.g. Open Water (optional)">`}
          </div>
        </div>
        <div class="form-row">
          <div class="field"><label>Tax treatment</label>
            <select id="pf-tax">
              <option value="STANDARD" ${(!src.taxCode||src.taxCode==='STANDARD')?'selected':''}>Standard rate</option>
              <option value="EXEMPT" ${src.taxCode==='EXEMPT'?'selected':''}>Tax exempt</option>
              <option value="CUSTOM" ${src.taxCode==='CUSTOM'?'selected':''}>Custom rate</option>
            </select>
          </div>
          <div class="field" id="pf-customtax-wrap" style="${src.taxCode==='CUSTOM'?'':'display:none'}"><label>Custom rate (%)</label><input id="pf-customtax" type="number" min="0" step="0.01" value="${src.customTaxRate||0}"></div>
          <div class="field"><label>Revenue account</label>
            <select id="pf-rev"><option value="">Default</option>${accounts.map(a=>`<option value="${a.id}" ${src.revenueAccountId===a.id?'selected':''}>${esc(a.code)} — ${esc(a.name)}</option>`).join('')}</select>
          </div>
        </div>

        <div class="section-title" id="kit-section" style="${src.kind==='ADDON'?'display:none':''}">Equipment kit</div>
        <div id="kit-block" style="${src.kind==='ADDON'?'display:none':''}">
          <p class="small muted mb-8">Gear is included in the package price. Add the types this package needs and how many of each per guest.</p>
          ${otherPackages.length ? `<div class="flex-gap mb-8"><label class="small muted">Copy kit from</label>
            <select id="kit-copy-src"><option value="">—</option>${otherPackages.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select>
            <button class="btn btn-sm" id="kit-copy-btn" type="button">Copy</button></div>` : ''}
          <div class="flex-gap mb-12">
            <select id="kit-type-pick" style="max-width:220px">${types.length?types.map(t=>`<option value="${t.id}">${esc(t.name)}</option>`).join(''):'<option value="">No gear types yet</option>'}</select>
            <button class="btn btn-sm" id="kit-add-btn" type="button" ${types.length?'':'disabled'}>+ Add to kit</button>
          </div>
          <div id="kit-holder">${kitRowsHtml()}</div>
        </div>
      `,
      footerHtml: `<button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="pf-save">Save package</button>`,
      onMount(modal){
        bindKitEvents(modal);
        qs('#pf-kind', modal).addEventListener('change', (e)=>{
          const isAddon = e.target.value==='ADDON';
          qs('#kit-section', modal).style.display = isAddon?'none':'';
          qs('#kit-block', modal).style.display = isAddon?'none':'';
        });
        qs('#pf-tax', modal).addEventListener('change', e=>{
          qs('#pf-customtax-wrap', modal).style.display = e.target.value==='CUSTOM'?'':'none';
        });
        const addBtn = qs('#kit-add-btn', modal);
        if(addBtn) addBtn.addEventListener('click', ()=>{
          const typeId = qs('#kit-type-pick', modal).value;
          if(!typeId) return;
          if(draftKit.find(k=>k.equipmentTypeId===typeId)){ toast('That gear type is already in the kit.', 'err'); return; }
          draftKit.push({ equipmentTypeId: typeId, qtyPerGuest: 1 });
          refreshKitUi();
        });
        const copyBtn = qs('#kit-copy-btn', modal);
        if(copyBtn) copyBtn.addEventListener('click', ()=>{
          const srcId = qs('#kit-copy-src', modal).value;
          if(!srcId) return;
          const srcPkg = Store.find('packages', srcId);
          draftKit = JSON.parse(JSON.stringify((srcPkg&&srcPkg.kit)||[]));
          refreshKitUi();
          toast('Kit copied — adjust as needed before saving');
        });
        qs('#pf-save', modal).addEventListener('click', ()=>{
          const name = qs('#pf-name', modal).value.trim();
          if(!name){ toast('Enter a name.', 'err'); return; }
          const kind = qs('#pf-kind', modal).value;
          const data = {
            name, code: qs('#pf-code', modal).value.trim(), kind,
            diveCount: parseInt(qs('#pf-dives', modal).value)||0,
            minCert: qs('#pf-cert', modal).value||'',
            taxCode: qs('#pf-tax', modal).value,
            customTaxRate: parseFloat(qs('#pf-customtax', modal).value)||0,
            revenueAccountId: qs('#pf-rev', modal).value||null,
            kit: kind==='ADDON' ? [] : draftKit.slice(),
            active: true
          };
          if(existing) Store.update('packages', existing.id, data);
          else Store.insert('packages', data);
          closeModal(); toast('Package saved', 'ok'); render({});
        });
      }
    });
  }

  Router.on('/packages', render);
})();
