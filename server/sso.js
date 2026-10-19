// Okta (any OIDC provider) single sign-on: authorization-code flow with PKCE.
// Off until OKTA_ISSUER, OKTA_CLIENT_ID and OKTA_CLIENT_SECRET are set (see .env.example).
import crypto from 'node:crypto';

const env = (k) => String(process.env[k] || '').trim();
const issuer = () => env('OKTA_ISSUER').replace(/\/$/, '');
export const ssoEnabled = () => !!(issuer() && env('OKTA_CLIENT_ID') && env('OKTA_CLIENT_SECRET'));
export const ssoLabel = () => env('SSO_LABEL') || 'Okta';
export const passwordLoginOff = () => env('SSO_ONLY') === '1'; // admins can always still use their password
const allowedDomains = () => (env('SSO_ALLOWED_DOMAINS') || 'buildots.com').toLowerCase().split(',').map((d) => d.trim().replace(/^@/, '')).filter(Boolean);

const b64 = (b) => Buffer.from(b).toString('base64url');
const pending = new Map(); // state -> { verifier, nonce, at }
const prune = () => { const now = Date.now(); for (const [k, v] of pending) if (now - v.at > 10 * 60_000) pending.delete(k); };

let meta = null, metaAt = 0;
async function discovery() {
  if (meta && Date.now() - metaAt < 3600_000) return meta;
  const r = await fetch(`${issuer()}/.well-known/openid-configuration`);
  if (!r.ok) throw new Error(`Could not read the Okta configuration (${r.status}). Check OKTA_ISSUER.`);
  meta = await r.json(); metaAt = Date.now(); return meta;
}

/** The address Okta sends people back to. Set PUBLIC_URL to the fixed address you registered in Okta. */
export function redirectUri(req) {
  const base = env('PUBLIC_URL').replace(/\/$/, '') || `${(req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0]}://${req.headers['x-forwarded-host'] || req.headers.host}`;
  return `${base}/api/auth/okta/callback`;
}

export async function startLogin(req) {
  const m = await discovery(); prune();
  const state = b64(crypto.randomBytes(24)), nonce = b64(crypto.randomBytes(24)), verifier = b64(crypto.randomBytes(48));
  pending.set(state, { verifier, nonce, at: Date.now() });
  const q = new URLSearchParams({ client_id: env('OKTA_CLIENT_ID'), response_type: 'code', scope: 'openid email profile', redirect_uri: redirectUri(req), state, nonce,
    code_challenge: b64(crypto.createHash('sha256').update(verifier).digest()), code_challenge_method: 'S256' });
  return `${m.authorization_endpoint}?${q}`;
}

const fail = (code, msg) => Object.assign(new Error(msg), { ssoCode: code });

/** Finishes the sign-in: returns the verified { email, name } or throws an error carrying a short code. */
export async function finishLogin(req) {
  const { code, state, error } = req.query;
  if (error) throw fail('denied', `Okta said: ${error}`);
  const p = pending.get(String(state)); pending.delete(String(state));
  if (!p || Date.now() - p.at > 10 * 60_000) throw fail('expired', 'The sign-in took too long or was already used. Try again.');
  const m = await discovery();
  const tr = await fetch(m.token_endpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code: String(code), redirect_uri: redirectUri(req), client_id: env('OKTA_CLIENT_ID'), client_secret: env('OKTA_CLIENT_SECRET'), code_verifier: p.verifier }) });
  const tok = await tr.json().catch(() => ({}));
  if (!tr.ok || !tok.id_token) throw fail('token', `Okta did not accept the sign-in (${tok.error_description || tr.status}).`);
  // The id_token came straight from Okta over TLS, so its claims are checked (not re-signed); identity is then confirmed with userinfo.
  const claims = JSON.parse(Buffer.from(tok.id_token.split('.')[1], 'base64url').toString());
  if (claims.iss?.replace(/\/$/, '') !== (m.issuer || issuer()).replace(/\/$/, '') || ![].concat(claims.aud).includes(env('OKTA_CLIENT_ID')) || claims.nonce !== p.nonce || claims.exp * 1000 < Date.now()) throw fail('token', 'The sign-in response did not check out.');
  const ur = await fetch(m.userinfo_endpoint, { headers: { authorization: `Bearer ${tok.access_token}` } });
  const info = await ur.json().catch(() => ({}));
  if (!ur.ok || info.sub !== claims.sub) throw fail('token', 'Could not confirm who signed in.');
  const email = String(info.email || claims.email || '').toLowerCase();
  if (!email || info.email_verified === false) throw fail('email', 'Okta did not return a verified email address.');
  if (!allowedDomains().includes(email.split('@')[1])) throw fail('domain', `Only ${allowedDomains().map((d) => `@${d}`).join(', ')} accounts can sign in.`);
  return { email, name: info.name || claims.name || email };
}
