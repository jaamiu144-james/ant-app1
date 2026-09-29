/* ---------------------------------------------------------------------
   index.js — the whole HTTP server. Built on Node's built-in http
   module (no Express — npm installs weren't reachable in the sandbox
   this was written in; swap in Express later if you'd rather, the
   routes below translate directly). See server/SETUP.md for how to run
   and deploy this.
--------------------------------------------------------------------- */
import './loadEnv.js';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as db from './db.js';
import * as auth from './auth.js';
import * as billing from './billing.js';
import { renderAppHtml } from './appBundle.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const PORT = Number(process.env.PORT || 8787);
const APP_URL = process.env.APP_URL || `http://localhost:${PORT}`;

const PLAN_TO_EDITION = { front: 'front', back: 'back', complete: 'full' };

/* ---- small helpers ---- */
function sendJson(res, status, obj){
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}
function sendHtml(res, status, html){
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': Buffer.byteLength(html) });
  res.end(html);
}
function redirect(res, location){
  res.writeHead(302, { Location: location });
  res.end();
}
function isSecureReq(req){
  return req.headers['x-forwarded-proto'] === 'https' || process.env.FORCE_SECURE_COOKIE === '1';
}
function readBody(req, { limit = 2_000_000 } = {}){
  return new Promise((resolve, reject)=>{
    let size = 0;
    const chunks = [];
    req.on('data', c=>{
      size += c.length;
      if(size > limit){ reject(new Error('Request body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', ()=> resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
async function readJson(req){
  const buf = await readBody(req);
  if(!buf.length) return {};
  try{ return JSON.parse(buf.toString('utf8')); }catch{ throw new Error('Invalid JSON body'); }
}
function getSession(req){
  const cookies = auth.parseCookies(req.headers.cookie);
  return auth.verifySessionToken(cookies[auth.SESSION_COOKIE]);
}
function tenantPublicView(t){
  return { companyName: t.company_name, edition: t.edition, plan: t.plan, status: t.status };
}

/* ---- route handlers ---- */

async function handleSignup(req, res){
  let body;
  try{ body = await readJson(req); }catch(e){ return sendJson(res, 400, { error: e.message }); }
  const companyName = String(body.companyName||'').trim();
  const email = String(body.email||'').trim().toLowerCase();
  const password = String(body.password||'');
  const plan = PLAN_TO_EDITION[body.plan] ? body.plan : null;

  if(!companyName) return sendJson(res, 400, { error: 'Company name is required.' });
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return sendJson(res, 400, { error: 'A valid email is required.' });
  if(password.length < 8) return sendJson(res, 400, { error: 'Password must be at least 8 characters.' });
  if(!plan) return sendJson(res, 400, { error: 'Choose a plan: front, back, or complete.' });
  if(await db.getUserByEmail(email)) return sendJson(res, 409, { error: 'An account with that email already exists — try logging in instead.' });

  const edition = PLAN_TO_EDITION[plan];
  const tenantId = db.uid('tenant');
  await db.createTenant({ id: tenantId, companyName, edition, plan });
  const userId = db.uid('user');
  await db.createUser({ id: userId, tenantId, email, passwordHash: auth.hashPassword(password), name: body.name || null });

  let checkoutUrl = null;
  if(billing.isConfigured()){
    const priceId = billing.priceIdForPlan(plan);
    if(!priceId){
      return sendJson(res, 500, { error: `Billing is configured but no Stripe price is set for the "${plan}" plan (see server/SETUP.md).` });
    }
    const customer = await billing.createCustomer({ email, name: companyName });
    await db.updateTenant(tenantId, { stripe_customer_id: customer.id });
    const session = await billing.createCheckoutSession({
      customerId: customer.id,
      priceId,
      successUrl: `${APP_URL}/app?checkout=success`,
      cancelUrl: `${APP_URL}/pricing?checkout=cancelled`,
      tenantId,
    });
    checkoutUrl = session.url;
  } else {
    // Dev mode — no Stripe configured. Activate immediately so the app
    // can be built/tested end-to-end. NOT for production use.
    await db.updateTenant(tenantId, { status: 'active' });
  }

  const token = auth.createSessionToken({ userId, tenantId });
  res.setHeader('Set-Cookie', auth.cookieHeader(token, { secure: isSecureReq(req) }));
  sendJson(res, 200, { ok: true, checkoutUrl, devMode: !billing.isConfigured() });
}

async function handleLogin(req, res){
  let body;
  try{ body = await readJson(req); }catch(e){ return sendJson(res, 400, { error: e.message }); }
  const email = String(body.email||'').trim().toLowerCase();
  const password = String(body.password||'');
  const user = await db.getUserByEmail(email);
  if(!user || !auth.verifyPassword(password, user.password_hash)){
    return sendJson(res, 401, { error: 'Incorrect email or password.' });
  }
  const token = auth.createSessionToken({ userId: user.id, tenantId: user.tenant_id });
  res.setHeader('Set-Cookie', auth.cookieHeader(token, { secure: isSecureReq(req) }));
  sendJson(res, 200, { ok: true });
}

function handleLogout(req, res){
  res.setHeader('Set-Cookie', auth.clearCookieHeader({ secure: isSecureReq(req) }));
  sendJson(res, 200, { ok: true });
}

async function handleSession(req, res){
  const s = getSession(req);
  if(!s) return sendJson(res, 200, { authenticated: false });
  const tenant = await db.getTenant(s.tid);
  if(!tenant) return sendJson(res, 200, { authenticated: false });
  sendJson(res, 200, { authenticated: true, tenant: tenantPublicView(tenant) });
}

async function handleGetData(req, res){
  const s = getSession(req);
  if(!s) return sendJson(res, 401, { error: 'Not signed in.' });
  const tenant = await db.getTenant(s.tid);
  if(!tenant) return sendJson(res, 401, { error: 'Account not found.' });
  const data = await db.getTenantData(s.tid);
  sendJson(res, 200, { data, tenant: tenantPublicView(tenant) });
}

async function handlePutData(req, res){
  const s = getSession(req);
  if(!s) return sendJson(res, 401, { error: 'Not signed in.' });
  const tenant = await db.getTenant(s.tid);
  if(!tenant) return sendJson(res, 401, { error: 'Account not found.' });
  let body;
  try{ body = await readJson(req, { limit: 20_000_000 }); }catch(e){ return sendJson(res, 400, { error: e.message }); }
  if(!body || typeof body.data !== 'object') return sendJson(res, 400, { error: 'Missing data.' });
  await db.saveTenantData(s.tid, body.data);
  sendJson(res, 200, { ok: true });
}

async function handleBillingPortal(req, res){
  const s = getSession(req);
  if(!s) return sendJson(res, 401, { error: 'Not signed in.' });
  const tenant = await db.getTenant(s.tid);
  if(!tenant || !tenant.stripe_customer_id) return sendJson(res, 400, { error: 'No billing account on file yet.' });
  try{
    const portal = await billing.createBillingPortalSession({ customerId: tenant.stripe_customer_id, returnUrl: `${APP_URL}/app` });
    sendJson(res, 200, { url: portal.url });
  }catch(e){
    sendJson(res, 500, { error: e.message });
  }
}

async function handleStripeWebhook(req, res){
  const buf = await readBody(req, { limit: 2_000_000 });
  const rawBody = buf.toString('utf8');
  try{
    billing.verifyWebhookSignature(rawBody, req.headers['stripe-signature']);
  }catch(e){
    console.error('[stripe webhook] signature check failed:', e.message);
    return sendJson(res, 400, { error: 'Invalid signature' });
  }
  const event = JSON.parse(rawBody);
  try{
    switch(event.type){
      case 'checkout.session.completed': {
        const session = event.data.object;
        const tenantId = session.metadata && session.metadata.tenant_id;
        if(tenantId){
          await db.updateTenant(tenantId, { status: 'active', stripe_subscription_id: session.subscription || null });
        }
        break;
      }
      case 'customer.subscription.updated': {
        const sub = event.data.object;
        const tenant = (await db.getTenantByStripeSubscription(sub.id)) || (await db.getTenantByStripeCustomer(sub.customer));
        if(tenant){
          const status = sub.status === 'active' || sub.status === 'trialing' ? 'active'
            : sub.status === 'past_due' ? 'past_due' : 'canceled';
          await db.updateTenant(tenant.id, { status, stripe_subscription_id: sub.id });
        }
        break;
      }
      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        const tenant = (await db.getTenantByStripeSubscription(sub.id)) || (await db.getTenantByStripeCustomer(sub.customer));
        if(tenant) await db.updateTenant(tenant.id, { status: 'canceled' });
        break;
      }
      default:
        break; // ignore anything we don't act on
    }
  }catch(e){
    console.error('[stripe webhook] handler error:', e);
    return sendJson(res, 500, { error: 'Webhook handler failed' });
  }
  sendJson(res, 200, { received: true });
}

async function serveApp(req, res){
  const s = getSession(req);
  if(!s) return redirect(res, '/login');
  const tenant = await db.getTenant(s.tid);
  if(!tenant) return redirect(res, '/login');
  if(tenant.status !== 'active'){
    return redirect(res, '/pricing?resume=1');
  }
  sendHtml(res, 200, renderAppHtml({ edition: tenant.edition }));
}

function serveStatic(res, filePath, contentType, { cache } = {}){
  try{
    const body = fs.readFileSync(filePath);
    const headers = { 'Content-Type': contentType, 'Content-Length': body.length };
    if(cache) headers['Cache-Control'] = cache;
    res.writeHead(200, headers);
    res.end(body);
  }catch{
    sendHtml(res, 404, '<h1>Not found</h1>');
  }
}

// /icons/<name>.png — basename-only, no path traversal (rejects anything
// with a slash or that isn't a plain filename already on disk).
function serveIcon(res, name){
  if(!/^[a-z0-9.-]+\.png$/i.test(name)) return sendHtml(res, 404, '<h1>Not found</h1>');
  serveStatic(res, path.join(PUBLIC_DIR, 'icons', name), 'image/png', { cache: 'public, max-age=604800' });
}

/* ---- router ---- */
const server = http.createServer(async (req, res)=>{
  const url = new URL(req.url, APP_URL);
  const { pathname } = url;
  try{
    if(pathname === '/' ) return redirect(res, getSession(req) ? '/app' : '/pricing');
    if(pathname === '/pricing' && req.method === 'GET') return serveStatic(res, path.join(PUBLIC_DIR, 'pricing.html'), 'text/html; charset=utf-8');
    if(pathname === '/login' && req.method === 'GET') return serveStatic(res, path.join(PUBLIC_DIR, 'login.html'), 'text/html; charset=utf-8');
    if(pathname === '/app' && req.method === 'GET') return await serveApp(req, res);

    // PWA — manifest, service worker, offline fallback, icons.
    if(pathname === '/manifest.webmanifest' && req.method === 'GET') return serveStatic(res, path.join(PUBLIC_DIR, 'manifest.webmanifest'), 'application/manifest+json; charset=utf-8', { cache: 'public, max-age=3600' });
    if(pathname === '/sw.js' && req.method === 'GET') return serveStatic(res, path.join(PUBLIC_DIR, 'sw.js'), 'text/javascript; charset=utf-8', { cache: 'no-cache' });
    if(pathname === '/offline.html' && req.method === 'GET') return serveStatic(res, path.join(PUBLIC_DIR, 'offline.html'), 'text/html; charset=utf-8');
    if(pathname === '/pwa-install.js' && req.method === 'GET') return serveStatic(res, path.join(PUBLIC_DIR, 'pwa-install.js'), 'text/javascript; charset=utf-8', { cache: 'public, max-age=3600' });
    if(pathname.startsWith('/icons/') && req.method === 'GET') return serveIcon(res, pathname.slice('/icons/'.length));

    if(pathname === '/api/signup' && req.method === 'POST') return await handleSignup(req, res);
    if(pathname === '/api/login' && req.method === 'POST') return await handleLogin(req, res);
    if(pathname === '/api/logout' && req.method === 'POST') return handleLogout(req, res);
    if(pathname === '/api/session' && req.method === 'GET') return await handleSession(req, res);
    if(pathname === '/api/data' && req.method === 'GET') return await handleGetData(req, res);
    if(pathname === '/api/data' && req.method === 'PUT') return await handlePutData(req, res);
    if(pathname === '/api/billing/portal' && req.method === 'GET') return await handleBillingPortal(req, res);
    if(pathname === '/api/stripe/webhook' && req.method === 'POST') return await handleStripeWebhook(req, res);

    sendHtml(res, 404, '<h1>Not found</h1>');
  }catch(e){
    console.error('Unhandled error:', e);
    sendJson(res, 500, { error: 'Internal server error' });
  }
});

db.migrate()
  .then(()=>{
    server.listen(PORT, ()=>{
      console.log(`Ant App server listening on http://localhost:${PORT}`);
      console.log(`Billing: ${billing.isConfigured() ? 'Stripe configured' : 'DEV MODE — Stripe not configured, signups activate immediately with no payment'}`);
    });
  })
  .catch(err=>{
    console.error('Could not reach/migrate the MySQL database — check MYSQL_URL / MYSQL_HOST etc. in .env:', err.message);
    process.exit(1);
  });
