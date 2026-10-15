import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { demoAccounts, demoAccountData, demoFields } from './demo.js';
import * as creds from './creds.js';
import { importBoard } from './miro.js';
import { readOrgChart } from './vision.js';
import { readChart } from './ocr.js';
import * as sf from './salesforce.js';
import { providers } from './enrich.js';
import { permissions, legacyWriters, audit, currentUser } from './access.js';
import { root, dataPath } from './paths.js';
import * as auth from './auth.js';

try { // minimal .env loader, no extra dependency
  for (const l of fs.readFileSync(path.join(root, '../.env'), 'utf8').split('\n')) {
    const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch {}

const app = express();
const wrap = (fn) => (req, res) => fn(req, res).catch((e) => res.status(e.status || 500).json({ error: e.message }));
app.disable('x-powered-by');
app.use((_req, res, next) => { // basic hardening headers
  res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('X-Frame-Options', 'DENY'); res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('Cache-Control', 'no-store');
  next();
});
app.use(express.json({ limit: '30mb' }));
app.use('/api', auth.authenticate, auth.csrfGuard);

// ---- sign-in (public) ----
const me = (u) => ({ username: u.username, role: u.role, mustChange: !!u.mustChange });
app.get('/api/auth/state', (req, res) => res.json({ setupNeeded: !auth.hasUsers(), setupCodeRequired: !auth.isLoopback(req), user: req.user ? me(req.user) : null }));

app.post('/api/auth/setup', wrap(async (req, res) => { // creates the FIRST account (an admin); only possible while no account exists
  if (auth.hasUsers()) return res.status(403).json({ error: 'Setup is already done.' });
  const { username, password, code } = req.body || {};
  if (!auth.isLoopback(req) && String(code || '').trim() !== auth.setupCode) return res.status(403).json({ error: 'Enter the setup code shown in the server terminal.' });
  const u = await auth.createUser({ username, password, role: 'admin' });
  audit({ action: 'auth-setup', user: u.username });
  auth.setCookie(req, res, auth.createSession(u.username)); res.json({ user: me(u) });
}));

app.post('/api/auth/login', wrap(async (req, res) => {
  const { username, password } = req.body || {};
  const r = await auth.checkLogin(req, username, password);
  if (r.locked) { audit({ action: 'auth-locked', user: auth.normUser(username), ip: auth.clientIp(req) }); return res.status(429).json({ error: `Too many attempts. Try again in ${Math.ceil(r.locked / 60)} minute${r.locked > 90 ? 's' : ''}.` }); }
  if (r.error) { audit({ action: 'auth-failed', user: auth.normUser(username), ip: auth.clientIp(req) }); return res.status(401).json({ error: r.error }); }
  audit({ action: 'auth-login', user: r.username });
  auth.setCookie(req, res, auth.createSession(r.username)); res.json({ user: me({ username: r.username, ...r.user }) });
}));

app.post('/api/auth/logout', (req, res) => { if (req.user) audit({ action: 'auth-logout', user: req.user.username }); auth.endSession(req.sessionToken); auth.clearCookie(res); res.json({ ok: true }); });

app.post('/api/auth/password', auth.requireUser, wrap(async (req, res) => {
  const { current, next } = req.body || {};
  const rec = auth.getUserRecord(req.user.username);
  if (!(await auth.verifyPassword(String(current || ''), rec.hash))) return res.status(403).json({ error: 'Your current password is not right.' });
  if (current === next) return res.status(400).json({ error: 'Choose a new password that is different from the current one.' });
  await auth.setPassword(req.user.username, next); auth.endUserSessions(req.user.username, req.sessionToken);
  audit({ action: 'auth-password-changed', user: req.user.username }); res.json({ ok: true });
}));

// everything below needs a signed-in user (and a changed temporary password)
app.use('/api', auth.requireUser, (req, res, next) => (req.user.mustChange ? res.status(403).json({ error: 'Set a new password first.', code: 'mustChange' }) : next()));

// ---- user management (admins) ----
app.get('/api/users', auth.requireAdmin, (_req, res) => res.json(auth.listUsers()));
app.post('/api/users', auth.requireAdmin, wrap(async (req, res) => {
  const u = await auth.createUser({ ...req.body, mustChange: true }); // the person must choose their own password at first sign-in
  audit({ action: 'user-created', user: req.user.username, target: u.username, role: u.role }); res.json(auth.listUsers());
}));
app.put('/api/users/:name', auth.requireAdmin, wrap(async (req, res) => {
  const { role, password, canPush } = req.body || {};
  if (typeof canPush === 'boolean') auth.setCanPush(req.params.name, canPush);
  if (role) { if (req.params.name === req.user.username && role !== 'admin') return res.status(400).json({ error: 'You cannot remove your own admin role.' }); auth.setRole(req.params.name, role); }
  if (password) { await auth.setPassword(req.params.name, password, { mustChange: req.params.name !== req.user.username }); auth.endUserSessions(req.params.name); }
  audit({ action: 'user-updated', user: req.user.username, target: req.params.name, role: role || undefined, canPush, passwordReset: !!password }); res.json(auth.listUsers());
}));
app.delete('/api/users/:name', auth.requireAdmin, wrap(async (req, res) => {
  if (req.params.name === req.user.username) return res.status(400).json({ error: 'You cannot remove your own account.' });
  auth.removeUser(req.params.name); audit({ action: 'user-removed', user: req.user.username, target: req.params.name }); res.json(auth.listUsers());
}));
{ const n = auth.migrateWriters(legacyWriters()); if (n) console.log(`Moved ${n} Salesforce writer(s) onto the Users list`); }
const boards = dataPath('boards');
fs.mkdirSync(boards, { recursive: true });
const boardFile = (id) => path.join(boards, `${id.replace(/[^\w-]/g, '')}.json`);
let sfOk = null; // null = unknown, true/false after the last attempt
let sfCheckedAt = 0; // a failed check is retried after 30s so a temporary CLI hiccup doesn't pin us to demo mode
const useDemo = () => process.env.DEMO === '1' || sfOk === false;

app.get('/api/status', wrap(async (req, res) => {
  if (process.env.DEMO !== '1' && (sfOk === null || (sfOk === false && Date.now() - sfCheckedAt > 30_000))) { sfCheckedAt = Date.now(); try { sf.getConn(); sfOk = true; } catch (e) { sfOk = false; console.error('Salesforce unavailable, using demo data:', (e.stderr?.toString() || e.message).slice(0, 500)); } }
  const perm = permissions(req);
  res.json({ demo: useDemo(), org: process.env.SF_ORG || 'prod', me: perm.email, admin: perm.admin, writer: perm.writer, switchOn: perm.switchOn, canWrite: perm.canWrite && !useDemo(), enrichment: creds.credStatus(perm.email) });
}));

app.get('/api/accounts', wrap(async (req, res) => {
  const q = String(req.query.q || '');
  const demo = demoAccounts.filter((a) => a.Name.toLowerCase().includes(q.toLowerCase()));
  if (useDemo()) return res.json(demo);
  res.json([...(await sf.searchAccounts(q)), ...(q ? [] : demo)]);
}));

app.get('/api/accounts/:id', wrap(async (req, res) => {
  if (req.params.id === 'demo-meridian') return res.json(demoAccountData);
  const fields = String(req.query.fields || '').split(',').filter(Boolean);
  res.json(await sf.loadAccount(req.params.id, fields));
}));

app.get('/api/contact-fields', wrap(async (_req, res) => res.json(useDemo() ? demoFields : await sf.contactFields())));

// Boards carry a revision number. A save based on an older revision means somebody else saved in between: refuse it (409)
// instead of silently overwriting their work.
const readBoard = (id) => { try { return JSON.parse(fs.readFileSync(boardFile(id), 'utf8')); } catch { return null; } };
app.get('/api/boards/:id', (req, res) => res.json(readBoard(req.params.id)));
// ---- recent boards (the homepage tiles) ----
const recentFile = dataPath('recent.json');
const readRecent = () => { try { return JSON.parse(fs.readFileSync(recentFile, 'utf8')); } catch { return {}; } };
const writeRecent = (r) => fs.writeFileSync(recentFile, JSON.stringify(r));
const sumLen = (o) => Object.values(o || {}).reduce((a, v) => a + (Array.isArray(v) ? v.length : 0), 0);

app.put('/api/boards/:id', (req, res) => {
  const id = req.params.id; const { baseRev, force, ...b } = req.body || {};
  const cur = readBoard(id); const curRev = cur?._rev || 0;
  if (!force && baseRev !== undefined && baseRev !== curRev) return res.status(409).json({ error: 'This board was changed by someone else.', code: 'conflict', rev: curRev, by: cur?._by || null, at: cur?._at || null });
  b._rev = curRev + 1; b._by = currentUser(req); b._at = new Date().toISOString();
  fs.writeFileSync(boardFile(id), JSON.stringify(b));
  if (b.meta?.name) { // keep the homepage tile's numbers in step with the board
    const r = readRecent(); const prev = r[id] || {};
    r[id] = { ...prev, id, ...b.meta, openedAt: prev.openedAt || new Date().toISOString(), updatedAt: new Date().toISOString(),
      stats: { edits: Object.keys(b.overrides || {}).length, added: (b.extras || []).length, comments: sumLen(b.comments) + (b.items || []).filter((i) => i.type === 'comment').length, notes: (b.items || []).filter((i) => i.type !== 'comment').length, reference: !!(b.reference?.dataUrl || b.reference?.embedUrl), research: !!b.accountNotes } };
    writeRecent(r);
  }
  res.json({ ok: true, rev: b._rev });
});
app.post('/api/recent/:id/open', (req, res) => {
  const r = readRecent(); const id = req.params.id;
  r[id] = { ...(r[id] || {}), id, ...req.body, openedAt: new Date().toISOString() };
  writeRecent(r); res.json({ ok: true });
});
const boardStats = (b) => ({ edits: Object.keys(b.overrides || {}).length, added: (b.extras || []).length, comments: sumLen(b.comments) + (b.items || []).filter((i) => i.type === 'comment').length, notes: (b.items || []).filter((i) => i.type !== 'comment').length, reference: !!(b.reference?.dataUrl || b.reference?.embedUrl), research: !!b.accountNotes });
// Boards saved before the homepage existed get a tile too: labelled from Salesforce, "opened" = when the file last changed.
async function backfillRecent() {
  const r = readRecent();
  const missing = fs.readdirSync(boards).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).filter((id) => !r[id] && id !== 'demo-meridian');
  if (!missing.length || useDemo()) return r;
  try {
    for (const a of await sf.accountsByIds(missing)) {
      const f = boardFile(a.Id); let b = {}; try { b = JSON.parse(fs.readFileSync(f, 'utf8')); } catch {}
      const t = fs.statSync(f).mtime.toISOString();
      r[a.Id] = { id: a.Id, name: a.Name, industry: a.Industry, country: a.BillingCountry, type: a.Type, website: a.Website || null, target: !!a.Target_Account__c, salesFocus: !!a.Sales_Focus__c, openedAt: t, updatedAt: t, stats: boardStats(b) };
    }
    writeRecent(r);
  } catch { /* Salesforce unavailable: the tiles simply appear once it is */ }
  return r;
}
app.get('/api/recent', wrap(async (_req, res) => res.json(Object.values(await backfillRecent()).sort((a, b) => String(b.openedAt).localeCompare(String(a.openedAt))).slice(0, 24))));
app.delete('/api/recent/:id', (req, res) => { const r = readRecent(); delete r[req.params.id]; writeRecent(r); res.json({ ok: true }); });

app.post('/api/enrich/:provider', wrap(async (req, res) => {
  const fn = providers[req.params.provider];
  if (!fn) return res.status(404).json({ error: 'Unknown provider' });
  const user = currentUser(req);
  res.json(await fn(req.body, { user, cred: creds.getCred(user, req.params.provider) }));
}));

// Personal credentials: stored encrypted per user, never sent back to the browser.
app.put('/api/credentials/:provider', wrap(async (req, res) => {
  if (!['zoominfo', 'lusha', 'miro', 'anthropic'].includes(req.params.provider)) return res.status(404).json({ error: 'Unknown provider' });
  const user = currentUser(req); creds.setCred(user, req.params.provider, req.body);
  res.json(creds.credStatus(user));
}));
app.delete('/api/credentials/:provider', wrap(async (req, res) => { const user = currentUser(req); creds.delCred(user, req.params.provider); res.json(creds.credStatus(user)); }));

// Read a picture of an org chart with OCR on this computer: free, no AI service, nothing leaves the machine.
app.post('/api/ocr/org-chart', wrap(async (req, res) => {
  const m = String(req.body.dataUrl || '').match(/^data:image\/[a-z+.-]+;base64,(.+)$/i);
  if (!m) return res.status(400).json({ error: 'Send the picture as a base64 data URL' });
  res.json(await readChart({ buffer: Buffer.from(m[1], 'base64') }));
}));

// Read people, offices and colours off an uploaded picture of a map (uses the signed-in user's own Anthropic key).
app.post('/api/vision/org-chart', wrap(async (req, res) => {
  const apiKey = creds.getCred(currentUser(req), 'anthropic')?.apiKey || process.env.ANTHROPIC_API_KEY;
  const { images, names, account } = req.body;
  if (!Array.isArray(images) || !images.length || images.length > 16) return res.status(400).json({ error: 'Send between 1 and 16 image tiles' });
  res.json(await readOrgChart({ images, names: names || [], account: account || 'this account', apiKey }));
}));

app.post('/api/miro/import', wrap(async (req, res) => {
  const t = creds.getCred(currentUser(req), 'miro')?.token;
  if (!t) return res.status(400).json({ error: 'Connect your Miro token first' });
  res.json(await importBoard(req.body.board, t));
}));

app.post('/api/push', wrap(async (req, res) => {
  const perm = permissions(req);
  if (useDemo()) return res.status(403).json({ error: 'Demo data cannot be pushed' });
  if (!perm.switchOn) return res.status(403).json({ error: 'Writes to Salesforce are switched off (ALLOW_WRITE=1 to enable)' });
  if (!perm.writer) return res.status(403).json({ error: 'You do not have permission to update Salesforce — your changes stay on the board' });
  const result = await sf.updateContacts(req.body.changes);
  audit({ user: perm.email, org: process.env.SF_ORG || 'prod', changes: req.body.changes, failed: result.filter((r) => !r.success).length });
  res.json(result);
}));

const dist = path.join(root, '../dist');
if (fs.existsSync(dist)) { app.use(express.static(dist)); app.use((_q, r) => r.sendFile(path.join(dist, 'index.html'))); }
const HOST = process.env.HOST || '127.0.0.1', PORT = +(process.env.PORT || 8787);
app.listen(PORT, HOST, () => {
  if (process.env.DEMO !== '1') setTimeout(() => sf.warmAccountIndex(), 1500); // account names for instant search
  console.log(`API on http://${HOST === '127.0.0.1' ? 'localhost' : HOST}:${PORT}`);
  if (!auth.hasUsers()) console.log(`No accounts yet — open the app and create the first one.${HOST !== '127.0.0.1' ? ` Setup code (needed from other machines): ${auth.setupCode}` : ''}`);
  if (HOST !== '127.0.0.1') console.log('Listening beyond this computer: put the app behind HTTPS before real use.');
});
