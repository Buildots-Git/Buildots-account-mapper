// Board history and backups.
//  - every board save may leave a compressed copy of the PREVIOUS state (at most one per 10 minutes, and always before a big change)
//  - once a day a copy of every board (plus the user list and homepage tiles) goes into backups/daily/<date>/
//  - restoring never deletes anything: the current state is kept as a version first
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { dataPath } from './paths.js';

const root = dataPath('backups'); const KEEP_VERSIONS = 40, KEEP_DAYS = 14, EVERY_MS = 10 * 60_000, BULK = 25;
const safe = (s) => String(s || '').replace(/[^\w.@+-]/g, '_').slice(0, 60);
const bdir = (id) => path.join(root, 'boards', safe(id));
const gz = (obj) => zlib.gzipSync(Buffer.from(JSON.stringify(obj)), { level: 6 });
const un = (buf) => JSON.parse(zlib.gunzipSync(buf).toString('utf8'));
const mk = (p) => fs.mkdirSync(p, { recursive: true, mode: 0o700 });

// file name: <ms>~<rev>~<reason>~<who>.json.gz  (so a listing never has to open the files)
const parse = (f) => { const [ms, rev, reason, who] = f.replace(/\.json\.gz$/, '').split('~'); return { ms: +ms, rev: +rev || 0, reason, by: who }; };
const files = (id) => { try { return fs.readdirSync(bdir(id)).filter((f) => f.endsWith('.json.gz')).sort(); } catch { return []; } };

export function snapshot(id, board, reason, by) {
  if (!board) return null;
  const d = bdir(id); mk(d);
  const f = `${Date.now()}~${board._rev || 0}~${safe(reason)}~${safe(by || board._by || 'unknown')}.json.gz`;
  fs.writeFileSync(path.join(d, f), gz(board), { mode: 0o600 });
  for (const old of files(id).slice(0, -KEEP_VERSIONS)) fs.rmSync(path.join(d, old), { force: true });
  return f;
}

/** Called just before a save replaces `prev`. `changed` = how many people the save touches. */
export function beforeSave(id, prev, changed, by) {
  if (!prev) return;
  const last = files(id).at(-1); const age = last ? Date.now() - parse(last).ms : Infinity;
  if (changed >= BULK) snapshot(id, prev, 'before-big-change', by);
  else if (age > EVERY_MS) snapshot(id, prev, 'auto', by);
}

export function listVersions(id) {
  const out = files(id).map((f) => { const m = parse(f); return { key: `v:${f}`, at: new Date(m.ms).toISOString(), rev: m.rev, by: m.by, reason: m.reason, source: 'history', size: fs.statSync(path.join(bdir(id), f)).size }; });
  try {
    for (const day of fs.readdirSync(path.join(root, 'daily')).sort()) {
      const f = path.join(root, 'daily', day, `${safe(id)}.json.gz`);
      if (fs.existsSync(f)) out.push({ key: `d:${day}`, at: `${day}T00:00:00.000Z`, rev: null, by: 'daily backup', reason: 'daily', source: 'daily', size: fs.statSync(f).size });
    }
  } catch { /* no daily backups yet */ }
  return out.sort((a, b) => b.at.localeCompare(a.at));
}

export function loadVersion(id, key) {
  const [kind, ref] = String(key).split(/:(.*)/s);
  if (kind === 'v' && /^[\w.@+~-]+\.json\.gz$/.test(ref)) return un(fs.readFileSync(path.join(bdir(id), ref)));
  if (kind === 'd' && /^\d{4}-\d{2}-\d{2}$/.test(ref)) return un(fs.readFileSync(path.join(root, 'daily', ref, `${safe(id)}.json.gz`)));
  throw Object.assign(new Error('Unknown version'), { status: 404 });
}

const today = () => new Date().toISOString().slice(0, 10);
/** Copies every board into today's folder (skips boards already copied today unless force). */
export function dailyBackup(boardsDir, { force = false } = {}) {
  const day = path.join(root, 'daily', today()); mk(day); let n = 0;
  for (const f of fs.readdirSync(boardsDir).filter((x) => x.endsWith('.json'))) {
    const out = path.join(day, `${safe(f.slice(0, -5))}.json.gz`);
    if (!force && fs.existsSync(out)) continue;
    try { fs.writeFileSync(out, zlib.gzipSync(fs.readFileSync(path.join(boardsDir, f))), { mode: 0o600 }); n++; } catch { /* unreadable board: skipped, next run retries */ }
  }
  const sys = path.join(day, '_system'); mk(sys);
  for (const f of ['users.json', 'prefs.json', 'recent.json']) { const src = dataPath(f); if (fs.existsSync(src)) fs.copyFileSync(src, path.join(sys, f)); try { fs.chmodSync(path.join(sys, f), 0o600); } catch {} }
  for (const d of fs.readdirSync(path.join(root, 'daily')).sort().slice(0, -KEEP_DAYS)) fs.rmSync(path.join(root, 'daily', d), { recursive: true, force: true });
  return { day: today(), boards: n };
}
export function backupStatus() {
  const dir = path.join(root, 'daily'); let days = [];
  try { days = fs.readdirSync(dir).sort().reverse().map((d) => { const fs_ = fs.readdirSync(path.join(dir, d)).filter((f) => f.endsWith('.json.gz')); return { day: d, boards: fs_.length, bytes: fs_.reduce((a, f) => a + fs.statSync(path.join(dir, d, f)).size, 0) }; }); } catch { /* none yet */ }
  return { days, keepDays: KEEP_DAYS, keepVersions: KEEP_VERSIONS };
}
