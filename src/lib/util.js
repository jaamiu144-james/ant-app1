/* ---------------------------------------------------------------------
   util.js — formatting helpers, tiny DOM helpers, toast, modal, router.
--------------------------------------------------------------------- */

function fmtMoney(n){
  const sym = (Store.settings && Store.settings.currencySymbol) || '$';
  const v = (n===undefined||n===null||isNaN(n)) ? 0 : n;
  const neg = v < 0;
  const s = Math.abs(v).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
  return (neg?'-':'')+sym+s;
}
// Currency-aware formatter: falls back to fmtMoney (base currency, with the
// company's symbol) when no currency is given or it matches the ledger's
// base currency; otherwise renders a plain "12.00 USD"-style amount, since
// USD/EUR/etc don't share the company's configured symbol.
function fmtCur(n, currency){
  const base = (typeof Pricing!=='undefined' && Pricing.baseCurrency) ? Pricing.baseCurrency() : (Store.settings && Store.settings.currency) || 'MVR';
  if(!currency || currency===base) return fmtMoney(n);
  const v = (n===undefined||n===null||isNaN(n)) ? 0 : n;
  const neg = v < 0;
  const s = Math.abs(v).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
  return (neg?'-':'')+s+' '+currency;
}
function fmtDate(d){
  if(!d) return '—';
  const dt = typeof d==='string' ? new Date(d+'T00:00:00') : d;
  if(isNaN(dt)) return d;
  return dt.toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'});
}
function fmtDateTime(d){
  if(!d) return '—';
  const dt = new Date(d);
  if(isNaN(dt)) return d;
  return dt.toLocaleString(undefined,{year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
}
function todayISO(){ return new Date().toISOString().slice(0,10); }
function nowISO(){ return new Date().toISOString(); }
function esc(s){
  return String(s===undefined||s===null?'':s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function el(html){
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}
function qs(sel, root){ return (root||document).querySelector(sel); }
function qsa(sel, root){ return Array.from((root||document).querySelectorAll(sel)); }

/* ---- toast ---- */
function toast(msg, kind){
  let wrap = qs('.toast-wrap');
  if(!wrap){ wrap = el('<div class="toast-wrap"></div>'); document.body.appendChild(wrap); }
  const t = el(`<div class="toast ${kind==='err'?'err':kind==='ok'?'ok':''}">${esc(msg)}</div>`);
  wrap.appendChild(t);
  setTimeout(()=>{ t.style.opacity='0'; t.style.transition='opacity .3s'; setTimeout(()=>t.remove(),300); }, 3200);
}

/* ---- modal ----
   openModal({title, bodyHtml, size, onMount, footerHtml, onSubmit}) */
function openModal(opts){
  closeModal();
  const backdrop = el(`<div class="modal-backdrop"></div>`);
  const modal = el(`<div class="modal ${opts.size==='lg'?'modal-lg':''}">
    <div class="modal-head"><h2>${esc(opts.title||'')}</h2><button class="close-x" data-close>&times;</button></div>
    <div class="modal-body">${opts.bodyHtml||''}</div>
    <div class="modal-foot">${opts.footerHtml||''}</div>
  </div>`);
  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);
  backdrop.addEventListener('mousedown', (e)=>{ if(e.target===backdrop) closeModal(); });
  qsa('[data-close]', modal).forEach(b=>b.addEventListener('click', closeModal));
  if(opts.onMount) opts.onMount(modal);
  return modal;
}
function closeModal(){ qsa('.modal-backdrop').forEach(b=>b.remove()); }

function confirmDialog(message, onYes, opts){
  opts = opts || {};
  openModal({
    title: opts.title || 'Please confirm',
    bodyHtml: `<p>${esc(message)}</p>`,
    footerHtml: `<button class="btn" data-close>Cancel</button><button class="btn ${opts.danger?'btn-danger':'btn-primary'}" id="confirm-yes">${esc(opts.yesLabel||'Confirm')}</button>`,
    onMount(modal){
      qs('#confirm-yes', modal).addEventListener('click', ()=>{ closeModal(); onYes(); });
    }
  });
}

/* ---- simple hash router ---- */
const Router = (function(){
  const routes = {};
  function on(path, handler){ routes[path] = handler; }
  function navigate(path){ if(location.hash.slice(1)!==path) location.hash = path; else render(); }
  function current(){ return (location.hash||'#/dashboard').slice(1); }
  function render(){
    const full = current();
    const [path, query] = full.split('?');
    const parts = path.split('/').filter(Boolean);
    const base = '/'+(parts[0]||'dashboard');
    // A kiosk-only user (see auth.js) must never reach any route but the
    // kiosk itself — enforced here, centrally, so it can't be bypassed by
    // typing a hash, clicking a stale link, or a module calling navigate().
    if(base!=='/kiosk' && window.Auth && typeof Auth.isKioskOnly==='function' && Auth.isKioskOnly()){
      if(location.hash.slice(1)!=='/kiosk'){ location.hash = '/kiosk'; return; }
    }
    // Front Office / Back Office editions (see app.js) only license part of
    // the app — block any route the running edition doesn't include, the
    // same way the kiosk lock above blocks everything but the kiosk.
    if(window.EditionGuard && typeof EditionGuard.isPathAllowed==='function' && !EditionGuard.isPathAllowed(base)){
      const fallback = EditionGuard.firstAllowedPath();
      if(location.hash.slice(1)!==fallback){ location.hash = fallback; return; }
    }
    const handler = routes[base] || routes['/dashboard'];
    const params = {};
    if(query) query.split('&').forEach(kv=>{ const [k,v]=kv.split('='); if(k) params[decodeURIComponent(k)]=decodeURIComponent(v||''); });
    if(parts[1]) params.id = parts[1];
    if(parts[2]) params.sub = parts[2];
    try{ handler(params); }catch(e){ console.error(e); qs('#content').innerHTML = `<div class="card"><div class="danger-box">Something went wrong rendering this page: ${esc(e.message)}</div></div>`; }
  }
  window.addEventListener('hashchange', render);
  return { on, navigate, current, render };
})();

function debounce(fn, ms){
  let t; return (...args)=>{ clearTimeout(t); t=setTimeout(()=>fn(...args), ms||250); };
}

function round2(n){ return Math.round((n+Number.EPSILON)*100)/100; }

function downloadFile(filename, content, mime){
  const blob = new Blob([content], { type: mime || 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 2000);
}
function toCsv(headers, rows){
  const esc1 = v=>{ const s = String(v===undefined||v===null?'':v); return /[",\n]/.test(s) ? '"'+s.replace(/"/g,'""')+'"' : s; };
  return [headers.map(esc1).join(','), ...rows.map(r=>r.map(esc1).join(','))].join('\n');
}
