/* ---------------------------------------------------------------------
   equipment.js — gear types and gear items. Nothing is preloaded: the
   shop defines its own types (BCD, regulator, whatever it uses) before
   adding individual items against them.
--------------------------------------------------------------------- */

(function(){

  function render(params){
    setPageTitle('Equipment', 'Catalog');
    renderNav();
    const tab = params.sub || 'items';
    qs('#content').innerHTML = `
      <div class="tabs">
        <div class="tab ${tab==='items'?'active':''}" data-tab="items">Gear items</div>
        <div class="tab ${tab==='types'?'active':''}" data-tab="types">Gear types</div>
      </div>
      <div id="eq-body"></div>
    `;
    qsa('[data-tab]').forEach(t=>t.addEventListener('click', ()=>Router.navigate('equipment/x/'+t.dataset.tab)));
    if(tab==='types') renderTypes(); else renderItems();
  }

  function renderTypes(){
    const types = Store.all('equipmentTypes').slice().sort((a,b)=>a.name.localeCompare(b.name));
    const vo = Auth.isViewOnly();
    qs('#eq-body').innerHTML = `
      <div class="toolbar"><div class="spacer"></div>${vo?'':`<button class="btn btn-primary" id="t-add">+ Add gear type</button>`}</div>
      <div class="table-wrap"><table class="t">
        <thead><tr><th>Type</th><th>Sizes tracked</th><th>Per dive</th><th>Items</th><th>Status</th><th></th></tr></thead>
        <tbody>
        ${types.length ? types.map(t=>{
          const count = Store.where('equipment', e=>e.equipmentTypeId===t.id).length;
          return `<tr><td><strong>${esc(t.name)}</strong></td><td>${t.hasSizes?'Yes':'No'}</td>
            <td>${t.consumedPerDive?'<span class="badge badge-teal">Needed per dive</span>':'<span class="muted small">Once per trip</span>'}</td><td>${count}</td>
            <td>${t.active===false?'<span class="badge badge-gray">Inactive</span>':'<span class="badge badge-green">Active</span>'}</td>
            <td class="row-actions">
              ${vo?'':`<button class="btn btn-sm" data-edit-type="${t.id}">Edit</button>
              ${count===0 ? `<button class="btn btn-sm btn-ghost" data-del-type="${t.id}">Delete</button>`
                          : `<button class="btn btn-sm btn-ghost" data-toggle-type="${t.id}">${t.active===false?'Reactivate':'Deactivate'}</button>`}`}
            </td></tr>`;
        }).join('') : `<tr><td colspan="6" class="table-empty">No gear types defined yet. Start here — e.g. BCD, Regulator, Mask, Fins — whatever your shop uses.</td></tr>`}
        </tbody>
      </table></div>
    `;
    if(qs('#t-add')) qs('#t-add').addEventListener('click', ()=>openTypeForm());
    qsa('[data-edit-type]').forEach(b=>b.addEventListener('click', ()=>openTypeForm(Store.find('equipmentTypes', b.dataset.editType))));
    qsa('[data-del-type]').forEach(b=>b.addEventListener('click', ()=>{ Store.remove('equipmentTypes', b.dataset.delType); toast('Gear type deleted'); renderTypes(); }));
    qsa('[data-toggle-type]').forEach(b=>b.addEventListener('click', ()=>{
      const t = Store.find('equipmentTypes', b.dataset.toggleType);
      Store.update('equipmentTypes', t.id, { active: t.active===false });
      renderTypes();
    }));
  }

  function openTypeForm(existing){
    openModal({
      title: existing ? 'Edit gear type' : 'Add gear type',
      bodyHtml: `
        <div class="field"><label>Type name</label><input id="tf-name" type="text" placeholder="e.g. BCD, Regulator, Mask" value="${esc(existing?existing.name:'')}"></div>
        <label class="checkline"><input type="checkbox" id="tf-sizes" ${existing&&existing.hasSizes?'checked':''}> Track sizes for this type</label>
        <label class="checkline"><input type="checkbox" id="tf-perdive" ${existing&&existing.consumedPerDive?'checked':''}> Needed again for every dive <span class="hint">(e.g. a tank fill for a DSD guest doing 2 dives on the same trip — not just once per trip, like a BCD)</span></label>
      `,
      footerHtml: `<button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="tf-save">Save</button>`,
      onMount(){
        qs('#tf-save').addEventListener('click', ()=>{
          const name = qs('#tf-name').value.trim();
          if(!name){ toast('Enter a type name.', 'err'); return; }
          const data = { name, hasSizes: qs('#tf-sizes').checked, consumedPerDive: qs('#tf-perdive').checked, active:true };
          if(existing) Store.update('equipmentTypes', existing.id, data);
          else Store.insert('equipmentTypes', data);
          closeModal(); toast('Gear type saved', 'ok'); renderTypes();
        });
      }
    });
  }

  function renderItems(){
    const types = Store.all('equipmentTypes');
    const items = Store.all('equipment').slice().sort((a,b)=>a.tag.localeCompare(b.tag));
    const vo = Auth.isViewOnly();
    qs('#eq-body').innerHTML = `
      <div class="toolbar">
        <div class="spacer"></div>
        ${vo?'': types.length ? `<button class="btn" id="i-receive">+ Receive stock</button><button class="btn btn-primary" id="i-add">+ Add gear item</button>` : `<span class="muted small">Add a gear type first.</span>`}
      </div>
      <div class="table-wrap"><table class="t">
        <thead><tr><th>Tag</th><th>Type</th><th>Size</th><th>Status</th><th>Assigned to</th><th></th></tr></thead>
        <tbody>
        ${items.length ? items.map(i=>{
          const t = Store.find('equipmentTypes', i.equipmentTypeId);
          const assignee = i.status==='ISSUED' ? (i.issuedToType==='STAFF' ? (Store.find('staff', i.issuedToId)||{}).name : (Store.find('guests', i.issuedToId)||{}).name) : '';
          return `<tr><td class="mono">${esc(i.tag)}</td><td>${esc(t?t.name:'—')}</td><td>${esc(i.size||'—')}</td>
            <td>${statusBadge(i.status)}</td><td>${assignee?esc(assignee)+(i.issuedToType==='STAFF'?' (staff)':''):'—'}</td>
            <td class="row-actions">
              ${vo?'':`<button class="btn btn-sm" data-edit-item="${i.id}">Edit</button>
              ${i.status==='IN_STOCK'?`<button class="btn btn-sm btn-ghost" data-issue-staff="${i.id}">Issue to staff</button><button class="btn btn-sm btn-ghost" data-damage="${i.id}">Send to service</button>`:''}
              ${i.status==='ISSUED' && i.issuedToType==='STAFF'?`<button class="btn btn-sm btn-ghost" data-return-staff="${i.id}">Return</button>`:''}
              ${i.status==='SERVICE'?`<button class="btn btn-sm btn-ghost" data-restock="${i.id}">Return to stock</button><button class="btn btn-sm btn-ghost" data-retire="${i.id}">Retire</button>`:''}`}
            </td></tr>`;
        }).join('') : `<tr><td colspan="6" class="table-empty">No gear items yet.</td></tr>`}
        </tbody>
      </table></div>
    `;
    if(qs('#i-add')) qs('#i-add').addEventListener('click', ()=>openItemForm());
    if(qs('#i-receive')) qs('#i-receive').addEventListener('click', ()=>openReceiveStockForm());
    qsa('[data-edit-item]').forEach(b=>b.addEventListener('click', ()=>openItemForm(Store.find('equipment', b.dataset.editItem))));
    qsa('[data-issue-staff]').forEach(b=>b.addEventListener('click', ()=>openIssueToStaffForm(Store.find('equipment', b.dataset.issueStaff))));
    qsa('[data-return-staff]').forEach(b=>b.addEventListener('click', ()=>{
      Store.update('equipment', b.dataset.returnStaff, { status:'IN_STOCK', issuedToType:null, issuedToId:null, issuedTripId:null, issuedTripDate:null });
      toast('Gear returned', 'ok'); renderItems();
    }));
    qsa('[data-damage]').forEach(b=>b.addEventListener('click', ()=>openDamageForm(Store.find('equipment', b.dataset.damage))));
    qsa('[data-restock]').forEach(b=>b.addEventListener('click', ()=>{ Store.update('equipment', b.dataset.restock, {status:'IN_STOCK'}); toast('Back in stock', 'ok'); renderItems(); }));
    qsa('[data-retire]').forEach(b=>b.addEventListener('click', ()=>{ Store.update('equipment', b.dataset.retire, {status:'RETIRED'}); toast('Retired', 'ok'); renderItems(); }));
  }

  function statusBadge(s){
    const map = { IN_STOCK:'badge-green', ISSUED:'badge-teal', SERVICE:'badge-amber', RETIRED:'badge-gray' };
    const label = { IN_STOCK:'In stock', ISSUED:'Issued', SERVICE:'In service', RETIRED:'Retired' };
    return `<span class="badge ${map[s]||'badge-gray'}">${label[s]||s}</span>`;
  }

  // ---- damage/repair workflow: IN_STOCK -> SERVICE or RETIRED, with a reason
  // and an optional repair cost posted as an expense ----
  function openDamageForm(item){
    if(!item) return;
    openModal({
      title:'Send gear to service',
      bodyHtml: `
        <div class="field"><label>Reason</label><input id="dm-reason" type="text" placeholder="e.g. Regulator leaking, BCD torn"></div>
        <div class="field"><label>Outcome</label><select id="dm-status"><option value="SERVICE">Needs service (will come back)</option><option value="RETIRED">Retire (write off)</option></select></div>
        <div class="field"><label>Repair cost <span class="hint">(optional)</span></label><input id="dm-cost" type="number" min="0" step="0.01" value="0"></div>
      `,
      footerHtml: `<button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="dm-save">Save</button>`,
      onMount(modal){
        qs('#dm-save', modal).addEventListener('click', ()=>{
          const reason = qs('#dm-reason', modal).value.trim();
          const status = qs('#dm-status', modal).value;
          const cost = parseFloat(qs('#dm-cost', modal).value)||0;
          if(!reason){ toast('Enter a reason.', 'err'); return; }
          Store.update('equipment', item.id, { status, serviceReason: reason, serviceLoggedAt: nowISO() });
          if(cost>0){
            try{
              VouchersModule.quickCreate('PETTY', { payee:'Gear repair', method:'CASH', memo: reason,
                lines:[{ kind:'GL', accountId: Store.acctId('5020'), description: 'Repair — '+item.tag+' — '+reason, amount: cost }] }, true);
            }catch(e){ toast(e.message, 'err'); }
          }
          closeModal(); toast('Gear updated', 'ok'); renderItems();
        });
      }
    });
  }

  // ---- receive new stock: single item, or a quick batch by type + quantity ----
  function openReceiveStockForm(){
    const types = Store.all('equipmentTypes').filter(t=>t.active!==false);
    openModal({
      title:'Receive new stock', size:'lg',
      bodyHtml: `
        <p class="small muted mb-8">Add several items of the same type at once. Tags are auto-numbered from the prefix you give — edit any of them afterwards from the list.</p>
        <div class="form-row">
          <div class="field"><label>Type</label><select id="rs-type">${types.map(t=>`<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select></div>
          <div class="field"><label>Quantity</label><input id="rs-qty" type="number" min="1" value="1"></div>
        </div>
        <div class="form-row">
          <div class="field"><label>Tag prefix</label><input id="rs-prefix" type="text" placeholder="e.g. BCD"></div>
          <div class="field"><label>Size <span class="hint">(optional, same for all)</span></label><input id="rs-size" type="text"></div>
        </div>
        <div class="field"><label>Cost per item</label><input id="rs-cost" type="number" min="0" step="0.01" value="0"></div>
      `,
      footerHtml: `<button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="rs-save">Receive</button>`,
      onMount(modal){
        qs('#rs-save', modal).addEventListener('click', ()=>{
          const typeId = qs('#rs-type', modal).value, qty = parseInt(qs('#rs-qty', modal).value)||1;
          const prefix = qs('#rs-prefix', modal).value.trim() || (Store.find('equipmentTypes', typeId)||{}).name || 'ITEM';
          const size = qs('#rs-size', modal).value.trim();
          const cost = parseFloat(qs('#rs-cost', modal).value)||0;
          const existingCount = Store.where('equipment', e=>e.equipmentTypeId===typeId).length;
          for(let i=1;i<=qty;i++){
            Store.insert('equipment', { tag: `${prefix}-${String(existingCount+i).padStart(3,'0')}`, equipmentTypeId: typeId, size, status:'IN_STOCK', cost, notes:'' });
          }
          closeModal(); toast(`${qty} item(s) received`, 'ok'); renderItems();
        });
      }
    });
  }

  // ---- issue gear directly to staff (camera, drone, etc.), for a trip ----
  function openIssueToStaffForm(item){
    if(!item) return;
    const staff = Store.all('staff').filter(s=>s.active!==false);
    const trips = Store.all('trips').filter(t=>t.status!=='CANCELLED').sort((a,b)=>b.tripDate.localeCompare(a.tripDate)).slice(0,100);
    openModal({
      title:`Issue ${item.tag} to staff`,
      bodyHtml: `
        <div class="field"><label>Staff</label><select id="is-staff">${staff.map(s=>`<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></div>
        <div class="field"><label>Trip <span class="hint">(optional — ties up stock for that day)</span></label><select id="is-trip"><option value="">—</option>${trips.map(t=>`<option value="${t.id}">${esc(t.tripNo||'')} ${fmtDate(t.tripDate)}</option>`).join('')}</select></div>
      `,
      footerHtml: `<button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="is-save">Issue</button>`,
      onMount(modal){
        qs('#is-save', modal).addEventListener('click', ()=>{
          const staffId = qs('#is-staff', modal).value;
          const tripId = qs('#is-trip', modal).value;
          const trip = tripId ? Store.find('trips', tripId) : null;
          Store.update('equipment', item.id, { status:'ISSUED', issuedToType:'STAFF', issuedToId: staffId, issuedTripId: tripId||null, issuedTripDate: trip?trip.tripDate:null });
          Store.insert('equipmentUsageLog', { equipmentId:item.id, typeId:item.equipmentTypeId, tripId: tripId||null, staffId, date: todayISO(), assigneeType:'STAFF' });
          closeModal(); toast('Gear issued to staff', 'ok'); renderItems();
        });
      }
    });
  }

  function openItemForm(existing){
    const types = Store.all('equipmentTypes').filter(t=>t.active!==false);
    const vendors = Store.all('vendors');
    openModal({
      title: existing ? 'Edit gear item' : 'Add gear item',
      bodyHtml: `
        <div class="form-row">
          <div class="field"><label>Tag / serial</label><input id="if-tag" type="text" value="${esc(existing?existing.tag:'')}"></div>
          <div class="field"><label>Type</label><select id="if-type">${types.map(t=>`<option value="${t.id}" ${existing&&existing.equipmentTypeId===t.id?'selected':''}>${esc(t.name)}</option>`).join('')}</select></div>
        </div>
        <div class="form-row">
          <div class="field"><label>Size</label><input id="if-size" type="text" value="${esc(existing?existing.size:'')}" placeholder="e.g. M, L, 42"></div>
          <div class="field"><label>Status</label>
            <select id="if-status">
              ${['IN_STOCK','ISSUED','SERVICE','RETIRED'].map(s=>`<option value="${s}" ${existing&&existing.status===s?'selected':''}>${s.replace('_',' ')}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="form-row">
          <div class="field"><label>Cost</label><input id="if-cost" type="number" min="0" step="0.01" value="${existing?existing.cost||'':''}"></div>
          <div class="field"><label>Purchased from</label><select id="if-vendor"><option value="">—</option>${vendors.map(v=>`<option value="${v.id}" ${existing&&existing.vendorId===v.id?'selected':''}>${esc(v.name)}</option>`).join('')}</select></div>
        </div>
        <div class="field"><label>Notes</label><textarea id="if-notes">${esc(existing?existing.notes:'')}</textarea></div>
      `,
      footerHtml: `<button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="if-save">Save</button>`,
      onMount(){
        qs('#if-save').addEventListener('click', ()=>{
          const tag = qs('#if-tag').value.trim();
          if(!tag){ toast('Enter a tag / serial.', 'err'); return; }
          const data = {
            tag, equipmentTypeId: qs('#if-type').value, size: qs('#if-size').value.trim(),
            status: qs('#if-status').value, cost: parseFloat(qs('#if-cost').value)||0,
            vendorId: qs('#if-vendor').value||null, notes: qs('#if-notes').value.trim()
          };
          if(existing) Store.update('equipment', existing.id, data);
          else Store.insert('equipment', data);
          closeModal(); toast('Gear item saved', 'ok'); renderItems();
        });
      }
    });
  }

  Router.on('/equipment', render);
})();
