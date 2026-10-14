import React, { useMemo, useState } from 'react';
import { useStore } from './store.js';
import { applyReview } from './importReview.js';

const COLORS = [['', '— none —'], ['green', '🟢 Active / have met'], ['orange', '🟠 Talk first'], ['yellow', '🟡 Contact them']];

export default function ReviewModal() {
  const store = useStore();
  const review = store.review;
  const people = store.people();
  const [filter, setFilter] = useState(null);
  const [q, setQ] = useState('');
  if (!review) return null;
  const { rows, headers } = review;
  const byId = Object.fromEntries(people.map((p) => [p.Id, p]));
  const attention = (r) => r.action === 'skip' || r.action === 'new' || (r.action === 'match' && !r.sure);
  const f = filter || (rows.some(attention) ? 'attention' : 'all');
  const shown = rows.filter((r) => (f === 'all' || (f === 'attention' ? attention(r) : r.action === f)) && (!q || `${r.read.name} ${r.read.title}`.toLowerCase().includes(q.toLowerCase())));
  const count = (fn) => rows.filter(fn).length;
  const stats = { match: count((r) => r.action === 'match'), new: count((r) => r.action === 'new'), skip: count((r) => r.action === 'skip'), lines: count((r) => r.parent && r.action !== 'skip') + headers.filter((h) => h.parent).length };
  const offices = [...new Set([...headers.map((h) => h.text), ...rows.map((r) => r.group).filter(Boolean)])];
  const sortedPeople = [...people].sort((a, b) => a.Name.localeCompare(b.Name));
  const taken = new Set(rows.filter((r) => r.action === 'match').map((r) => r.matchId));

  const chooseMatch = (r, v) => {
    if (v === '__new') return store.updateRow(r.id, { action: 'new', matchId: null });
    if (v === '__skip') return store.updateRow(r.id, { action: 'skip', matchId: null });
    const p = byId[v];
    store.updateRow(r.id, { action: 'match', matchId: v, sure: false, ...(p && !r.group && p.Region__c ? {} : {}) });
  };
  const toggle = (r, on) => store.updateRow(r.id, on ? (r.matchId ? { action: 'match' } : { action: 'new' }) : { action: 'skip' });
  const parentOptions = rows.filter((x) => x.action !== 'skip').map((x) => ({ id: x.id, name: x.matchId ? byId[x.matchId]?.Name || x.read.name : x.read.name }));
  const apply = () => {
    const s = applyReview(review);
    store.closeReview();
    store.flash(`Imported: ${s.matched} matched, ${s.created} new card${s.created === 1 ? '' : 's'}, ${s.offices} office${s.offices === 1 ? '' : 's'}, ${s.colored} colored, ${s.lines} reporting line${s.lines === 1 ? '' : 's'}  (⌘Z to undo)`);
  };

  return (
    <div className="modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) store.closeReview(); }}>
      <div className="modal" role="dialog" aria-label="Review import">
        <header className="modal-h">
          <div><h3>Review import</h3><div className="muted sm">{rows.length} cards read from the {review.source.toLowerCase()} · nothing changes until you press Apply</div></div>
          <button className="x" onClick={store.closeReview} aria-label="Close">×</button>
        </header>
        <div className="modal-bar">
          <div className="tabs" style={{ flex: '0 0 auto' }}>
            {[['attention', `Needs a look (${count(attention)})`], ['match', `Matched (${stats.match})`], ['new', `New cards (${stats.new})`], ['skip', `Skipped (${stats.skip})`], ['all', `All (${rows.length})`]].map(([k, l]) => <button key={k} className={f === k ? 'on' : ''} onClick={() => setFilter(k)}>{l}</button>)}
          </div>
          <input placeholder="Find a name…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 200 }} />
          <span className="grow" />
          <button className="btn ghost sm" onClick={() => store.updateRows((r) => (r.action === 'skip' && /^[A-Z]/.test(r.read.name) ? { action: 'new' } : null))}>Add all unmatched as new</button>
        </div>
        <div className="modal-body">
          <table className="rv">
            <colgroup><col style={{ width: 34 }} /><col style={{ width: 210 }} /><col style={{ width: 270 }} /><col style={{ width: 110 }} /><col style={{ width: 130 }} /><col style={{ width: 170 }} /></colgroup>
            <thead><tr><th /><th>On the {review.source.toLowerCase()}</th><th>Salesforce contact</th><th>Office</th><th>Color</th><th>Reports to</th></tr></thead>
            <tbody>
              {shown.map((r) => {
                const sel = r.action === 'match' ? r.matchId : r.action === 'new' ? '__new' : '__skip';
                return (
                  <tr key={r.id} className={r.action === 'skip' ? 'off' : ''}>
                    <td><input type="checkbox" checked={r.action !== 'skip'} onChange={(e) => toggle(r, e.target.checked)} title="Include in the import" /></td>
                    <td><b>{r.read.name}</b> <span className={`chip ${r.action === 'match' ? (r.sure ? 'ok' : 'chk') : r.action}`}>{r.action === 'match' ? (r.sure ? 'matched' : 'check') : r.action === 'new' ? 'new' : 'skipped'}</span>
                      <div className="muted sm ell" title={r.read.title}>{r.read.title || 'no title read'}</div>{r.notes && <div className="muted sm ell" title={r.notes}>💬 {r.notes}</div>}</td>
                    <td>
                      <select value={sel} onChange={(e) => chooseMatch(r, e.target.value)}>
                        {r.cands.length > 0 && <optgroup label="Best matches">{r.cands.map((c) => <option key={c.id} value={c.id} disabled={taken.has(c.id) && r.matchId !== c.id}>{c.name} — {c.title || 'no title'} ({Math.round(c.score * 100)}%){taken.has(c.id) && r.matchId !== c.id ? ' · already used' : ''}</option>)}</optgroup>}
                        <optgroup label="Other"><option value="__new">＋ Add as a new card (not in Salesforce)</option><option value="__skip">Skip this card</option></optgroup>
                        <optgroup label="Any contact (A–Z)">{sortedPeople.filter((p) => !r.cands.some((c) => c.id === p.Id) && !p.external).map((p) => <option key={p.Id} value={p.Id} disabled={taken.has(p.Id) && r.matchId !== p.Id}>{p.Name}{p.Title ? ` — ${p.Title}` : ''}</option>)}</optgroup>
                      </select>
                    </td>
                    <td><input list="rv-offices" value={r.group} onChange={(e) => store.updateRow(r.id, { group: e.target.value })} placeholder="—" /></td>
                    <td><select value={r.color} onChange={(e) => store.updateRow(r.id, { color: e.target.value })}>{COLORS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></td>
                    <td><select value={r.parent || ''} onChange={(e) => store.updateRow(r.id, { parent: e.target.value || null })} title={r.parent ? 'Set from a line on the picture, or by you' : ''}>
                      <option value="">— by seniority —</option>
                      {headers.length > 0 && <optgroup label="Offices">{headers.map((h) => <option key={h.id} value={h.id}>{h.text}</option>)}</optgroup>}
                      <optgroup label="People on this import">{parentOptions.filter((o) => o.id !== r.id).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</optgroup>
                    </select></td>
                  </tr>);
              })}
            </tbody>
          </table>
          <datalist id="rv-offices">{offices.map((o) => <option key={o} value={o} />)}</datalist>
          {!shown.length && <div className="muted" style={{ padding: 24 }}>Nothing in this view.</div>}
        </div>
        <footer className="modal-f">
          <span className="sm"><b>{stats.match}</b> matched · <b>{stats.new}</b> new cards · <b>{stats.skip}</b> skipped · <b>{stats.lines}</b> reporting line{stats.lines === 1 ? '' : 's'} read</span>
          <span className="grow" />
          <button className="btn ghost" onClick={store.closeReview}>Cancel</button>
          <button className="btn" disabled={!stats.match && !stats.new} onClick={apply}>Apply to board</button>
        </footer>
      </div>
    </div>
  );
}
