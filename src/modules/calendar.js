/* ---------------------------------------------------------------------
   calendar.js — trip templates, trips (month/day views) and closures.
   A trip is one dated departure with a boat, staff, a seat limit and
   the packages it offers. Booking guest lines are placed onto trips
   elsewhere (bookings.js); this module manages the trips themselves.
--------------------------------------------------------------------- */

(function(){

  const WEEKDAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

  function render(params){
    setPageTitle('Calendar', 'Bookings');
    renderNav();
    const tab = params.sub || 'month';
    qs('#content').innerHTML = `
      <div class="tabs">
        <div class="tab ${tab==='month'?'active':''}" data-tab="month">Month</div>
        <div class="tab ${tab==='day'?'active':''}" data-tab="day">Day</div>
        <div class="tab ${tab==='templates'?'active':''}" data-tab="templates">Trip templates</div>
        <div class="tab ${tab==='closures'?'active':''}" data-tab="closures">Closures</div>
      </div>
      <div id="cal-body"></div>
    `;
    qsa('[data-tab]').forEach(t=>t.addEventListener('click', ()=>Router.navigate('calendar/x/'+t.dataset.tab)));
    if(tab==='day') renderDay(params);
    else if(tab==='templates') renderTemplates();
    else if(tab==='closures') renderClosures();
    else renderMonth(params);
  }

  /* ---------------- MONTH VIEW ---------------- */
  function renderMonth(params){
    const now = new Date();
    const y = parseInt(params.y) || now.getFullYear();
    const m = parseInt(params.m) || (now.getMonth()+1); // 1-12
    const first = new Date(y, m-1, 1);
    const startOffset = first.getDay();
    const daysInMonth = new Date(y, m, 0).getDate();
    const trips = Store.all('trips').filter(t=>{
      const d = new Date(t.tripDate+'T00:00:00');
      return d.getFullYear()===y && (d.getMonth()+1)===m;
    });
    const byDate = {};
    trips.forEach(t=>{ (byDate[t.tripDate]=byDate[t.tripDate]||[]).push(t); });

    const cells = [];
    for(let i=0;i<startOffset;i++) cells.push({blank:true});
    for(let d=1; d<=daysInMonth; d++){
      const dateStr = `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      cells.push({ date: dateStr, day: d, trips: byDate[dateStr]||[] });
    }
    while(cells.length % 7 !== 0) cells.push({blank:true});

    let prevY=y, prevM=m-1; if(prevM<1){prevM=12;prevY--;}
    let nextY=y, nextM=m+1; if(nextM>12){nextM=1;nextY++;}

    qs('#cal-body').innerHTML = `
      <div class="toolbar">
        <button class="btn btn-sm" id="cal-prev">&larr;</button>
        <h2 style="min-width:180px;text-align:center">${first.toLocaleDateString(undefined,{month:'long',year:'numeric'})}</h2>
        <button class="btn btn-sm" id="cal-next">&rarr;</button>
        <div class="spacer"></div>
        ${Auth.isViewOnly()?'':'<button class="btn btn-primary" id="cal-add-trip">+ Add trip</button>'}
      </div>
      <div class="calendar-grid">
        ${WEEKDAYS.map(w=>`<div class="cal-dow">${w}</div>`).join('')}
        ${cells.map(c=>{
          if(c.blank) return `<div class="cal-cell other-month"></div>`;
          const isToday = c.date===todayISO();
          return `<div class="cal-cell ${isToday?'today':''}">
            <div class="daynum">${c.day}</div>
            ${c.trips.slice(0,4).map(t=>tripPill(t)).join('')}
            ${c.trips.length>4?`<div class="small muted">+${c.trips.length-4} more</div>`:''}
            ${c.trips.length ? `<div class="linkbtn small" data-goto-day="${c.date}">View day</div>` : ''}
          </div>`;
        }).join('')}
      </div>
    `;
    qs('#cal-prev').addEventListener('click', ()=>Router.navigate(`calendar/x/month?y=${prevY}&m=${prevM}`));
    qs('#cal-next').addEventListener('click', ()=>Router.navigate(`calendar/x/month?y=${nextY}&m=${nextM}`));
    if(qs('#cal-add-trip')) qs('#cal-add-trip').addEventListener('click', ()=>openTripForm());
    qsa('[data-goto-day]').forEach(b=>b.addEventListener('click', ()=>Router.navigate('calendar/x/day?date='+b.dataset.gotoDay)));
    qsa('[data-trip]').forEach(b=>b.addEventListener('click', (e)=>{ e.stopPropagation(); openTripDetail(b.dataset.trip); }));
  }

  function tripPill(t){
    const boat = Store.find('boats', t.boatId);
    const taken = Availability.activeGuestLinesOnTrip(t.id).length;
    const cls = t.status==='CANCELLED'?'cancelled':t.status==='CLOSED'?'closed':(taken>=(t.seatLimit||0)?'full':'');
    return `<div class="cal-trip ${cls}" data-trip="${t.id}" title="${esc(t.tripNo||'')}">${t.startTime||''} ${esc(boat?boat.name:'')} (${taken}/${t.seatLimit||0})</div>`;
  }

  /* ---------------- DAY VIEW ---------------- */
  function renderDay(params){
    const date = params.date || todayISO();
    const trips = Store.all('trips').filter(t=>t.tripDate===date).sort((a,b)=>(a.startTime||'').localeCompare(b.startTime||''));
    qs('#cal-body').innerHTML = `
      <div class="toolbar">
        <input type="date" id="day-picker" value="${date}">
        <div class="spacer"></div>
        ${Auth.isViewOnly()?'':'<button class="btn btn-primary" id="cal-add-trip">+ Add trip</button>'}
      </div>
      <h2 class="mb-12">${fmtDate(date)}</h2>
      ${trips.length ? trips.map(t=>tripCard(t)).join('') : `<div class="empty-state card"><h3>No trips this day</h3><p>Add one, or generate trips from a template.</p></div>`}
    `;
    qs('#day-picker').addEventListener('change', e=>Router.navigate('calendar/x/day?date='+e.target.value));
    if(qs('#cal-add-trip')) qs('#cal-add-trip').addEventListener('click', ()=>openTripForm({tripDate:date}));
    qsa('[data-trip]').forEach(b=>b.addEventListener('click', ()=>openTripDetail(b.dataset.trip)));
    qsa('[data-manifest]').forEach(b=>b.addEventListener('click', e=>{ e.stopPropagation(); Router.navigate('manifest?date='+date+'&trip='+b.dataset.manifest); }));
  }

  function tripCard(t){
    const boat = Store.find('boats', t.boatId);
    const staff = (t.staffIds||[]).map(id=>Store.find('staff', id)).filter(Boolean);
    const pkgs = (t.packageIds||[]).map(id=>Store.find('packages', id)).filter(Boolean);
    const taken = Availability.activeGuestLinesOnTrip(t.id).length;
    return `<div class="card" style="cursor:pointer" data-trip="${t.id}">
      <div class="flex-between">
        <div>
          <h3>${t.startTime||''} — ${esc(boat?boat.name:'No boat')} ${statusBadge(t.status)}</h3>
          <p class="small muted mt-8">${esc(t.tripNo||'')} · ${staff.map(s=>esc(s.name)).join(', ')||'No staff assigned'} · ${pkgs.map(p=>esc(p.name)).join(', ')||'No packages set'}</p>
        </div>
        <div class="flex-gap">
          <div class="stat" style="padding:8px 14px"><div class="value" style="font-size:16px">${taken}/${t.seatLimit||0}</div><div class="label" style="font-size:10px">Seats</div></div>
          <button class="btn btn-sm" data-manifest="${t.id}">Manifest</button>
        </div>
      </div>
    </div>`;
  }

  function statusBadge(s){
    const map = { OPEN:'badge-green', FULL:'badge-amber', CLOSED:'badge-gray', COMPLETED:'badge-teal', CANCELLED:'badge-red' };
    return `<span class="badge ${map[s]||'badge-gray'}">${esc(s||'OPEN')}</span>`;
  }

  function openTripDetail(tripId){
    const t = Store.find('trips', tripId);
    if(!t) return;
    const boat = Store.find('boats', t.boatId);
    const rentalBoat = t.rentalBoatId ? Store.find('boats', t.rentalBoatId) : null;
    const lines = Availability.activeGuestLinesOnTrip(tripId);
    const vo = Auth.isViewOnly();
    const seatLimit = Availability.effectiveSeatLimit(t);
    const freelancers = (t.freelancers||[]);
    openModal({
      title: `Trip ${esc(t.tripNo||'')} — ${fmtDate(t.tripDate)} ${t.startTime||''}`,
      bodyHtml: `
        <dl class="kv">
          <dt>Trip #</dt><dd>${esc(t.tripNo||'—')}</dd>
          <dt>Boat</dt><dd>${esc(boat?boat.name:'—')}${rentalBoat?` + rental: ${esc(rentalBoat.name)}`:''}</dd>
          <dt>Seats</dt><dd>${lines.length} of ${seatLimit}</dd>
          <dt>Status</dt><dd>${statusBadge(t.status)}</dd>
          ${freelancers.length?`<dt>Freelancers</dt><dd>${freelancers.map(f=>{ const s=Store.find('staff',f.staffId); return `${esc(s?s.name:'—')} (${fmtMoney(f.commission)})`; }).join(', ')}</dd>`:''}
        </dl>
        <div class="divider"></div>
        <div class="flex-gap wrap">
          ${vo?'':`<button class="btn btn-sm" id="td-edit">Edit trip</button>`}
          <button class="btn btn-sm" id="td-manifest">Open manifest</button>
          ${!vo?`<button class="btn btn-sm" id="td-rental">+ Rental boat (overflow)</button>
          <button class="btn btn-sm" id="td-freelancer">+ Assign freelancer</button>`:''}
          ${t.status!=='CANCELLED' && !vo ? `<button class="btn btn-sm btn-danger" id="td-cancel">Cancel trip</button>` : ''}
        </div>
      `,
      footerHtml: `<button class="btn" data-close>Close</button>`,
      onMount(modal){
        if(qs('#td-edit', modal)) qs('#td-edit', modal).addEventListener('click', ()=>{ closeModal(); openTripForm(t); });
        qs('#td-manifest', modal).addEventListener('click', ()=>{ closeModal(); Router.navigate('manifest?date='+t.tripDate+'&trip='+t.id); });
        if(qs('#td-rental', modal)) qs('#td-rental', modal).addEventListener('click', ()=>{ closeModal(); openRentalBoatForm(t); });
        if(qs('#td-freelancer', modal)) qs('#td-freelancer', modal).addEventListener('click', ()=>{ closeModal(); openFreelancerForm(t); });
        const cancelBtn = qs('#td-cancel', modal);
        if(cancelBtn) cancelBtn.addEventListener('click', ()=>{
          confirmDialog('Cancel this trip? Guests on it will need to be rescheduled or refunded from their bookings.', ()=>{
            Store.update('trips', t.id, { status:'CANCELLED' });
            closeModal(); toast('Trip cancelled'); Router.render();
          }, {danger:true, yesLabel:'Cancel trip'});
        });
      }
    });
  }

  // ---- Rental boats/gear for overflow capacity (a rental boat/vendor is tagged
  // on the trip; its cost is billed to that vendor through a normal bill) ----
  function openRentalBoatForm(t){
    const rentalBoats = Store.all('boats').filter(b=>b.rental && b.active!==false);
    if(!rentalBoats.length){ toast('Add a rental boat under Boats & staff first (tick "This is a rental boat").', 'err'); return; }
    openModal({
      title:'Add rental boat for this trip',
      bodyHtml: `
        <div class="field"><label>Rental boat</label><select id="rb-boat">${rentalBoats.map(b=>`<option value="${b.id}">${esc(b.name)} (${b.seats} seats)</option>`).join('')}</select></div>
        <div class="field"><label>Rental cost <span class="hint">(billed to the boat's vendor)</span></label><input id="rb-cost" type="number" min="0" step="0.01" value="0"></div>
      `,
      footerHtml: `<button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="rb-save">Add &amp; bill</button>`,
      onMount(modal){
        qs('#rb-save', modal).addEventListener('click', ()=>{
          const boatId = qs('#rb-boat', modal).value;
          const cost = parseFloat(qs('#rb-cost', modal).value)||0;
          const boat = Store.find('boats', boatId);
          Store.update('trips', t.id, { rentalBoatId: boatId });
          if(cost>0 && boat && boat.vendorId && window.BillsModule){
            BillsModule.openForm({ vendorId: boat.vendorId, tripId: t.id, accountId: Store.acctId('5010'), amount: cost,
              description: 'Rental boat — '+boat.name+' — trip '+(t.tripNo||''), title:'Rental boat bill' });
          } else { closeModal(); toast('Rental boat added to trip', 'ok'); Router.render(); }
        });
      }
    });
  }

  function openFreelancerForm(t){
    const freelancers = Store.all('staff').filter(s=>s.employmentType==='FREELANCER' && s.active!==false);
    if(!freelancers.length){ toast('Add a freelancer under Boats & staff first (employment type Freelancer).', 'err'); return; }
    openModal({
      title:'Assign freelancer to this trip',
      bodyHtml: `
        <div class="field"><label>Freelancer</label><select id="fr-staff">${freelancers.map(s=>`<option value="${s.id}" data-rate="${s.freelanceRate||0}">${esc(s.name)}</option>`).join('')}</select></div>
        <div class="field"><label>Commission for this trip</label><input id="fr-comm" type="number" min="0" step="0.01" value="${freelancers[0].freelanceRate||0}"></div>
        <div class="field"><label>Pay from</label><select id="fr-method"><option value="PETTY">Petty cash</option><option value="BANK_CASH">Bank / cash</option></select></div>
        <p class="hint">Posted as a direct expense (Freelancer / Casual Guide Fees) — never through payroll.</p>
      `,
      footerHtml: `<button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="fr-save">Assign &amp; pay</button>`,
      onMount(modal){
        qs('#fr-staff', modal).addEventListener('change', e=>{ qs('#fr-comm', modal).value = e.target.selectedOptions[0].dataset.rate||0; });
        qs('#fr-save', modal).addEventListener('click', ()=>{
          const staffId = qs('#fr-staff', modal).value;
          const commission = parseFloat(qs('#fr-comm', modal).value)||0;
          const s = Store.find('staff', staffId);
          const freelancers2 = (t.freelancers||[]).concat([{ staffId, commission }]);
          Store.update('trips', t.id, { freelancers: freelancers2 });
          if(commission>0){
            try{
              VouchersModule.quickCreate(qs('#fr-method', modal).value, { payee: s?s.name:'Freelancer', method:'CASH', tripId: t.id,
                memo:'Freelance commission — trip '+(t.tripNo||''),
                lines:[{ kind:'GL', accountId: Store.acctId('5120'), description:'Freelance commission — '+(s?s.name:''), amount: commission }] }, true);
            }catch(e){ toast(e.message, 'err'); }
          }
          closeModal(); toast('Freelancer assigned', 'ok'); Router.render();
        });
      }
    });
  }

  function openTripForm(existing){
    const boats = Store.all('boats').filter(b=>b.active!==false);
    const staff = Store.all('staff').filter(s=>s.active!==false && (s.role==='GUIDE'||s.role==='INSTRUCTOR'));
    const packages = Store.all('packages').filter(p=>p.kind!=='ADDON' && p.active!==false);
    const src = existing || {};
    openModal({
      title: existing && existing.id ? 'Edit trip' : 'Add trip', size:'lg',
      bodyHtml: `
        <div class="form-row">
          <div class="field"><label>Date</label><input id="tr-date" type="date" value="${src.tripDate||''}"></div>
          <div class="field"><label>Start time</label><input id="tr-time" type="time" value="${src.startTime||'08:00'}"></div>
        </div>
        <div class="form-row">
          <div class="field"><label>Boat</label><select id="tr-boat">${boats.map(b=>`<option value="${b.id}" ${src.boatId===b.id?'selected':''}>${esc(b.name)} (${b.seats} seats)</option>`).join('')}</select></div>
          <div class="field"><label>Seat limit <span class="hint">(defaults to boat seats)</span></label><input id="tr-seats" type="number" min="1" value="${src.seatLimit||''}"></div>
        </div>
        <div class="field"><label>Staff on this trip</label>
          <div class="pill-select" id="tr-staff">${staff.map(s=>`<button type="button" class="pill ${(src.staffIds||[]).includes(s.id)?'active':''}" data-id="${s.id}">${esc(s.name)}</button>`).join('')||'<span class="muted small">Add staff under Catalog → Boats &amp; staff.</span>'}</div>
        </div>
        <div class="field"><label>Packages offered on this trip</label>
          <div class="pill-select" id="tr-pkgs">${packages.map(p=>`<button type="button" class="pill ${(src.packageIds||[]).includes(p.id)?'active':''}" data-id="${p.id}">${esc(p.name)}</button>`).join('')||'<span class="muted small">Add packages under Catalog → Packages.</span>'}</div>
        </div>
        <div class="field"><label>Status</label>
          <select id="tr-status">${['OPEN','FULL','CLOSED','COMPLETED','CANCELLED'].map(s=>`<option value="${s}" ${src.status===s?'selected':''}>${s}</option>`).join('')}</select>
        </div>
      `,
      footerHtml: `<button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="tr-save">Save trip</button>`,
      onMount(modal){
        qsa('#tr-staff .pill', modal).forEach(p=>p.addEventListener('click', ()=>p.classList.toggle('active')));
        qsa('#tr-pkgs .pill', modal).forEach(p=>p.addEventListener('click', ()=>p.classList.toggle('active')));
        qs('#tr-save', modal).addEventListener('click', ()=>{
          const tripDate = qs('#tr-date', modal).value;
          const boatId = qs('#tr-boat', modal).value;
          if(!tripDate || !boatId){ toast('Pick a date and boat.', 'err'); return; }
          const boat = Store.find('boats', boatId);
          const staffIds = qsa('#tr-staff .pill.active', modal).map(p=>p.dataset.id);
          const packageIds = qsa('#tr-pkgs .pill.active', modal).map(p=>p.dataset.id);
          const data = {
            tripDate, startTime: qs('#tr-time', modal).value, boatId,
            seatLimit: parseInt(qs('#tr-seats', modal).value) || (boat?boat.seats:0),
            staffIds, packageIds, status: qs('#tr-status', modal).value || 'OPEN'
          };
          if(existing && existing.id) Store.update('trips', existing.id, data);
          else Store.insert('trips', Object.assign({ tripNo: Store.docNo('TRP','trip') }, data));
          closeModal(); toast('Trip saved', 'ok'); Router.render();
        });
      }
    });
  }

  /* ---------------- TEMPLATES ---------------- */
  function renderTemplates(){
    const templates = Store.all('tripTemplates');
    qs('#cal-body').innerHTML = `
      <div class="help-box mb-16">Templates are a shortcut for recurring departures. Generating trips from one just creates ordinary trips you can still edit individually.</div>
      <div class="toolbar"><div class="spacer"></div>${Auth.isViewOnly()?'':'<button class="btn btn-primary" id="tmpl-add">+ Add template</button>'}</div>
      <div class="table-wrap"><table class="t">
        <thead><tr><th>Name</th><th>Weekdays</th><th>Time</th><th>Boat</th><th></th></tr></thead>
        <tbody>
        ${templates.length ? templates.map(t=>{
          const boat = Store.find('boats', t.boatId);
          return `<tr><td><strong>${esc(t.name)}</strong></td><td>${(t.weekdays||[]).map(d=>WEEKDAYS[d]).join(', ')}</td><td>${t.startTime}</td><td>${esc(boat?boat.name:'—')}</td>
            <td class="row-actions"><button class="btn btn-sm" data-gen="${t.id}">Generate trips</button><button class="btn btn-sm" data-edit="${t.id}">Edit</button></td></tr>`;
        }).join('') : `<tr><td colspan="5" class="table-empty">No templates yet.</td></tr>`}
        </tbody>
      </table></div>
    `;
    if(qs('#tmpl-add')) qs('#tmpl-add').addEventListener('click', ()=>openTemplateForm());
    qsa('[data-edit]').forEach(b=>b.addEventListener('click', ()=>openTemplateForm(Store.find('tripTemplates', b.dataset.edit))));
    qsa('[data-gen]').forEach(b=>b.addEventListener('click', ()=>openGenerateForm(Store.find('tripTemplates', b.dataset.gen))));
  }

  function openTemplateForm(existing){
    const boats = Store.all('boats').filter(b=>b.active!==false);
    const staff = Store.all('staff').filter(s=>s.active!==false && (s.role==='GUIDE'||s.role==='INSTRUCTOR'));
    const packages = Store.all('packages').filter(p=>p.kind!=='ADDON' && p.active!==false);
    const src = existing || {};
    openModal({
      title: existing?'Edit template':'Add trip template', size:'lg',
      bodyHtml: `
        <div class="field"><label>Name</label><input id="tf-name" type="text" value="${esc(src.name||'')}" placeholder="e.g. Morning reef trip"></div>
        <div class="field"><label>Weekdays</label>
          <div class="pill-select" id="tf-days">${WEEKDAYS.map((d,i)=>`<button type="button" class="pill ${(src.weekdays||[]).includes(i)?'active':''}" data-i="${i}">${d}</button>`).join('')}</div>
        </div>
        <div class="form-row">
          <div class="field"><label>Start time</label><input id="tf-time" type="time" value="${src.startTime||'08:00'}"></div>
          <div class="field"><label>Boat</label><select id="tf-boat">${boats.map(b=>`<option value="${b.id}" ${src.boatId===b.id?'selected':''}>${esc(b.name)}</option>`).join('')}</select></div>
          <div class="field"><label>Seat limit</label><input id="tf-seats" type="number" min="1" value="${src.seatLimit||''}"></div>
        </div>
        <div class="field"><label>Default staff</label><div class="pill-select" id="tf-staff">${staff.map(s=>`<button type="button" class="pill ${(src.staffIds||[]).includes(s.id)?'active':''}" data-id="${s.id}">${esc(s.name)}</button>`).join('')}</div></div>
        <div class="field"><label>Packages offered</label><div class="pill-select" id="tf-pkgs">${packages.map(p=>`<button type="button" class="pill ${(src.packageIds||[]).includes(p.id)?'active':''}" data-id="${p.id}">${esc(p.name)}</button>`).join('')}</div></div>
      `,
      footerHtml: `<button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="tf-save">Save template</button>`,
      onMount(modal){
        qsa('#tf-days .pill, #tf-staff .pill, #tf-pkgs .pill', modal).forEach(p=>p.addEventListener('click', ()=>p.classList.toggle('active')));
        qs('#tf-save', modal).addEventListener('click', ()=>{
          const name = qs('#tf-name', modal).value.trim();
          const boatId = qs('#tf-boat', modal).value;
          if(!name || !boatId){ toast('Enter a name and pick a boat.', 'err'); return; }
          const boat = Store.find('boats', boatId);
          const data = {
            name, weekdays: qsa('#tf-days .pill.active', modal).map(p=>+p.dataset.i),
            startTime: qs('#tf-time', modal).value, boatId,
            seatLimit: parseInt(qs('#tf-seats', modal).value)||(boat?boat.seats:0),
            staffIds: qsa('#tf-staff .pill.active', modal).map(p=>p.dataset.id),
            packageIds: qsa('#tf-pkgs .pill.active', modal).map(p=>p.dataset.id),
            active:true
          };
          if(existing) Store.update('tripTemplates', existing.id, data); else Store.insert('tripTemplates', data);
          closeModal(); toast('Template saved', 'ok'); renderTemplates();
        });
      }
    });
  }

  function openGenerateForm(template){
    openModal({
      title: `Generate trips from "${template.name}"`,
      bodyHtml: `
        <div class="form-row">
          <div class="field"><label>From</label><input id="gen-from" type="date" value="${todayISO()}"></div>
          <div class="field"><label>To</label><input id="gen-to" type="date" value="${todayISO()}"></div>
        </div>
        <p class="hint">Creates a trip for every matching weekday in range that doesn't already have one on this boat at this time.</p>
      `,
      footerHtml: `<button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="gen-go">Generate</button>`,
      onMount(modal){
        qs('#gen-go', modal).addEventListener('click', ()=>{
          const from = qs('#gen-from', modal).value, to = qs('#gen-to', modal).value;
          if(!from || !to || from>to){ toast('Enter a valid date range.', 'err'); return; }
          let created = 0;
          let cur = new Date(from+'T00:00:00');
          const end = new Date(to+'T00:00:00');
          while(cur<=end){
            const dow = cur.getDay();
            if((template.weekdays||[]).includes(dow)){
              const dateStr = cur.toISOString().slice(0,10);
              const exists = Store.all('trips').find(t=>t.tripDate===dateStr && t.boatId===template.boatId && t.startTime===template.startTime);
              if(!exists){
                Store.insert('trips', {
                  tripNo: Store.docNo('TRP','trip'),
                  templateId: template.id, tripDate: dateStr, startTime: template.startTime, boatId: template.boatId,
                  seatLimit: template.seatLimit, staffIds: template.staffIds.slice(), packageIds: template.packageIds.slice(), status:'OPEN'
                });
                created++;
              }
            }
            cur.setDate(cur.getDate()+1);
          }
          closeModal(); toast(`${created} trip(s) created`, 'ok'); Router.navigate('calendar');
        });
      }
    });
  }

  /* ---------------- CLOSURES ---------------- */
  function renderClosures(){
    const closures = Store.all('closures').sort((a,b)=>b.fromDate.localeCompare(a.fromDate));
    qs('#cal-body').innerHTML = `
      <div class="toolbar"><div class="spacer"></div>${Auth.isViewOnly()?'':'<button class="btn btn-primary" id="cl-add">+ Add closure</button>'}</div>
      <div class="table-wrap"><table class="t">
        <thead><tr><th>Boat</th><th>From</th><th>To</th><th>Reason</th><th>Affected trips</th><th></th></tr></thead>
        <tbody>
        ${closures.length ? closures.map(c=>{
          const boat = c.boatId ? Store.find('boats', c.boatId) : null;
          const affected = Store.all('trips').filter(t=> t.tripDate>=c.fromDate && t.tripDate<=c.toDate && (!c.boatId || t.boatId===c.boatId) && t.status!=='CANCELLED');
          return `<tr><td>${boat?esc(boat.name):'All boats'}</td><td>${fmtDate(c.fromDate)}</td><td>${fmtDate(c.toDate)}</td><td>${esc(c.reason||'—')}</td>
            <td>${affected.length}</td>
            <td class="row-actions">
              ${affected.length?`<button class="btn btn-sm btn-danger" data-cancel-affected="${c.id}">Cancel affected</button>`:''}
              <button class="btn btn-sm btn-ghost" data-del="${c.id}">Delete</button>
            </td></tr>`;
        }).join('') : `<tr><td colspan="6" class="table-empty">No closures.</td></tr>`}
        </tbody>
      </table></div>
    `;
    if(qs('#cl-add')) qs('#cl-add').addEventListener('click', ()=>openClosureForm());
    qsa('[data-del]').forEach(b=>b.addEventListener('click', ()=>{ Store.remove('closures', b.dataset.del); renderClosures(); }));
    qsa('[data-cancel-affected]').forEach(b=>b.addEventListener('click', ()=>{
      const c = Store.find('closures', b.dataset.cancelAffected);
      const affected = Store.all('trips').filter(t=> t.tripDate>=c.fromDate && t.tripDate<=c.toDate && (!c.boatId || t.boatId===c.boatId) && t.status!=='CANCELLED');
      confirmDialog(`Cancel ${affected.length} trip(s) affected by this closure? Guests on them will need rescheduling.`, ()=>{
        affected.forEach(t=>Store.update('trips', t.id, {status:'CANCELLED'}));
        toast('Trips cancelled'); renderClosures();
      }, {danger:true, yesLabel:'Cancel trips'});
    }));
  }

  function openClosureForm(){
    const boats = Store.all('boats');
    openModal({
      title:'Add closure',
      bodyHtml: `
        <div class="field"><label>Boat</label><select id="cl-boat"><option value="">All boats</option>${boats.map(b=>`<option value="${b.id}">${esc(b.name)}</option>`).join('')}</select></div>
        <div class="form-row">
          <div class="field"><label>From</label><input id="cl-from" type="date" value="${todayISO()}"></div>
          <div class="field"><label>To</label><input id="cl-to" type="date" value="${todayISO()}"></div>
        </div>
        <div class="field"><label>Reason</label><input id="cl-reason" type="text" placeholder="e.g. Weather, maintenance"></div>
      `,
      footerHtml: `<button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="cl-save">Save</button>`,
      onMount(modal){
        qs('#cl-save', modal).addEventListener('click', ()=>{
          const fromDate = qs('#cl-from', modal).value, toDate = qs('#cl-to', modal).value;
          if(!fromDate || !toDate || fromDate>toDate){ toast('Enter a valid date range.', 'err'); return; }
          Store.insert('closures', { boatId: qs('#cl-boat', modal).value||null, fromDate, toDate, reason: qs('#cl-reason', modal).value.trim() });
          closeModal(); toast('Closure added', 'ok'); renderClosures();
        });
      }
    });
  }

  Router.on('/calendar', render);
  window.CalendarModule = { openTripForm, openRentalBoatForTrip: (tripId)=>{ const t=Store.find('trips', tripId); if(t) openRentalBoatForm(t); } };
})();
