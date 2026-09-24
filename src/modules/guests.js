/* ---------------------------------------------------------------------
   guests.js — guest register: one record per person, reused across
   bookings regardless of which customer (agent or Direct) books them.
--------------------------------------------------------------------- */

(function(){

  function render(params){
    setPageTitle('Guests', 'Directory');
    renderNav();
    const q = (params.q||'').toLowerCase();
    let rows = Store.all('guests').slice().sort((a,b)=>a.name.localeCompare(b.name));
    if(q) rows = rows.filter(g=> g.name.toLowerCase().includes(q) || (g.passportNo||'').toLowerCase().includes(q));

    const vo = Auth.isViewOnly();
    qs('#content').innerHTML = `
      <div class="toolbar">
        <input class="search-input" id="g-search" type="text" placeholder="Search guests…" value="${esc(params.q||'')}">
        <div class="spacer"></div>
        ${vo?'':`<button class="btn btn-primary" id="g-add">+ Add guest</button>`}
      </div>
      <div class="table-wrap">
        <table class="t">
          <thead><tr><th>Name</th><th>Certification</th><th>Waiver</th><th>Trips</th><th></th></tr></thead>
          <tbody>
            ${rows.length ? rows.map(rowHtml).join('') : `<tr><td colspan="5" class="table-empty">No guests registered yet.</td></tr>`}
          </tbody>
        </table>
      </div>
    `;
    qs('#g-search').addEventListener('input', debounce(e=>Router.navigate('guests?q='+encodeURIComponent(e.target.value))));
    if(qs('#g-add')) qs('#g-add').addEventListener('click', ()=>openGuestForm());
    qsa('[data-view]').forEach(b=>b.addEventListener('click', ()=>Router.navigate('guests/'+b.dataset.view)));
    qsa('[data-edit]').forEach(b=>b.addEventListener('click', e=>{ e.stopPropagation(); openGuestForm(Store.find('guests', b.dataset.edit)); }));
  }

  function tripCount(guestId){
    let n=0;
    Store.all('bookings').forEach(b=> (b.guestLines||[]).forEach(gl=>{ if(gl.guestId===guestId && gl.status==='COMPLETED') n++; }));
    return n;
  }

  function rowHtml(g){
    return `<tr style="cursor:pointer" data-view="${g.id}">
      <td><strong>${esc(g.name)}</strong></td>
      <td>${esc(g.certLevel||'—')}</td>
      <td>${g.waiverSigned?'<span class="badge badge-green">Signed</span>':'<span class="badge badge-amber">Missing</span>'}</td>
      <td>${tripCount(g.id)}</td>
      <td class="row-actions">${Auth.isViewOnly()?'':`<button class="btn btn-sm" data-edit="${g.id}">Edit</button>`}</td>
    </tr>`;
  }

  function detail(params){
    const g = Store.find('guests', params.id);
    if(!g){ Router.navigate('guests'); return; }
    setPageTitle(g.name, 'Guests');
    renderNav();
    const lines = [];
    Store.all('bookings').forEach(b=> (b.guestLines||[]).forEach(gl=>{
      if(gl.guestId===g.id) lines.push({ b, gl });
    }));
    lines.sort((a,b)=> (b.gl.tripId||'').localeCompare(a.gl.tripId||''));

    qs('#content').innerHTML = `
      <div class="toolbar"><button class="btn" onclick="Router.navigate('guests')">&larr; All guests</button><div class="spacer"></div>${Auth.isViewOnly()?'':'<button class="btn" id="g-edit">Edit</button>'}</div>
      <div class="grid grid-2">
        <div class="card">
          <div class="card-head"><h2>Profile</h2></div>
          <dl class="kv">
            <dt>Passport / ID</dt><dd>${esc(g.passportNo||'—')}</dd>
            <dt>Nationality</dt><dd>${esc(g.nationality||'—')}</dd>
            <dt>Date of birth</dt><dd>${g.dob?fmtDate(g.dob):'—'}</dd>
            <dt>Phone</dt><dd>${esc(g.phone||'—')}</dd>
            <dt>Email</dt><dd>${esc(g.email||'—')}</dd>
          </dl>
        </div>
        <div class="card">
          <div class="card-head"><h2>Diving &amp; waiver</h2></div>
          <dl class="kv">
            <dt>Certification</dt><dd>${esc(g.certLevel||'—')} ${g.certAgency?`(${esc(g.certAgency)})`:''}</dd>
            <dt>Cert. number</dt><dd>${esc(g.certNo||'—')}</dd>
            <dt>Medical form</dt><dd>${g.medicalDate?`Signed ${fmtDate(g.medicalDate)}`:'<span class="badge badge-amber">Not on file</span>'}</dd>
            <dt>Waiver</dt><dd>${g.waiverSigned?`<span class="badge badge-green">Signed ${g.waiverDate?fmtDate(g.waiverDate):''}</span>${g.waiverTemplateName?` <span class="small muted">(${esc(g.waiverTemplateName)})</span>`:''}`:'<span class="badge badge-amber">Not signed</span>'}</dd>
          </dl>
          ${g.waiverSignatureDataUrl?`<div class="mt-12"><div class="small muted mb-4">Signature ${g.waiverSignedAt?'— '+fmtDateTime(g.waiverSignedAt):''}</div><img src="${g.waiverSignatureDataUrl}" style="max-width:280px;border:1px solid var(--line);border-radius:8px;background:#fff"></div>`:''}
          ${g.notes?`<p class="small muted mt-12">${esc(g.notes)}</p>`:''}
        </div>
      </div>
      <div class="card">
        <div class="card-head"><h2>Dive history</h2></div>
        <div class="table-wrap"><table class="t">
          <thead><tr><th>Booking</th><th>Trip</th><th>Package</th><th>Status</th></tr></thead>
          <tbody>
          ${lines.length ? lines.map(({b,gl})=>{
            const trip = Store.find('trips', gl.tripId);
            const pkg = Store.find('packages', gl.packageId);
            return `<tr style="cursor:pointer" onclick="Router.navigate('bookings/${b.id}')"><td>${esc(b.bookingNo)}</td><td>${trip?fmtDate(trip.tripDate):'—'}</td><td>${esc(pkg?pkg.name:'—')}</td><td>${esc(gl.status)}</td></tr>`;
          }).join('') : `<tr><td colspan="4" class="table-empty">No trips yet.</td></tr>`}
          </tbody>
        </table></div>
      </div>
    `;
    if(qs('#g-edit')) qs('#g-edit').addEventListener('click', ()=>openGuestForm(g));
  }

  function openGuestForm(existing){
    const levels = Store.settings.certLevels||[];
    openModal({
      title: existing ? 'Edit guest' : 'Add guest', size:'lg',
      bodyHtml: `
        <div class="form-row">
          <div class="field"><label>Full name</label><input id="gf-name" type="text" value="${esc(existing?existing.name:'')}"></div>
          <div class="field"><label>Passport / ID number</label><input id="gf-pass" type="text" value="${esc(existing?existing.passportNo:'')}"></div>
        </div>
        <div class="form-row">
          <div class="field"><label>Nationality</label><input id="gf-nat" type="text" value="${esc(existing?existing.nationality:'')}"></div>
          <div class="field"><label>Date of birth</label><input id="gf-dob" type="date" value="${existing&&existing.dob?existing.dob:''}"></div>
        </div>
        <div class="form-row">
          <div class="field"><label>Phone</label><input id="gf-phone" type="text" value="${esc(existing?existing.phone:'')}"></div>
          <div class="field"><label>Email</label><input id="gf-email" type="email" value="${esc(existing?existing.email:'')}"></div>
        </div>
        <div class="section-title">Diving</div>
        <div class="form-row">
          <div class="field"><label>Certification level</label>
            ${levels.length ? `<select id="gf-cert"><option value="">— none —</option>${levels.map(l=>`<option ${existing&&existing.certLevel===l?'selected':''}>${esc(l)}</option>`).join('')}</select>`
                             : `<input id="gf-cert" type="text" value="${esc(existing?existing.certLevel:'')}" placeholder="e.g. Open Water">`}
          </div>
          <div class="field"><label>Agency</label><input id="gf-agency" type="text" value="${esc(existing?existing.certAgency:'')}" placeholder="e.g. PADI"></div>
        </div>
        <div class="field"><label>Certification number</label><input id="gf-certno" type="text" value="${esc(existing?existing.certNo:'')}"></div>
        <div class="form-row">
          <div class="field"><label>Medical form signed</label><input id="gf-med" type="date" value="${existing&&existing.medicalDate?existing.medicalDate:''}"></div>
          <div class="field"><label>Waiver signed</label><input id="gf-waiver" type="date" value="${existing&&existing.waiverDate?existing.waiverDate:''}"></div>
        </div>
        <div class="field"><label>Notes</label><textarea id="gf-notes">${esc(existing?existing.notes:'')}</textarea></div>
      `,
      footerHtml: `<button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="gf-save">Save</button>`,
      onMount(){
        qs('#gf-save').addEventListener('click', ()=>{
          const name = qs('#gf-name').value.trim();
          if(!name){ toast('Enter a name.', 'err'); return; }
          const waiverDate = qs('#gf-waiver').value;
          const data = {
            name, passportNo: qs('#gf-pass').value.trim(), nationality: qs('#gf-nat').value.trim(),
            dob: qs('#gf-dob').value||null, phone: qs('#gf-phone').value.trim(), email: qs('#gf-email').value.trim(),
            certLevel: qs('#gf-cert').value.trim(), certAgency: qs('#gf-agency').value.trim(), certNo: qs('#gf-certno').value.trim(),
            medicalDate: qs('#gf-med').value||null, waiverSigned: !!waiverDate, waiverDate: waiverDate||null,
            notes: qs('#gf-notes').value.trim(), active:true
          };
          if(existing) Store.update('guests', existing.id, data);
          else Store.insert('guests', data);
          closeModal(); toast('Guest saved', 'ok'); Router.render();
        });
      }
    });
  }

  Router.on('/guests', (p)=> p.id ? detail(p) : render(p));
})();
