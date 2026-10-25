// Per-user Salesforce login checks against a fake Salesforce (no real org needed).
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
const DIR = process.argv[2]; const PORT = 8794, SFP = 8793; const B = `http://127.0.0.1:${PORT}`; const SF = `http://127.0.0.1:${SFP}`;
fs.rmSync(DIR, { recursive: true, force: true });
let ok = 0, bad = 0; const t = (n, c, x = '') => { c ? ok++ : bad++; console.log(c ? 'PASS' : 'FAIL', n, c ? '' : x); };

// --- fake Salesforce: each person sees different accounts; only "editor" may write ---
const codes = new Map(), refresh = new Map(); let revoked = new Set(); const log = [];
const sees = { 'alice@sf': [{ Id: '001A', Name: 'Acme Builders' }], 'bob@sf': [{ Id: '001B', Name: 'Bobs Concrete' }] };
let nextSfUser = 'alice@sf';
const fake = http.createServer((req, res) => {
  const u = new URL(req.url, SF); const json = (o, s = 200) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
  let b = ''; req.on('data', (d) => (b += d)); req.on('end', () => {
    if (u.pathname === '/services/oauth2/authorize') { const code = crypto.randomBytes(8).toString('hex'); codes.set(code, { sf: nextSfUser, challenge: u.searchParams.get('code_challenge') });
      res.writeHead(302, { location: `${u.searchParams.get('redirect_uri')}?code=${code}&state=${u.searchParams.get('state')}` }); return res.end(); }
    if (u.pathname === '/services/oauth2/token') { const p = new URLSearchParams(b);
      if (p.get('grant_type') === 'authorization_code') { const c = codes.get(p.get('code')); const v = c && crypto.createHash('sha256').update(p.get('code_verifier') || '').digest('base64url') === c.challenge;
        if (!c || !v) return json({ error: 'invalid_grant', error_description: 'bad code' }, 400); codes.delete(p.get('code'));
        const rt = `rt-${c.sf}-${crypto.randomBytes(4).toString('hex')}`; refresh.set(rt, c.sf);
        return json({ access_token: `at-${c.sf}-1`, refresh_token: rt, instance_url: SF, id: `${SF}/id/${c.sf}` }); }
      const sfu = refresh.get(p.get('refresh_token')); if (!sfu || revoked.has(sfu)) return json({ error: 'invalid_grant', error_description: 'expired access/refresh token' }, 400);
      return json({ access_token: `at-${sfu}-${crypto.randomBytes(3).toString('hex')}`, instance_url: SF }); }
    if (u.pathname.startsWith('/id/')) return json({ username: u.pathname.slice(4) });
    const tok = String(req.headers.authorization || '').replace('Bearer ', ''); const sfu = tok.split('-')[1];
    if (!tok.startsWith('at-')) return json([{ message: 'bad token' }], 401);
    log.push([req.method, u.pathname, sfu]);
    if (u.pathname.endsWith('/query')) return json({ records: (sees[sfu] || []).map((r) => ({ attributes: {}, ...r })) });
    if (req.method === 'PATCH') return sfu === 'alice@sf' ? (res.writeHead(204), res.end()) : json([{ message: 'insufficient access rights on object id' }], 403);
    json({}, 404);
  });
});
await new Promise((r) => fake.listen(SFP, '127.0.0.1', r));
const start = async (extra) => { const s = spawn('node', ['server/index.js'], { env: { ...process.env, DATA_DIR: DIR, PORT: String(PORT), ...extra }, stdio: 'ignore' }); await new Promise((r) => setTimeout(r, 1800)); return s; };
const call = async (method, path, body, ck = '') => { const r = await fetch(B + path, { method, redirect: 'manual', headers: { 'content-type': 'application/json', 'x-requested-with': 'account-mapper', ...(ck ? { cookie: ck } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const sc = r.headers.get('set-cookie'); return { status: r.status, loc: r.headers.get('location'), json: await r.json().catch(() => null), ck: sc && !/Max-Age=0/.test(sc) ? sc.split(';')[0] : null }; };
const connect = async (ck, sfUser) => { nextSfUser = sfUser; let r = await call('POST', '/api/salesforce/connect', {}, ck); if (!r.json?.url) return { r };
  const a = await fetch(r.json.url, { redirect: 'manual' }); const back = new URL(a.headers.get('location')); return { r: await call('GET', back.pathname + back.search), back }; };
const pw = () => crypto.randomBytes(9).toString('base64url') + 'aA1';
let srv = await start({ SF_CLIENT_ID: 'cid', SF_LOGIN_URL: SF, PUBLIC_URL: B, ALLOW_WRITE: '1' });
try {
  const apw = pw(); let r = await call('POST', '/api/auth/setup', { username: 'admin.t@buildots.com', password: apw }); const adminCk = r.ck;
  const bpw = pw(); await call('POST', '/api/users', { username: 'bob.t@buildots.com', password: 'Tmp-' + pw(), role: 'user', canPush: true }, adminCk);
  r = await call('GET', '/api/status', null, adminCk); t('status offers Salesforce login, not connected', r.json.sfLogin?.connected === false && r.json.canWrite === false, JSON.stringify(r.json.sfLogin));
  r = await call('GET', '/api/accounts?q=ac', null, adminCk); t('Salesforce calls are refused until the person connects', r.status === 409 && r.json.code === 'sf-connect', r.status);
  let c = await connect(adminCk, 'alice@sf'); t('connect flow returns to the app', c.r.status === 302 && /sf=connected/.test(c.r.loc), c.r.loc);
  r = await call('GET', '/api/status', null, adminCk); t('status shows who they connected as', r.json.sfLogin?.connected && r.json.sfLogin.label === 'alice@sf' && r.json.canWrite === true, JSON.stringify(r.json.sfLogin));
  r = await call('GET', '/api/accounts?q=acme', null, adminCk); t('search runs as the connected person', r.status === 200 && r.json.some((a) => a.Name === 'Acme Builders'), JSON.stringify(r.json));
  t('Salesforce saw that person’s own token', log.some(([, p, who]) => p.endsWith('/query') && who === 'alice@sf'));
  // second person with different visibility and no write rights
  const tmp = 'Tmp-' + pw(); await call('PUT', '/api/users/bob.t@buildots.com', { password: tmp }, adminCk);
  r = await call('POST', '/api/auth/login', { username: 'bob.t@buildots.com', password: tmp }); const bobCk = r.ck;
  await call('POST', '/api/auth/password', { current: tmp, next: bpw }, bobCk); r = await call('POST', '/api/auth/login', { username: 'bob.t@buildots.com', password: bpw }); const bob = r.ck;
  c = await connect(bob, 'bob@sf'); t('a second person connects their own login', /sf=connected/.test(c.r.loc || ''), c.r.loc);
  r = await call('GET', '/api/accounts?q=acme', null, bob); t('the second person does not see the first person’s account', r.status === 200 && !r.json.some((a) => a.Name === 'Acme Builders'), JSON.stringify(r.json));
  r = await call('GET', '/api/accounts?q=bobs', null, bob); t('…but sees what Salesforce shows them', r.json.some((a) => a.Name === 'Bobs Concrete'), JSON.stringify(r.json));
  r = await call('GET', '/api/accounts?q=bobs', null, adminCk); t('and the first person does not see theirs', !r.json.some((a) => a.Name === 'Bobs Concrete'));
  // writes are checked by Salesforce itself
  r = await call('POST', '/api/push', { changes: [{ Id: '003X', Contact_Role__c: 'Champion' }] }, adminCk); t('a person with edit rights can push', r.status === 200 && r.json[0].success === true, JSON.stringify(r.json));
  r = await call('POST', '/api/push', { changes: [{ Id: '003X', Contact_Role__c: 'Champion' }] }, bob); t('Salesforce refusing the edit comes back as a failed row', r.status === 200 && r.json[0].success === false && /insufficient/.test(r.json[0].error), JSON.stringify(r.json));
  t('the write used the pusher’s own token', log.some(([m, , who]) => m === 'PATCH' && who === 'alice@sf') && log.some(([m, , who]) => m === 'PATCH' && who === 'bob@sf'));
    r = await call('GET', '/api/accounts?q=acme', null, adminCk); t('repeat search still works (cached or refreshed token)', r.status === 200);
  // revoked refresh token asks to reconnect
  revoked.add('alice@sf');
  srv.kill(); await new Promise((r) => setTimeout(r, 300));
  srv = await start({ SF_CLIENT_ID: 'cid', SF_LOGIN_URL: SF, PUBLIC_URL: B, ALLOW_WRITE: '1' });
  r = await call('POST', '/api/auth/login', { username: 'admin.t@buildots.com', password: apw }); const ck2 = r.ck;
  r = await call('GET', '/api/accounts?q=acme', null, ck2); t('a revoked Salesforce login asks them to connect again', r.status === 409 && r.json.code === 'sf-connect', r.status + JSON.stringify(r.json));
  r = await call('GET', '/api/status', null, ck2); t('and status flips back to not connected', r.json.sfLogin?.connected === false);
  // callback safety
  r = await call('GET', '/api/auth/salesforce/callback?code=zzz&state=nope'); t('a forged callback is rejected', r.status === 302 && /sf_error=failed/.test(r.loc), r.loc);
  c = await connect(ck2, 'alice@sf'); revoked.delete('alice@sf');
  const replay = c.back ? await call('GET', c.back.pathname + c.back.search) : null; t('a used callback cannot be replayed', replay && /sf_error=failed/.test(replay.loc || ''), replay?.loc);
  r = await call('DELETE', '/api/salesforce', null, ck2); t('disconnect works', r.status === 200);
  r = await call('GET', '/api/status', null, ck2); t('disconnected means not connected', r.json.sfLogin?.connected === false);
  const enc = fs.readFileSync(`${DIR}/credentials.enc.json`, 'utf8'); t('refresh tokens are not stored in clear text', !/rt-alice|rt-bob/.test(enc));
} finally { srv.kill(); fake.close(); }
console.log(`\n${ok} passed, ${bad} failed`); process.exit(bad ? 1 : 0);
