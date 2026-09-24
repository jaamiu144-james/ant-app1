/* ---------------------------------------------------------------------
   manifest.js — the trip manifest: guest list for one trip with
   package, customer, own-gear ticks, waiver/medical status and gear.
   Feeds check-in and gear issue on the day.
--------------------------------------------------------------------- */

(function(){

  function render(params){
    setPageTitle('Trip manifest', 'Bookings');
    renderNav();
    // Default filter is always today's date — the manifest is a day-of-ops
    // screen, so it should never silently land on some other day's trips.
    const date = params.date || todayISO();
    const allTrips = Store.all('trips').filter(t=>t.status!=='CANCELLED').sort((a,b)=> b.tripDate.localeCompare(a.tripDate) || (a.startTime||'').localeCompare(b.startTime||''));
    const dayTrips = allTrips.filter(t=>t.tripDate===date).sort((a,b)=>(a.startTime||'').localeCompare(b.startTime||''));
    const tripId = (params.trip && dayTrips.some(t=>t.id===params.trip)) ? params.trip : (dayTrips[0]||{}).id;

    qs('#content').innerHTML = `
      <div class="toolbar">
        <input type="date" id="mf-date-pick" value="${date}">
        <button class="btn btn-sm no-print" id="mf-today">Today</button>
        <select id="mf-trip-pick" style="min-width:280px">
          <option value="">${dayTrips.length ? 'Select a trip…' : 'No trips on this date'}</option>
          ${dayTrips.map(t=>{ const boat=Store.find('boats',t.boatId); return `<option value="${t.id}" ${t.id===tripId?'selected':''}>${t.startTime||''} — ${esc(boat?boat.name:'')}</option>`; }).join('')}
        </select>
        <div class="spacer"></div>
        <button class="btn no-print" onclick="window.print()">Print</button>
      </div>
      <div id="mf-body"></div>
    `;
    qs('#mf-date-pick').addEventListener('change', e=>Router.navigate('manifest?date='+e.target.value));
    qs('#mf-today').addEventListener('click', ()=>Router.navigate('manifest?date='+todayISO()));
    qs('#mf-trip-pick').addEventListener('change', e=>Router.navigate('manifest?date='+date+'&trip='+e.target.value));
    if(tripId) renderManifest(tripId);
    else qs('#mf-body').innerHTML = `<div class="empty-state card"><h3>No trips scheduled for ${fmtDate(date)}</h3><p class="muted small">Pick a different date, or check the Calendar.</p></div>`;
  }

  function renderManifest(tripId){
    const trip = Store.find('trips', tripId);
    if(!trip){ qs('#mf-body').innerHTML = `<div class="empty-state card"><h3>No trip selected</h3></div>`; return; }
    const boat = Store.find('boats', trip.boatId);
    const staff = (trip.staffIds||[]).map(id=>Store.find('staff', id)).filter(Boolean);
    const lines = Availability.activeGuestLinesOnTrip(tripId);

    qs('#mf-body').innerHTML = `
      <div class="card mb-16">
        <div class="grid grid-4">
          <div><div class="small muted">Date</div><div><strong>${fmtDate(trip.tripDate)} ${trip.startTime||''}</strong></div></div>
          <div><div class="small muted">Boat</div><div><strong>${esc(boat?boat.name:'—')}</strong></div></div>
          <div><div class="small muted">Staff</div><div><strong>${staff.map(s=>esc(s.name)).join(', ')||'—'}</strong></div></div>
          <div><div class="small muted">Seats</div><div><strong>${lines.length} / ${trip.seatLimit||0}</strong></div></div>
        </div>
      </div>
      <div class="table-wrap"><table class="t">
        <thead><tr><th>Guest</th><th>Customer</th><th>Package</th><th>Own gear</th><th>Waiver</th><th>Medical</th><th>Status</th><th class="no-print"></th></tr></thead>
        <tbody>
        ${lines.length ? lines.map(({booking, guestLine})=>manifestRow(booking, guestLine)).join('') : `<tr><td colspan="8" class="table-empty">No guests on this trip yet.</td></tr>`}
        </tbody>
      </table></div>
    `;
    qsa('[data-gl-action]').forEach(btn=>btn.addEventListener('click', ()=>{
      const booking = Store.find('bookings', btn.dataset.booking);
      BookingsModule.handleLineAction(booking, btn.dataset.glAction, btn.dataset.glId);
      renderManifest(tripId);
    }));
  }

  function manifestRow(booking, gl){
    const guest = Store.find('guests', gl.guestId);
    const cust = Store.find('customers', booking.customerId);
    const pkg = Store.find('packages', gl.packageId);
    const ownGear = (gl.ownGearTypeIds||[]).map(id=>{ const t=Store.find('equipmentTypes', id); return t?t.name:''; }).filter(Boolean);
    const actions = [];
    if(!Auth.isViewOnly()){
    if(gl.status==='CONFIRMED') actions.push(`<button class="btn btn-sm" data-gl-action="checkin" data-gl-id="${gl.id}" data-booking="${booking.id}">Check in</button>`);
    if(gl.status==='CHECKED_IN' && !(gl.equipmentIssued&&gl.equipmentIssued.length)) actions.push(`<button class="btn btn-sm" data-gl-action="issue" data-gl-id="${gl.id}" data-booking="${booking.id}">Issue gear</button>`);
    if(gl.status==='CHECKED_IN' && gl.equipmentIssued&&gl.equipmentIssued.length) actions.push(`<button class="btn btn-sm" data-gl-action="return" data-gl-id="${gl.id}" data-booking="${booking.id}">Return gear</button>`);
    if(gl.status==='CHECKED_IN') actions.push(`<button class="btn btn-sm btn-sand" data-gl-action="complete" data-gl-id="${gl.id}" data-booking="${booking.id}">Complete</button>`);
    }
    return `<tr>
      <td><a onclick="Router.navigate('guests/${gl.guestId}')">${esc(guest?guest.name:'—')}</a></td>
      <td>${esc(cust?cust.name:'—')}</td>
      <td>${esc(pkg?pkg.name:'—')}</td>
      <td>${ownGear.length?esc(ownGear.join(', ')):'<span class="muted">None</span>'}</td>
      <td>${guest&&guest.waiverSigned?'<span class="badge badge-green">Signed</span>':'<span class="badge badge-amber">Missing</span>'}</td>
      <td>${guest&&guest.medicalDate?'<span class="badge badge-green">On file</span>':'<span class="badge badge-gray">—</span>'}</td>
      <td>${BookingsModule.lineStatusBadge(gl.status)}</td>
      <td class="row-actions no-print">${actions.join('')}</td>
    </tr>`;
  }

  Router.on('/manifest', render);
})();
