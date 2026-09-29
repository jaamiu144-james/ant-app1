/* ---------------------------------------------------------------------
   db.js — storage layer, on MySQL (via the `mysql2` driver). Three
   tables: tenants (one per dive centre / subscription), users (platform
   login — separate from the in-app "Store" users each tenant manages on
   the Settings > Users tab), and tenant_data (the tenant's whole app
   data blob, the same JSON that used to live in localStorage).

   Connection: set either MYSQL_URL (mysql://user:pass@host:port/dbname
   — what most managed MySQL hosts hand you) or the discrete MYSQL_HOST /
   MYSQL_PORT / MYSQL_USER / MYSQL_PASSWORD / MYSQL_DATABASE vars. See
   server/SETUP.md.

   Every exported function here is async (mysql2 is promise-based) —
   callers in index.js all `await` them.
--------------------------------------------------------------------- */
import mysql from 'mysql2/promise';
import crypto from 'node:crypto';

const pool = process.env.MYSQL_URL
  ? mysql.createPool(process.env.MYSQL_URL)
  : mysql.createPool({
      host: process.env.MYSQL_HOST || 'localhost',
      port: Number(process.env.MYSQL_PORT || 3306),
      user: process.env.MYSQL_USER || 'root',
      password: process.env.MYSQL_PASSWORD || '',
      database: process.env.MYSQL_DATABASE || 'ant_app',
      waitForConnections: true,
      connectionLimit: 10,
      charset: 'utf8mb4_general_ci',
    });

// Runs once at startup (see index.js) — creates the schema if it isn't
// there yet. Safe to run every boot: CREATE TABLE IF NOT EXISTS.
export async function migrate(){
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tenants (
      id VARCHAR(64) PRIMARY KEY,
      company_name VARCHAR(255) NOT NULL,
      edition VARCHAR(16) NOT NULL DEFAULT 'full',
      plan VARCHAR(16) NOT NULL DEFAULT 'front',
      status VARCHAR(16) NOT NULL DEFAULT 'pending',
      stripe_customer_id VARCHAR(64),
      stripe_subscription_id VARCHAR(64),
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id VARCHAR(64) PRIMARY KEY,
      tenant_id VARCHAR(64) NOT NULL,
      email VARCHAR(255) NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      name VARCHAR(255),
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_users_email (email),
      CONSTRAINT fk_users_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS tenant_data (
      tenant_id VARCHAR(64) PRIMARY KEY,
      data LONGTEXT NOT NULL,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_tenant_data_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
}

export function uid(prefix){
  return (prefix ? prefix + '_' : '') + crypto.randomBytes(9).toString('base64url');
}

/* ---- tenants ---- */
export async function createTenant({ id, companyName, edition, plan }){
  await pool.query(
    `INSERT INTO tenants (id, company_name, edition, plan, status) VALUES (?, ?, ?, ?, 'pending')`,
    [id, companyName, edition, plan]
  );
  return getTenant(id);
}
export async function getTenant(id){
  const [rows] = await pool.query(`SELECT * FROM tenants WHERE id = ?`, [id]);
  return rows[0] || null;
}
export async function getTenantByStripeCustomer(customerId){
  const [rows] = await pool.query(`SELECT * FROM tenants WHERE stripe_customer_id = ?`, [customerId]);
  return rows[0] || null;
}
export async function getTenantByStripeSubscription(subId){
  const [rows] = await pool.query(`SELECT * FROM tenants WHERE stripe_subscription_id = ?`, [subId]);
  return rows[0] || null;
}
export async function updateTenant(id, fields){
  const cols = Object.keys(fields);
  if(!cols.length) return getTenant(id);
  const set = cols.map(c=>`${c} = ?`).join(', ');
  await pool.query(`UPDATE tenants SET ${set} WHERE id = ?`, [...cols.map(c=>fields[c]), id]);
  return getTenant(id);
}

/* ---- users (platform login) ---- */
export async function createUser({ id, tenantId, email, passwordHash, name }){
  await pool.query(
    `INSERT INTO users (id, tenant_id, email, password_hash, name) VALUES (?, ?, ?, ?, ?)`,
    [id, tenantId, email.toLowerCase().trim(), passwordHash, name || null]
  );
  return getUserById(id);
}
export async function getUserByEmail(email){
  const [rows] = await pool.query(`SELECT * FROM users WHERE email = ?`, [email.toLowerCase().trim()]);
  return rows[0] || null;
}
export async function getUserById(id){
  const [rows] = await pool.query(`SELECT * FROM users WHERE id = ?`, [id]);
  return rows[0] || null;
}

/* ---- tenant_data (the app's JSON blob — replaces localStorage) ---- */
export async function getTenantData(tenantId){
  const [rows] = await pool.query(`SELECT data FROM tenant_data WHERE tenant_id = ?`, [tenantId]);
  return rows[0] ? JSON.parse(rows[0].data) : null;
}
export async function saveTenantData(tenantId, data){
  const json = JSON.stringify(data);
  // MySQL's upsert syntax (not SQLite/Postgres' ON CONFLICT):
  await pool.query(
    `INSERT INTO tenant_data (tenant_id, data) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE data = VALUES(data)`,
    [tenantId, json]
  );
}

export default pool;
