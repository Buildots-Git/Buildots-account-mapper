// Per-user Salesforce login (OAuth web-server flow with PKCE).
// Off until SF_CLIENT_ID is set (a Salesforce Connected App, see .env.example). When on, every Salesforce read and write runs as the
// signed-in person, so Salesforce's own visibility, field-level security, sharing and edit rules apply and Salesforce records the real author.
import crypto from 'node:crypto';
import * as creds from './creds.js';

const env = (k) => String(process.env[k] || '').trim();
const loginUrl = () => (env('SF_LOGIN_URL') || 'https://login.salesforce.com').replace(/\/$/, '');
export const perUserEnabled = () => !!env('SF_CLIENT_ID');

const b64 = (b) => Buffer.from(b).toString('base64url');
const pending = new Map(); // state -> { user, verifier, at }
const prune = () => { const now = Date.now(); for (const [k, v] of pending) if (now - v.at > 10 * 60_000) pending.delete(k); };
const connectError = (msg) => Object.assign(new Error(msg), { status: 409, code: 'sf-connect' });

export function redirectUri(req) {
  const base = env('PUBLIC_URL').replace(/\/$/, '') || `${(req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0]}://${req.headers['x-forwarded-host'] || req.headers.host}`;
  return `${base}/api/auth/salesforce/callback`;
}

/** The URL to send the signed-in person to so they can approve access with their own Salesforce login. */
export function startConnect(req, user) {
  prune();
  const state = b64(crypto.randomBytes(24)), verifier = b64(crypto.randomBytes(48));
  pending.set(state, { user, verifier, at: Date.now() });
  const q = new URLSearchParams({ response_type: 'code', client_id: env('SF_CLIENT_ID'), redirect_uri: redirectUri(req), scope: 'api refresh_token', state,
    code_challenge: b64(crypto.createHash('sha256').update(verifier).digest()), code_challenge_method: 'S256', prompt: 'login' });
  return `${loginUrl()}/services/oauth2/authorize?${q}`;
}

async function tokenCall(params) {
  const body = new URLSearchParams({ client_id: env('SF_CLIENT_ID'), ...(env('SF_CLIENT_SECRET') ? { client_secret: env('SF_CLIENT_SECRET') } : {}), ...params });
  const r = await fetch(`${loginUrl()}/services/oauth2/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, j };
}

/** Finishes the connect: stores the person's refresh token (encrypted) and returns their Salesforce username. The user comes from our own stored state, not from a cookie. */
export async function finishConnect(req) {
  const { code, state, error, error_description } = req.query;
  if (error) throw new Error(error_description || `Salesforce said: ${error}`);
  const p = pending.get(String(state)); pending.delete(String(state));
  if (!p || Date.now() - p.at > 10 * 60_000) throw new Error('The connection took too long or was already used. Try again.');
  const { ok, j } = await tokenCall({ grant_type: 'authorization_code', code: String(code), redirect_uri: redirectUri(req), code_verifier: p.verifier });
  if (!ok || !j.refresh_token) throw new Error(`Salesforce did not accept the connection (${j.error_description || j.error || 'no refresh token — check the Connected App scopes'}).`);
  let label = null;
  try { const ir = await fetch(j.id, { headers: { authorization: `Bearer ${j.access_token}` } }); const id = await ir.json(); label = id.username || id.email || null; } catch {}
  creds.setCred(p.user, 'salesforce', { refresh_token: j.refresh_token, instance_url: j.instance_url, username: label });
  cache.delete(p.user);
  return { user: p.user, label };
}

export const status = (user) => { const c = creds.getCred(user, 'salesforce'); return c ? { connected: true, label: c.username || null } : { connected: false }; };
export function disconnect(user) { creds.delCred(user, 'salesforce'); cache.delete(user); }

const cache = new Map(); // user -> { token, instance, exp }
/** A working access token for this person (refreshing it when needed). Throws a "connect" error when they have not linked Salesforce. */
export async function access(user, force = false) {
  const c = creds.getCred(user, 'salesforce');
  if (!c) throw connectError('Connect your Salesforce account to continue.');
  const hit = cache.get(user);
  if (!force && hit && hit.exp > Date.now() + 60_000) return hit;
  const { ok, j } = await tokenCall({ grant_type: 'refresh_token', refresh_token: c.refresh_token });
  if (!ok) { cache.delete(user); if (j.error === 'invalid_grant') { creds.delCred(user, 'salesforce'); throw connectError('Your Salesforce connection expired or was revoked. Connect again.'); } throw new Error(`Salesforce sign-in failed (${j.error_description || j.error || 'error'}).`); }
  const rec = { token: j.access_token, instance: j.instance_url || c.instance_url, exp: Date.now() + 25 * 60_000 };
  cache.set(user, rec); return rec;
}
