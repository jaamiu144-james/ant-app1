/* ---------------------------------------------------------------------
   auth.js — password hashing (Node's built-in scrypt, no bcrypt package
   needed) and signed session cookies (HMAC-SHA256, no jsonwebtoken
   package needed — this is functionally the same idea as a JWT, just
   handwritten, since npm installs aren't available in the environment
   this was built in; swap in a real JWT lib later if you'd rather).
--------------------------------------------------------------------- */
import crypto from 'node:crypto';

const SESSION_SECRET = process.env.SESSION_SECRET || (()=>{
  console.warn('[auth] SESSION_SECRET not set — using a random one-off secret (every restart invalidates all sessions). Set SESSION_SECRET in production.');
  return crypto.randomBytes(32).toString('hex');
})();
const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
export const SESSION_COOKIE = 'ant_session';

/* ---- password hashing ---- */
export function hashPassword(password){
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt:${salt}:${hash}`;
}
export function verifyPassword(password, stored){
  const [alg, salt, hash] = String(stored||'').split(':');
  if(alg !== 'scrypt' || !salt || !hash) return false;
  const check = crypto.scryptSync(password, salt, 64).toString('hex');
  const a = Buffer.from(hash, 'hex'), b = Buffer.from(check, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/* ---- signed session tokens ---- */
function sign(payloadB64){
  return crypto.createHmac('sha256', SESSION_SECRET).update(payloadB64).digest('base64url');
}
export function createSessionToken({ userId, tenantId }){
  const payload = { uid: userId, tid: tenantId, exp: Date.now() + SESSION_MAX_AGE_MS };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${payloadB64}.${sign(payloadB64)}`;
}
export function verifySessionToken(token){
  if(!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [payloadB64, sig] = token.split('.');
  const expected = sign(payloadB64);
  const a = Buffer.from(sig||''), b = Buffer.from(expected);
  if(a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try{
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    if(!payload.exp || Date.now() > payload.exp) return null;
    return payload; // { uid, tid, exp }
  }catch{ return null; }
}

export function cookieHeader(token, { secure } = {}){
  const parts = [
    `${SESSION_COOKIE}=${token}`,
    'HttpOnly', 'Path=/', 'SameSite=Lax',
    `Max-Age=${Math.floor(SESSION_MAX_AGE_MS/1000)}`,
  ];
  if(secure) parts.push('Secure');
  return parts.join('; ');
}
export function clearCookieHeader({ secure } = {}){
  const parts = [`${SESSION_COOKIE}=`, 'HttpOnly', 'Path=/', 'SameSite=Lax', 'Max-Age=0'];
  if(secure) parts.push('Secure');
  return parts.join('; ');
}

export function parseCookies(header){
  const out = {};
  (header||'').split(';').forEach(p=>{
    const i = p.indexOf('=');
    if(i<0) return;
    out[p.slice(0,i).trim()] = decodeURIComponent(p.slice(i+1).trim());
  });
  return out;
}
