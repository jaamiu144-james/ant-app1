/* ---------------------------------------------------------------------
   store.js — persistence, generic collection CRUD, ids, doc numbering.
   All app data lives in one JSON object saved to localStorage under
   DB_KEY. Nothing about gear, kits, packages, price lists, boats, staff
   or trips is pre-seeded — those collections start empty. The only
   built-in record is the locked "Direct Booking" customer, plus a
   starter chart of accounts (accounting needs somewhere to post to;
   every account stays fully editable).
--------------------------------------------------------------------- */

const DB_KEY = 'diveErpDb_v1';
// v1 -> v2: chart of accounts renumbered to the standard QuickBooks-style
// ranges (1000s assets / 2000s liabilities / 3000s equity / 4000s income /
// 5000s COGS / 6000s operating expenses / 7000s other income / 8000s other
// expense) with accountType + parent/sub-account hierarchy added. See
// CODE_MIGRATIONS below — this only ever rewrites `code` strings on existing
// account records (never `id`, which is what journal lines reference), so it
// is purely cosmetic/organizational and safe to run once against real data.
// v2 -> v3: petty cash moved off the single `pettyCashConfig` object onto a
// proper `pettyCashFloats` list — every float has its own float number,
// purpose, custodian and fixed imprest value, and its own sub-account under
// 1020 Petty Cash. See migratePettyCashToFloats() below.
const SCHEMA_VERSION = 3;

const COLLECTIONS = [
  'customers','guests','vendors',
  'equipmentTypes','equipment','equipmentUsageLog',
  'packages','priceLists','agentPrices',
  'boats','staff','tripTemplates','trips','closures',
  'bookings','salesInvoices',
  'receipts','vouchers','bills',
  'pettyCashConfig', // legacy single object — kept only so old saves migrate cleanly; unused by new code
  'pettyCashFloats',
  'dayEndCloses','deposits','reconciliations',
  'payrollRuns','advances',
  'taxPeriods',
  'accounts','journalEntries',
  'users','auditLog',
  'waiverTemplates'
];

function emptyDb(){
  const db = { schemaVersion: SCHEMA_VERSION, _seq: {}, settings: defaultSettings() };
  COLLECTIONS.forEach(c=>{
    db[c] = (c === 'pettyCashConfig') ? null : [];
  });
  return db;
}

function defaultSettings(){
  return {
    companyName: 'Dive Squad',
    companyAddress: '',
    currency: 'USD',
    currencySymbol: '$',
    taxLabel: 'Tax',
    defaultTaxRate: 0,
    // The registered GST "Taxable Activity Name" MIRA expects on the Input/
    // Output Tax Statement exports — falls back to companyName when blank.
    taxableActivityName: '',
    holdExpiryMinutes: 120,
    fiscalYearStartMonth: 1,
    setupComplete: false,
    baseCurrency: 'MVR',
    exchangeRates: [], // [{id,date,usdToMvr,eurToMvr}] dated, most recent-effective wins
    taxPeriodFrequency: 'MONTHLY', // MONTHLY | QUARTERLY
    taxYearStartMonth: 1,
    logoDataUrl: '',
    roles: defaultRoles(),
    pension: { enabled:false, companyPct:7, staffPct:7 },
    certLevels: [],
    paymentMethods: defaultPaymentMethods(),
    invoiceTemplate: defaultInvoiceTemplate()
  };
}

// Sales-invoice template — the shop can customize the printed/on-screen
// layout (title, accent color, which optional lines show, a footer note)
// without touching code. See invoices.js for where each field is applied.
function defaultInvoiceTemplate(){
  return {
    title: 'Sales Invoice',
    accentColor: '#0b5d56',
    showLogo: true,
    showAddress: true,
    showBillTo: true,
    showBookingLink: true,
    footerNote: 'Thank you for diving with us!'
  };
}

// Payment methods are data-driven so the shop can add its own (e.g. a house
// account, a QR-pay method) alongside the built-ins. CASH is special: it is
// the only method with per-currency control accounts (see seedChartOfAccounts)
// and its opening balance carries forward day to day. FOB is a built-in
// complimentary/comped "payment" that never touches cash or bank — see
// Posting.postReceipt.
function defaultPaymentMethods(){
  return [
    { id:'CASH', label:'Cash', kind:'CASH', cashType:true, system:true },
    { id:'CARD', label:'Card', kind:'STD', cashType:false, accountCode:'1030', system:true },
    { id:'BANK', label:'Bank transfer', kind:'STD', cashType:false, accountCode:'1060', system:true },
    { id:'FOB', label:'FOB (Complimentary)', kind:'FOB', cashType:false, system:true }
  ];
}

function defaultRoles(){
  return [
    { id:'ADMIN', label:'Admin', system:true, full:true, viewOnly:false, permissions:[] },
    { id:'ACCOUNTANT', label:'Accountant', system:true, full:false, viewOnly:false, permissions:
      ['DAY_END_CLOSE','APPROVE_VOUCHER','APPROVE_BILL','POST_PAYROLL','CLOSE_TAX_PERIOD','POST_DEPOSIT','RECONCILE_ACCOUNT','EDIT_CONFIRMED_RATE'] },
    { id:'FRONT_DESK', label:'Front desk', system:true, full:false, viewOnly:false, permissions:[] },
    { id:'OWNER', label:'Owner', system:true, full:false, viewOnly:true, permissions:[] },
    // A user with this role sees NOTHING but the waiver kiosk screen — no
    // sidebar, no topbar, no other route reachable, no data of any kind.
    // Intended for a dedicated reception tablet: front desk switches the
    // session to this user once, hands the device to the guest, and only
    // another staff member (via "Staff sign-in" on the kiosk screen) can
    // get the device back into normal use. viewOnly is also true as a
    // belt-and-braces guard, though kioskOnly already blocks every route.
    { id:'WAIVER_KIOSK', label:'Waiver Kiosk', system:true, full:false, viewOnly:true, kioskOnly:true, permissions:[] }
  ];
}

let DB = null;
let listeners = [];

function fillSettingsDefaults(){
  const def = defaultSettings();
  Object.keys(def).forEach(k=>{ if(!(k in DB.settings) || DB.settings[k]===undefined) DB.settings[k] = def[k]; });
  if(!Array.isArray(DB.settings.roles) || !DB.settings.roles.length) DB.settings.roles = defaultRoles();
  else {
    // make sure the built-in roles are all present even on an older save
    defaultRoles().forEach(r=>{ if(!DB.settings.roles.find(x=>x.id===r.id)) DB.settings.roles.push(r); });
    // and that a built-in system role picks up a permission added to it later (e.g.
    // RECONCILE_ACCOUNT) even on a save that already has that role
    defaultRoles().forEach(r=>{
      const existing = DB.settings.roles.find(x=>x.id===r.id);
      if(existing && existing.system){
        (r.permissions||[]).forEach(p=>{ if(!(existing.permissions||[]).includes(p)) (existing.permissions = existing.permissions||[]).push(p); });
      }
    });
  }
  if(!Array.isArray(DB.settings.paymentMethods) || !DB.settings.paymentMethods.length) DB.settings.paymentMethods = defaultPaymentMethods();
  else {
    // make sure the built-in methods (esp. FOB, added later) exist even on an older save
    defaultPaymentMethods().forEach(m=>{ if(!DB.settings.paymentMethods.find(x=>x.id===m.id)) DB.settings.paymentMethods.push(m); });
  }
  if(!Array.isArray(DB.settings.certLevels)) DB.settings.certLevels = [];
  if(typeof DB.settings.invoiceTemplate!=='object' || !DB.settings.invoiceTemplate) DB.settings.invoiceTemplate = defaultInvoiceTemplate();
  else {
    const defTpl = defaultInvoiceTemplate();
    Object.keys(defTpl).forEach(k=>{ if(!(k in DB.settings.invoiceTemplate)) DB.settings.invoiceTemplate[k] = defTpl[k]; });
  }
}

// Normalizes a raw DB object (parsed from localStorage, or handed down
// from the server in cloud mode) in place: fills any missing collections/
// settings, runs schema migrations, seeds starter records. Shared by both
// persistence backends so a cloud tenant's data goes through exactly the
// same forward-compat path a local save does.
function normalize(raw){
  if(raw){
    DB = raw;
    COLLECTIONS.forEach(c=>{ if(!(c in DB)) DB[c] = (c==='pettyCashConfig')?null:[]; });
    if(!DB.settings) DB.settings = defaultSettings();
    fillSettingsDefaults();
    if(!DB._seq) DB._seq = {};
    if(DB.schemaVersion==null) DB.schemaVersion = 1; // any save from before this field existed
    migrateSchema();
    ensureNewStarterAccounts();
    if(!DB.waiverTemplates.length) seedDefaultWaiverTemplate();
  } else {
    DB = emptyDb();
    seedChartOfAccounts();
    seedDirectCustomer();
    seedDefaultWaiverTemplate();
  }
  return DB;
}

function load(){
  try{
    const raw = localStorage.getItem(DB_KEY);
    normalize(raw ? JSON.parse(raw) : null);
    // Persist forward-compat additions (migrated codes, any newly-added starter/parent
    // accounts, a first waiver template) immediately, so they get a stable id/shape
    // instead of being silently regenerated with new ids on every future load.
    persist();
  }catch(e){
    console.error('Failed to load DB, starting fresh', e);
    normalize(null);
    persist();
  }
  return DB;
}

// Cloud mode (see cloud.js, only bundled in the hosted app): the server
// hands us the tenant's saved blob (or null for a brand-new tenant)
// instead of us reading localStorage ourselves.
function initFromData(raw){
  normalize(raw || null);
  persist();
  return DB;
}

function persist(){
  // localStorage stays the fast local cache in every build — cloud mode
  // layers a debounced push to the server on top (see cloud.js), so the
  // app keeps working (and stays instant) even on a flaky connection.
  try{ localStorage.setItem(DB_KEY, JSON.stringify(DB)); }catch(e){ /* private mode / quota — cloud push below still runs */ }
  if(window.CloudSync && typeof CloudSync.schedulePush==='function') CloudSync.schedulePush(DB);
  listeners.forEach(fn=>{ try{ fn(); }catch(e){ console.error(e); } });
}

function subscribe(fn){ listeners.push(fn); return ()=>{ listeners = listeners.filter(l=>l!==fn); }; }

function nextSeq(key, start){
  if(!DB._seq[key]) DB._seq[key] = (start||0);
  DB._seq[key] += 1;
  return DB._seq[key];
}

function uid(prefix){
  return (prefix?prefix+'_':'') + Math.random().toString(36).slice(2,9) + Date.now().toString(36).slice(-4);
}

function pad(n, len){ return String(n).padStart(len||4,'0'); }

function docNo(prefix, seqKey){
  const n = nextSeq(seqKey||prefix);
  return `${prefix}-${pad(n,5)}`;
}

/* ---- generic CRUD over an array collection ---- */
function all(coll){ return DB[coll] || []; }
function find(coll, id){ return all(coll).find(r=>r.id===id) || null; }
function where(coll, pred){ return all(coll).filter(pred); }
function insert(coll, rec){
  if(!rec.id) rec.id = uid(coll.slice(0,3));
  if(!('createdAt' in rec)) rec.createdAt = new Date().toISOString();
  DB[coll].push(rec);
  persist();
  return rec;
}
function update(coll, id, patch){
  const rec = find(coll, id);
  if(!rec) return null;
  Object.assign(rec, patch, { updatedAt: new Date().toISOString() });
  persist();
  return rec;
}
function remove(coll, id){
  DB[coll] = all(coll).filter(r=>r.id!==id);
  persist();
}

function log(action, detail){
  DB.auditLog.push({ id: uid('log'), at: new Date().toISOString(), action, detail });
  if(DB.auditLog.length > 500) DB.auditLog = DB.auditLog.slice(-500);
}

/* ---- seed: only Direct Booking + starter chart of accounts ---- */
function seedDirectCustomer(){
  DB.customers.push({
    id: 'CUST_DIRECT',
    type: 'DIRECT',
    name: 'Direct Booking',
    contact: '', email:'', phone:'', address:'',
    commissionPct: 0,
    creditLimit: 0,
    priceListId: null,
    taxNo: '',
    locked: true,
    active: true,
    createdAt: new Date().toISOString()
  });
}

// ---- Standard chart of accounts (QuickBooks-style numbering) ----
// code, name, type (5-way — drives debit/credit-natural balance in Ledger),
// accountType (the finer QBO-style classification shown in the UI),
// parentCode (or null — a couple of sensible groupings; every child here is
// still a normal postable account, the parent is just a header/rollup row).
// subtype is kept for backward-compat display only.
const STANDARD_ACCOUNTS = [
  // ---- 1000-1499 current assets ----
  ['1000','Cash on Hand','ASSET','Other Current Asset',null,'CASH'],
  ['1010','Cash on Hand — MVR','ASSET','Bank','1000','CASH'],
  ['1011','Cash on Hand — USD','ASSET','Bank','1000','CASH'],
  ['1012','Cash on Hand — EUR','ASSET','Bank','1000','CASH'],
  ['1020','Petty Cash','ASSET','Bank',null,'CASH'],
  ['1030','Card Clearing','ASSET','Other Current Asset',null,'CASH'],
  ['1040','Undeposited Funds','ASSET','Other Current Asset',null,'CASH'],
  ['1060','Bank Account','ASSET','Bank',null,'BANK'],
  ['1100','Accounts Receivable','ASSET','Accounts Receivable',null,'RECEIVABLE'],
  ['1110','Accounts Receivable — Agents','ASSET','Accounts Receivable','1100','RECEIVABLE'],
  ['1120','Accounts Receivable — Guests','ASSET','Accounts Receivable','1100','RECEIVABLE'],
  ['1200','Staff Advances Receivable','ASSET','Other Current Asset',null,'RECEIVABLE'],
  ['1300','Prepaid Expenses','ASSET','Other Current Asset',null,'OTHER'],
  // ---- 1500-1999 fixed assets ----
  ['1500','Equipment (Fixed Assets)','ASSET','Fixed Asset',null,'FIXED'],
  ['1510','Accumulated Depreciation — Equipment','ASSET','Fixed Asset',null,'CONTRA_FIXED'],
  // ---- 2000-2499 current liabilities ----
  ['2000','Accounts Payable — Vendors','LIABILITY','Accounts Payable',null,'PAYABLE'],
  ['2100','Tax Payable','LIABILITY','Other Current Liability',null,'TAX'],
  ['2200','Salaries Payable','LIABILITY','Other Current Liability',null,'PAYROLL'],
  ['2210','Pension Payable','LIABILITY','Other Current Liability',null,'PAYROLL'],
  ['2300','Customer Deposits / Unearned Revenue','LIABILITY','Other Current Liability',null,'OTHER'],
  ['2150','Agent Commission Payable','LIABILITY','Other Current Liability',null,'PAYABLE'],
  // ---- 3000-3999 equity ----
  ['3000','Owner Equity','EQUITY','Equity',null,'EQUITY'],
  ['3900','Retained Earnings','EQUITY','Equity',null,'EQUITY'],
  // ---- 4000-4999 income ----
  ['4000','Dive Package Revenue','REVENUE','Income',null,'SALES'],
  ['4010','Add-on & Extras Revenue','REVENUE','Income',null,'SALES'],
  ['4020','Equipment Damage / Loss Recovery','REVENUE','Income',null,'SALES'],
  ['4900','Agent Commission (Contra Revenue)','REVENUE','Income',null,'CONTRA'],
  // ---- 5000-5999 cost of goods sold / direct costs ----
  ['5000','Cost of Boat Trips (Fuel, Crew)','EXPENSE','Cost of Goods Sold',null,'COGS'],
  ['5010','Boat & Gear Rental (Overflow)','EXPENSE','Cost of Goods Sold',null,'COGS'],
  ['5020','Equipment Maintenance & Service','EXPENSE','Cost of Goods Sold',null,'COGS'],
  ['5100','Salaries & Wages','EXPENSE','Cost of Goods Sold',null,'PAYROLL'],
  ['5110','Pension — Company Contribution','EXPENSE','Cost of Goods Sold',null,'PAYROLL'],
  ['5120','Freelancer / Casual Guide Fees','EXPENSE','Cost of Goods Sold',null,'COGS'],
  // ---- 6000-6999 operating expenses (overhead) ----
  ['6100','Rent & Utilities','EXPENSE','Expense',null,'OPERATING'],
  ['6200','Office & Admin Expense','EXPENSE','Expense',null,'OPERATING'],
  ['6300','Marketing Expense','EXPENSE','Expense',null,'OPERATING'],
  ['6400','Bank & Card Fees','EXPENSE','Expense',null,'OPERATING'],
  ['6500','Complimentary / Promotional Expense','EXPENSE','Expense',null,'OPERATING'],
  ['6900','Miscellaneous Expense','EXPENSE','Expense',null,'OPERATING'],
  // ---- 7000-7999 other income ----
  ['7000','Cash Over / Short','REVENUE','Other Income',null,'OTHER'],
];

// Old (pre-v2) code -> new standard code. Applied once by migrateSchema()
// against any account whose `code` still matches a key here. Never touches
// `id` (journal lines reference accountId, not code), so this is a pure
// renumbering/relabeling and cannot change any historical balance.
const CODE_MIGRATIONS_V1_TO_V2 = {
  '1000':'1010', '1001':'1011', '1002':'1012', '1010':'1020', '1020':'1030', '1050':'1040', '1100':'1060',
  '1200':'1110', '1210':'1120', '1300':'1200', '1400':'1500', '1450':'1510', '1500':'1300',
  '2000':'2000', '2100':'2100', '2200':'2200', '2250':'2210', '2400':'2300',
  '3000':'3000', '3900':'3900',
  '4000':'4000', '4100':'4010', '4200':'4900', '4300':'4020', '4900':'7000',
  '5000':'5000', '5100':'5020', '5150':'5010', '5200':'5100', '5210':'5120', '5220':'5110',
  '5300':'6100', '5400':'6200', '5500':'6300', '5600':'6400', '5900':'6900', '5950':'6500'
};

function seedChartOfAccounts(){
  // STANDARD_ACCOUNTS lists parents before their children, so acctId(parentCode)
  // already finds the parent's freshly-assigned id by the time a child is seeded.
  STANDARD_ACCOUNTS.forEach(([code,name,type,accountType,parentCode,subtype])=>{
    DB.accounts.push({
      id: uid('acc'), code, name, type, accountType, subtype,
      parentAccountId: parentCode ? acctId(parentCode) : null,
      parentId:null, active:true, system:true
    });
  });
}

function acctByCode(code){ return DB.accounts.find(a=>a.code===code); }
function acctId(code){ const a = acctByCode(code); return a ? a.id : null; }

// One-time, idempotent migration: remaps any account still carrying an old
// (pre-v2) code to its standard replacement. Runs only while
// DB.schemaVersion < 2; a fresh install seeds directly with the new codes
// (schemaVersion starts at 2), so this never fires — and re-running it after
// it has already bumped the version is a guaranteed no-op since none of the
// CODE_MIGRATIONS_V1_TO_V2 keys are valid v2 codes.
function migrateSchema(){
  if(DB.schemaVersion < 2){
    (DB.accounts||[]).forEach(a=>{
      const next = CODE_MIGRATIONS_V1_TO_V2[a.code];
      if(next) a.code = next;
    });
    // A payment method's `accountCode` is a standalone string copy of an
    // account code (not an accountId lookup), so it needs the same remap or
    // it would silently point at whatever account happens to now sit at its
    // old code (e.g. old Card Clearing '1020' would otherwise resolve to the
    // new Petty Cash, which is now '1020').
    (DB.settings && DB.settings.paymentMethods || []).forEach(m=>{
      if(m.accountCode && CODE_MIGRATIONS_V1_TO_V2[m.accountCode]) m.accountCode = CODE_MIGRATIONS_V1_TO_V2[m.accountCode];
    });
    log('SCHEMA_MIGRATION', 'Renumbered chart of accounts to standard codes (v1 -> v2).');
    DB.schemaVersion = 2;
  }
  if(DB.schemaVersion < 3){
    migratePettyCashToFloats();
    log('SCHEMA_MIGRATION', 'Converted single petty cash float to the pettyCashFloats list (v2 -> v3).');
    DB.schemaVersion = 3;
  }
}

// v2's single `pettyCashConfig` box (if one was ever set up) becomes the
// first row in `pettyCashFloats`, reusing the existing 1020 Petty Cash
// account directly — no new account, so every historical posting still
// points at the same account and no balance moves. Existing petty cash
// vouchers (expenses and replenishments) are backfilled with this float's
// id so their history still shows up filtered by float. A save that never
// set up petty cash gets an empty `pettyCashFloats` list, same as a fresh
// install — nothing to migrate.
function migratePettyCashToFloats(){
  if(!Array.isArray(DB.pettyCashFloats)) DB.pettyCashFloats = [];
  const cfg = DB.pettyCashConfig;
  if(!cfg || DB.pettyCashFloats.length) return;
  const acct = acctByCode('1020');
  const float = {
    id: uid('pcf'), floatNo: 'PC-001',
    purpose: 'General petty cash',
    custodian: cfg.custodian || '',
    imprestAmount: cfg.imprestAmount || 0,
    accountId: acct ? acct.id : null,
    fundedAt: null, // unknown historically — the ledger balance already reflects whatever was funded
    active: true,
    createdAt: new Date().toISOString()
  };
  DB.pettyCashFloats.push(float);
  (DB.vouchers||[]).forEach(v=>{
    if(!v.floatId && (v.kind==='PETTY' || v.isReplenishment)) v.floatId = float.id;
  });
  DB.pettyCashConfig = null;
}

// Forward-compat: adds any standard account missing from this save (a fresh
// starter account introduced after the save was first created, or — for a
// database just migrated from v1 — the new parent header accounts, which
// never existed under the old scheme) and backfills accountType/
// parentAccountId onto every account that matches a standard code but
// predates those fields. Never touches an existing account's id, code
// (beyond what migrateSchema already did) or balance history.
function ensureNewStarterAccounts(){
  STANDARD_ACCOUNTS.forEach(([code,name,type,accountType,parentCode,subtype])=>{
    if(!acctByCode(code)){
      DB.accounts.push({
        id: uid('acc'), code, name, type, accountType, subtype,
        parentAccountId: parentCode ? acctId(parentCode) : null,
        parentId:null, active:true, system:true
      });
    }
  });
  DB.accounts.forEach(a=>{
    const std = STANDARD_ACCOUNTS.find(s=>s[0]===a.code);
    if(std){
      if(a.accountType==null) a.accountType = std[3];
      if(a.parentAccountId===undefined || a.parentAccountId===null) a.parentAccountId = std[4] ? acctId(std[4]) : (a.parentAccountId||null);
      if(a.subtype==null) a.subtype = std[5];
    } else {
      if(a.accountType===undefined) a.accountType = null;
      if(a.parentAccountId===undefined) a.parentAccountId = null;
    }
  });
}

function seedDefaultWaiverTemplate(){
  DB.waiverTemplates.push({
    id: uid('wvr'), name:'Standard Liability Waiver', isDefault:true, active:true,
    body: 'I confirm that I am physically fit to participate in scuba diving activities and have disclosed any medical conditions that could affect my safety.\n\nI understand the inherent risks of diving and release the dive centre, its staff, boat operators and instructors from all liability for injury, loss or damage arising from my participation, except where caused by their gross negligence.\n\nI consent to receive first aid or emergency medical treatment if required during this activity.',
    createdAt: new Date().toISOString()
  });
}

function exportJson(){ return JSON.stringify(DB, null, 2); }
function importJson(json){
  const parsed = JSON.parse(json);
  DB = parsed;
  COLLECTIONS.forEach(c=>{ if(!(c in DB)) DB[c] = (c==='pettyCashConfig')?null:[]; });
  if(!DB.settings) DB.settings = defaultSettings();
  fillSettingsDefaults();
  if(!DB._seq) DB._seq = {};
  if(DB.schemaVersion==null) DB.schemaVersion = 1; // a backup taken before this field existed
  migrateSchema();
  ensureNewStarterAccounts();
  persist();
}
function resetAll(){
  DB = emptyDb();
  seedChartOfAccounts();
  seedDirectCustomer();
  seedDefaultWaiverTemplate();
  persist();
}

const Store = {
  load, persist, subscribe, initFromData,
  all, find, where, insert, update, remove,
  uid, docNo, nextSeq, log,
  acctByCode, acctId,
  exportJson, importJson, resetAll,
  STANDARD_ACCOUNTS,
  get db(){ return DB; },
  get settings(){ return DB.settings; },
};

window.Store = Store;
