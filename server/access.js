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
  const writer = admin || !!req.user?.canPush;
  const switchOn = process.env.ALLOW_WRITE === '1'; // global kill-switch
  return { email, admin, writer, canWrite: writer && switchOn, switchOn };
}

export const audit = (entry) => fs.appendFileSync(auditFile, JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n', { mode: 0o600 });
