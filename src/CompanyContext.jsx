import React, { useState } from 'react';
import { useStore } from './store.js';

const FIELDS = [
  ['vision', 'Vision', 'Their stated vision'],
  ['mission', 'Mission and core values', 'Mission statement, values, what makes them tick'],
  ['tech', 'Tech and ways of working', 'What they build in-house, tools they use or are piloting, lean / delivery approach'],
];

/** Full-screen company context for the account: board-only for now (not tied to Salesforce), so the team can plan from one place and replace the Miro research area. */
export default function CompanyContext() {
  const s = useStore();
  const c = s.context || {};
  const [text, setText] = useState(''); const [src, setSrc] = useState('');
  const [init, setInit] = useState('');
  const me = s.auth.user?.username || '';
  const add = (key, entry, clear) => { if (!entry.text.trim()) return; s.setContext({ [key]: [{ id: `${Date.now()}`, at: new Date().toISOString(), by: me, ...entry, text: entry.text.trim() }, ...(c[key] || [])] }); clear(); };
  const del = (key, id) => s.setContext({ [key]: (c[key] || []).filter((x) => x.id !== id) });
  const day = (iso) => new Date(iso).toLocaleDateString();
  return (
    <div className="ctxpage">
      <div className="ctxin">
        <h2>{s.account.Name} · company context</h2>
        <p className="muted">Board-only for now — nothing here is written to Salesforce. Use it in the planning session: org chart → mission and initiatives → decision-makers → account plan → QAP.</p>
        <div className="ctxgrid">
          {FIELDS.map(([k, label, ph]) => (
            <label key={k} className="ctxcard"><b>{label}</b>
              <textarea rows={5} defaultValue={c[k] || ''} placeholder={ph} onBlur={(e) => e.target.value !== (c[k] || '') && s.setContext({ [k]: e.target.value })} /></label>
          ))}
          <div className="ctxcard"><b>Latest QAP</b>
            <span className="muted sm">Pulling the latest QAP from Salesforce comes next. Until then, paste the link and a one-line summary.</span>
            <input defaultValue={c.qapUrl || ''} placeholder="Link to the QAP" onBlur={(e) => e.target.value !== (c.qapUrl || '') && s.setContext({ qapUrl: e.target.value })} />
            <textarea rows={3} defaultValue={c.qapNote || ''} placeholder="What the QAP says vs what we think the plan should be" onBlur={(e) => e.target.value !== (c.qapNote || '') && s.setContext({ qapNote: e.target.value })} />
            {c.qapUrl && /^https?:\/\//.test(c.qapUrl) && <a href={c.qapUrl} target="_blank" rel="noreferrer">Open QAP ↗</a>}
          </div>
        </div>
        <div className="ctxcard wide"><b>Company-wide initiatives</b>
          <span className="muted sm">Including ones that aren’t about us (e.g. “rolling out reality capture company-wide”). Then look at the org chart and mark the decision-makers as targets.</span>
          <div className="ctxadd"><input value={init} onChange={(e) => setInit(e.target.value)} placeholder="Add an initiative" onKeyDown={(e) => e.key === 'Enter' && add('initiatives', { text: init }, () => setInit(''))} /><button className="btn" onClick={() => add('initiatives', { text: init }, () => setInit(''))}>Add</button></div>
          {(c.initiatives || []).map((x) => <div key={x.id} className="ctxrow"><span>{x.text}</span><span className="muted sm">{who(x.by)} · {day(x.at)}</span><button className="link" onClick={() => del('initiatives', x.id)}>remove</button></div>)}
        </div>
        <div className="ctxcard wide"><b>Intel log</b>
          <span className="muted sm">Things you learn about the account: LinkedIn posts, a new hotel starting, a pilot of another tool. (Where the team’s shared “info dump” lives — probably Slack — is still being decided.)</span>
          <div className="ctxadd"><input value={text} onChange={(e) => setText(e.target.value)} placeholder="What did you learn?" /><input value={src} onChange={(e) => setSrc(e.target.value)} placeholder="Source link (optional)" />
            <button className="btn" onClick={() => add('intel', { text, src: src.trim() }, () => { setText(''); setSrc(''); })}>Add</button></div>
          {(c.intel || []).map((x) => <div key={x.id} className="ctxrow"><span>{x.text}{x.src && /^https?:\/\//.test(x.src) && <> · <a href={x.src} target="_blank" rel="noreferrer">source ↗</a></>}</span><span className="muted sm">{who(x.by)} · {day(x.at)}</span><button className="link" onClick={() => del('intel', x.id)}>remove</button></div>)}
        </div>
      </div>
    </div>
  );
}
const who = (u) => (u || '').split('@')[0];
