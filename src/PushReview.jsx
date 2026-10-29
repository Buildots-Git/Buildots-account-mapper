import React, { useMemo, useState } from 'react';
import { useStore } from './store.js';

/** Lists every change that would be written to Salesforce, so people can untick the ones they didn't mean before pushing. */
export default function PushReview() {
  const s = useStore();
  const open = s.pushReview;
  const rows = useMemo(() => (open ? s.pendingDetail() : []), [open, s.overrides, s.data]);
  const [off, setOff] = useState({});
  const [busy, setBusy] = useState(false);
  if (!open) return null;
  const key = (r) => `${r.id}|${r.key}`;
  const chosen = rows.filter((r) => !off[key(r)]);
  const people = [...new Set(rows.map((r) => r.id))];
  const close = () => { setOff({}); s.setShow('pushReview', false); };
  const go = async () => {
    setBusy(true);
    try { const r = await s.push(chosen); s.flash(r.n ? `Pushed ${r.n} contact(s)${r.failed ? `, ${r.failed} failed` : ''}` : 'Nothing to push'); close(); }
    catch (e) { s.flash(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="modal-back" onClick={close}>
      <div className="modal" style={{ width: 'min(820px,96vw)', height: 'min(80vh,720px)' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-h"><div><h3>Review changes before they go to Salesforce</h3><div className="muted sm">This WRITES to Salesforce. Untick anything you didn’t mean to change — unticked changes stay on the board.</div></div><button className="btn ghost" onClick={close}>×</button></div>
        <div className="modal-bar">
          <button className="link" onClick={() => setOff({})}>Select all</button>
          <button className="link" onClick={() => setOff(Object.fromEntries(rows.map((r) => [key(r), true])))}>Select none</button>
          <span className="muted sm">{chosen.length} of {rows.length} change(s) selected · {people.length} contact(s)</span>
        </div>
        <div className="modal-body">
          <table className="grid pushtbl"><thead><tr><th /><th>Contact</th><th>Field</th><th>Salesforce today</th><th>New value</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={key(r)} className={off[key(r)] ? 'off' : ''}>
                <td><input type="checkbox" checked={!off[key(r)]} onChange={(e) => setOff({ ...off, [key(r)]: !e.target.checked })} /></td>
                <td>{r.name}</td><td>{r.label}</td><td className="muted">{r.from || '—'}</td><td><b>{r.to || '— (cleared)'}</b></td>
              </tr>))}</tbody></table>
        </div>
        <div className="modal-f"><span className="grow" /><button className="btn ghost" onClick={close}>Cancel</button><button className="btn primary" disabled={!chosen.length || busy} onClick={go}>{busy ? 'Pushing…' : `Push ${chosen.length} change(s) to Salesforce`}</button></div>
      </div>
    </div>
  );
}
