import React, { useEffect, useState } from 'react';
import { useStore, api, jsonOpts } from './store.js';

const REASON = { auto: 'Earlier version', 'before-big-change': 'Before a big change', 'before-restore': 'Before a restore', daily: 'Daily backup' };
const ago = (iso) => { const m = Math.round((Date.now() - new Date(iso)) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };

/** Earlier states of this board (kept automatically) and the daily backups. Restoring keeps the current state as a version, so it can be undone. */
export default function VersionHistory({ onClose }) {
  const account = useStore((s) => s.account);
  const [list, setList] = useState(null); const [err, setErr] = useState(null); const [busy, setBusy] = useState(null);
  useEffect(() => { useStore.getState().flushNow(); api(`/boards/${account.Id}/versions`).then(setList).catch((e) => setErr(e.message)); }, [account.Id]);
  const restore = async (v) => {
    if (!confirm(`Restore this board to how it was on ${new Date(v.at).toLocaleString()}?\n\nWhat is on the board now is kept as a version, so you can come back to it.`)) return;
    setBusy(v.key); setErr(null);
    try { await api(`/boards/${account.Id}/restore`, jsonOpts('POST', { key: v.key })); onClose(); await useStore.getState().open(account.Id, account.Name); useStore.getState().flash?.('Board restored'); }
    catch (e) { setErr(e.message); setBusy(null); }
  };
  return (
    <div className="modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={{ width: 'min(640px,96vw)', height: 'auto', maxHeight: '86vh' }} role="dialog" aria-label="Version history">
        <header className="modal-h"><div><h3>Version history</h3><div className="muted sm">{account.Name} · earlier states of this board and daily backups. Restoring keeps what is there now.</div></div><button className="x" onClick={onClose} aria-label="Close">×</button></header>
        <div className="modal-body" style={{ padding: '0 18px 14px' }}>
          {err && <div className="warn">{err}</div>}
          {!list && !err && <div className="muted">Loading…</div>}
          {list && !list.length && <p className="muted">No earlier versions yet. They appear as the board changes.</p>}
          {!!list?.length && <table className="rv" style={{ tableLayout: 'auto' }}><thead><tr><th>When</th><th>What</th><th>By</th><th /></tr></thead>
            <tbody>{list.map((v) => <tr key={v.key}>
              <td title={new Date(v.at).toLocaleString()}>{v.source === 'daily' ? new Date(v.at).toLocaleDateString([], { dateStyle: 'medium' }) : `${new Date(v.at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })} · ${ago(v.at)}`}</td>
              <td>{REASON[v.reason] || v.reason}{v.rev ? <span className="muted sm"> · rev {v.rev}</span> : null}</td><td className="muted sm">{v.by}</td>
              <td><button className="btn sm" disabled={!!busy} onClick={() => restore(v)}>{busy === v.key ? 'Restoring…' : 'Restore'}</button></td></tr>)}</tbody></table>}
        </div>
      </div>
    </div>
  );
}
