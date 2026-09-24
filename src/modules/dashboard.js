/* ---------------------------------------------------------------------
   dashboard.js — quick overview: today's trips, money at a glance,
   and anything that needs attention.
--------------------------------------------------------------------- */

(function(){

  function render(params){
    setPageTitle('Dashboard', '');
    renderNav();
    Availability.sweepExpiredHolds();

    const today = todayISO();
    const todaysTrips = Store.all('trips').filter(t=>t.tripDate===today && t.status!=='CANCELLED');
    const upcoming = Store.all('trips').filter(t=>t.tripDate>today && t.status!=='CANCELLED').sort((a,b)=>a.tripDate.localeCompare(b.tripDate)).slice(0,5);
    const openBookings = Store.all('bookings').filter(b=>b.status==='OPEN' || b.status==='CONFIRMED');
    // Cash on Hand now has a separate control account per currency (1000 MVR,
    // 1001 USD, 1002 EUR — see round-3 per-currency cash accounts). Convert the
    // foreign-currency tills to base currency at the latest exchange rate so
    // this stat reflects all cash actually on hand, not just the MVR till.
    const bal1000 = Ledger.accountBalance(Store.acctId('1010'));
    const bal1001Usd = Ledger.accountBalance(Store.acctId('1011'));
    const bal1002Eur = Ledger.accountBalance(Store.acctId('1012'));
    const bal1001 = Pricing.toBase(bal1001Usd, 'USD').amountBase;
    const bal1002 = Pricing.toBase(bal1002Eur, 'EUR').amountBase;
    const bal1100 = Ledger.accountBalance(Store.acctId('1060'));
    const arTotal = Ledger.round2(Ledger.accountBalance(Store.acctId('1110')) + Ledger.accountBalance(Store.acctId('1120')));
    const apTotal = -Ledger.accountBalance(Store.acctId('2000'));
    const todayClosed = Store.all('dayEndCloses').some(c=>c.date===today && c.status==='LOCKED');
    const holdsExpiringSoon = [];
    Store.all('bookings').forEach(b=> (b.guestLines||[]).forEach(gl=>{
      if(gl.status==='HOLD' && gl.holdExpiresAt) holdsExpiringSoon.push({b, gl});
    }));
    holdsExpiringSoon.sort((a,b)=> a.gl.holdExpiresAt.localeCompare(b.gl.holdExpiresAt));
    const unpaidBills = Store.all('bills').filter(b=>b.status!=='PAID' && b.dueDate<today);
    const draftVouchers = Store.all('vouchers').filter(v=>v.status==='DRAFT');

    // ---- analytical widgets (revenue trend, top packages, occupancy) ----
    const monthLabels = [];
    const monthRevenue = [];
    for(let i=5;i>=0;i--){
      const d = new Date(); d.setDate(1); d.setMonth(d.getMonth()-i);
      const from = d.toISOString().slice(0,7)+'-01';
      const to = new Date(d.getFullYear(), d.getMonth()+1, 0).toISOString().slice(0,10);
      const is = Ledger.incomeStatement(from, to);
      monthLabels.push(d.toLocaleDateString(undefined,{month:'short'}));
      monthRevenue.push(is.totalRevenue);
    }
    const maxRev = Math.max(1, ...monthRevenue);

    const pkgCounts = {};
    Store.all('bookings').forEach(b=> (b.guestLines||[]).forEach(gl=>{
      if(['CANCELLED','EXPIRED'].includes(gl.status)) return;
      pkgCounts[gl.packageId] = (pkgCounts[gl.packageId]||0)+1;
    }));
    const topPackages = Object.entries(pkgCounts).map(([id,count])=>({ pkg: Store.find('packages', id), count }))
      .filter(r=>r.pkg).sort((a,b)=>b.count-a.count).slice(0,5);
    const maxPkg = Math.max(1, ...topPackages.map(p=>p.count));

    const last14 = [];
    for(let i=13;i>=0;i--){
      const d = new Date(); d.setDate(d.getDate()-i);
      const dateStr = d.toISOString().slice(0,10);
      const trips = Store.all('trips').filter(t=>t.tripDate===dateStr && t.status!=='CANCELLED');
      const seats = trips.reduce((s,t)=>s+Availability.effectiveSeatLimit(t),0);
      const taken = trips.reduce((s,t)=>s+Availability.activeGuestLinesOnTrip(t.id).length,0);
      last14.push({ date: dateStr, pct: seats ? Math.round(100*taken/seats) : 0 });
    }
    const avgOccupancy = Math.round(last14.reduce((s,d)=>s+d.pct,0)/last14.length);

    qs('#content').innerHTML = `
      <div class="grid grid-4 mb-16">
        <div class="stat"><div class="label">Trips today</div><div class="value">${todaysTrips.length}</div><div class="sub"><a onclick="Router.navigate('calendar/x/day?date=${today}')">View day</a></div></div>
        <div class="stat"><div class="label">Cash + bank</div><div class="value">${fmtMoney(bal1000+bal1001+bal1002+bal1100)}</div><div class="sub">${todayClosed?'Today is closed':'Today not yet closed'}${(bal1001Usd||bal1002Eur)?' · incl. foreign cash converted at latest rate':''}</div></div>
        <div class="stat"><div class="label">Receivables</div><div class="value">${fmtMoney(arTotal)}</div><div class="sub">Owed by customers</div></div>
        <div class="stat"><div class="label">Payables</div><div class="value">${fmtMoney(apTotal)}</div><div class="sub">Owed to vendors</div></div>
      </div>

      <div class="grid grid-2">
        <div class="card">
          <div class="card-head"><h2>Today's trips</h2><a class="linkbtn" onclick="Router.navigate('calendar')">Calendar &rarr;</a></div>
          ${todaysTrips.length ? todaysTrips.map(t=>{
            const boat = Store.find('boats', t.boatId);
            const taken = Availability.activeGuestLinesOnTrip(t.id).length;
            return `<div class="flex-between mb-8"><span>${t.startTime||''} — ${esc(boat?boat.name:'')}</span><span class="badge badge-teal">${taken}/${t.seatLimit||0}</span></div>`;
          }).join('') : `<p class="muted small">No trips scheduled today.</p>`}
        </div>
        <div class="card">
          <div class="card-head"><h2>Upcoming trips</h2></div>
          ${upcoming.length ? upcoming.map(t=>{
            const boat = Store.find('boats', t.boatId);
            return `<div class="flex-between mb-8"><span>${fmtDate(t.tripDate)} ${t.startTime||''} — ${esc(boat?boat.name:'')}</span></div>`;
          }).join('') : `<p class="muted small">Nothing scheduled yet.</p>`}
        </div>
      </div>

      <div class="grid grid-2">
        <div class="card">
          <div class="card-head"><h2>Needs attention</h2></div>
          ${[
            !todayClosed ? `<div class="warn-box mb-8">Today's counter hasn't been closed yet. <a onclick="Router.navigate('dayend')">Close it &rarr;</a></div>` : '',
            unpaidBills.length ? `<div class="warn-box mb-8">${unpaidBills.length} bill(s) overdue. <a onclick="Router.navigate('bills')">Review &rarr;</a></div>` : '',
            draftVouchers.length ? `<div class="warn-box mb-8">${draftVouchers.length} voucher(s) waiting for approval. <a onclick="Router.navigate('vouchers')">Review &rarr;</a></div>` : '',
            holdsExpiringSoon.length ? `<div class="warn-box mb-8">${holdsExpiringSoon.length} guest(s) on hold, not yet confirmed. <a onclick="Router.navigate('bookings')">Review &rarr;</a></div>` : '',
          ].filter(Boolean).join('') || `<p class="muted small">Nothing needs attention right now.</p>`}
        </div>
        <div class="card">
          <div class="card-head"><h2>Open bookings</h2><a class="linkbtn" onclick="Router.navigate('bookings')">All bookings &rarr;</a></div>
          ${openBookings.length ? openBookings.slice(0,6).map(b=>{
            const cust = Store.find('customers', b.customerId);
            return `<div class="flex-between mb-8" style="cursor:pointer" onclick="Router.navigate('bookings/${b.id}')"><span>${esc(b.bookingNo)} — ${esc(cust?cust.name:'')}</span><span class="badge badge-gray">${(b.guestLines||[]).length} guest(s)</span></div>`;
          }).join('') : `<p class="muted small">No open bookings.</p>`}
        </div>
      </div>

      <div class="grid grid-3">
        <div class="card">
          <div class="card-head"><h2>Revenue trend</h2><div class="sub">Last 6 months</div></div>
          <div class="flex-gap" style="align-items:flex-end;height:110px">
            ${monthRevenue.map((v,i)=>`<div style="flex:1;text-align:center">
              <div style="background:var(--teal);border-radius:4px 4px 0 0;height:${Math.round(90*v/maxRev)}px;min-height:2px" title="${fmtMoney(v)}"></div>
              <div class="small muted mt-8">${monthLabels[i]}</div></div>`).join('')}
          </div>
        </div>
        <div class="card">
          <div class="card-head"><h2>Top packages</h2><div class="sub">By guest lines sold</div></div>
          ${topPackages.length ? topPackages.map(r=>`<div class="mb-8">
            <div class="flex-between small"><span>${esc(r.pkg.name)}</span><span class="mono">${r.count}</span></div>
            <div class="progress-bar"><div style="width:${Math.round(100*r.count/maxPkg)}%"></div></div>
          </div>`).join('') : `<p class="muted small">No sales yet.</p>`}
        </div>
        <div class="card">
          <div class="card-head"><h2>Occupancy</h2><div class="sub">Avg. last 14 days</div></div>
          <div class="stat" style="border:none;padding:0"><div class="value">${avgOccupancy}%</div><div class="sub">Seats filled vs. offered (incl. rental boats)</div></div>
          <div class="progress-bar mt-12"><div style="width:${avgOccupancy}%"></div></div>
        </div>
      </div>
    `;
  }

  Router.on('/dashboard', render);
})();
