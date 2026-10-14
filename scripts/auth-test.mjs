import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
const DIR = process.argv[2]; const PORT = 8799; const B = `http://127.0.0.1:${PORT}`;
fs.rmSync(DIR, { recursive: true, force: true });
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, DATA_DIR: DIR, PORT: String(PORT), DEMO: '1' }, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 1800));
const rnd = () => crypto.randomBytes(9).toString('base64url') + 'aA1';
const adminPw = rnd(), userPw = rnd(), newPw = rnd();
let ok = 0, bad = 0; const t = (name, cond, extra = '') => { cond ? ok++ : bad++; console.log(cond ? 'PASS' : 'FAIL', name, cond ? '' : extra); };
let cookie = '';
const call = async (method, path, body, { csrf = true, ck = cookie } = {}) => {
  const r = await fetch(B + path, { method, headers: { 'content-type': 'application/json', ...(csrf ? { 'x-requested-with': 'account-mapper' } : {}), ...(ck ? { cookie: ck } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const sc = r.headers.get('set-cookie'); if (sc && /am_session=[^;]+/.test(sc) && !/Max-Age=0/.test(sc)) cookie = sc.split(';')[0];
  return { status: r.status, json: await r.json().catch(() => null), setCookie: sc };
};
try {
  let r = await call('GET', '/api/auth/state'); t('first run: setup needed, nobody signed in', r.json.setupNeeded === true && r.json.user === null);
  r = await call('GET', '/api/status'); t('protected endpoint refuses anonymous', r.status === 401);
  r = await call('GET', '/api/boards/x'); t('boards refuse anonymous', r.status === 401);
  r = await call('POST', '/api/auth/setup', { username: 'admin.test@example.com', password: 'short' }); t('weak password rejected', r.status === 400, JSON.stringify(r.json));
  r = await call('POST', '/api/auth/setup', { username: 'admin.test@example.com', password: 'aaaaaaaaaaaa' }); t('repeated-character password rejected', r.status === 400);
  r = await call('POST', '/api/auth/setup', { username: 'admin.test@example.com', password: adminPw }, { csrf: false }); t('setup without CSRF header blocked', r.status === 403);
  r = await call('POST', '/api/auth/setup', { username: 'admin.test@example.com', password: adminPw }); t('first admin created', r.status === 200 && r.json.user.role === 'admin');
  t('cookie is HttpOnly + SameSite=Strict', /HttpOnly/.test(r.setCookie) && /SameSite=Strict/.test(r.setCookie));
  r = await call('POST', '/api/auth/setup', { username: 'second@example.com', password: rnd() }); t('setup cannot be repeated', r.status === 403);
  r = await call('GET', '/api/status'); t('signed-in request works', r.status === 200 && r.json.me === 'admin.test@example.com' && r.json.admin === true, JSON.stringify(r.json));
  r = await call('POST', '/api/access', {}); // wrong verb, just probing csrf below
  r = await call('PUT', '/api/boards/zz', { a: 1 }, { csrf: false }); t('state-changing request without header blocked', r.status === 403);
  r = await call('PUT', '/api/boards/zz', { a: 1 }); t('state-changing request with header ok', r.status === 200);

  // users
  r = await call('POST', '/api/users', { username: 'rep.test', password: userPw, role: 'user' }); t('admin creates a user', r.status === 200 && r.json.some((u) => u.username === 'rep.test'));
  r = await call('POST', '/api/users', { username: 'rep.test', password: rnd() }); t('duplicate username refused', r.status === 400);
  const adminCookie = cookie;
  // that user signs in: must change the temporary password
  cookie = ''; r = await call('POST', '/api/auth/login', { username: 'REP.test', password: userPw }); t('login is case-insensitive on username', r.status === 200 && r.json.user.mustChange === true);
  r = await call('GET', '/api/status'); t('temporary password blocks the app', r.status === 403 && r.json.code === 'mustChange');
  r = await call('POST', '/api/auth/password', { current: userPw, next: userPw }); t('same password refused', r.status === 400);
  r = await call('POST', '/api/auth/password', { current: 'wrong-password-123', next: newPw }); t('wrong current password refused', r.status === 403);
  r = await call('POST', '/api/auth/password', { current: userPw, next: newPw }); t('password changed', r.status === 200);
  r = await call('GET', '/api/status'); t('app unlocked after change', r.status === 200 && r.json.me === 'rep.test' && r.json.admin === false);
  r = await call('GET', '/api/users'); t('normal user cannot list users', r.status === 403);
  r = await call('PUT', '/api/boards/zz', { b: 1 }); const w = await call('POST', '/api/push', { changes: [] }); t('normal user cannot push to Salesforce', w.status === 403, JSON.stringify(w.json));
  const userCookie = cookie;

  // brute force lock
  cookie = '';
  let last; for (let i = 0; i < 5; i++) last = await call('POST', '/api/auth/login', { username: 'rep.test', password: 'definitely-wrong-' + i });
  t('wrong password gives a generic message', last.status === 401 && last.json.error === 'Incorrect username or password.');
  const unknown = await call('POST', '/api/auth/login', { username: 'nobody.here', password: 'x'.repeat(12) }); t('unknown user gives the same message', unknown.status === 401 && unknown.json.error === last.json.error);
  r = await call('POST', '/api/auth/login', { username: 'rep.test', password: newPw }); t('account locks after 5 failures (even with the right password)', r.status === 429, JSON.stringify(r.json));

  // logout invalidates the session
  r = await call('POST', '/api/auth/logout', {}, { ck: userCookie }); r = await call('GET', '/api/status', null, { ck: userCookie }); t('logout invalidates the session', r.status === 401);
  // admin removes a user
  r = await call('DELETE', '/api/users/rep.test', null, { ck: adminCookie }); t('admin removes a user', r.status === 200 && !r.json.some((u) => u.username === 'rep.test'));
  r = await call('DELETE', '/api/users/admin.test@example.com', null, { ck: adminCookie }); t('admin cannot remove own account', r.status === 400);
  r = await call('PUT', '/api/users/admin.test@example.com', { role: 'user' }, { ck: adminCookie }); t('admin cannot demote self', r.status === 400);

  // storage hygiene
  const uf = DIR + '/users.json'; const txt = fs.readFileSync(uf, 'utf8');
  t('users.json is private (0600)', (fs.statSync(uf).mode & 0o777) === 0o600);
  t('no password stored in clear', ![adminPw, userPw, newPw].some((p) => txt.includes(p)) && /scrypt\$/.test(txt));
  const sess = fs.readFileSync(DIR + '/sessions.json', 'utf8'); t('session tokens stored only as hashes', !sess.includes(adminCookie.split('=')[1]));
  const audit = fs.readFileSync(DIR + '/audit.log', 'utf8'); t('sign-ins are audited, passwords never logged', /auth-login/.test(audit) && /auth-failed/.test(audit) && ![adminPw, userPw, newPw].some((p) => audit.includes(p)));
} finally { srv.kill(); }
console.log(`\n${ok} passed, ${bad} failed`); process.exit(bad ? 1 : 0);
