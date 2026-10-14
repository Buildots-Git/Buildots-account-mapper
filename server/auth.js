// Username + password sign-in for the app.
//  - passwords: scrypt with a random salt per user (never stored or logged in clear)
//  - sessions: random 256-bit token in an HttpOnly, SameSite=Strict cookie; only a SHA-256 of it is stored server-side
//  - brute force: lock a username+address for 15 minutes after 5 wrong passwords; same message for "no such user"
//  - CSRF: state-changing requests must carry a custom header, which cross-site pages cannot send
import crypto from 'node:crypto';
import fs from 'node:fs';
import { promisify } from 'node:util';
import { dataPath } from './paths.js';

const scrypt = promisify(crypto.scrypt);
const usersFile = dataPath('users.json');
const sessionsFile = dataPath('sessions.json');

const IDLE_MS = 12 * 3600_000;       // signed out after 12 hours without use
const ABSOLUTE_MS = 7 * 24 * 3600_000; // and never stay signed in longer than 7 days
const MAX_FAILS = 5, LOCK_MS = 15 * 60_000;
export const COOKIE = 'am_session';

// ---------------------------------------------------------------- storage
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const writeJson = (f, o) => { fs.writeFileSync(f, JSON.stringify(o, null, 2), { mode: 0o600 }); try { fs.chmodSync(f, 0o600); } catch {} };
const users = () => readJson(usersFile, {});
const saveUsers = (u) => writeJson(usersFile, u);
let sessions = readJson(sessionsFile, {});
const saveSessions = () => writeJson(sessionsFile, sessions);
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

export const normUser = (u) => String(u || '').trim().toLowerCase();
export const validUsername = (u) => /^[a-z0-9][a-z0-9._@+-]{2,63}$/.test(u);
export const hasUsers = () => Object.keys(users()).length > 0;
export const publicUser = (name, u) => ({ username: name, role: u.role, mustChange: !!u.mustChange, createdAt: u.createdAt, lastLoginAt: u.lastLoginAt || null });
export const listUsers = () => Object.entries(users()).map(([n, u]) => publicUser(n, u)).sort((a, b) => a.username.localeCompare(b.username));

// ---------------------------------------------------------------- passwords
export async function hashPassword(pw) {
  const salt = crypto.randomBytes(16); const N = 16384, r = 8, p = 1;
  const key = await scrypt(pw, salt, 64, { N, r, p, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${key.toString('base64')}`;
}
export async function verifyPassword(pw, stored) {
  try {
    const [, N, r, p, salt, key] = stored.split('$');
    const k = Buffer.from(key, 'base64');
    const got = await scrypt(pw, Buffer.from(salt, 'base64'), k.length, { N: +N, r: +r, p: +p, maxmem: 64 * 1024 * 1024 });
    return crypto.timingSafeEqual(got, k);
  } catch { return false; }
}
let dummy; // so a login for an unknown user costs the same time as a real one
const dummyHash = async () => (dummy ||= await hashPassword('not-a-real-password'));

const COMMON = new Set(['password', 'password1', 'password123', '1234567890', '12345678910', 'qwertyuiop', 'letmein123', 'welcome123', 'admin12345', 'iloveyou123', 'buildots123']);
export function passwordProblem(pw, username) {
  if (typeof pw !== 'string' || pw.length < 10) return 'Use at least 10 characters.';
  if (pw.length > 200) return 'That password is too long.';
  const l = pw.toLowerCase();
  if (COMMON.has(l) || /^(.)\1+$/.test(pw)) return 'That password is too easy to guess.';
  if (username && (l.includes(username.split('@')[0]) && username.split('@')[0].length >= 4)) return 'The password should not contain your username.';
  if (new Set(pw).size < 5) return 'Use a wider mix of characters.';
  return null;
}

// ---------------------------------------------------------------- sessions
export function createSession(username) {
  const token = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  sessions[sha(token)] = { username, created: now, last: now };
  pruneSessions(); saveSessions();
  return token;
}
function pruneSessions() { const now = Date.now(); for (const [k, s] of Object.entries(sessions)) if (now - s.last > IDLE_MS || now - s.created > ABSOLUTE_MS) delete sessions[k]; }
export function endSession(token) { if (token && sessions[sha(token)]) { delete sessions[sha(token)]; saveSessions(); } }
export function endUserSessions(username, exceptToken) { const keep = exceptToken ? sha(exceptToken) : null; for (const [k, s] of Object.entries(sessions)) if (s.username === username && k !== keep) delete sessions[k]; saveSessions(); }

export const parseCookies = (req) => Object.fromEntries((req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).filter((p) => p[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
const secureReq = (req) => req.secure || req.headers['x-forwarded-proto'] === 'https';
export function setCookie(req, res, token) {
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${ABSOLUTE_MS / 1000}${secureReq(req) ? '; Secure' : ''}`);
}
export const clearCookie = (res) => res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);

/** Reads the cookie and attaches req.user / req.sessionToken when the session is valid (and slides its idle timer). */
export function authenticate(req, _res, next) {
  const token = parseCookies(req)[COOKIE];
  if (token) {
    const s = sessions[sha(token)]; const now = Date.now();
    if (s && now - s.last <= IDLE_MS && now - s.created <= ABSOLUTE_MS) {
      const u = users()[s.username];
      if (u) { req.user = { username: s.username, role: u.role, mustChange: !!u.mustChange, email: s.username }; req.sessionToken = token; if (now - s.last > 60_000) { s.last = now; saveSessions(); } }
    }
  }
  next();
}
export const requireUser = (req, res, next) => (req.user ? next() : res.status(401).json({ error: 'Sign in required', code: 'auth' }));
export const requireAdmin = (req, res, next) => (req.user?.role === 'admin' ? next() : res.status(403).json({ error: 'Admins only' }));

/** Blocks cross-site form posts: every state-changing request must carry this header (a browser won't add it cross-site). */
export function csrfGuard(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.headers['x-requested-with'] === 'account-mapper') return next();
  res.status(403).json({ error: 'Blocked: missing request header' });
}

// ---------------------------------------------------------------- login attempts
const fails = new Map(); // "ip|user" -> { n, until }
const failKey = (req, u) => `${req.socket.remoteAddress}|${u}`;
export function lockedFor(req, u) { const f = fails.get(failKey(req, u)); return f && f.until > Date.now() ? Math.ceil((f.until - Date.now()) / 1000) : 0; }
function noteFail(req, u) { const k = failKey(req, u); const f = fails.get(k) || { n: 0, until: 0 }; if (f.until && f.until <= Date.now()) { f.n = 0; f.until = 0; } f.n++; if (f.n >= MAX_FAILS) f.until = Date.now() + LOCK_MS; fails.set(k, f); }

export async function checkLogin(req, usernameRaw, password) {
  const username = normUser(usernameRaw);
  const wait = lockedFor(req, username); if (wait) return { locked: wait };
  const u = users()[username];
  const ok = await verifyPassword(String(password || ''), u ? u.hash : await dummyHash());
  if (!u || !ok) { noteFail(req, username); return { error: 'Incorrect username or password.' }; }
  fails.delete(failKey(req, username));
  u.lastLoginAt = new Date().toISOString(); const all = users(); all[username] = u; saveUsers(all);
  return { username, user: u };
}

// ---------------------------------------------------------------- user management
const bad = (m) => Object.assign(new Error(m), { status: 400 });
export async function createUser({ username, password, role = 'user', mustChange = false }) {
  const name = normUser(username);
  if (!validUsername(name)) throw bad('Usernames are 3–64 characters: letters, numbers and . _ @ + -');
  const prob = passwordProblem(password, name); if (prob) throw bad(prob);
  const all = users(); if (all[name]) throw bad('That username is already taken.');
  all[name] = { hash: await hashPassword(password), role: role === 'admin' ? 'admin' : 'user', mustChange, createdAt: new Date().toISOString() };
  saveUsers(all); return publicUser(name, all[name]);
}
export async function setPassword(username, password, { mustChange = false } = {}) {
  const name = normUser(username); const prob = passwordProblem(password, name); if (prob) throw bad(prob);
  const all = users(); if (!all[name]) throw bad('No such user.');
  all[name].hash = await hashPassword(password); all[name].mustChange = mustChange; saveUsers(all);
}
export function setRole(username, role) {
  const name = normUser(username); const all = users(); if (!all[name]) throw bad('No such user.');
  if (all[name].role === 'admin' && role !== 'admin' && Object.values(all).filter((u) => u.role === 'admin').length < 2) throw bad('There must be at least one admin.');
  all[name].role = role === 'admin' ? 'admin' : 'user'; saveUsers(all);
}
export function removeUser(username) {
  const name = normUser(username); const all = users(); if (!all[name]) throw bad('No such user.');
  if (all[name].role === 'admin' && Object.values(all).filter((u) => u.role === 'admin').length < 2) throw bad('There must be at least one admin.');
  delete all[name]; saveUsers(all); endUserSessions(name);
}
export const getUserRecord = (name) => users()[normUser(name)];

// A one-time code printed in the server console, required to create the first account from another machine.
export const setupCode = crypto.randomBytes(4).toString('hex');
export const isLoopback = (req) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress) && !req.headers['x-forwarded-for'];
