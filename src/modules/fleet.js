/* ---------------------------------------------------------------------
   fleet.js — boats and staff (guides). Feeds trip templates and trips.
--------------------------------------------------------------------- */

(function(){

  function render(params){
    setPageTitle('Boats & staff', 'Catalog');
    renderNav();
    const tab = params.sub || 'boats';
    qs('#content').innerHTML = `
      <div class="tabs">
        <div class="tab ${tab==='boats'?'active':''}" data-tab="boats">Boats</div>
        <div class="tab ${tab==='staff'?'active':''}" data-tab="staff">Staff</div>
      </div>
      <div id="fl-body"></div>
    `;
    qsa('[data-tab]').forEach(t=>t.addEventListener('click', ()=>Router.navigate('fleet/x/'+t.dataset.tab)));
    if(tab==='staff') renderStaff(); else renderBoats();
  }

  function renderBoats(){
    const boats = Store.all('boats');
    const vo = Auth.isViewOnly();
    qs('#fl-body').innerHTML = `
      <div class="toolbar"><div class="spacer"></div>${vo?'':`<button class="btn btn-primary" id="b-add">+ Add boat</button>`}</div>
      <div class="table-wrap"><table class="t">
        <thead><tr><th>Name</th><th class="num">Seats</th><th>Kind</th><th>Status</th><th></th></tr></thead>
        <tbody>
        ${boats.length ? boats.map(b=>{
          const vend = b.rental && b.vendorId ? Store.find('vendors', b.vendorId) : null;
          return `<tr><td><strong>${esc(b.name)}</strong></td><td class="num">${b.seats}</td>
          <td>${b.rental?`<span class="badge badge-sand">Rental${vend?' — '+esc(vend.name):''}</span>`:'<span class="badge badge-gray">Own</span>'}</td>
          <td>${b.active===false?'<span class="badge badge-gray">Inactive</span>':'<span class="badge badge-green">Active</span>'}</td>
          <td class="row-actions">${vo?'':`<button class="btn btn-sm" data-edit="${b.id}">Edit</button>`}</td></tr>`;
        }).join('')
          : `<tr><td colspan="5" class="table-empty">No boats yet.</td></tr>`}
        </tbody>
      </table></div>
    `;
    if(qs('#b-add')) qs('#b-add').addEventListener('click', ()=>openBoatForm());
    qsa('[data-edit]').forEach(x=>x.addEventListener('click', ()=>openBoatForm(Store.find('boats', x.dataset.edit))));
  }

  function openBoatForm(existing){
    const vendors = Store.all('vendors');
    openModal({
      title: existing?'Edit boat':'Add boat',
      bodyHtml: `
        <div class="field"><label>Boat name</label><input id="bf-name" type="text" value="${esc(existing?existing.name:'')}"></div>
        <div class="field"><label>Seats</label><input id="bf-seats" type="number" min="1" value="${existing?existing.seats:8}"></div>
        <label class="checkline"><input type="checkbox" id="bf-rental" ${existing&&existing.rental?'checked':''}> This is a rental boat (overflow capacity from a vendor)</label>
        <div class="field mt-8" id="bf-vendor-wrap" style="display:${existing&&existing.rental?'':'none'}">
          <label>Rental vendor</label><select id="bf-vendor"><option value="">—</option>${vendors.map(v=>`<option value="${v.id}" ${existing&&existing.vendorId===v.id?'selected':''}>${esc(v.name)}</option>`).join('')}</select>
        </div>
      `,
      footerHtml: `<button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="bf-save">Save</button>`,
      onMount(modal){
        qs('#bf-rental', modal).addEventListener('change', e=>{ qs('#bf-vendor-wrap', modal).style.display = e.target.checked?'':'none'; });
        qs('#bf-save', modal).addEventListener('click', ()=>{
          const name = qs('#bf-name', modal).value.trim();
          if(!name){ toast('Enter a name.', 'err'); return; }
          const data = { name, seats: parseInt(qs('#bf-seats', modal).value)||1, active:true,
            rental: qs('#bf-rental', modal).checked, vendorId: qs('#bf-rental', modal).checked ? (qs('#bf-vendor', modal).value||null) : null };
          if(existing) Store.update('boats', existing.id, data); else Store.insert('boats', data);
          closeModal(); toast('Boat saved', 'ok'); renderBoats();
        });
      }
    });
  }

  function renderStaff(){
    const staff = Store.all('staff');
    const vo = Auth.isViewOnly();
    qs('#fl-body').innerHTML = `
      <div class="toolbar"><div class="spacer"></div>${vo?'':`<button class="btn btn-primary" id="s-add">+ Add staff</button>`}</div>
      <div class="table-wrap"><table class="t">
        <thead><tr><th>Name</th><th>Role</th><th>Category</th><th>Type</th><th>Certification</th><th class="num">Max guests</th><th class="num">Base salary</th><th></th></tr></thead>
        <tbody>
        ${staff.length ? staff.map(s=>`<tr><td><strong>${esc(s.name)}</strong></td><td>${esc(s.role)}</td>
          <td>${s.category==='ADMIN_SUPPORT'?'<span class="badge badge-gray">Admin/support</span>':'<span class="badge badge-teal">Dive ops</span>'}</td>
          <td>${s.employmentType==='FREELANCER'?'<span class="badge badge-sand">Freelancer</span>':'<span class="badge badge-green">Staff</span>'}</td>
          <td>${esc(s.certLevel||'—')}</td>
          <td class="num">${s.role==='GUIDE'||s.role==='INSTRUCTOR'?(s.maxGuests||0):'—'}</td><td class="num">${s.employmentType==='FREELANCER'?'—':fmtMoney((s.salaryPackage&&s.salaryPackage.basic)||s.baseSalary||0)}</td>
          <td class="row-actions">${vo?'':`<button class="btn btn-sm" data-edit="${s.id}">Edit</button>`}</td></tr>`).join('')
          : `<tr><td colspan="8" class="table-empty">No staff yet.</td></tr>`}
        </tbody>
      </table></div>
    `;
    if(qs('#s-add')) qs('#s-add').addEventListener('click', ()=>openStaffForm());
    qsa('[data-edit]').forEach(x=>x.addEventListener('click', ()=>openStaffForm(Store.find('staff', x.dataset.edit))));
  }

  function namedAmountRowsHtml(list, prefix){
    if(!list || !list.length) return `<p class="muted small" id="${prefix}-empty">None added.</p>`;
    return list.map((r,i)=>`<div class="inline-item" data-${prefix}-row="${i}">
      <span class="grow">${esc(r.name)}</span><span class="mono">${fmtMoney(r.amount)}</span>
      <button class="btn btn-icon btn-ghost" type="button" data-${prefix}-del="${i}">&times;</button>
    </div>`).join('');
  }

  function openStaffForm(existing){
    const pkg = (existing && existing.salaryPackage) || { basic: existing?existing.baseSalary||0:0, allowances:[], bonuses:[], deductions:[] };
    let allowances = JSON.parse(JSON.stringify(pkg.allowances||[]));
    let bonuses = JSON.parse(JSON.stringify(pkg.bonuses||[]));
    let deductions = JSON.parse(JSON.stringify(pkg.deductions||[]));

    openModal({
      title: existing?'Edit staff':'Add staff', size:'lg',
      bodyHtml: `
        <div class="form-row">
          <div class="field"><label>Name</label><input id="sf-name" type="text" value="${esc(existing?existing.name:'')}"></div>
          <div class="field"><label>Role</label>
            <select id="sf-role">
              ${['GUIDE','INSTRUCTOR','CREW','OFFICE'].map(r=>`<option value="${r}" ${existing&&existing.role===r?'selected':''}>${r.charAt(0)+r.slice(1).toLowerCase()}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="form-row">
          <div class="field"><label>Category</label>
            <select id="sf-cat">
              <option value="DIVE_OPS" ${!existing||existing.category!=='ADMIN_SUPPORT'?'selected':''}>Dive ops (guides / instructors / crew — linked to trips)</option>
              <option value="ADMIN_SUPPORT" ${existing&&existing.category==='ADMIN_SUPPORT'?'selected':''}>Admin / support</option>
            </select>
          </div>
          <div class="field"><label>Employment type</label>
            <select id="sf-emp">
              <option value="STAFF" ${!existing||existing.employmentType!=='FREELANCER'?'selected':''}>Staff (on payroll)</option>
              <option value="FREELANCER" ${existing&&existing.employmentType==='FREELANCER'?'selected':''}>Freelancer (paid per-trip, not payroll)</option>
            </select>
          </div>
        </div>
        <div class="form-row">
          <div class="field"><label>Certification level</label><input id="sf-cert" type="text" value="${esc(existing?existing.certLevel:'')}" placeholder="e.g. Divemaster"></div>
          <div class="field"><label>Max guests per trip</label><input id="sf-max" type="number" min="0" value="${existing?existing.maxGuests||0:4}"></div>
          <div class="field"><label>Commission per dive led</label><input id="sf-comm" type="number" min="0" step="0.01" value="${existing?existing.commissionPerDive||0:0}"></div>
        </div>
        <div class="field" id="sf-freelance-rate-wrap" style="display:${existing&&existing.employmentType==='FREELANCER'?'':'none'}">
          <label>Default freelance commission per trip</label><input id="sf-freelance-rate" type="number" min="0" step="0.01" value="${existing?existing.freelanceRate||0:0}">
        </div>

        <div class="section-title">Identity &amp; contact</div>
        <div class="form-row">
          <div class="field"><label>ID / passport number</label><input id="sf-idno" type="text" value="${esc(existing?existing.idNo:'')}"></div>
          <div class="field"><label>Nationality</label><input id="sf-nat" type="text" value="${esc(existing?existing.nationality:'')}"></div>
          <div class="field"><label>Local or foreign</label>
            <select id="sf-local"><option value="LOCAL" ${!existing||existing.localStatus!=='FOREIGN'?'selected':''}>Local</option><option value="FOREIGN" ${existing&&existing.localStatus==='FOREIGN'?'selected':''}>Foreign</option></select>
          </div>
        </div>
        <div class="field"><label>Address</label><textarea id="sf-addr">${esc(existing?existing.address:'')}</textarea></div>
        <div class="form-row">
          <div class="field"><label>Phone</label><input id="sf-phone" type="text" value="${esc(existing?existing.phone:'')}"></div>
          <div class="field"><label>Email</label><input id="sf-email" type="email" value="${esc(existing?existing.email:'')}"></div>
        </div>
        <div class="form-row">
          <div class="field"><label>Emergency contact name</label><input id="sf-ename" type="text" value="${esc(existing?existing.emergencyName:'')}"></div>
          <div class="field"><label>Emergency contact phone</label><input id="sf-ephone" type="text" value="${esc(existing?existing.emergencyPhone:'')}"></div>
        </div>

        <div class="section-title" id="sf-salary-title">Salary package <span class="hint">(monthly — ignored for freelancers)</span></div>
        <div id="sf-salary-block">
          <div class="field" style="max-width:220px"><label>Basic salary</label><input id="sf-basic" type="number" min="0" step="0.01" value="${pkg.basic||0}"></div>
          <div class="grid grid-3">
            <div>
              <label class="small muted">Allowances</label>
              <div id="sf-allow-list">${namedAmountRowsHtml(allowances,'allow')}</div>
              <div class="flex-gap mt-8"><input id="sf-allow-name" type="text" placeholder="Name" style="max-width:110px"><input id="sf-allow-amt" type="number" step="0.01" placeholder="Amt" style="max-width:80px"><button class="btn btn-sm" type="button" id="sf-allow-add">+</button></div>
            </div>
            <div>
              <label class="small muted">Bonuses</label>
              <div id="sf-bonus-list">${namedAmountRowsHtml(bonuses,'bonus')}</div>
              <div class="flex-gap mt-8"><input id="sf-bonus-name" type="text" placeholder="Name" style="max-width:110px"><input id="sf-bonus-amt" type="number" step="0.01" placeholder="Amt" style="max-width:80px"><button class="btn btn-sm" type="button" id="sf-bonus-add">+</button></div>
            </div>
            <div>
              <label class="small muted">Other deductions</label>
              <div id="sf-ded-list">${namedAmountRowsHtml(deductions,'ded')}</div>
              <div class="flex-gap mt-8"><input id="sf-ded-name" type="text" placeholder="Name" style="max-width:110px"><input id="sf-ded-amt" type="number" step="0.01" placeholder="Amt" style="max-width:80px"><button class="btn btn-sm" type="button" id="sf-ded-add">+</button></div>
            </div>
          </div>
          <p class="hint mt-8">Pension (7% company + 7% staff of basic salary, set in Settings) applies automatically to local staff — freelancers and foreign staff are excluded.</p>
        </div>
      `,
      footerHtml: `<button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="sf-save">Save</button>`,
      onMount(modal){
        function wireList(key, arr){
          function refresh(){
            qs('#sf-'+key+'-list', modal).innerHTML = namedAmountRowsHtml(arr, key);
            qsa(`[data-${key}-del]`, modal).forEach(b=>b.addEventListener('click', ()=>{ arr.splice(+b.getAttribute(`data-${key}-del`),1); refresh(); }));
          }
          refresh();
          qs('#sf-'+key+'-add', modal).addEventListener('click', ()=>{
            const name = qs('#sf-'+key+'-name', modal).value.trim();
            const amount = parseFloat(qs('#sf-'+key+'-amt', modal).value)||0;
            if(!name||!amount) return;
            arr.push({name, amount});
            qs('#sf-'+key+'-name', modal).value=''; qs('#sf-'+key+'-amt', modal).value='';
            refresh();
          });
        }
        wireList('allow', allowances); wireList('bonus', bonuses); wireList('ded', deductions);

        qs('#sf-emp', modal).addEventListener('change', e=>{
          const isFree = e.target.value==='FREELANCER';
          qs('#sf-freelance-rate-wrap', modal).style.display = isFree?'':'none';
          qs('#sf-salary-block', modal).style.display = isFree?'none':'';
        });
        if(existing && existing.employmentType==='FREELANCER') qs('#sf-salary-block', modal).style.display='none';

        qs('#sf-save', modal).addEventListener('click', ()=>{
          const name = qs('#sf-name', modal).value.trim();
          if(!name){ toast('Enter a name.', 'err'); return; }
          const basic = parseFloat(qs('#sf-basic', modal).value)||0;
          const data = {
            name, role: qs('#sf-role', modal).value, category: qs('#sf-cat', modal).value,
            employmentType: qs('#sf-emp', modal).value,
            certLevel: qs('#sf-cert', modal).value.trim(),
            maxGuests: parseInt(qs('#sf-max', modal).value)||0,
            commissionPerDive: parseFloat(qs('#sf-comm', modal).value)||0,
            freelanceRate: parseFloat(qs('#sf-freelance-rate', modal).value)||0,
            idNo: qs('#sf-idno', modal).value.trim(), nationality: qs('#sf-nat', modal).value.trim(),
            localStatus: qs('#sf-local', modal).value,
            address: qs('#sf-addr', modal).value.trim(), phone: qs('#sf-phone', modal).value.trim(), email: qs('#sf-email', modal).value.trim(),
            emergencyName: qs('#sf-ename', modal).value.trim(), emergencyPhone: qs('#sf-ephone', modal).value.trim(),
            baseSalary: basic, // kept for backward-compat readers
            salaryPackage: { basic, allowances, bonuses, deductions },
            active:true
          };
          if(existing) Store.update('staff', existing.id, data); else Store.insert('staff', data);
          closeModal(); toast('Staff saved', 'ok'); renderStaff();
        });
      }
    });
  }

  Router.on('/fleet', render);
  window.FleetModule = { openBoatForm, openStaffForm };
})();
