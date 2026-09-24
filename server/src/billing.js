/* ---------------------------------------------------------------------
   billing.js — Stripe integration over plain HTTPS (Stripe's REST API +
   Node's built-in fetch), no `stripe` SDK package needed — same reason
   as auth.js: this was built where `npm install` isn't available. Swap
   in the official SDK later if you prefer; the calls below map 1:1 to
   it.

   DEV MODE: if STRIPE_SECRET_KEY isn't set, every function here is a
   no-op stand-in so the rest of the app (signup, login, data, edition
   gating) can be built and tested end-to-end before you have a Stripe
   account. server/src/index.js checks `billing.isConfigured()` and
   activates a tenant immediately on signup in that case, skipping
   checkout entirely — clearly a dev/testing path, never for production.
--------------------------------------------------------------------- */
import crypto from 'node:crypto';

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
const STRIPE_API = 'https://api.stripe.com/v1';

// Maps our plan key -> the Stripe Price ID for its subscription. Create
// these in the Stripe Dashboard (Product catalog) and put the IDs in env
// vars — see server/SETUP.md.
export const PLAN_PRICE_ENV = {
  front: 'STRIPE_PRICE_FRONT',
  back: 'STRIPE_PRICE_BACK',
  complete: 'STRIPE_PRICE_COMPLETE',
};
export function priceIdForPlan(plan){
  const envVar = PLAN_PRICE_ENV[plan];
  return envVar ? (process.env[envVar] || '') : '';
}

export function isConfigured(){
  return !!STRIPE_SECRET_KEY;
}

async function stripeRequest(method, endpoint, params){
  const body = params ? new URLSearchParams(flatten(params)).toString() : undefined;
  const res = await fetch(`${STRIPE_API}${endpoint}`, {
    method,
    headers: {
      'Authorization': 'Basic ' + Buffer.from(STRIPE_SECRET_KEY + ':').toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  const json = await res.json();
  if(!res.ok){
    const msg = json && json.error ? json.error.message : `Stripe API error (${res.status})`;
    throw new Error(msg);
  }
  return json;
}

// Stripe's form-encoded API wants nested objects/arrays flattened as
// bracketed keys, e.g. {line_items:[{price:'x'}]} -> 'line_items[0][price]=x'.
function flatten(obj, prefix=''){
  const out = {};
  for(const [k, v] of Object.entries(obj)){
    const key = prefix ? `${prefix}[${k}]` : k;
    if(v && typeof v === 'object' && !Array.isArray(v)) Object.assign(out, flatten(v, key));
    else if(Array.isArray(v)) v.forEach((item, i)=> Object.assign(out, typeof item==='object' ? flatten(item, `${key}[${i}]`) : { [`${key}[${i}]`]: item }));
    else if(v !== undefined && v !== null) out[key] = v;
  }
  return out;
}

export async function createCustomer({ email, name }){
  if(!isConfigured()) return { id: 'dev_cus_' + Date.now() };
  return stripeRequest('POST', '/customers', { email, name });
}

export async function createCheckoutSession({ customerId, priceId, successUrl, cancelUrl, tenantId }){
  if(!isConfigured()) return { url: successUrl }; // dev mode — nothing to redirect to, caller should skip checkout entirely
  return stripeRequest('POST', '/checkout/sessions', {
    customer: customerId,
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: { tenant_id: tenantId },
    subscription_data: { metadata: { tenant_id: tenantId } },
  });
}

export async function createBillingPortalSession({ customerId, returnUrl }){
  if(!isConfigured()) throw new Error('Billing is not configured on this server yet.');
  return stripeRequest('POST', '/billing_portal/sessions', { customer: customerId, return_url: returnUrl });
}

export async function retrieveSubscription(subId){
  if(!isConfigured()) return null;
  return stripeRequest('GET', `/subscriptions/${subId}`);
}

// Verifies the Stripe-Signature header per Stripe's documented scheme:
// header is "t=<timestamp>,v1=<hex hmac>[,v1=<hex hmac>...]"; the signed
// payload is "<timestamp>.<raw body>", HMAC-SHA256'd with the webhook
// signing secret. Rejects payloads older than 5 minutes (replay guard).
export function verifyWebhookSignature(rawBody, sigHeader){
  if(!STRIPE_WEBHOOK_SECRET) throw new Error('STRIPE_WEBHOOK_SECRET is not set');
  const parts = Object.fromEntries(String(sigHeader||'').split(',').map(p=>p.split('=')));
  const timestamp = parts.t;
  const signatures = String(sigHeader||'').split(',').filter(p=>p.startsWith('v1=')).map(p=>p.slice(3));
  if(!timestamp || !signatures.length) throw new Error('Malformed Stripe-Signature header');
  const expected = crypto.createHmac('sha256', STRIPE_WEBHOOK_SECRET).update(`${timestamp}.${rawBody}`).digest('hex');
  const ok = signatures.some(sig=>{
    const a = Buffer.from(sig), b = Buffer.from(expected);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  });
  if(!ok) throw new Error('Signature mismatch');
  if(Date.now()/1000 - Number(timestamp) > 300) throw new Error('Webhook timestamp too old (possible replay)');
  return true;
}
