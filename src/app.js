/* ---------------------------------------------------------------------
   app.js — shell: sidebar nav, topbar, first-run setup, boot.
--------------------------------------------------------------------- */

/* Small inline-SVG icon set for the sidebar. Each is a 16x16 line icon
   drawn with currentColor so it inherits the nav's text color/states. */
const ICONS = {
  home: '<path d="M2 8.5 8 3l6 5.5"/><path d="M3.5 7.5V13a.5.5 0 0 0 .5.5h3v-3.5a1 1 0 0 1 1-1h0a1 1 0 0 1 1 1V13.5h3a.5.5 0 0 0 .5-.5V7.5"/>',
  bookings: '<rect x="2.25" y="3" width="11.5" height="11" rx="1.4"/><path d="M2.25 6.2h11.5"/><path d="M5.2 1.6v2.4M10.8 1.6v2.4"/><path d="M4.7 9.1h2M9.3 9.1h2M4.7 11.4h2"/>',
  directory: '<circle cx="5.6" cy="5.4" r="2.1"/><path d="M1.6 13.4c.5-2.4 2-3.7 4-3.7s3.5 1.3 4 3.7"/><circle cx="11.3" cy="5.8" r="1.6"/><path d="M10.4 9.9c1.5.2 2.6 1.3 3 3.5"/>',
  catalog: '<path d="M8 2.2 13.6 5 8 7.8 2.4 5 8 2.2Z"/><path d="M2.4 5v6L8 13.8l5.6-2.8V5"/><path d="M8 7.8v6"/>',
  finance: '<rect x="1.6" y="4" width="12.8" height="9" rx="1.4"/><path d="M1.6 6.6h12.8"/><circle cx="11" cy="10" r="1.3"/>',
  accounting: '<path d="M4 1.8h6.4L13 4.4V13a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V2.8a1 1 0 0 1 1-1Z"/><path d="M9.8 1.8v2.6H13"/><path d="M4.6 8h6.8M4.6 10.2h6.8M4.6 5.8h3"/>',
  reports: '<path d="M2.5 13.5h11"/><rect x="3.5" y="8.2" width="2.4" height="5.3"/><rect x="6.8" y="5.2" width="2.4" height="8.3"/><rect x="10.1" y="2.5" width="2.4" height="11"/>',
  settings: '<circle cx="8" cy="8" r="2.1"/><path d="M8 2.2v1.6M8 12.2v1.6M13.8 8h-1.6M3.8 8H2.2M11.9 4.1l-1.1 1.1M5.2 10.7l-1.1 1.1M11.9 11.9l-1.1-1.1M5.2 5.3 4.1 4.1"/>',
  ant: '<circle cx="12" cy="6" r="2"/><circle cx="12" cy="11" r="2.6"/><circle cx="12" cy="17" r="3"/><path d="M12 8v1"/><path d="M12 13.5v1"/><path d="M9.5 4.5 7 2.5M14.5 4.5 17 2.5"/><path d="M4 9l4.5 2M20 9l-4.5 2"/><path d="M3 13l5.5 1M21 13l-5.5 1"/><path d="M4 20l5.5-3.5M20 20l-5.5-3.5"/>',
};
function icon(name, size){
  const s = size||16;
  return `<svg class="nav-icon" width="${s}" height="${s}" viewBox="0 0 ${name==='ant'?'24 24':'16 16'}" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]||''}</svg>`;
}

/* ---------------------------------------------------------------------
   Editions — this same codebase is sold as three products:
     'front'  Front Office  — booking, calendar, sales, customers/guests,
              catalog, kiosk waivers, and taking payment at the counter.
     'back'   Back Office   — cash/bank bookkeeping, bills & vendors,
              payroll, the chart of accounts, ledgers and tax.
     'full'   Complete      — both, unrestricted (also what runs in the
              dev harness and the test suite, so nothing here narrows
              those).
   The build script stamps window.APP_EDITION into the front/back-office
   bundles; every nav item below carries the edition(s) it belongs to
   and EditionGuard (used by Router in util.js) enforces it centrally so
   a typed/bookmarked hash can't reach a route the license doesn't cover
   — the same pattern already used for the waiver-kiosk lock. All module
   code still ships in every bundle (reports, postings, etc. read across
   both sides of the business), only navigation/routing is gated, so nothing
   here needs the module bundle to change per edition. */
const EDITION = (typeof window!=='undefined' && window.APP_EDITION) || 'full';

const NAV = [
  { group:'', items:[ {path:'/dashboard', label:'Dashboard', icon:'home', ed:'all'} ] },
  { group:'Bookings', icon:'bookings', items:[
    {path:'/calendar', label:'Calendar', ed:'front'},
    {path:'/bookings', label:'Bookings', ed:'front'},
    {path:'/invoices', label:'Sales invoices', ed:'front'},
    {path:'/manifest', label:'Trip manifest', ed:'front'},
    {path:'/kiosk', label:'Kiosk (waiver)', ed:'front'},
  ]},
  { group:'Directory', icon:'directory', items:[
    {path:'/customers', label:'Customers (agents)', ed:'front'},
    {path:'/guests', label:'Guests', ed:'front'},
    {path:'/vendors', label:'Vendors', ed:'back'},
    {path:'/waivers', label:'Waiver templates', ed:'front'},
  ]},
  { group:'Catalog', icon:'catalog', items:[
    {path:'/packages', label:'Packages & kits', ed:'front'},
    {path:'/pricelists', label:'Price lists', ed:'front'},
    {path:'/equipment', label:'Equipment', ed:'front'},
    {path:'/fleet', label:'Boats & staff', ed:'front'},
  ]},
  { group:'Finance', icon:'finance', items:[
    {path:'/receipts', label:'Receipts', ed:'front'},
    {path:'/dayend', label:'Day-end close', ed:'back'},
    {path:'/deposits', label:'Deposits', ed:'back'},
    {path:'/reconcile', label:'Reconciliation', ed:'back'},
    {path:'/pettycash', label:'Petty cash', ed:'back'},
    {path:'/vouchers', label:'Payment vouchers', ed:'back'},
    {path:'/bills', label:'Bills & vendors', ed:'back'},
    {path:'/payroll', label:'Salary', ed:'back'},
  ]},
  { group:'Accounting', icon:'accounting', items:[
    {path:'/accounts', label:'Chart of accounts', ed:'back'},
    {path:'/journal', label:'Journal entries', ed:'back'},
    {path:'/ledgers', label:'Ledgers', ed:'back'},
    {path:'/tax', label:'Tax', ed:'back'},
  ]},
  { group:'', items:[
    {path:'/reports', label:'Reports', icon:'reports', ed:'all'},
    {path:'/settings', label:'Settings', icon:'settings', ed:'all'},
  ]},
];

/* Report-page tabs (reports.js) are similarly split — pnl/bs/tb/etc are
   back-office statements, customers/trips/equipment are front-office
   operational reports. 'menu' (the overview) and anything not listed
   here is shown to everyone. */
const REPORT_TAB_EDITION = {
  pnl:'back', bs:'back', tb:'back', cashflow:'back', gl:'back',
  araging:'back', apaging:'back', vendors:'back', tax:'back',
  customers:'front', trips:'front', equipment:'front',
};

const EditionGuard = {
  edition(){ return EDITION; },
  isPathAllowed(path){
    if(EDITION==='full') return true;
    for(const g of NAV) for(const it of g.items) if(it.path===path) return it.ed==='all' || it.ed===EDITION;
    return true; // route with no nav entry — don't block
  },
  isReportTabAllowed(tab){
    if(EDITION==='full') return true;
    const ed = REPORT_TAB_EDITION[tab];
    return !ed || ed===EDITION;
  },
  firstAllowedPath(){ return '/dashboard'; }, // always 'all' — safe fallback for every edition
};
window.EditionGuard = EditionGuard;

function renderShell(){
  const s = Store.settings;
  const editionSuffix = EDITION==='front' ? ' · Ant App (Front Office)' : EDITION==='back' ? ' · Ant App (Back Office)' : ' · Ant App';
  document.title = s.companyName ? `${s.companyName}${editionSuffix}` : `Ant App${EDITION!=='full'?' — '+(EDITION==='front'?'Front Office':'Back Office'):''}`;
  document.body.innerHTML = `
    <div id="app">
      <nav class="sidebar" id="sidebar">
        <div class="sidebar-brand">
          ${s.logoDataUrl?`<img src="${s.logoDataUrl}" class="brand-logo">`:''}
          <div class="brand-text">
            <div class="brand-name">${esc(s.companyName||'Dive Squad')}</div>
            ${s.companyAddress?`<div class="brand-address">${esc(s.companyAddress).replace(/\n/g,'<br>')}</div>`:`<div class="brand-sub">Booking &amp; finance</div>`}
          </div>
        </div>
        <div class="sidebar-nav" id="sidebar-nav"></div>
        <div class="sidebar-foot">${icon('ant',15)}<span>Ant App${EDITION!=='full'?' · '+(EDITION==='front'?'Front Office':'Back Office'):''}</span></div>
      </nav>
      <div class="main">
        <div class="topbar">
          <div class="topbar-title">
            <div class="crumb" id="crumb">&nbsp;</div>
            <h1 id="page-title">Dashboard</h1>
          </div>
          <div class="topbar-right" id="topbar-right"></div>
        </div>
        <div class="content" id="content"></div>
      </div>
    </div>
  `;
  renderNav();
  renderTopbarRight();
}

/* Which nav groups are expanded, keyed by group name. Persists for the
   session (not localStorage) as the user toggles them. The group
   containing the current route is auto-expanded the moment navigation
   enters it, but the user can still collapse it manually afterwards —
   it won't be forced back open until they navigate away and back. */
let navExpandState = {};
let lastActiveGroupKey = null;

function renderNav(){
  const bar = qs('#sidebar-nav');
  if(!bar) return;
  const activeTop = '/'+(Router.current().split('/').filter(Boolean)[0]||'dashboard');
  const activeGroup = NAV.find(g=>g.group && g.items.some(it=>it.path===activeTop));
  const activeGroupKey = activeGroup ? activeGroup.group : null;
  if(activeGroupKey && activeGroupKey !== lastActiveGroupKey){
    navExpandState[activeGroupKey] = true;
  }
  lastActiveGroupKey = activeGroupKey;

  const visible = (it)=> EDITION==='full' || it.ed==='all' || it.ed===EDITION;

  bar.innerHTML = NAV.map((g,gi)=>{
    const items = g.items.filter(visible);
    if(!items.length) return '';
    if(!g.group){
      return items.map(it=>`<div class="sidebar-link top ${it.path===activeTop?'active':''}" data-nav="${it.path}">${it.icon?icon(it.icon):''}<span>${esc(it.label)}</span></div>`).join('');
    }
    const groupActive = g.group===activeGroupKey;
    const expanded = !!navExpandState[g.group];
    return `
      <div class="sidebar-group ${expanded?'expanded':''}" data-group="${gi}">
        <button type="button" class="sidebar-group-header ${groupActive?'active':''}" data-group-toggle="${gi}">
          <span class="group-label">${g.icon?icon(g.icon):''}<span>${esc(g.group)}</span></span><span class="chev">&#9662;</span>
        </button>
        <div class="sidebar-group-items" data-group-panel="${gi}">
          ${items.map(it=>`<div class="sidebar-link sub ${it.path===activeTop?'active':''}" data-nav="${it.path}">${esc(it.label)}</div>`).join('')}
        </div>
      </div>`;
  }).join('');
  qsa('[data-nav]', bar).forEach(n=>n.addEventListener('click', ()=>{ Router.navigate(n.dataset.nav.slice(1)); }));
  qsa('[data-group-toggle]', bar).forEach(btn=>btn.addEventListener('click', ()=>{
    const g = NAV[btn.dataset.groupToggle];
    navExpandState[g.group] = !navExpandState[g.group];
    renderNav();
  }));
}

function renderTopbarRight(){
  const right = qs('#topbar-right');
  if(!right) return;
  const users = Store.all('users');
  const cur = Auth.currentUser();
  right.innerHTML = `
    <span class="date-chip">${fmtDate(todayISO())}</span>
    <select id="user-switch" class="btn btn-sm" style="border-radius:8px">
      ${users.map(u=>`<option value="${u.id}" ${cur&&cur.id===u.id?'selected':''}>${esc(u.name)} — ${Auth.ROLE_LABEL[u.role]}</option>`).join('')}
    </select>
    ${cur?`<span class="role-badge">${esc(Auth.roleLabel(cur.role))}${Auth.isViewOnly()?' · view only':''}</span>`:''}
    ${window.CLOUD_MODE?`<button class="btn btn-sm" id="cloud-logout" title="Sign out of ${esc(Store.settings.companyName||'your')} account">Log out</button>`:''}
  `;
  const sel = qs('#user-switch', right);
  if(sel) sel.addEventListener('change', ()=>{ Auth.setCurrentUser(sel.value); renderTopbarRight(); Router.render(); });
  const logoutBtn = qs('#cloud-logout', right);
  if(logoutBtn) logoutBtn.addEventListener('click', ()=>{ if(window.CloudSync) CloudSync.logout(); });
}

function setPageTitle(title, crumb){
  const t = qs('#page-title'); if(t) t.textContent = title;
  const c = qs('#crumb'); if(c) c.textContent = crumb||'';
}

/* ---- first run setup wizard ---- */
function needsSetup(){
  return !Store.settings.setupComplete || Store.all('users').length===0;
}

function renderSetupWizard(){
  document.body.innerHTML = `
    <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;background:var(--paper);padding:20px">
      <div class="card" style="max-width:480px;width:100%">
        <h1 style="margin-bottom:4px">Set up your dive centre</h1>
        <p class="muted small mb-16">This runs entirely in this browser. Nothing is sent anywhere. You can change all of this later in Settings.</p>
        <div class="field"><label>Company / dive centre name</label><input id="su-name" type="text" placeholder="e.g. Blue Horizon Divers"></div>
        <div class="form-row">
          <div class="field"><label>Currency code</label><input id="su-cur" type="text" value="USD" maxlength="3" style="text-transform:uppercase"></div>
          <div class="field"><label>Currency symbol</label><input id="su-sym" type="text" value="$" maxlength="3"></div>
        </div>
        <div class="field"><label>Default tax rate (%)</label><input id="su-tax" type="number" value="0" min="0" step="0.01"></div>
        <hr class="divider">
        <p class="muted small mb-8">Create your first user. You can add more (front desk, accountant) afterwards in Settings.</p>
        <div class="field"><label>Your name</label><input id="su-user" type="text" placeholder="e.g. Amara Khan"></div>
        <div class="field"><label>Your role</label>
          <select id="su-role">
            <option value="ADMIN">Admin — full access</option>
            <option value="ACCOUNTANT">Accountant — approvals, day-end close, payroll, tax</option>
            <option value="FRONT_DESK">Front desk — bookings, check-in, receipts</option>
            <option value="OWNER">Owner — view everything, change nothing</option>
          </select>
        </div>
        <button class="btn btn-primary btn-block mt-12" id="su-go">Start using the app</button>
      </div>
    </div>`;
  qs('#su-go').addEventListener('click', ()=>{
    const name = qs('#su-name').value.trim();
    const userName = qs('#su-user').value.trim();
    if(!name || !userName){ toast('Please fill in the company name and your name.', 'err'); return; }
    Object.assign(Store.settings, {
      companyName: name,
      currency: qs('#su-cur').value.trim().toUpperCase()||'USD',
      currencySymbol: qs('#su-sym').value.trim()||'$',
      defaultTaxRate: parseFloat(qs('#su-tax').value)||0,
      setupComplete: true
    });
    const user = Store.insert('users', { name:userName, role: qs('#su-role').value, active:true });
    Auth.setCurrentUser(user.id);
    Store.persist();
    // Not boot() — Store already holds the freshly-set-up data in memory;
    // re-running boot() in cloud mode would re-fetch from the server and
    // could race the debounced save that Store.persist() just queued,
    // clobbering the setup we just did with what's still there.
    continueBoot();
  });
}

function boot(){
  // Cloud mode (server/): the tenant's data blob lives on the server, not
  // (only) in this browser's localStorage. window.CLOUD_MODE is stamped
  // into the page server-side, only for the hosted app — the standalone
  // downloadable editions never set it, so they keep booting exactly as
  // before, synchronously, with no network round trip and no server at all.
  if(window.CLOUD_MODE){
    CloudSync.bootstrap().then(payload=>{
      if(!payload) return; // bootstrap() already redirected to /login
      Store.initFromData(payload.data);
      continueBoot();
    }).catch(err=>{
      console.error(err);
      document.body.innerHTML = `<div style="padding:48px;font:15px/1.5 -apple-system,sans-serif;max-width:420px;margin:0 auto">
        <h2 style="margin-bottom:8px">Couldn't reach the server</h2>
        <p>Check your connection and reload. Your last-saved data is safe on the server either way.</p>
        <button class="btn btn-primary" style="margin-top:14px" onclick="location.reload()">Reload</button>
      </div>`;
    });
    return;
  }
  Store.load();
  continueBoot();
}

function continueBoot(){
  if(needsSetup()){ renderSetupWizard(); return; }
  if(!Auth.currentUser()){ Auth.setCurrentUser(Store.all('users')[0].id); }
  Store.subscribe(()=>{ /* modules re-render themselves on explicit actions */ });
  if(Auth.isKioskOnly()){
    // No shell at all for a kiosk-only session — the kiosk route replaces
    // the whole document itself (see waivers.js renderKiosk). Router.render()
    // already forces the hash to /kiosk for this user; just kick it off.
    Router.render();
    return;
  }
  renderShell();
  Router.render();
}

document.addEventListener('DOMContentLoaded', boot);
