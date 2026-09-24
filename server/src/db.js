/* ---------------------------------------------------------------------
   db.js — storage layer, built on Node's built-in node:sqlite (Node 22+,
   no external DB driver needed). One file on disk (DB_PATH), three
   tables: tenants (one per dive centre / subscription), users (platform
   login — separate from the in-app "Store" users each tenant manages on
   the Settings > Users tab), and tenant_data (the tenant's whole app
   data blob, the same JSON that used to live in localStorage).

   SQLite is a completely reasonable production choice at this scale —
   one writer per tenant, no cross-tenant joins, easy to back up (it's a
   single file). If/when this needs to scale past what one file can hold,
   swap this module for a Postgres-backed one; nothing outside db.js
   needs to change since every caller only sees the functions below.
--------------------------------------------------------------------- */
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), 'data', 'ant-app.sqlite');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
  CREATE TABLE IF NOT EXISTS tenants (
    id TEXT PRIMARY KEY,
    company_name TEXT NOT NULL,
    edition TEXT NOT NULL DEFAULT 'full',           -- 'front' | 'back' | 'full' — what the app shows
    plan TEXT NOT NULL DEFAULT 'front',              -- 'front' | 'back' | 'complete' — billing plan key
    status TEXT NOT NULL DEFAULT 'pending',          -- pending | active | past_due | canceled
    stripe_customer_id TEXT,
    stripe_subscription_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    name TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS tenant_data (
    tenant_id TEXT PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
    data TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

export function uid(prefix){
  return (prefix ? prefix + '_' : '') + crypto.randomBytes(9).toString('base64url');
}

/* ---- tenants ---- */
export function createTenant({ id, companyName, edition, plan }){
  db.prepare(`INSERT INTO tenants (id, company_name, edition, plan, status) VALUES (?, ?, ?, ?, 'pending')`)
    .run(id, companyName, edition, plan);
  return getTenant(id);
}
export function getTenant(id){
  return db.prepare(`SELECT * FROM tenants WHERE id = ?`).get(id) || null;
}
export function getTenantByStripeCustomer(customerId){
  return db.prepare(`SELECT * FROM tenants WHERE stripe_customer_id = ?`).get(customerId) || null;
}
export function getTenantByStripeSubscription(subId){
  return db.prepare(`SELECT * FROM tenants WHERE stripe_subscription_id = ?`).get(subId) || null;
}
export function updateTenant(id, fields){
  const cols = Object.keys(fields);
  if(!cols.length) return getTenant(id);
  const set = cols.map(c=>`${c} = ?`).join(', ');
  db.prepare(`UPDATE tenants SET ${set} WHERE id = ?`).run(...cols.map(c=>fields[c]), id);
  return getTenant(id);
}

/* ---- users (platform login) ---- */
export function createUser({ id, tenantId, email, passwordHash, name }){
  db.prepare(`INSERT INTO users (id, tenant_id, email, password_hash, name) VALUES (?, ?, ?, ?, ?)`)
    .run(id, tenantId, email.toLowerCase().trim(), passwordHash, name || null);
  return getUserById(id);
}
export function getUserByEmail(email){
  return db.prepare(`SELECT * FROM users WHERE email = ?`).get(email.toLowerCase().trim()) || null;
}
export function getUserById(id){
  return db.prepare(`SELECT * FROM users WHERE id = ?`).get(id) || null;
}

/* ---- tenant_data (the app's JSON blob — replaces localStorage) ---- */
export function getTenantData(tenantId){
  const row = db.prepare(`SELECT data FROM tenant_data WHERE tenant_id = ?`).get(tenantId);
  return row ? JSON.parse(row.data) : null;
}
export function saveTenantData(tenantId, data){
  const json = JSON.stringify(data);
  db.prepare(`
    INSERT INTO tenant_data (tenant_id, data, updated_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(tenant_id) DO UPDATE SET data = excluded.data, updated_at = datetime('now')
  `).run(tenantId, json);
}

export default db;
