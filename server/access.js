import fs from 'node:fs';
import { dataPath } from './paths.js';

const file = dataPath('access.json');
const auditFile = dataPath('audit.log');
const norm = (e) => String(e || '').trim().toLowerCase();

/** Who is making this request: the signed-in user (see auth.js). */
export const currentUser = (req) => norm(req.user?.username) || 'anonymous';

// Who may push changes to Salesforce: app admins, plus any user an admin switched on under Users (user.canPush).
/** Old access.json writer list, only read once to migrate onto users. */
export function legacyWriters() { try { return JSON.parse(fs.readFileSync(file, 'utf8')).writers || []; } catch { return []; } }

export function permissions(req) {
  const email = currentUser(req);
  const admin = req.user?.role === 'admin';
  const writer = admin || (req.user?.role === 'editor' && !!req.user?.canPush); // viewers never write
  const switchOn = process.env.ALLOW_WRITE === '1'; // global kill-switch
  return { email, admin, writer, canWrite: writer && switchOn, switchOn };
}

export const audit = (entry) => fs.appendFileSync(auditFile, JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n', { mode: 0o600 });

// ---- names, so the audit log can say "Jane Smith" instead of a Salesforce id (remembered from every account the server loads) ----
const names = new Map();
export const remember = (rows = []) => { for (const r of rows) if (r?.Id && r.Name) names.set(r.Id, r.Name); };
export const nameOf = (id) => names.get(id) || null;

/** What changed between two saves of a board: per person the fields that differ, plus counts for added people, comments and notes. */
export function boardDiff(prev, next) {
  const a = prev?.overrides || {}, c = next?.overrides || {};
  const show = (k, v) => (k === 'reportsTo' && v ? nameOf(v) || v : v);
  const people = [];
  for (const id of new Set([...Object.keys(a), ...Object.keys(c)])) {
    const x = a[id] || {}, y = c[id] || {}; const changes = {};
    for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) if (k !== 'manual' && JSON.stringify(x[k] ?? null) !== JSON.stringify(y[k] ?? null)) changes[k] = [show(k, x[k] ?? null), show(k, y[k] ?? null)];
    if (Object.keys(changes).length) people.push({ id, name: nameOf(id) || (next.extras || []).find((e) => e.Id === id)?.Name || null, changes });
  }
  const count = (b) => ({ extras: (b?.extras || []).length, notes: (b?.items || []).length, comments: Object.values(b?.comments || {}).reduce((n, l) => n + (Array.isArray(l) ? l.length : 0), 0) });
  const p0 = count(prev), p1 = count(next);
  return { people, added: p1.extras - p0.extras, notes: p1.notes - p0.notes, comments: p1.comments - p0.comments };
}

/** Newest-first slice of the audit log, optionally filtered. */
export function readAudit({ limit = 200, user, action, q, before } = {}) {
  let lines = []; try { lines = fs.readFileSync(auditFile, 'utf8').split('\n'); } catch { return { entries: [], actions: [], users: [] }; }
  const all = []; for (let i = lines.length - 1; i >= 0; i--) { if (!lines[i]) continue; try { const e = JSON.parse(lines[i]); e.action ||= 'sf-push'; all.push(e); } catch { /* skip a damaged line */ } }
  const needle = String(q || '').toLowerCase();
  const entries = all.filter((e) => (!user || e.user === user) && (!action || e.action === action) && (!before || e.at < before) && (!needle || JSON.stringify(e).toLowerCase().includes(needle))).slice(0, Math.min(500, +limit || 200));
  return { entries, actions: [...new Set(all.map((e) => e.action))].sort(), users: [...new Set(all.map((e) => e.user).filter(Boolean))].sort() };
}
