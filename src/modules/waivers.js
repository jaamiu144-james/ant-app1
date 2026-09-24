/* ---------------------------------------------------------------------
   waivers.js — user-definable waiver templates, and a lightweight kiosk
   screen for guests to search themselves up, read the waiver, consent
   and sign on a tablet at reception.

   Kiosk auth note: this app's auth is already explicitly "not secure" —
   just accountability separation for staff (see auth.js). The kiosk route
   (#/kiosk) is deliberately role-agnostic and doesn't require anyone to
   pick a user: it renders a standalone full-screen page (replacing the
   normal shell entirely, like the first-run setup wizard does) so a guest
   — not a staff member — can use it directly without touching the rest of
   the app or seeing any other data. That's judged simplest and secure
   enough for a single local machine; nothing sensitive is exposed there
   beyond guest names already visible at the front desk.
--------------------------------------------------------------------- */

(function(){

  /* ---------------- TEMPLATE ADMIN (Settings-adjacent) ---------------- */
  function renderTemplates(params){
    setPageTitle('Waiver templates', 'Directory');
    renderNav();
    const vo = Auth.isViewOnly();
    const templates = Store.all('waiverTemplates').slice().sort((a,b)=>(b.isDefault?1:0)-(a.isDefault?1:0));
    qs('#content').innerHTML = `
      <div class="help-box mb-16">The kiosk (#/kiosk) shows a guest the default template's text, a consent checkbox and a signature pad. Add more than one template if different activities need different wording — the kiosk lets the guest pick when more than one is active.</div>
      <div class="toolbar"><div class="spacer"></div>${vo?'':`<button class="btn btn-primary" id="wv-add">+ Add template</button>`}</div>
      <div class="table-wrap"><table class="t">
        <thead><tr><th>Name</th><th>Default</th><th>Status</th><th></th></tr></thead>
        <tbody>
        ${templates.length ? templates.map(t=>`<tr>
          <td><strong>${esc(t.name)}</strong></td>
          <td>${t.isDefault?'<span class="badge badge-green">Default</span>':''}</td>
          <td>${t.active===false?'<span class="badge badge-gray">Inactive</span>':'<span class="badge badge-green">Active</span>'}</td>
          <td class="row-actions">${vo?'':`<button class="btn btn-sm" data-edit="${t.id}">Edit</button>${!t.isDefault?`<button class="btn btn-sm btn-ghost" data-default="${t.id}">Make default</button>`:''}`}</td>
        </tr>`).join('') : `<tr><td colspan="4" class="table-empty">No waiver templates yet.</td></tr>`}
        </tbody>
      </table></div>
      <div class="toolbar mt-16"><a class="linkbtn" onclick="Router.navigate('kiosk')">Open the kiosk screen &rarr;</a></div>
    `;
    if(qs('#wv-add')) qs('#wv-add').addEventListener('click', ()=>openForm());
    qsa('[data-edit]').forEach(b=>b.addEventListener('click', ()=>openForm(Store.find('waiverTemplates', b.dataset.edit))));
    qsa('[data-default]').forEach(b=>b.addEventListener('click', ()=>{
      Store.all('waiverTemplates').forEach(t=>Store.update('waiverTemplates', t.id, { isDefault: t.id===b.dataset.default }));
      toast('Default template updated', 'ok'); renderTemplates({});
    }));
  }

  function openForm(existing){
    openModal({
      title: existing?'Edit waiver template':'Add waiver template', size:'lg',
      bodyHtml: `
        <div class="field"><label>Template name</label><input id="wf-name" type="text" value="${esc(existing?existing.name:'')}" placeholder="e.g. Standard Liability Waiver"></div>
        <div class="field"><label>Waiver text <span class="hint">(plain text — blank lines start a new paragraph)</span></label>
          <textarea id="wf-body" style="min-height:220px">${esc(existing?existing.body:'')}</textarea>
        </div>
        <label class="checkline"><input type="checkbox" id="wf-default" ${existing&&existing.isDefault?'checked':''}> Make this the default template shown at the kiosk</label>
      `,
      footerHtml: `<button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="wf-save">Save</button>`,
      onMount(modal){
        qs('#wf-save', modal).addEventListener('click', ()=>{
          const name = qs('#wf-name', modal).value.trim();
          const body = qs('#wf-body', modal).value.trim();
          if(!name || !body){ toast('Enter a name and the waiver text.', 'err'); return; }
          const makeDefault = qs('#wf-default', modal).checked;
          const data = { name, body, active:true };
          let saved;
          if(existing) saved = Store.update('waiverTemplates', existing.id, data);
          else saved = Store.insert('waiverTemplates', data);
          if(makeDefault) Store.all('waiverTemplates').forEach(t=>Store.update('waiverTemplates', t.id, { isDefault: t.id===saved.id }));
          closeModal(); toast('Template saved', 'ok'); renderTemplates({});
        });
      }
    });
  }

  function activeTemplates(){ return Store.all('waiverTemplates').filter(t=>t.active!==false); }
  function defaultTemplate(){ return activeTemplates().find(t=>t.isDefault) || activeTemplates()[0] || null; }

  // Plain-text waiver body -> simple HTML: blank line = new paragraph.
  function waiverBodyHtml(body){
    return (body||'').split(/\n\s*\n/).map(p=>`<p style="margin-bottom:10px">${esc(p).replace(/\n/g,'<br>')}</p>`).join('');
  }

  /* ---------------- KIOSK ---------------- */
  // Two ways to land here: (1) a normal staff session opens the kiosk
  // screen from the nav to demo it or hand the tablet over — "Exit kiosk"
  // just goes back to the dashboard as before; (2) the session's user IS
  // the kiosk-only role (see auth.js/store.js) — there is no shell, no nav,
  // no data reachable, and the only way out is a staff member identifying
  // themselves via "Staff sign-in", which reboots the whole app as that user.
  function renderKiosk(params){
    const locked = Auth.isKioskOnly();
    document.body.innerHTML = `
      <div style="min-height:100vh;background:var(--paper);display:flex;flex-direction:column">
        <div style="padding:14px 20px;background:var(--teal-dark);color:#fff;display:flex;align-items:center;justify-content:space-between">
          <div><strong>${esc(Store.settings.companyName||'Dive Squad')}</strong> — Waiver kiosk</div>
          <button class="btn btn-sm" id="kiosk-exit">${locked?'Staff sign-in':'Exit kiosk'}</button>
        </div>
        <div id="kiosk-body" style="flex:1;padding:24px;max-width:640px;margin:0 auto;width:100%"></div>
      </div>
    `;
    qs('#kiosk-exit').addEventListener('click', ()=>{
      if(locked) openStaffSignIn();
      else { renderShell(); Router.navigate('dashboard'); }
    });
    kioskStep1();
  }

  // Lets a staff member take a kiosk-locked device back into normal use.
  // Same trust model as the rest of this app's user switching (see
  // auth.js) — no password, just picking your name from the list of
  // non-kiosk staff users, then rebooting the app as that user.
  function openStaffSignIn(){
    const staff = Store.all('users').filter(u=>!Auth.roleDef(u.role) || !Auth.roleDef(u.role).kioskOnly);
    openModal({
      title: 'Staff sign-in',
      bodyHtml: staff.length ? `
        <p class="muted small mb-12">Pick your name to leave the waiver kiosk and return to the dashboard.</p>
        <div class="field"><label>Staff member</label>
          <select id="ss-user">${staff.map(u=>`<option value="${u.id}">${esc(u.name)} — ${esc(Auth.roleLabel(u.role))}</option>`).join('')}</select>
        </div>
      ` : `<p class="muted small">No non-kiosk staff users exist yet. Add one from another device's Settings → Users first.</p>`,
      footerHtml: `<button class="btn" data-close>Cancel</button>${staff.length?`<button class="btn btn-primary" id="ss-go">Sign in</button>`:''}`,
      onMount(modal){
        if(qs('#ss-go', modal)) qs('#ss-go', modal).addEventListener('click', ()=>{
          Auth.setCurrentUser(qs('#ss-user', modal).value);
          closeModal();
          // The hash is still #/kiosk (that's how the lock works) — move it
          // to the dashboard BEFORE rebooting, or boot()'s own Router.render()
          // would just re-read the stale #/kiosk hash and land back here.
          location.hash = '/dashboard';
          boot();
        });
      }
    });
  }

  // Step 1: front desk can quick-add a name-only guest; the guest then
  // searches for themself, narrowed by default to guests added recently so
  // they don't have to search the whole database.
  function kioskStep1(){
    const body = qs('#kiosk-body');
    let showAll = false;
    const RECENT_MS = 2*60*60*1000; // 2 hours

    function guestList(q){
      const now = Date.now();
      let list = Store.all('guests').slice().sort((a,b)=>(b.createdAt||'').localeCompare(a.createdAt||''));
      if(!showAll) list = list.filter(g=> g.createdAt && (now - new Date(g.createdAt).getTime()) < RECENT_MS);
      if(q) list = list.filter(g=> g.name.toLowerCase().includes(q.toLowerCase()));
      return list.slice(0,30);
    }

    function draw(){
      const q = (qs('#kiosk-q')&&qs('#kiosk-q').value)||'';
      body.innerHTML = `
        <h1 style="font-size:22px;margin-bottom:6px">Find your name</h1>
        <p class="muted small mb-16">Front desk: use the box below to add a guest with just their name, then hand the tablet over.</p>
        <div class="card mb-16">
          <div class="flex-gap">
            <input id="kiosk-newname" type="text" placeholder="New guest's full name" style="flex:1">
            <button class="btn" id="kiosk-newguest">+ Add</button>
          </div>
        </div>
        <div class="field"><label>Guest: search your name</label><input id="kiosk-q" type="text" placeholder="Start typing your name…" value="${esc(q)}" autocomplete="off"></div>
        <label class="checkline mb-12"><input type="checkbox" id="kiosk-showall" ${showAll?'checked':''}> Search all guests (not just recently added)</label>
        <div id="kiosk-results" class="inline-list"></div>
      `;
      const results = guestList(q);
      qs('#kiosk-results').innerHTML = results.length ? results.map(g=>`
        <div class="inline-item" style="cursor:pointer" data-pick="${g.id}">
          <span class="grow">${esc(g.name)}</span>
          ${g.waiverSigned?'<span class="badge badge-green">Waiver on file</span>':'<span class="badge badge-amber">No waiver yet</span>'}
        </div>`).join('') : `<p class="muted small">No matching guests${showAll?'':' added recently'}. ${showAll?'':'Try "Search all guests".'}</p>`;
      qsa('[data-pick]').forEach(row=>row.addEventListener('click', ()=>kioskStep2(row.dataset.pick)));
      qs('#kiosk-q').addEventListener('input', draw);
      qs('#kiosk-q').focus();
      qs('#kiosk-q').setSelectionRange(q.length, q.length);
      qs('#kiosk-showall').addEventListener('change', e=>{ showAll = e.target.checked; draw(); });
      qs('#kiosk-newguest').addEventListener('click', ()=>{
        const name = qs('#kiosk-newname').value.trim();
        if(!name){ toast('Enter a name.', 'err'); return; }
        const g = Store.insert('guests', { name, active:true });
        toast('Guest added — hand the tablet to the guest', 'ok');
        showAll = false;
        draw();
      });
    }
    draw();
  }

  // Step 2: show the waiver, consent + signature pad, save to the guest record.
  function kioskStep2(guestId){
    const guest = Store.find('guests', guestId);
    const body = qs('#kiosk-body');
    const templates = activeTemplates();
    if(!guest || !templates.length){
      body.innerHTML = `<div class="danger-box">${!guest?'Guest not found.':'No waiver template is set up yet — ask staff to add one under Waiver templates.'}</div>
        <button class="btn mt-12" id="kiosk-back">&larr; Back</button>`;
      qs('#kiosk-back').addEventListener('click', kioskStep1);
      return;
    }
    let templateId = (defaultTemplate()||templates[0]).id;

    function draw(){
      const tpl = Store.find('waiverTemplates', templateId);
      body.innerHTML = `
        <button class="btn btn-sm mb-12" id="kiosk-back">&larr; Not you?</button>
        <h1 style="font-size:20px;margin-bottom:4px">Hi ${esc(guest.name)}</h1>
        ${templates.length>1 ? `<div class="field"><label>Waiver</label><select id="kiosk-tpl">${templates.map(t=>`<option value="${t.id}" ${t.id===templateId?'selected':''}>${esc(t.name)}</option>`).join('')}</select></div>` : ''}
        <div class="card mb-12" style="max-height:260px;overflow-y:auto">${waiverBodyHtml(tpl.body)}</div>
        <label class="checkline mb-12"><input type="checkbox" id="kiosk-consent"> I have read and agree to the terms above.</label>
        <div class="field"><label>Sign below</label>
          <canvas id="kiosk-sig" width="560" height="180" style="border:1px solid var(--line-strong);border-radius:8px;background:#fff;touch-action:none;width:100%;max-width:560px;height:180px"></canvas>
          <button type="button" class="btn btn-sm mt-8" id="kiosk-clear">Clear signature</button>
        </div>
        <button class="btn btn-primary btn-block mt-12" id="kiosk-save">Sign &amp; save waiver</button>
      `;
      if(templates.length>1) qs('#kiosk-tpl').addEventListener('change', e=>{ templateId = e.target.value; draw(); });
      qs('#kiosk-back').addEventListener('click', kioskStep1);

      const canvas = qs('#kiosk-sig');
      const ctx = canvas.getContext('2d');
      ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.strokeStyle = '#16211f';
      let drawing = false, hasInk = false, last = null;
      function posFromEvent(e){
        const rect = canvas.getBoundingClientRect();
        const sx = canvas.width/rect.width, sy = canvas.height/rect.height;
        const p = e.touches ? e.touches[0] : e;
        return { x: (p.clientX-rect.left)*sx, y: (p.clientY-rect.top)*sy };
      }
      function start(e){ e.preventDefault(); drawing = true; last = posFromEvent(e); }
      function move(e){
        if(!drawing) return;
        e.preventDefault();
        const p = posFromEvent(e);
        ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(p.x, p.y); ctx.stroke();
        last = p; hasInk = true;
      }
      function end(){ drawing = false; }
      ['mousedown','touchstart'].forEach(ev=>canvas.addEventListener(ev, start));
      ['mousemove','touchmove'].forEach(ev=>canvas.addEventListener(ev, move));
      ['mouseup','mouseleave','touchend','touchcancel'].forEach(ev=>canvas.addEventListener(ev, end));
      qs('#kiosk-clear').addEventListener('click', ()=>{ ctx.clearRect(0,0,canvas.width,canvas.height); hasInk = false; });

      qs('#kiosk-save').addEventListener('click', ()=>{
        if(!qs('#kiosk-consent').checked){ toast('Please check the consent box.', 'err'); return; }
        if(!hasInk){ toast('Please sign in the box.', 'err'); return; }
        const dataUrl = canvas.toDataURL('image/png');
        Store.update('guests', guest.id, {
          waiverSigned: true, waiverDate: todayISO(), waiverSignedAt: nowISO(),
          waiverTemplateId: templateId, waiverTemplateName: tpl.name, waiverSignatureDataUrl: dataUrl
        });
        body.innerHTML = `<div class="empty-state card"><h3>Waiver signed — thank you, ${esc(guest.name)}!</h3><p>You can hand the tablet back to reception now.</p>
          <button class="btn btn-primary mt-12" id="kiosk-next">Next guest</button></div>`;
        qs('#kiosk-next').addEventListener('click', kioskStep1);
      });
    }
    draw();
  }

  Router.on('/waivers', renderTemplates);
  Router.on('/kiosk', renderKiosk);
  window.WaiversModule = { defaultTemplate, waiverBodyHtml };
})();
