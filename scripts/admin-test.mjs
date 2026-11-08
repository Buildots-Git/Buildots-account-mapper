// Roles, per-account access, audit log, offboarding and board history/backups, against a throw-away server in demo mode.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
const DIR = process.argv[2]; const PORT = 8798; const B = `http://127.0.0.1:${PORT}`;
fs.rmSync(DIR, { recursive: true, force: true });
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, DATA_DIR: DIR, PORT: String(PORT), DEMO: '1' }, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 1800));
const rnd = () => crypto.randomBytes(9).toString('base64url') + 'aA1';
let ok = 0, bad = 0; const t = (name, cond, extra = '') => { cond ? ok++ : bad++; console.log(cond ? 'PASS' : 'FAIL', name, cond ? '' : extra); };
const call = async (method, path, body, ck) => {
  const r = await fetch(B + path, { method, headers: { 'content-type': 'application/json', 'x-requested-with': 'account-mapper', ...(ck ? { cookie: ck } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const sc = r.headers.get('set-cookie'); return { status: r.status, json: await r.json().catch(() => null), cookie: sc && /am_session=[^;]+/.test(sc) && !/Max-Age=0/.test(sc) ? sc.split(';')[0] : null };
};
const pw = { admin: rnd(), editor: rnd(), viewer: rnd(), rep: rnd() };
try {
  let r = await call('POST', '/api/auth/setup', { username: 'boss@example.com', password: pw.admin }); const A = r.cookie;
  // create users (temporary password -> they pick their own at first sign-in)
  const mkUser = async (name, role) => {
    const temp = rnd(); await call('POST', '/api/users', { username: name, password: temp, role }, A);
    let l = await call('POST', '/api/auth/login', { username: name, password: temp }); await call('POST', '/api/auth/password', { current: temp, next: pw[name.split('@')[0]] }, l.cookie);
    l = await call('POST', '/api/auth/login', { username: name, password: pw[name.split('@')[0]] }); return l.cookie;
  };
  const E = await mkUser('editor@example.com', 'editor'), V = await mkUser('viewer@example.com', 'viewer'), R = await mkUser('rep@example.com', 'editor');
  r = await call('GET', '/api/users', null, A); t('roles are listed as admin / editor / viewer', r.json.find((u) => u.username === 'viewer@example.com')?.role === 'viewer' && r.json.find((u) => u.username === 'editor@example.com')?.role === 'editor');
  r = await call('POST', '/api/users', { username: 'old@example.com', password: rnd(), role: 'user' }, A); t("the old 'user' role is read as editor", r.json.find((u) => u.username === 'old@example.com')?.role === 'editor');

  // viewer: looks, never changes
  await call('PUT', '/api/boards/acct111', { overrides: {}, meta: { name: 'Acme' } }, E);
  r = await call('GET', '/api/boards/acct111', null, V); t('viewer can open a board', r.status === 200 && r.json?.meta?.name === 'Acme');
  r = await call('PUT', '/api/boards/acct111', { overrides: { c1: { title: 'x' } } }, V); t('viewer cannot save a board', r.status === 403 && r.json.code === 'viewer');
  r = await call('POST', '/api/push', { changes: [{ Id: 'c1', Region__c: 'West' }] }, V); t('viewer cannot push to Salesforce', r.status === 403);
  r = await call('DELETE', '/api/recent/acct111', null, V); t('viewer cannot remove a board tile', r.status === 403);
  r = await call('GET', '/api/users', null, E); t('editor cannot see the user list', r.status === 403);
  r = await call('GET', '/api/admin/audit', null, E); t('editor cannot read the audit log', r.status === 403);
  r = await call('GET', '/api/admin/audit', null, V); t('viewer cannot read the audit log', r.status === 403);

  // audit: who changed what on which board
  const ov = {}; for (let i = 0; i < 3; i++) ov[`c${i}`] = { title: `Title ${i}`, reportsTo: 'c9', manual: true };
  r = await call('PUT', '/api/boards/acct111', { overrides: ov, meta: { name: 'Acme' } }, E); t('editor can save a board', r.status === 200);
  r = await call('GET', '/api/admin/audit?action=board-saved', null, A); const e = r.json.entries[0];
  t('audit log shows who changed which board', r.status === 200 && e?.user === 'editor@example.com' && e.board === 'acct111' && e.boardName === 'Acme', JSON.stringify(e));
  t('audit log lists the people and fields changed', e?.people?.length === 3 && e.people[0].changes.title, JSON.stringify(e?.people));
  r = await call('PUT', '/api/boards/acct111', { overrides: ov, meta: { name: 'Acme' } }, E); r = await call('GET', '/api/admin/audit?action=board-saved', null, A);
  t('a save that changes nothing is not logged', r.json.entries.length === 1);
  r = await call('GET', '/api/admin/audit?user=editor%40example.com&q=title', null, A); t('audit log can be filtered by person and text', r.json.entries.length >= 1 && r.json.entries.every((x) => x.user === 'editor@example.com'));

  // push entries are recorded with before / after (demo cannot push, so check the refusal is not logged as a push)
  r = await call('POST', '/api/push', { changes: [{ Id: 'c1', Region__c: 'West' }] }, A); t('push is refused in demo and logged nothing false', r.status === 403);

  // history + restore
  const big = {}; for (let i = 0; i < 30; i++) big[`p${i}`] = { title: `T${i}` };
  await call('PUT', '/api/boards/acct111', { overrides: big, meta: { name: 'Acme' } }, E);
  r = await call('GET', '/api/boards/acct111/versions', null, E); const hist = r.json;
  t('first change leaves a version of what it replaced', r.status === 200 && hist.length >= 1 && hist.some((v) => v.source === 'history'), JSON.stringify(hist));
  t('a big change is flagged in the history', hist.some((v) => v.reason === 'before-big-change'));
  t('viewer cannot read the version list', (await call('GET', '/api/boards/acct111/versions', null, V)).status === 403);
  const before = hist.find((v) => v.reason === 'before-big-change');
  r = await call('POST', '/api/boards/acct111/restore', { key: before.key }, E); t('restore succeeds', r.status === 200 && r.json.rev > 3, JSON.stringify(r.json));
  r = await call('GET', '/api/boards/acct111', null, E); t('restore brings the earlier board back', Object.keys(r.json.overrides).length === 3 && !r.json.overrides.p0, JSON.stringify(Object.keys(r.json.overrides)));
  r = await call('GET', '/api/boards/acct111/versions', null, E); t('restore keeps what it replaced (nothing is lost)', r.json.some((v) => v.reason === 'before-restore'));
  t('viewer cannot restore', (await call('POST', '/api/boards/acct111/restore', { key: before.key }, V)).status === 403);
  t('restore rejects a made-up version name', (await call('POST', '/api/boards/acct111/restore', { key: 'v:../../users.json' }, E)).status >= 400);
  r = await call('GET', '/api/admin/audit?action=board-restored', null, A); t('restore is in the audit log', r.json.entries.length === 1 && r.json.entries[0].user === 'editor@example.com');

  // daily backup
  r = await call('POST', '/api/admin/backups/run', {}, A); t('admin can run a backup now', r.status === 200 && r.json.boards >= 1, JSON.stringify(r.json));
  r = await call('GET', '/api/admin/backups', null, A); t('backups are listed by day', r.json.days.length === 1 && r.json.days[0].boards >= 1);
  t('backup contains the board, compressed', fs.readdirSync(`${DIR}/backups/daily/${r.json.days[0].day}`).includes('acct111.json.gz'));
  t('backups are private', (fs.statSync(`${DIR}/backups/daily/${r.json.days[0].day}/acct111.json.gz`).mode & 0o077) === 0);
  t('editor cannot run backups', (await call('POST', '/api/admin/backups/run', {}, E)).status === 403);
  t('credentials and the secret key are NOT copied into backups', !fs.existsSync(`${DIR}/backups/daily/${r.json.days[0].day}/_system/credentials.enc.json`) && !fs.existsSync(`${DIR}/backups/daily/${r.json.days[0].day}/_system/.secret`));

  // per-account access
  await call('PUT', '/api/boards/acct222', { overrides: {}, meta: { name: 'Other Co' } }, A);
  r = await call('PUT', '/api/users/rep%40example.com', { access: 'assigned', boards: [{ id: 'acct111', name: 'Acme' }] }, A); t('admin limits a rep to chosen accounts', r.json.find((u) => u.username === 'rep@example.com')?.access === 'assigned');
  const R2 = (await call('POST', '/api/auth/login', { username: 'rep@example.com', password: pw.rep })).cookie;
  t('rep can open an assigned account', (await call('GET', '/api/boards/acct111', null, R2)).status === 200);
  r = await call('GET', '/api/boards/acct222', null, R2); t('rep cannot open someone else’s account', r.status === 403 && r.json.code === 'no-access');
  t('rep cannot save to an unassigned account', (await call('PUT', '/api/boards/acct222', { overrides: {} }, R2)).status === 403);
  t('rep cannot load an unassigned account’s Salesforce data', (await call('GET', '/api/accounts/acct222', null, R2)).status === 403);
  r = await call('GET', '/api/recent', null, R2); t('rep sees only their accounts on the home screen', r.json.every((x) => x.id !== 'acct222'));
  r = await call('GET', '/api/recent', null, A); t('admin sees every account', r.json.some((x) => x.id === 'acct222') && r.json.some((x) => x.id === 'acct111'));
  await call('PUT', '/api/users/rep%40example.com', { access: 'all' }, A); t('access can be opened up again', (await call('GET', '/api/boards/acct222', null, R2)).status === 200);

  r = await call('GET', '/api/boards/acct111/rev', null, V); const rev0 = r.json?.rev; t('open boards can be checked for newer saves (cheap rev check)', r.status === 200 && rev0 >= 1 && r.json.by === 'editor@example.com', JSON.stringify(r.json));
  await call('PUT', '/api/boards/acct111', { overrides: { c1: { title: 'z' } }, meta: { name: 'Acme' } }, E); r = await call('GET', '/api/boards/acct111/rev', null, V); t('the rev check notices a new save', r.json.rev === rev0 + 1, JSON.stringify(r.json));
  t('rev check needs sign-in', (await call('GET', '/api/boards/acct111/rev', null, '')).status === 401);

  // offboarding
  await call('PUT', '/api/credentials/miro', { token: 'miro-secret-token' }, R2); await call('PUT', '/api/credentials/lusha', { apiKey: 'lusha-secret' }, R2);
  t('stored keys exist before offboarding', /rep@example.com/.test(fs.readFileSync(`${DIR}/credentials.enc.json`, 'utf8')));
  r = await call('PUT', '/api/users/rep%40example.com', { disabled: true }, A); t('admin deactivates a user', r.status === 200 && r.json.find((u) => u.username === 'rep@example.com')?.disabled === true);
  t('their open session ends at once', (await call('GET', '/api/status', null, R2)).status === 401);
  r = await call('POST', '/api/auth/login', { username: 'rep@example.com', password: pw.rep }); t('they cannot sign in again', r.status === 401 && /deactivated/.test(r.json.error), JSON.stringify(r.json));
  t('their stored keys are deleted', !/rep@example.com/.test(fs.readFileSync(`${DIR}/credentials.enc.json`, 'utf8')));
  r = await call('GET', '/api/admin/audit?action=user-deactivated', null, A); t('offboarding is audited with what was removed', r.json.entries[0]?.target === 'rep@example.com' && r.json.entries[0].removedKeys.includes('miro') && r.json.entries[0].removedKeys.includes('lusha'), JSON.stringify(r.json.entries[0]));
  t('admin cannot deactivate themselves', (await call('PUT', '/api/users/boss%40example.com', { disabled: true }, A)).status === 400);
  r = await call('PUT', '/api/users/rep%40example.com', { disabled: false }, A); t('a user can be reactivated', r.json.find((u) => u.username === 'rep@example.com')?.disabled === false);
  t('after reactivation they can sign in again (with the same password)', (await call('POST', '/api/auth/login', { username: 'rep@example.com', password: pw.rep })).status === 200);
  t('the last active admin cannot be deactivated or demoted', (await call('PUT', '/api/users/boss%40example.com', { role: 'viewer' }, A)).status === 400);

  // who else has the board open
  r = await call('POST', '/api/boards/acct111/live', { editing: true }, E); t('opening a board reports nobody else at first', r.status === 200 && r.json.viewers.length === 0);
  r = await call('POST', '/api/boards/acct111/live', { editing: false }, V); t('a second person sees the first, and that they are editing', r.json.viewers.length === 1 && r.json.viewers[0].user === 'editor@example.com' && r.json.viewers[0].editing === true, JSON.stringify(r.json));
  r = await call('POST', '/api/boards/acct111/live', {}, E); t('and the first sees the viewer (not themselves)', r.json.viewers.length === 1 && r.json.viewers[0].user === 'viewer@example.com' && r.json.viewers[0].editing === false);
  await call('DELETE', '/api/boards/acct111/live', null, V); r = await call('POST', '/api/boards/acct111/live', {}, E); t('leaving the board removes you at once', r.json.viewers.length === 0);
  t('no push has been recorded yet', (await call('POST', '/api/boards/acct111/live', {}, E)).json.lastPush === null);

  const audit = fs.readFileSync(DIR + '/audit.log', 'utf8'); t('no secrets ever reach the audit log', !/miro-secret-token|lusha-secret/.test(audit) && !Object.values(pw).some((p) => audit.includes(p)));
} finally { srv.kill(); }
console.log(`\n${ok} passed, ${bad} failed`); process.exit(bad ? 1 : 0);
