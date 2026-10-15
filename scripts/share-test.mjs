// Checks for running one copy for several people: edit conflicts and per-visitor lockout behind a tunnel.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
const DIR = process.argv[2]; const PORT = 8797; const B = `http://127.0.0.1:${PORT}`;
fs.rmSync(DIR, { recursive: true, force: true });
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, DATA_DIR: DIR, PORT: String(PORT), DEMO: '1' }, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 1800));
const rnd = () => crypto.randomBytes(9).toString('base64url') + 'aA1';
let ok = 0, bad = 0; const t = (n, c, x = '') => { c ? ok++ : bad++; console.log(c ? 'PASS' : 'FAIL', n, c ? '' : x); };
const call = async (method, path, body, { ck = '', extra = {} } = {}) => {
  const r = await fetch(B + path, { method, headers: { 'content-type': 'application/json', 'x-requested-with': 'account-mapper', ...(ck ? { cookie: ck } : {}), ...extra }, body: body ? JSON.stringify(body) : undefined });
  const sc = r.headers.get('set-cookie'); return { status: r.status, json: await r.json().catch(() => null), ck: sc && !/Max-Age=0/.test(sc) ? sc.split(';')[0] : null };
};
try {
  const apw = rnd(), upw = rnd();
  let r = await call('POST', '/api/auth/setup', { username: 'admin.t@example.com', password: apw }); const adminCk = r.ck;
  await call('POST', '/api/users', { username: 'rep.t', password: upw }, { ck: adminCk });
  r = await call('POST', '/api/auth/login', { username: 'rep.t', password: upw }); const rpw2 = rnd();
  const tmp = r.ck; await call('POST', '/api/auth/password', { current: upw, next: rpw2 }, { ck: tmp });
  r = await call('POST', '/api/auth/login', { username: 'rep.t', password: rpw2 }); const repCk = r.ck;

  // edit conflicts
  r = await call('GET', '/api/boards/acct1', null, { ck: adminCk }); t('new board has no revision yet', r.json === null);
  r = await call('PUT', '/api/boards/acct1', { baseRev: 0, items: ['a'] }, { ck: adminCk }); t('first save accepted, revision 1', r.status === 200 && r.json.rev === 1);
  r = await call('PUT', '/api/boards/acct1', { baseRev: 0, items: ['stale'] }, { ck: repCk }); t('a save based on an old revision is refused (409)', r.status === 409 && r.json.code === 'conflict' && r.json.by === 'admin.t@example.com' && r.json.rev === 1, JSON.stringify(r.json));
  r = await call('GET', '/api/boards/acct1', null, { ck: repCk }); t('their refused save did not overwrite anything', JSON.stringify(r.json.items) === '["a"]' && r.json._rev === 1);
  r = await call('PUT', '/api/boards/acct1', { baseRev: 1, items: ['b'] }, { ck: repCk }); t('a save based on the latest revision is accepted', r.status === 200 && r.json.rev === 2);
  r = await call('PUT', '/api/boards/acct1', { baseRev: 1, items: ['mine'], force: true }, { ck: adminCk }); t('"keep mine" (force) overwrites and moves the revision on', r.status === 200 && r.json.rev === 3);
  r = await call('GET', '/api/boards/acct1', null, { ck: adminCk }); t('board records who saved last', r.json._by === 'admin.t@example.com' && r.json._rev === 3);

  // lockout is per visitor behind a tunnel (the tunnel connects from 127.0.0.1 and forwards the real address)
  const as = (ip) => ({ extra: { 'x-forwarded-for': ip } });
  let last; for (let i = 0; i < 5; i++) last = await call('POST', '/api/auth/login', { username: 'rep.t', password: 'wrong-wrong-' + i }, as('203.0.113.7'));
  r = await call('POST', '/api/auth/login', { username: 'rep.t', password: rpw2 }, as('203.0.113.7')); t('the visitor who guessed wrongly is locked out', r.status === 429);
  r = await call('POST', '/api/auth/login', { username: 'rep.t', password: rpw2 }, as('198.51.100.9')); t('a different visitor can still sign in as that user', r.status === 200);
  r = await call('POST', '/api/auth/login', { username: 'rep.t', password: rpw2 }, { extra: { 'x-forwarded-for': '203.0.113.7' } }); t('lock persists for that visitor', r.status === 429);
  const audit = fs.readFileSync(DIR + '/audit.log', 'utf8'); t('audit log records the visitor address, not the tunnel', /203\.0\.113\.7/.test(audit));
} finally { srv.kill(); }
console.log(`\n${ok} passed, ${bad} failed`); process.exit(bad ? 1 : 0);
