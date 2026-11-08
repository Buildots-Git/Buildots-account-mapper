// Okta/OIDC sign-in checks against a fake identity provider (no real Okta needed).
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
const DIR = process.argv[2]; const PORT = 8796, IDP = 8795; const B = `http://127.0.0.1:${PORT}`; const ISS = `http://127.0.0.1:${IDP}`;
fs.rmSync(DIR, { recursive: true, force: true });
let ok = 0, bad = 0; const t = (n, c, x = '') => { c ? ok++ : bad++; console.log(c ? 'PASS' : 'FAIL', n, c ? '' : x); };
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

// --- fake identity provider ---
let nextEmail = 'new.person@buildots.com'; const codes = new Map();
const idp = http.createServer((req, res) => {
  const u = new URL(req.url, ISS); const json = (o, s = 200) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
  if (u.pathname === '/.well-known/openid-configuration') return json({ issuer: ISS, authorization_endpoint: `${ISS}/authorize`, token_endpoint: `${ISS}/token`, userinfo_endpoint: `${ISS}/userinfo` });
  if (u.pathname === '/authorize') { const code = crypto.randomBytes(8).toString('hex'); codes.set(code, { nonce: u.searchParams.get('nonce'), email: nextEmail, challenge: u.searchParams.get('code_challenge') });
    res.writeHead(302, { location: `${u.searchParams.get('redirect_uri')}?code=${code}&state=${u.searchParams.get('state')}` }); return res.end(); }
  if (u.pathname === '/token') { let b = ''; req.on('data', (d) => (b += d)); req.on('end', () => { const p = new URLSearchParams(b); const c = codes.get(p.get('code'));
    const verifierOk = c && crypto.createHash('sha256').update(p.get('code_verifier') || '').digest('base64url') === c.challenge;
    if (!c || !verifierOk || p.get('client_secret') !== 'sekret') return json({ error: 'invalid_grant' }, 400);
    codes.delete(p.get('code')); json({ access_token: `at-${c.email}`, id_token: `x.${b64({ iss: ISS, aud: 'cid', sub: c.email, nonce: c.nonce, exp: Math.floor(Date.now() / 1000) + 300 })}.y` }); }); return; }
  if (u.pathname === '/userinfo') { const e = String(req.headers.authorization).replace('Bearer at-', ''); return json({ sub: e, email: e, email_verified: true, name: 'Test Person' }); }
  json({}, 404);
});
await new Promise((r) => idp.listen(IDP, '127.0.0.1', r));
const start = async (extra) => { const s = spawn('node', ['server/index.js'], { env: { ...process.env, DATA_DIR: DIR, PORT: String(PORT), DEMO: '1', ...extra }, stdio: 'ignore' }); await new Promise((r) => setTimeout(r, 1800)); return s; };
const call = async (method, path, body, ck = '') => { const r = await fetch(B + path, { method, redirect: 'manual', headers: { 'content-type': 'application/json', 'x-requested-with': 'account-mapper', ...(ck ? { cookie: ck } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const sc = r.headers.get('set-cookie'); return { status: r.status, loc: r.headers.get('location'), json: await r.json().catch(() => null), ck: sc && !/Max-Age=0/.test(sc) ? sc.split(';')[0] : null }; };
// walk the whole browser flow: our login -> idp authorize -> our callback
const signInFlow = async () => { let r = await call('GET', '/api/auth/okta/login'); if (!r.loc?.startsWith(ISS)) return { r };
  const a = await fetch(r.loc, { redirect: 'manual' }); const back = new URL(a.headers.get('location')); return { r: await call('GET', back.pathname + back.search), back }; };
let srv = await start({});
try {
  let r = await call('GET', '/api/auth/state'); t('SSO is off by default', r.json.sso === null);
  r = await call('GET', '/api/auth/okta/login'); t('login route does nothing when SSO is off', r.status === 302 && /sso_error=off/.test(r.loc));
  const apw = crypto.randomBytes(9).toString('base64url') + 'aA1';
  r = await call('POST', '/api/auth/setup', { username: 'admin.t@buildots.com', password: apw });
  srv.kill(); await new Promise((r) => setTimeout(r, 400));

  srv = await start({ OKTA_ISSUER: ISS, OKTA_CLIENT_ID: 'cid', OKTA_CLIENT_SECRET: 'sekret', PUBLIC_URL: B, SSO_ALLOWED_DOMAINS: 'buildots.com' });
  r = await call('GET', '/api/auth/state'); t('SSO shows up as available', r.json.sso?.label === 'Okta' && r.json.sso.passwordLogin === true);
  let f = await signInFlow(); t('first sign-in creates the user and signs them in', f.r.status === 302 && f.r.loc === '/' && !!f.r.ck, JSON.stringify(f.r));
  const ck = f.r.ck; r = await call('GET', '/api/auth/state', null, ck); t('session belongs to the Okta email, as a regular user', r.json.user?.username === 'new.person@buildots.com' && r.json.user.role === 'editor');
  r = await call('GET', '/api/users', null, ck); t('SSO user cannot manage users', r.status === 403);
  r = await call('POST', '/api/auth/login', { username: 'new.person@buildots.com', password: 'anything-at-all-1A' }); t('SSO-created users have no usable password', r.status === 401);
  f = await signInFlow(); r = await call('GET', '/api/auth/state', null, f.r.ck); t('signing in again reuses the same user', r.json.user?.username === 'new.person@buildots.com');
  nextEmail = 'admin.t@buildots.com'; f = await signInFlow(); r = await call('GET', '/api/auth/state', null, f.r.ck); t('an existing admin signs in with their own role', r.json.user?.role === 'admin');
  nextEmail = 'outsider@gmail.com'; f = await signInFlow(); t('other email domains are refused', f.r.status === 302 && /sso_error=domain/.test(f.r.loc) && !f.r.ck, JSON.stringify(f.r));
  nextEmail = 'new.person@buildots.com';
  const first = await call('GET', '/api/auth/okta/login'); const a = await fetch(first.loc, { redirect: 'manual' }); const back = new URL(a.headers.get('location'));
  await call('GET', back.pathname + back.search); r = await call('GET', back.pathname + back.search); t('a sign-in link cannot be replayed', /sso_error=expired/.test(r.loc) && !r.ck, JSON.stringify(r));
  r = await call('GET', '/api/auth/okta/callback?code=zzz&state=forged'); t('a forged state is refused', /sso_error=expired/.test(r.loc) && !r.ck);
  srv.kill(); await new Promise((r) => setTimeout(r, 400));

  srv = await start({ OKTA_ISSUER: ISS, OKTA_CLIENT_ID: 'cid', OKTA_CLIENT_SECRET: 'sekret', PUBLIC_URL: B, SSO_ONLY: '1' });
  r = await call('POST', '/api/auth/login', { username: 'admin.t@buildots.com', password: apw }); t('admins can still use their password when SSO_ONLY is on', r.status === 200);
  r = await call('GET', '/api/auth/state'); t('state tells the page that password sign-in is off', r.json.sso.passwordLogin === false);
} finally { srv.kill(); idp.close(); }
console.log(`\n${ok} passed, ${bad} failed`); process.exit(bad ? 1 : 0);
