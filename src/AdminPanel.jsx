import React, { useEffect, useMemo, useState } from 'react';
import { api, jsonOpts } from './store.js';

const ACTIONS = {
  'board-saved': 'Board edited', 'board-restored': 'Board restored', 'sf-push': 'Pushed to Salesforce',
  'user-created': 'User added', 'user-updated': 'User changed', 'user-removed': 'User removed', 'user-deactivated': 'User deactivated', 'user-reactivated': 'User reactivated', 'user-access-changed': 'Account access changed',
  'auth-login': 'Signed in', 'auth-logout': 'Signed out', 'auth-failed': 'Failed sign-in', 'auth-locked': 'Sign-in locked', 'auth-setup': 'First account created', 'auth-password-changed': 'Password changed', 'auth-sso-login': 'Signed in (SSO)', 'auth-sso-denied': 'SSO refused',
  'sf-connected': 'Salesforce connected', 'sf-disconnected': 'Salesforce disconnected', 'sf-connect-failed': 'Salesforce connect failed', 'backup-daily': 'Daily backup', 'backup-run': 'Backup run by admin',
};
const FIELDS = { reportsTo: 'Reports to', ReportsToId: 'Reports to', title: 'Title', region: 'Region', Region__c: 'Region', role: 'Role', Contact_Role__c: 'Role', es: 'ES status', ES_Expansion_Status__c: 'ES status', ecm: 'ECM', goal: 'Immediate target', cstatus: 'Status colour', hidden: 'Removed from board', show: 'Shown on board', enterprise: 'Target account' };
const label = (a) => ACTIONS[a] || a;
const val = (v) => (v === null || v === undefined || v === '' ? '—' : typeof v === 'boolean' ? (v ? 'yes' : 'no') : String(v));
const when = (iso) => new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
const BULK = new Set(['board-saved', 'sf-push']);

/** One line saying what happened, then (for edits and pushes) the exact before → after for every field. */
function Detail({ e }) {
  if (e.action === 'board-saved') {
    const n = (e.people?.length || 0) + (e.morePeople || 0);
    const bits = [n && `${n} ${n === 1 ? 'person' : 'people'} changed`, e.added > 0 && `${e.added} added`, e.added < 0 && `${-e.added} removed`, e.notes && `${e.notes > 0 ? '+' : ''}${e.notes} notes`, e.comments && `${e.comments > 0 ? '+' : ''}${e.comments} comments`].filter(Boolean).join(' · ');
    return <><b>{e.boardName || e.board}</b> · rev {e.rev} · {bits}{!!e.people?.length && <details><summary>Show changes</summary>
      <ul className="auditlist">{e.people.flatMap((p) => Object.entries(p.changes).map(([k, [a, b]]) => <li key={`${p.id}${k}`}><b>{p.name || p.id}</b> — {FIELDS[k] || k}: <s>{val(a)}</s> → <b>{val(b)}</b></li>))}</ul>{!!e.morePeople && <div className="muted sm">…and {e.morePeople} more people</div>}</details>}</>;
  }
  if (e.action === 'sf-push') {
    if (!e.rows) return <>Legacy entry · {(e.changes || []).length} contact(s)<details><summary>Show</summary><pre className="auditpre">{JSON.stringify(e.changes, null, 1)}</pre></details></>;
    return <>{new Set(e.rows.map((r) => r.id)).size} contact(s), {e.rows.length} field(s) · {e.org}{e.failed ? <span className="chip chk">{e.failed} failed</span> : <span className="chip ok">ok</span>}
      <details><summary>Show before → after</summary><ul className="auditlist">{e.rows.map((r, i) => <li key={i}><b>{r.name || r.id}</b> — {FIELDS[r.field] || r.field}: <s>{r.before === undefined ? 'unknown' : val(r.before)}</s> → <b>{val(r.after)}</b>{!r.ok && <span className="chip chk">failed{r.error ? `: ${r.error}` : ''}</span>}</li>)}</ul></details></>;
  }
  if (e.action === 'board-restored') return <><b>{e.boardName || e.board}</b> restored from {String(e.restored).startsWith('d:') ? `the ${String(e.restored).slice(2)} daily backup` : 'an earlier version'} · now rev {e.rev}</>;
  const { at, action, user, ...rest } = e;
  const bits = Object.entries(rest).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `${k}: ${Array.isArray(v) ? (v.length ? v.join(', ') : 'none') : typeof v === 'object' ? JSON.stringify(v) : v}`);
  return <span className="muted">{bits.join(' · ')}</span>;
}

function AuditTab() {
  const [f, setF] = useState({ user: '', action: '', q: '' }); const [data, setData] = useState({ entries: [], actions: [], users: [] }); const [err, setErr] = useState(null); const [busy, setBusy] = useState(false); const [more, setMore] = useState(true);
  const qs = (extra = {}) => new URLSearchParams({ limit: 150, ...Object.fromEntries(Object.entries({ ...f, ...extra }).filter(([, v]) => v)) }).toString();
  const load = async () => { setBusy(true); setErr(null); try { const r = await api(`/admin/audit?${qs()}`); setData(r); setMore(r.entries.length >= 150); } catch (e) { setErr(e.message); } finally { setBusy(false); } };
  useEffect(() => { const t = setTimeout(load, f.q ? 300 : 0); return () => clearTimeout(t); }, [f]); // eslint-disable-line
  const older = async () => { const last = data.entries.at(-1); if (!last) return; setBusy(true); try { const r = await api(`/admin/audit?${qs({ before: last.at })}`); setData((d) => ({ ...r, entries: [...d.entries, ...r.entries] })); setMore(r.entries.length >= 150); } catch (e) { setErr(e.message); } finally { setBusy(false); } };
  const csv = () => {
    const esc = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
    const rows = [['time', 'user', 'action', 'board', 'contact', 'field', 'before', 'after', 'detail']];
    for (const e of data.entries) {
      if (e.action === 'board-saved') for (const p of e.people || []) for (const [k, [a, b]] of Object.entries(p.changes)) rows.push([e.at, e.user, e.action, e.boardName || e.board, p.name || p.id, FIELDS[k] || k, val(a), val(b), '']);
      else if (e.action === 'sf-push' && e.rows) for (const r of e.rows) rows.push([e.at, e.user, e.action, '', r.name || r.id, FIELDS[r.field] || r.field, r.before === undefined ? 'unknown' : val(r.before), val(r.after), r.ok ? 'ok' : `failed ${r.error || ''}`]);
      else rows.push([e.at, e.user, e.action, e.boardName || e.board || '', '', '', '', '', JSON.stringify(Object.fromEntries(Object.entries(e).filter(([k]) => !['at', 'user', 'action'].includes(k))))]);
    }
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([rows.map((r) => r.map(esc).join(',')).join('\n')], { type: 'text/csv' })); a.download = `account-mapper-audit-${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(a.href);
  };
  return <>
    <div className="auditbar">
      <select value={f.user} onChange={(e) => setF({ ...f, user: e.target.value })}><option value="">Everyone</option>{data.users.map((u) => <option key={u}>{u}</option>)}</select>
      <select value={f.action} onChange={(e) => setF({ ...f, action: e.target.value })}><option value="">All activity</option>{data.actions.map((a) => <option key={a} value={a}>{label(a)}</option>)}</select>
      <input placeholder="Search a person, board or value…" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} />
      <button className="btn sm" onClick={load} disabled={busy}>Refresh</button><button className="btn sm" onClick={csv} disabled={!data.entries.length} title="Download what is listed as a spreadsheet">Download CSV</button>
    </div>
    {err && <div className="warn">{err}</div>}
    <table className="rv auditt" style={{ tableLayout: 'auto' }}>
      <thead><tr><th style={{ width: 150 }}>When</th><th style={{ width: 170 }}>Who</th><th style={{ width: 150 }}>What</th><th>Details</th></tr></thead>
      <tbody>{data.entries.map((e, i) => <tr key={e.at + i} className={BULK.has(e.action) ? '' : 'quiet'}>
        <td className="muted sm" style={{ whiteSpace: 'nowrap' }}>{when(e.at)}</td><td className="sm">{e.user || '—'}</td><td><b className="sm">{label(e.action)}</b></td><td className="sm"><Detail e={e} /></td></tr>)}
      </tbody>
    </table>
    {!data.entries.length && !busy && <p className="muted" style={{ padding: 12 }}>Nothing matches.</p>}
    {more && data.entries.length > 0 && <div style={{ textAlign: 'center', padding: 10 }}><button className="btn sm" onClick={older} disabled={busy}>{busy ? 'Loading…' : 'Show older'}</button></div>}
  </>;
}

const size = (b) => (b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`);
function BackupsTab() {
  const [st, setSt] = useState(null); const [err, setErr] = useState(null); const [busy, setBusy] = useState(false); const [note, setNote] = useState(null);
  const load = () => api('/admin/backups').then(setSt).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);
  const run = async () => { setBusy(true); setErr(null); try { const r = await api('/admin/backups/run', jsonOpts('POST', {})); setSt(r); setNote(`Backed up ${r.boards} board(s).`); } catch (e) { setErr(e.message); } finally { setBusy(false); } };
  return <div style={{ padding: '4px 18px 14px' }}>
    <p className="sm">A copy of every board is taken automatically once a day and kept for <b>{st?.keepDays || 14} days</b>. Each board also keeps its last <b>{st?.keepVersions || 40}</b> earlier versions (see <i>⋯ → Version history</i> on a board). Backups also include the user list (password hashes only) and the homepage tiles. They never include stored ZoomInfo/Lusha/Miro/Anthropic keys or the encryption key.</p>
    {err && <div className="warn">{err}</div>}{note && <div className="ok">{note}</div>}
    <button className="btn sm" onClick={run} disabled={busy}>{busy ? 'Backing up…' : 'Back up now'}</button>
    <table className="rv" style={{ tableLayout: 'auto', marginTop: 10 }}><thead><tr><th>Day</th><th>Boards</th><th>Size</th></tr></thead>
      <tbody>{(st?.days || []).map((d) => <tr key={d.day}><td>{d.day}</td><td>{d.boards}</td><td>{size(d.bytes)}</td></tr>)}</tbody></table>
    {st && !st.days.length && <p className="muted">No backups yet.</p>}
    <p className="muted sm">To bring a board back, open it and use <b>⋯ → Version history</b>; daily backups appear in that list too. Restoring never deletes anything — the version you replace is kept.</p>
  </div>;
}

export default function AdminPanel({ onClose }) {
  const [tab, setTab] = useState('audit');
  return (
    <div className="modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={{ width: 'min(1100px,97vw)', height: '88vh' }} role="dialog" aria-label="Audit log and backups">
        <header className="modal-h"><div><h3>Audit log &amp; backups</h3><div className="muted sm">Who changed what, on which board, and every push to Salesforce with the values before and after.</div></div><button className="x" onClick={onClose} aria-label="Close">×</button></header>
        <div className="seg" style={{ margin: '0 18px 8px', width: 'fit-content' }}><button className={tab === 'audit' ? 'on' : ''} onClick={() => setTab('audit')}>Audit log</button><button className={tab === 'backups' ? 'on' : ''} onClick={() => setTab('backups')}>Backups</button></div>
        <div className="modal-body" style={{ padding: tab === 'audit' ? '0 18px 12px' : 0 }}>{tab === 'audit' ? <AuditTab /> : <BackupsTab />}</div>
      </div>
    </div>
  );
}
