/* ---------------------------------------------------------------------
   auth.js — lightweight role separation, not secure authentication.
   This is a single local file the shop runs on their own machine, so
   there is no server to authenticate against. Users pick their name
   from a list; an optional PIN is just a soft deterrent against the
   wrong person acting under someone else's name, not real security.

   Roles are data-driven (Store.settings.roles), so an admin can define
   and edit them from Settings → Roles. ADMIN/ACCOUNTANT/FRONT_DESK/OWNER
   are seeded once (see store.js defaultRoles) and kept as sensible
   defaults, but every role's permission list is editable afterwards.
--------------------------------------------------------------------- */

const Auth = (function(){
  const SESSION_KEY = 'diveErpSessionUser';

  const ROLE_LABEL_FALLBACK = { ADMIN:'Admin', ACCOUNTANT:'Accountant', FRONT_DESK:'Front desk', OWNER:'Owner' };

  function roles(){ return (Store.settings && Store.settings.roles) || []; }
  function roleDef(roleId){ return roles().find(r=>r.id===roleId) || null; }

  // kept for callers that iterate role ids / labels the old way
  const ROLES_PROXY = { };
  Object.defineProperty(ROLES_PROXY, 'length', { get(){ return roles().length; } });

  function currentUser(){
    const id = localStorage.getItem(SESSION_KEY);
    return Store.find('users', id) || null;
  }
  function setCurrentUser(id){ localStorage.setItem(SESSION_KEY, id); }
  function signOut(){ localStorage.removeItem(SESSION_KEY); }

  function isViewOnly(user){
    const u = user || currentUser();
    if(!u) return false;
    const rd = roleDef(u.role);
    return !!(rd && rd.viewOnly);
  }

  // A kiosk-only role (e.g. Waiver Kiosk) sees nothing but its one dedicated
  // screen — no nav, no other route, no data. Enforced centrally in
  // Router.render() (util.js) so it can never be bypassed by navigating.
  function isKioskOnly(user){
    const u = user || currentUser();
    if(!u) return false;
    const rd = roleDef(u.role);
    return !!(rd && rd.kioskOnly);
  }

  function can(action){
    const u = currentUser();
    if(!u) return false;
    if(isViewOnly(u)) return false; // owner-style roles can never mutate, gated or not
    const rd = roleDef(u.role);
    if(rd && rd.full) return true; // e.g. Admin
    if(u.role==='ADMIN') return true; // legacy safety net
    if(!rd){
      // unknown role (shouldn't happen once roles are seeded) — deny gated actions
      return action===undefined;
    }
    const allowed = rd.permissions || [];
    if(action===undefined) return true; // ungated action
    // an action not represented in ANY role's permission list at all is "ungated"
    // (kept for backward compatibility with actions that were never in the rules table)
    const KNOWN_GATED = ['DAY_END_CLOSE','APPROVE_VOUCHER','APPROVE_BILL','POST_PAYROLL','CLOSE_TAX_PERIOD','MANAGE_SETTINGS','MANAGE_USERS','EDIT_LOCKED_DAY','POST_DEPOSIT','RECONCILE_ACCOUNT','EDIT_CONFIRMED_RATE'];
    if(!KNOWN_GATED.includes(action)) return true;
    return allowed.includes(action);
  }

  function roleLabel(roleId){
    const rd = roleDef(roleId);
    return rd ? rd.label : (ROLE_LABEL_FALLBACK[roleId] || roleId);
  }

  return {
    get ROLES(){ return roles().map(r=>r.id); },
    get ROLE_LABEL(){ const m={}; roles().forEach(r=>m[r.id]=r.label); return m; },
    roles, roleDef, roleLabel,
    currentUser, setCurrentUser, signOut, can, isViewOnly, isKioskOnly
  };
})();

window.Auth = Auth;
