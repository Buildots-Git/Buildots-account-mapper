import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DATA } from './paths.js';

// Per-user third-party credentials (ZoomInfo login, Lusha key, Miro token), encrypted at rest
// with a random key kept in data/.secret (mode 600). Keyed by the user's email.
const dir = DATA;
const store = path.join(dir, 'credentials.enc.json');
const keyFile = path.join(dir, '.secret');

function key() {
  fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(keyFile)) fs.writeFileSync(keyFile, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  return Buffer.from(fs.readFileSync(keyFile, 'utf8').trim(), 'hex');
}
const read = () => { try { return JSON.parse(fs.readFileSync(store, 'utf8')); } catch { return {}; } };
const write = (o) => fs.writeFileSync(store, JSON.stringify(o), { mode: 0o600 });

const enc = (obj) => {
  const iv = crypto.randomBytes(12); const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), data].map((b) => b.toString('base64')).join('.');
};
const dec = (s) => {
  const [iv, tag, data] = s.split('.').map((x) => Buffer.from(x, 'base64'));
  const d = crypto.createDecipheriv('aes-256-gcm', key(), iv); d.setAuthTag(tag);
  return JSON.parse(Buffer.concat([d.update(data), d.final()]).toString('utf8'));
};

export const getCred = (user, provider) => { try { const v = read()[user]?.[provider]; return v ? dec(v) : null; } catch { return null; } };
export function setCred(user, provider, value) { const all = read(); all[user] = { ...all[user], [provider]: enc(value) }; write(all); }
export function delCred(user, provider) { const all = read(); if (all[user]) delete all[user][provider]; write(all); }
/** Offboarding: delete every stored key for this person (ZoomInfo, Lusha, Miro, Anthropic, Salesforce link). Returns which were removed. */
export function delAll(user) { const all = read(); const had = Object.keys(all[user] || {}); delete all[user]; write(all); return had; }
// Never returns secrets - only whether a provider is connected and a non-secret label.
export function credStatus(user) {
  return Object.fromEntries(['zoominfo', 'lusha', 'miro', 'anthropic'].map((p) => {
    const v = getCred(user, p); return [p, v ? { connected: true, label: v.username || null } : { connected: false }];
  }));
}
