import React from 'react';
import { useStore } from './store.js';

const ago = (iso) => { const m = Math.round((Date.now() - new Date(iso)) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };
const short = (u) => (u || '').split('@')[0];

/** Two chips in the header: is Salesforce connected (and as whom), and has what's on the board been pushed. */
export function SfStatus({ pendingN, why }) {
  const status = useStore((s) => s.status); const lastPush = useStore((s) => s.lastPush);
  if (status.demo) return <span className="sfchip warn" title="Salesforce isn’t reachable, so this is demo data.">Demo data · not connected</span>;
  const login = status.sfLogin;
  const connected = login ? login.connected : true;
  const who = login ? login.label : status.org;
  const lp = lastPush ? `Last push ${ago(lastPush.at)}${lastPush.by ? ` by ${short(lastPush.by)}` : ''}${lastPush.n ? ` · ${lastPush.n} contact${lastPush.n > 1 ? 's' : ''}` : ''}` : 'Nothing has been pushed from this board yet';
  return (
    <>
      <span className={`sfchip ${connected ? 'ok' : 'bad'}`} title={connected ? `Signed in to Salesforce${who ? ` as ${who}` : ''}. Account data is read from there.` : 'You are not signed in to Salesforce.'}>
        <i className="dot" />{connected ? `Salesforce${who ? ` · ${who}` : ' connected'}` : 'Salesforce not connected'}</span>
      {!status.canWrite
        ? <span className="sfchip mute" title={why}>Board only · can’t push</span>
        : pendingN > 0
          ? <span className="sfchip warn" title={`${pendingN} contact(s) changed on the board but not in Salesforce yet. ${lp}.`}>↑ {pendingN} not pushed</span>
          : <span className="sfchip ok" title={lp}>✓ {lastPush ? `Pushed ${ago(lastPush.at)}` : 'Nothing to push'}</span>}
    </>
  );
}

/** Other people who have this board open right now. */
export function Viewers() {
  const viewers = useStore((s) => s.viewers);
  if (!viewers?.length) return null;
  const names = viewers.map((v) => `${short(v.user)}${v.editing ? ' (editing)' : ''}`);
  return (
    <span className="viewers" title={`Also on this board: ${names.join(', ')}`}>
      {viewers.slice(0, 3).map((v) => <span key={v.user} className={`vav${v.editing ? ' ed' : ''}`}>{short(v.user).slice(0, 1).toUpperCase()}</span>)}
      <span className="vtxt">{viewers.length === 1 ? `${short(viewers[0].user)} ${viewers[0].editing ? 'is editing' : 'is viewing'}` : `${viewers.length} others here`}</span>
    </span>
  );
}

/** Word-style undo list: the recent steps, newest first; pick one to go back to just before it. */
export function UndoList({ onClose, onHistory }) {
  const steps = useStore((s) => s.undoSteps)(); const redoN = useStore((s) => s.future.length);
  const go = (k) => { useStore.getState().undoTo(k); onClose(); };
  return (
    <div className="pop undo-pop" onMouseLeave={onClose}>
      <div className="muted sm undo-h">{steps.length ? 'Undo to just before…' : 'Nothing to undo yet'}</div>
      {steps.slice(0, 12).map((t, i) => <button key={i} className="item" onClick={() => go(i + 1)}>{t}{i === 0 ? '' : <span className="muted sm"> · {i + 1} steps</span>}</button>)}
      {steps.length > 12 && <div className="muted sm undo-h">…and {steps.length - 12} older</div>}
      {!!redoN && <button className="item" onClick={() => { useStore.getState().redo(); onClose(); }}>↷ Redo ({redoN} available)</button>}
      <button className="item" onClick={onHistory}>Older versions &amp; backups…</button>
    </div>
  );
}
