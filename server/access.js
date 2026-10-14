import fs from 'node:fs';
import { dataPath } from './paths.js';

const file = dataPath('access.json');
const auditFile = dataPath('audit.log');
const norm = (e) => String(e || '').trim().toLowerCase();

/** Who is making this request: the signed-in user (see auth.js). */
export const currentUser = (req) => norm(req.user?.username) || 'anonymous';

// Who may push changes to Salesforce. App admins always may; everyone else only if listed here.
export function loadAccess() { try { const a = JSON.parse(fs.readFileSync(file, 'utf8')); return { writers: a.writers || [] }; } catch { return { writers: [] }; } }
export function saveAccess(a) {
  const clean = { writers: [...new Set((a.writers || []).map(norm).filter(Boolean))] };
  fs.writeFileSync(file, JSON.stringify(clean, null, 2), { mode: 0o600 });
  return clean;
}

export function permissions(req) {
  const email = currentUser(req); const a = loadAccess();
  const admin = req.user?.role === 'admin';
  const writer = admin || a.writers.map(norm).includes(email);
  const switchOn = process.env.ALLOW_WRITE === '1'; // global kill-switch
  return { email, admin, writer, canWrite: writer && switchOn, switchOn };
}

export const audit = (entry) => fs.appendFileSync(auditFile, JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n', { mode: 0o600 });
