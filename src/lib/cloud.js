/* ---------------------------------------------------------------------
   cloud.js — only bundled into the server-hosted app (see server/), never
   into the standalone downloadable editions. Talks to the small REST API
   in server/src/data.js to keep the tenant's data blob on the server
   instead of (only) localStorage. store.js calls CloudSync.schedulePush()
   from persist() whenever this file/global is present; nothing here is
   referenced by the standalone build, so those keep working exactly as
   before, offline, with no server at all.
--------------------------------------------------------------------- */
const CloudSync = (function(){
  let timer = null;
  let inFlight = false;
  let pendingAgain = false;
  let lastError = null;

  function schedulePush(db){
    clearTimeout(timer);
    timer = setTimeout(()=>push(db), 900);
  }

  function push(db){
    if(inFlight){ pendingAgain = true; return; }
    inFlight = true;
    fetch('/api/data', {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify({ data: db })
    }).then(r=>{
      if(r.status===401){ location.href = '/login'; return; }
      if(!r.ok) throw new Error('save failed ('+r.status+')');
      lastError = null;
      setSaveIndicator('ok');
    }).catch(err=>{
      lastError = String(err);
      setSaveIndicator('err');
      console.error('Cloud save failed — will retry on the next change', err);
    }).finally(()=>{
      inFlight = false;
      if(pendingAgain){ pendingAgain = false; schedulePush(Store.db); }
    });
  }

  function setSaveIndicator(state){
    let el = document.getElementById('cloud-save-indicator');
    if(!el){
      el = document.createElement('div');
      el.id = 'cloud-save-indicator';
      el.className = 'cloud-save-indicator';
      document.body.appendChild(el);
    }
    if(state==='ok'){ el.textContent = 'Saved'; el.className = 'cloud-save-indicator ok'; }
    else { el.textContent = 'Could not save — check your connection'; el.className = 'cloud-save-indicator err'; }
    el.classList.add('show');
    clearTimeout(el._hideTimer);
    el._hideTimer = setTimeout(()=>el.classList.remove('show'), state==='ok' ? 1400 : 5000);
  }

  async function bootstrap(){
    const res = await fetch('/api/data', { credentials:'include' });
    if(res.status===401){ location.href = '/login'; return null; }
    if(!res.ok) throw new Error('Could not load your data from the server ('+res.status+')');
    return res.json(); // { data, tenant: {companyName, edition, plan, status} }
  }

  async function logout(){
    await fetch('/api/logout', { method:'POST', credentials:'include' }).catch(()=>{});
    location.href = '/login';
  }

  return { schedulePush, bootstrap, logout, lastError:()=>lastError };
})();
window.CloudSync = CloudSync;
