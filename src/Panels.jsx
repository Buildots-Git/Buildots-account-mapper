import React, { useMemo, useState } from 'react';
import { useStore, api, jsonOpts } from './store.js';
import { ES_STATES, ROLES, inferHierarchy, CONTACT_STATUS } from './hierarchy.js';
import { tileImage } from './miroImport.js';
import { buildRows, cardsFromMiro } from './importReview.js';
import { colorToStatus } from './hierarchy.js';
import { onBoard, matchesSearch } from './search.js';
import { ago, who } from './format.js';
import { SIGN_IN } from './links.js';
import { CardBody } from './ContactNode.jsx';
import { PRESETS } from './store.js';

const money = (n) => (n == null ? '' : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : `$${Math.round(n / 1e3)}k`);
const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

const Head = ({ title, sub, onClose }) => <header><div><h3>{title}</h3>{sub && <div className="muted sm">{sub}</div>}</div><button className="x" onClick={onClose}>×</button></header>;
const F = ({ label, children }) => <label className="f">{label}{children}</label>;

// ---- comments -----------------------------------------------------------------------------------
function Thread({ k, placeholder = 'Add a comment…' }) {
  const { comments, status, addComment, deleteComment } = useStore();
  const [text, setText] = useState('');
  const list = comments[k] || [];
  const post = () => { addComment(k, text); setText(''); };
  return (
    <div className="thread">
      {list.map((c) => (
        <div key={c.id} className="comment">
          <div className="muted sm"><b>{who(c.author)}</b> · {ago(c.at)}{c.author === status.me && <button className="link" onClick={() => deleteComment(k, c.id)}> delete</button>}</div>
          <div>{c.text}</div>
        </div>
      ))}
      <textarea rows={2} placeholder={placeholder} value={text} onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) post(); }} />
      <div className="row"><span className="muted sm">⌘↵ to post · board-only, not saved to Salesforce</span><button className="btn sm" disabled={!text.trim()} onClick={post}>Comment</button></div>
    </div>
  );
}

export function CommentsPanel({ onClose }) {
  const store = useStore(); const { comments, account } = store;
  const people = store.people();
  const withNotes = people.filter((p) => (comments[p.Id] || []).length);
  return (
    <aside className="side wide">
      <Head title="Comments" sub={`Notes on ${account.Name} — visible on this board only`} onClose={onClose} />
      <h4>About the account</h4>
      <Thread k="__board" placeholder="Account-level note (strategy, next steps…)" />
      <h4>Pinned on the board <em>{store.items.filter((i) => i.type === 'comment').length}</em></h4>
      {store.items.filter((i) => i.type === 'comment').length ? store.items.filter((i) => i.type === 'comment').map((i) => (
        <div key={i.id} className="cmt-row" onClick={() => { store.focus(i.id); store.setOpenPin(i.id); }}>
          <b>{i.resolved ? '✓ ' : '💬 '}{(i.thread || []).length} comment{(i.thread || []).length === 1 ? '' : 's'}</b> <span className="muted sm">{who(i.author)} · {ago(i.at)}</span>
          <div className="sm">{(i.thread || [])[0]?.text.slice(0, 120) || 'Empty pin'}</div>
        </div>)) : <div className="muted sm">None yet. Press <b>C</b> or use the Comment tool, then click the board.</div>}
      <h4>About people <em>{withNotes.length}</em></h4>
      {withNotes.length ? withNotes.map((p) => {
        const last = comments[p.Id].at(-1);
        return <div key={p.Id} className="cmt-row" onClick={() => { store.select(p.Id); store.focus(p.Id); }}>
          <b>{p.Name}</b> <span className="muted sm">{p.Title}</span>
          <div className="sm">{comments[p.Id].length > 1 ? `(${comments[p.Id].length}) ` : ''}{last.text.slice(0, 120)}</div>
        </div>;
      }) : <div className="muted sm">No comments on people yet. Open a card and add one.</div>}
    </aside>
  );
}

// ---- selected person: every field is editable (board-only unless pushed) ---------------------
export function DetailPanel() {
  const store = useStore();
  const { selected, data, select, account, patch } = store;
  const people = store.people();
  const p = people.find((x) => x.Id === selected);
  if (!p) return null;
  const mine = (list) => list.filter((x) => x.contactIds.includes(p.Id));
  const sfUrl = !p.external && !String(account.Id).startsWith('demo') ? `https://buildots.lightning.force.com/lightning/r/Contact/${p.Id}/view` : null;
  const descendants = (id, seen = new Set()) => { people.filter((x) => x.reportsTo === id).forEach((c) => { if (!seen.has(c.Id)) { seen.add(c.Id); descendants(c.Id, seen); } }); return seen; };
  const bad = descendants(p.Id); // a person can't report to themselves or to someone below them
  return (
    <aside className="side" key={p.Id}>
      <header><div><h3>{p.Name}</h3><div className="muted sm">{p.external ? `Added from ${p.source || 'outside Salesforce'}` : 'Salesforce contact'}</div></div><button className="x" onClick={() => select(null)}>×</button></header>
      <F label="Title"><input defaultValue={p.Title || ''} onBlur={(e) => e.target.value !== (p.Title || '') && patch(p.Id, { title: e.target.value })} /></F>
      <F label="Reports to">
        <select value={p.reportsTo || ''} onChange={(e) => patch(p.Id, { reportsTo: e.target.value || null, manual: true })}>
          <option value="">— nobody (top of the map) —</option>
          {people.filter((o) => o.Id !== p.Id && !bad.has(o.Id)).sort((a, b) => a.Name.localeCompare(b.Name)).map((o) => <option key={o.Id} value={o.Id}>{o.Name}{o.Title ? ` — ${o.Title}` : ''}</option>)}
        </select>
      </F>
      <F label="Contact status (team key)">
        <select value={p.cstatus || ''} onChange={(e) => store.setStatus([p.Id], e.target.value || null)}>
          <option value="">— not set —</option>
          {Object.entries(CONTACT_STATUS).map(([k, v]) => <option key={k} value={k}>{k === 'green' ? '🟢' : k === 'orange' ? '🟠' : '🟡'} {v.label}</option>)}
        </select>
      </F>
      <div className="grid2">
        <F label="Role"><select value={p.Contact_Role__c || ''} onChange={(e) => patch(p.Id, { role: e.target.value || null })}><option value="" />{ROLES.map((r) => <option key={r}>{r}</option>)}</select></F>
        <F label="ES status"><select value={p.ES_Expansion_Status__c || ''} onChange={(e) => patch(p.Id, { es: e.target.value || null })}><option value="" />{ES_STATES.map((r) => <option key={r}>{r}</option>)}</select></F>
        <F label="Region"><input defaultValue={p.Region__c || ''} onBlur={(e) => patch(p.Id, { region: e.target.value || null })} /></F>
        <F label="ECM ★"><select value={p.Enterprise_Coalition_Member__c ? 'y' : 'n'} onChange={(e) => patch(p.Id, { ecm: e.target.value === 'y' })}><option value="y">Enterprise Coalition Member</option><option value="n">No</option></select></F>
      </div>
      <dl>
        {[['Email', p.Email], ['Phone', p.Phone], ['City', p.MailingCity], ['Department', p.Department], ['Owner', p.Owner?.Name]].filter(([, v]) => v).map(([k, v]) => <React.Fragment key={k}><dt>{k}</dt><dd>{v}</dd></React.Fragment>)}
        {p.Linkedin_Profile_URL__c && <><dt>LinkedIn</dt><dd><a href={p.Linkedin_Profile_URL__c} target="_blank" rel="noreferrer">profile ↗</a></dd></>}
      </dl>
      <div className="row">
        {sfUrl && <a className="btn ghost sm" href={sfUrl} target="_blank" rel="noreferrer">Open in Salesforce ↗</a>}
        <button className="btn ghost sm" onClick={() => { patch(p.Id, { hidden: true }); select(null); }}>Hide from board</button>
        <button className="btn ghost sm" title="Look this person up through your connected ZoomInfo account" onClick={() => store.enrichPerson(p.Id, 'zoominfo')}>Look up in ZoomInfo (API)</button>
        <button className="btn ghost sm" title="Look this person up through your connected Lusha account" onClick={() => store.enrichPerson(p.Id, 'lusha')}>Look up in Lusha (API)</button>
        {p.external && <button className="btn ghost sm danger" onClick={() => { store.removeExtra(p.Id); select(null); }}>Delete card</button>}
      </div>
      <Section title="Opportunities" items={mine(data.opportunities)} render={(o) => <><b>{o.Name}</b><span>{o.StageName} · {money(o.Amount)} · {o.CloseDate}</span></>} />
      <Section title="Project leads" items={mine(data.projectLeads)} render={(o) => <><b>{o.Name}</b><span>{o.Role}</span></>} />
      <Section title="CS projects" items={mine(data.csProjects)} render={(o) => <><b>{o.Name}</b><span>{[o.Status, o.Role].filter(Boolean).join(' · ')}</span></>} />
      <h4>Comments <em>{(store.comments[p.Id] || []).length}</em></h4>
      <Thread k={p.Id} />
      {p.Project_Leads_Summary__c && <><h4>Project leads summary</h4><pre className="summary">{p.Project_Leads_Summary__c}</pre></>}
    </aside>
  );
}
const Section = ({ title, items, render }) => (
  <><h4>{title} <em>{items.length}</em></h4>
    {items.length ? <ul className="rel">{items.map((i) => <li key={i.Id}>{render(i)}</li>)}</ul> : <div className="muted sm">None linked</div>}</>
);

// ---- who is on the board ------------------------------------------------------------------------
export function PeoplePanel({ onClose }) {
  const store = useStore(); const { hideUntitled, setVisible } = store;
  const people = store.people();
  const [q, setQ] = useState(''); const [tab, setTab] = useState('all');
  const on = (p) => onBoard(p, hideUntitled);
  const listed = people.filter((p) => (!q || matchesSearch(p, { field: 'any', q })) && (tab === 'all' || (tab === 'on' ? on(p) : !on(p))))
    .sort((a, b) => a.Name.localeCompare(b.Name));
  const shown = people.filter(on).length;
  return (
    <aside className="side wide">
      <Head title="People on the board" sub={`${shown} of ${people.length} shown · changes only affect this board`} onClose={onClose} />
      <input placeholder="Find a person…" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="tabs">{[['all', 'Everyone'], ['on', 'On board'], ['off', 'Hidden']].map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}</div>
      <div className="row">
        <button className="btn ghost sm" disabled={!listed.length} onClick={() => setVisible(listed.map((p) => p.Id), true)}>Show all {listed.length} listed</button>
        <button className="btn ghost sm" disabled={!listed.length} onClick={() => setVisible(listed.map((p) => p.Id), false)}>Hide all {listed.length} listed</button>
      </div>
      <div className="fieldlist">
        {listed.slice(0, 300).map((p) => (
          <label key={p.Id} draggable title="Drag onto the board to place this person" onDragStart={(e) => { e.dataTransfer.setData('text/plain', `contact:${p.Id}`); e.dataTransfer.effectAllowed = 'copy'; }}>
            <input type="checkbox" checked={on(p)} onChange={(e) => setVisible([p.Id], e.target.checked)} />
            <span><b>{p.Name}</b><br /><span className="muted sm">{p.Title || 'No title'}</span></span>
          </label>
        ))}
        {!listed.length && <div className="muted sm" style={{ padding: 10 }}>No one matches.</div>}
        {listed.length > 300 && <div className="muted sm" style={{ padding: 10 }}>Showing the first 300 — narrow the search to see the rest.</div>}
      </div>
      <p className="muted sm">Tip: drag a name from this list onto the board to place them exactly where you drop. Hiding a manager keeps their team on the board, attached to the next manager up. Unticked people without a title can be brought back here too.</p>
    </aside>
  );
}

// ---- manual card ------------------------------------------------------------------------------
export function AddPersonPanel({ onClose }) {
  const store = useStore(); const people = store.people();
  const [f, setF] = useState({ Name: '', Title: '', parent: '', touched: false });
  // Suggest a manager from the title (same rules as auto-build) until the user picks one themselves.
  const suggested = useMemo(() => {
    if (!f.Title.trim()) return null;
    const probe = { Id: '__new', Name: f.Name || 'New person', Title: f.Title };
    return inferHierarchy([...people, probe])['__new'] || null;
  }, [f.Title, f.Name, people]);
  const parent = f.touched ? f.parent : (suggested || '');
  const add = () => {
    if (!f.Name.trim()) return;
    const id = store.addExtra({ Name: f.Name.trim(), Title: f.Title.trim(), source: 'Added manually' });
    if (parent) store.patch(id, { reportsTo: parent, manual: true });
    store.select(id); store.focus(id); onClose();
  };
  return (
    <aside className="side">
      <Head title="Add person" sub="Creates a card on the board only — nothing is created in Salesforce." onClose={onClose} />
      <F label="Name"><input autoFocus value={f.Name} onChange={(e) => setF({ ...f, Name: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && add()} /></F>
      <F label="Title"><input value={f.Title} onChange={(e) => setF({ ...f, Title: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && add()} /></F>
      <F label={suggested && !f.touched ? 'Reports to (suggested from title)' : 'Reports to'}>
        <select value={parent} onChange={(e) => setF({ ...f, parent: e.target.value, touched: true })}>
          <option value="">— nobody (top of the map) —</option>
          {people.slice().sort((a, b) => a.Name.localeCompare(b.Name)).map((o) => <option key={o.Id} value={o.Id}>{o.Name}{o.Title ? ` — ${o.Title}` : ''}</option>)}
        </select>
      </F>
      <button className="btn" disabled={!f.Name.trim()} onClick={add}>Add to board</button>
      <div className="muted sm">The new card is selected and the board zooms to it.</div>
    </aside>
  );
}

// ---- which Salesforce Contact fields show on the card ----------------------------------------
export function FieldPicker({ onClose }) {
  const store = useStore();
  const { fieldCatalog, showFields, showRelated, hideUntitled, highlight, cardLayout: L, setShow, setCardFields, setLayout, data } = store;
  const [q, setQ] = useState('');
  const people = store.people();
  // sample for the live preview: the person with the most to show
  const sample = useMemo(() => {
    const score = (p) => (p.Contact_Role__c ? 2 : 0) + (p.ES_Expansion_Status__c ? 2 : 0) + (p.Enterprise_Coalition_Member__c ? 2 : 0) + (p.Email ? 1 : 0) + (p.Phone ? 1 : 0) + (p.Title ? 1 : 0) + (p.MailingCity ? 1 : 0);
    return [...people].filter((p) => !p.isGroup).sort((a, b) => score(b) - score(a))[0];
  }, [data, store.overrides]);
  const labels = useMemo(() => Object.fromEntries(fieldCatalog.map((f) => [f.name, f.label])), [fieldCatalog]);
  const counts = sample ? { opps: showRelated.opps ? data.opportunities.filter((o) => o.contactIds.includes(sample.Id)).length : 0, leads: showRelated.leads ? data.projectLeads.filter((o) => o.contactIds.includes(sample.Id)).length : 0, cs: showRelated.cs ? data.csProjects.filter((o) => o.contactIds.includes(sample.Id)).length : 0, notes: (store.comments[sample.Id] || []).length } : null;

  const extras = showFields.filter((f) => f !== 'Title');
  const list = useMemo(() => fieldCatalog.filter((f) => f.name !== 'Title' && (f.type !== 'reference' || f.name === 'OwnerId')), [fieldCatalog]);
  const shown = list.filter((f) => !showFields.includes(f.name) && (!q || `${f.label} ${f.name}`.toLowerCase().includes(q.toLowerCase()))).slice(0, 80);
  const move = (name, d) => { const i = extras.indexOf(name), j = i + d; if (j < 0 || j >= extras.length) return; const n = [...extras]; [n[i], n[j]] = [n[j], n[i]]; setShow('showFields', showFields.includes('Title') ? ['Title', ...n] : n); };
  const addField = (k) => setCardFields([...showFields, k]);
  const dropField = (k) => setCardFields(showFields.filter((x) => x !== k));
  const Sw = ({ on, set, label }) => <label><input type="checkbox" checked={!!on} onChange={(e) => set(e.target.checked)} /> {label}</label>;
  const Seg = ({ value, options, onPick }) => <div className="segrow">{options.map(([v, l]) => <button key={v} className={Math.abs(value - v) < 0.001 ? 'on' : ''} onClick={() => onPick(v)}>{l}</button>)}</div>;

  return (
    <aside className="side wide">
      <Head title="Customize cards" sub="Choose what each person's card shows at a glance" onClose={onClose} />
      {sample && counts && <div className="cpreview"><CardBody data={{ p: sample, color: '#4b5bff', showFields, counts, branchLabel: null, labels, hl: highlight, layout: L, notesList: [] }} /></div>}
      <div className="muted sm" style={{ textAlign: 'center', marginTop: -4 }}>Preview{sample ? ` — ${sample.Name}` : ''}</div>

      <h4>Start from</h4>
      <div className="presets">{Object.entries(PRESETS).map(([k, v]) => <button key={k} onClick={() => store.applyPreset(k)}><b>{v.label}</b><span>{v.note}</span></button>)}</div>

      <h4>Show on the card</h4>
      <div className="toggles">
        <Sw label="Title" on={showFields.includes('Title')} set={(on) => setShow('showFields', on ? ['Title', ...extras] : extras)} />
        <Sw label="Role" on={highlight.role} set={(on) => setShow('highlight', { ...highlight, role: on })} />
        <Sw label="ES / ECM status" on={highlight.es} set={(on) => setShow('highlight', { ...highlight, es: on })} />
        <Sw label="★ ECM star" on={highlight.ecm} set={(on) => setShow('highlight', { ...highlight, ecm: on })} />
        <Sw label="Office / region name" on={L.office} set={(on) => setLayout({ office: on })} />
        <Sw label="Opportunities" on={showRelated.opps} set={(on) => setShow('showRelated', { ...showRelated, opps: on })} />
        <Sw label="Project leads" on={showRelated.leads} set={(on) => setShow('showRelated', { ...showRelated, leads: on })} />
        <Sw label="CS projects" on={showRelated.cs} set={(on) => setShow('showRelated', { ...showRelated, cs: on })} />
        <Sw label="Comments (badge + hover)" on={L.comments} set={(on) => setLayout({ comments: on })} />
        <Sw label="Quick buttons (in · ZI · Lu · Hide)" on={L.actions} set={(on) => setLayout({ actions: on })} />
        <Sw label="Field names (e.g. “Email”)" on={L.labels} set={(on) => setLayout({ labels: on })} />
      </div>

      <h4>Size</h4>
      <div className="muted sm">Card width</div>
      <Seg value={L.width} options={[[190, 'Narrow'], [220, 'Standard'], [280, 'Wide'], [340, 'Extra wide']]} onPick={(w) => setLayout({ width: w })} />
      <div className="muted sm">Text size</div>
      <Seg value={L.font} options={[[0.9, 'Small'], [1, 'Normal'], [1.15, 'Large']]} onPick={(f) => setLayout({ font: f })} />

      <h4>Salesforce fields <em>{extras.length}</em></h4>
      {extras.length > 0 && (
        <div className="picked">{extras.map((k, i) => (
          <div className="pk" key={k}><b title={k}>{labels[k] || k}</b>
            <button disabled={i === 0} onClick={() => move(k, -1)} title="Move up">↑</button>
            <button disabled={i === extras.length - 1} onClick={() => move(k, 1)} title="Move down">↓</button>
            <button onClick={() => dropField(k)} title="Remove from the card">×</button></div>))}</div>
      )}
      <input placeholder="Add a field — search the Contact fields…" value={q} onChange={(e) => setQ(e.target.value)} />
      {(q || !extras.length) && <div className="fieldlist" style={{ maxHeight: 200 }}>
        {shown.map((f) => <label key={f.name} onClick={(e) => { e.preventDefault(); addField(f.name); }}><span>＋ {f.label}</span><small>{f.name === f.label ? '' : f.name}</small></label>)}
        {!shown.length && <div className="muted sm" style={{ padding: 10 }}>No more fields match.</div>}
      </div>}
      <div className="muted sm">Only fields your Salesforce user can see are listed. They show in the order above.</div>

      <h4>Filter</h4>
      <label className="row" style={{ justifyContent: 'flex-start' }}><input type="checkbox" checked={hideUntitled} onChange={() => setShow('hideUntitled', !hideUntitled)} /> Hide contacts without a title</label>

      <div className="row" style={{ marginTop: 8 }}>
        <button className="btn ghost sm" onClick={() => store.resetCard()}>Reset to Standard</button>
        <button className="btn sm" onClick={() => store.saveCardDefault()} title="Boards you haven't customised will start with this layout">Use for my new boards</button>
      </div>
    </aside>
  );
}

// ---- CSV (Sales Navigator exports etc.) -------------------------------------------------------
function parseCsv(text) {
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
    else if (ch === '"') q = true; else if (ch === ',') { row.push(cur); cur = ''; }
    else if (ch === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; } else if (ch !== '\r') cur += ch;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  const head = (rows.shift() || []).map((h) => h.trim().toLowerCase());
  const col = (...names) => head.findIndex((h) => names.some((n) => h.includes(n)));
  const iF = col('first name'), iL = col('last name'), iN = col('full name', 'name'), iT = col('title', 'position', 'headline'),
    iU = col('profile url', 'linkedin', 'url'), iE = col('email'), iC = col('location', 'city');
  return rows.filter((r) => r.some(Boolean)).map((r) => ({
    name: iF >= 0 && iL >= 0 ? `${r[iF]} ${r[iL]}`.trim() : r[iN] || '', title: r[iT], linkedin: r[iU], email: iE >= 0 ? r[iE] : undefined, city: iC >= 0 ? r[iC] : undefined, source: 'Sales Navigator',
  })).filter((r) => r.name);
}

/** Connect / disconnect one provider with the user's OWN credentials. Secrets are write-only. */
function Connect({ provider, fields, hint }) {
  const { status, refreshStatus } = useStore();
  const st = status.enrichment[provider];
  const [v, setV] = useState({}); const [err, setErr] = useState(null); const [open, setOpen] = useState(false);
  const save = async () => { try { await api(`/credentials/${provider}`, jsonOpts('PUT', v)); setV({}); setOpen(false); setErr(null); await refreshStatus(); } catch (e) { setErr(e.message); } };
  const drop = async () => { await api(`/credentials/${provider}`, { method: 'DELETE' }); await refreshStatus(); };
  if (st?.connected && !open) return <div className="row"><span className="ok">● Connected{st.label ? ` as ${st.label}` : ''}</span><span>{SIGN_IN[provider] && <a className="link" href={SIGN_IN[provider].url} target="_blank" rel="noopener noreferrer">Open {SIGN_IN[provider].label} ↗</a>}{' · '}<button className="link" onClick={drop}>Disconnect</button></span></div>;
  const si = SIGN_IN[provider];
  return (
    <div className="connect">
      {si && <a className="btn ghost sm signin-link" href={si.url} target="_blank" rel="noopener noreferrer">Sign in to {si.label} ↗</a>}
      <p className="muted sm">{hint}</p>
      {fields.map(([k, label, type]) => <F key={k} label={label}><input type={type || 'text'} autoComplete="off" value={v[k] || ''} onChange={(e) => setV({ ...v, [k]: e.target.value })} /></F>)}
      {err && <div className="warn">{err}</div>}
      <button className="btn sm" disabled={fields.some(([k]) => !v[k])} onClick={save}>Save securely</button>
      <div className="muted sm">Stored encrypted on this machine, tied to your user. It is never sent back to the browser.</div>
    </div>
  );
}

export function EnrichPanel({ onClose: closePanel }) {
  const store = useStore();
  const { account, status } = store;
  const people0 = store.people();
  const runRef = React.useRef();
  const onClose = () => { useStore.setState({ enrichTarget: null }); closePanel(); };
  const et = store.enrichTarget;
  const target = et ? people0.find((p) => p.Id === et.id) : null;
  const [tab, setTab] = useState(et?.provider || 'zoominfo');
  const [titles, setTitles] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [found, setFound] = useState([]);
  const people = store.people();
  const match = (c) => people.find((p) => norm(p.Name) === norm(c.name));
  const connected = status.enrichment[tab]?.connected;
  const runNow = (prov) => run(prov);
  runRef.current = runNow;

  const run = async (prov = tab) => {
    setBusy(true); setErr(null);
    try {
      const body = target ? { company: account.Name, names: [target.Name] }
        : prov === 'lusha' ? { company: account.Name, names: people.filter((p) => !p.Email || !p.Phone).map((p) => p.Name).slice(0, 25) }
        : { company: account.Name, titles: titles.split(',').map((t) => t.trim()).filter(Boolean) };
      const res = await api(`/enrich/${prov}`, jsonOpts('POST', body));
      setFound(res); if (target && !res.length) setErr(`No ${prov === 'lusha' ? 'Lusha' : 'ZoomInfo'} match found for ${target.Name}.`);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  // A lookup started from a card button applies to that card; otherwise results are matched by name.
  React.useEffect(() => {
    if (!et) return;
    setTab(et.provider); setFound([]); setErr(null);
    if (status.enrichment[et.provider]?.connected) setTimeout(() => runRef.current?.(et.provider), 0);
  }, [et?.id, et?.provider]);
  const accept = (c) => {
    const m = target || match(c);
    if (m) { // fill only the blanks of an existing person
      const fields = {}; if (!m.Title && c.title) store.patch(m.Id, { title: c.title }); if (!m.Email && c.email) fields.Email = c.email; if (!m.Phone && c.phone) fields.Phone = c.phone;
      if (!m.Linkedin_Profile_URL__c && c.linkedin) fields.Linkedin_Profile_URL__c = c.linkedin; if (!m.MailingCity && c.city) fields.MailingCity = c.city;
      store.patch(m.Id, { fields: { ...(store.overrides[m.Id]?.fields || {}), ...fields } });
    } else store.addExtra({ Name: c.name, Title: c.title, Email: c.email, Phone: c.phone, Linkedin_Profile_URL__c: c.linkedin, MailingCity: c.city, source: c.source });
    setFound((f) => f.filter((x) => x !== c));
  };
  const acceptAll = () => { found.slice().forEach(accept); store.autoBuild(); };
  const onFile = async (e) => { const f = e.target.files[0]; if (f) setFound(parseCsv(await f.text())); };
  const salesNavUrl = `https://www.linkedin.com/sales/search/people?query=(filters:List((type:CURRENT_COMPANY,values:List((text:${encodeURIComponent(account.Name)},selectionType:INCLUDED)))))`;

  return (
    <aside className="side wide">
      <Head title="Enrich" sub={target ? `Looking up ${target.Name}` : account.Name} onClose={onClose} />
      <div className="tabs">{[['zoominfo', 'ZoomInfo'], ['lusha', 'Lusha'], ['salesnav', 'Sales Nav']].map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => { setTab(k); setFound([]); setErr(null); }}>{l}</button>)}</div>
      {tab === 'zoominfo' && <>
        <Connect provider="zoominfo" fields={[['username', 'ZoomInfo username (email)'], ['password', 'Password', 'password']]} hint="Use your own ZoomInfo login. Your licence must include API access." />
        {connected && !target && <><p className="muted sm">Finds contacts at the company that aren’t on the board yet.</p><input placeholder="Optional title keywords, e.g. Project Executive, VP Operations" value={titles} onChange={(e) => setTitles(e.target.value)} /></>}
      </>}
      {tab === 'lusha' && <>
        <Connect provider="lusha" fields={[['apiKey', 'Your Lusha API key', 'password']]} hint="Lusha → Settings → API. Each person uses their own key, so credits come out of their own plan." />
        {connected && !target && <p className="muted sm">Looks up email, phone and LinkedIn for people on the board who are missing them (up to 25 per run).</p>}
      </>}
      {tab === 'salesnav' && <>
        <p className="muted sm">Sales Navigator has no public API, so there is nothing to log in to. Open the company search with your own Sales Navigator session, export the list with the tool you normally use, and import the CSV here (name, title, profile URL, email and location columns are detected).</p>
        <div className="row" style={{ justifyContent: 'flex-start', gap: 8 }}>
          <a className="btn ghost sm" href={SIGN_IN.linkedin.url} target="_blank" rel="noopener noreferrer">Sign in to LinkedIn ↗</a>
          <a className="btn ghost sm" href={salesNavUrl} target="_blank" rel="noreferrer">Open company in Sales Navigator ↗</a>
        </div>
        <input type="file" accept=".csv" onChange={onFile} />
      </>}
      {tab !== 'salesnav' && connected && <button className="btn" disabled={busy} onClick={() => run()}>{busy ? 'Searching…' : target ? `Look up ${target.Name}` : 'Run enrichment'}</button>}
      {err && <div className="warn">{err}</div>}
      <ul className="cands">
        {found.map((c, i) => { const m = match(c); return (
          <li key={i}><div><b>{c.name}</b><div className="muted sm">{c.title}</div><div className="muted sm">{[c.email, c.phone, c.city].filter(Boolean).join(' · ')}</div></div>
            <button className="btn sm" onClick={() => accept(c)}>{target || m ? 'Fill gaps' : 'Add to board'}</button></li>); })}
      </ul>
      {found.length > 0 && <button className="btn ghost sm" onClick={acceptAll}>Accept all &amp; re-run auto-build</button>}
    </aside>
  );
}

// ---- Reference: uploaded Miro export (image/PDF) and Miro API import -------------------------
async function fileToImage(file) {
  if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
    const pdfjs = await import('pdfjs-dist');
    const worker = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
    pdfjs.GlobalWorkerOptions.workerSrc = worker;
    const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
    const page = await pdf.getPage(1);
    const vp = page.getViewport({ scale: 2 });
    const cv = document.createElement('canvas'); cv.width = vp.width; cv.height = vp.height;
    await page.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
    return cv.toDataURL('image/png');
  }
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
}

// Accepts a pasted Miro iframe snippet or a plain link; returns the embeddable URL or null.
function miroEmbedUrl(input) {
  const raw = (String(input).match(/src=["']([^"']+)["']/i)?.[1] || String(input)).trim().replace(/&amp;/g, '&');
  try {
    const u = new URL(raw);
    if (!/(^|\.)miro\.com$/.test(u.hostname)) return null;
    const m = u.pathname.match(/(?:board|live-embed)\/([^/]+)/);
    if (!m) return null;
    const keep = u.searchParams.get('moveToViewport');
    return `https://miro.com/app/live-embed/${m[1]}/?embedMode=view_only_without_ui${keep ? `&moveToViewport=${keep}` : ''}`;
  } catch { return null; }
}

export function ReferencePanel({ onClose }) {
  const store = useStore(); const { reference, status } = store;
  const [embed, setEmbed] = useState('');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(null);
  const [board, setBoard] = useState('');
  const people = store.people();
  const linked = !!(reference.embedUrl || reference.dataUrl);
  const link = (url) => { store.setShow('reference', { ...reference, embedUrl: url, boardLink: url, dataUrl: null, name: 'Miro board', visible: true }); setEmbed(''); onClose(); };

  const onFile = async (e) => {
    const f = e.target.files[0]; if (!f) return; setBusy(true); setErr(null);
    try { store.setShow('reference', { ...reference, dataUrl: await fileToImage(f), name: f.name, visible: true }); } catch (x) { setErr(`Couldn’t read that file: ${x.message}`); } finally { setBusy(false); }
  };

  // All three ways of reading a board end in the same review screen, so nothing changes until you approve it.
  const openReview = (cards, headers, edges, source) => {
    if (!cards.length) throw new Error('No people cards were found.');
    store.setReview(buildRows(cards, headers, edges, people, source)); onClose();
  };
  const importMiro = async () => {
    setBusy(true); setErr(null);
    try {
      const { items, connectors } = await api('/miro/import', jsonOpts('POST', { board: board || reference.boardLink }));
      const { cards, headers, edges } = cardsFromMiro(items, connectors, people);
      openReview(cards, headers, edges, 'Miro board');
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  // Read the uploaded picture with Claude: tiles go to the server, the answer is matched to real contacts.
  const [reading, setReading] = useState(null);
  const readImage = async () => {
    setErr(null);
    try {
      setReading('Preparing the image…');
      const { tiles, cols, rows } = await tileImage(reference.dataUrl);
      setReading(`Reading ${tiles.length} part${tiles.length > 1 ? 's' : ''} of the picture (${cols}×${rows}) — this takes about ${Math.max(15, tiles.length * 12)} seconds…`);
      const cards = await api('/vision/org-chart', jsonOpts('POST', { images: tiles, names: people.map((p) => p.Name), account: store.account.Name }));
      openReview(cards.map((c, i) => ({ id: `c${i}`, name: c.name, title: c.title, group: c.group, color: ['green', 'orange', 'yellow'].includes(c.color) ? c.color : 'neutral', notes: c.notes })), [], [], 'picture');
    } catch (e) { setErr(e.message); } finally { setReading(null); }
  };
  // Free, on-computer reading (OCR + line and box detection). Nothing is uploaded anywhere.
  const readLocal = async () => {
    setErr(null); setReading('Reading the picture on this computer… usually 10–40 seconds');
    try {
      const out = await api('/ocr/org-chart', jsonOpts('POST', { dataUrl: reference.dataUrl }));
      const cards = out.cards.map((c) => ({ id: c.id, name: c.name, title: c.title, group: c.group, color: colorToStatus(c.fill) || 'neutral', notes: null }));
      openReview(cards, out.headers, out.edges || [], 'picture');
    } catch (e) { setErr(e.message); } finally { setReading(null); }
  };
  const [useAI, setUseAI] = useState(false);
  const isImage = !!reference.dataUrl;

  return (
    <aside className="side wide">
      <Head title="Miro reference" sub="Keep your existing map next to this one" onClose={onClose} />
      {!linked ? <>
        <p className="sm">Paste the link to your Miro board. It shows up next to your map right away.</p>
        <input autoFocus className="bigfield" placeholder="Paste Miro link here…" value={embed}
          onChange={(e) => setEmbed(e.target.value)}
          onPaste={(e) => { const u = miroEmbedUrl(e.clipboardData.getData('text')); if (u) { e.preventDefault(); link(u); } }}
          onKeyDown={(e) => { if (e.key === 'Enter' && miroEmbedUrl(embed)) link(miroEmbedUrl(embed)); }} />
        {embed && !miroEmbedUrl(embed) && <div className="muted sm">Press Enter once the full link is in.</div>}
        <p className="muted sm">In Miro: open the board → <b>Share</b> → <b>Copy board link</b>. For a private board, be signed in to Miro in this browser.</p>
        <h4>Or upload a picture of the board</h4>
        <p className="muted sm">Export from Miro (board menu → Export → image or PDF) and upload it. It appears next to your map, and you can then have it <b>read</b> to fill in offices, colors and notes.</p>
        <input type="file" accept="image/*,.pdf,application/pdf" onChange={onFile} disabled={busy} />
      </> : <>
        <div className="row"><span className="ok">● {isImage ? 'Picture' : 'Miro board'} shown{isImage && reference.name ? `: ${reference.name}` : ''}</span>
          <span><button className="link" onClick={() => store.setShow('reference', { ...reference, visible: !reference.visible })}>{reference.visible ? 'Hide' : 'Show'}</button>{' · '}
            <button className="link" onClick={() => { store.setShow('reference', { ...reference, dataUrl: null, embedUrl: null, name: null }); }}>Remove</button></span></div>
        <F label="Size"><input type="range" min="280" max="1100" step="20" value={reference.w} onChange={(e) => store.setShow('reference', { ...reference, w: +e.target.value })} /></F>
        <F label="Transparency"><input type="range" min="0.2" max="1" step="0.05" value={reference.opacity} onChange={(e) => store.setShow('reference', { ...reference, opacity: +e.target.value })} /></F>
        <p className="muted sm">Drag the window by its title bar to move it.</p>
        {isImage && <>
          <h4>Use this picture to build the map</h4>
          <p className="muted sm">Right now the picture is only shown for reference. <b>Read it</b> to find the people, their offices, colors and notes, and match them to this account’s contacts. It runs on this computer — nothing is uploaded — and you approve the result before anything changes.</p>
          <button className="btn" disabled={!!reading} onClick={readLocal}>{reading && !useAI ? 'Reading…' : '✨ Read people from this picture'}</button>
          {reading && <div className="muted sm">{reading}</div>}
          <button className="link sm" onClick={() => setUseAI(!useAI)}>{useAI ? '▾' : '▸'} Messy picture? Use Claude instead (needs an Anthropic API key)</button>
          {useAI && (status.enrichment.anthropic?.connected
            ? <button className="btn ghost" disabled={!!reading} onClick={readImage}>{reading ? 'Reading…' : 'Read with Claude'}</button>
            : <Connect provider="anthropic" fields={[['apiKey', 'Your Anthropic API key', 'password']]} hint="Claude reads messy pictures better, but the picture is sent to Anthropic for this step." />)}
        </>}
      </>}

      <details className="more">
        <summary>More options</summary>
        {linked && <>
          <h4>Replace with a different picture</h4>
          <input type="file" accept="image/*,.pdf,application/pdf" onChange={onFile} disabled={busy} />
        </>}
        <h4>Copy the structure straight from Miro</h4>
        <p className="muted sm">Reads the board through Miro’s API and proposes offices and reporting lines. Needs a Miro access token for an app installed on the team that owns the board. If Miro rejects the token, upload a picture instead.</p>
        <Connect provider="miro" fields={[['token', 'Your Miro access token', 'password']]} hint="Miro → Profile → Settings → Your apps → create an app with boards:read → Install app and get OAuth token." />
        {status.enrichment.miro?.connected && <>
          <input placeholder="Board link" value={board || reference.boardLink || ''} onChange={(e) => setBoard(e.target.value)} />
          <button className="btn" disabled={busy || !(board || reference.boardLink)} onClick={() => importMiro()}>{busy ? 'Reading board…' : 'Read board'}</button>
        </>}
      </details>
      {err && <div className="warn">{err}</div>}
    </aside>
  );
}

export function ReferenceOverlay() {
  const { reference, setShow } = useStore();
  const [pos, setPos] = useState(null);
  if (!(reference.dataUrl || reference.embedUrl) || !reference.visible) return null;
  const live = !!reference.embedUrl && !reference.dataUrl;
  const drag = (e) => {
    const el = e.currentTarget.parentElement; const r = el.getBoundingClientRect(); const pr = el.parentElement.getBoundingClientRect();
    const dx = e.clientX - r.left, dy = e.clientY - r.top;
    const move = (m) => setPos({ left: m.clientX - pr.left - dx, top: m.clientY - pr.top - dy });
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
  };
  return (
    <div className="refwin" style={{ width: reference.w, opacity: reference.opacity, ...(pos || {}) }}>
      <header onMouseDown={drag}><b>Reference</b><span className="muted">{live ? 'Miro (live)' : reference.name}</span><span className="grow" /><button className="x" onClick={() => setShow('reference', { ...reference, visible: false })}>×</button></header>
      <div className="body">
        {live ? <iframe title="Miro board" src={reference.embedUrl} style={{ width: '100%', height: Math.round(reference.w * 0.62), border: 0, display: 'block' }} allow="fullscreen; clipboard-read; clipboard-write" allowFullScreen />
          : <img src={reference.dataUrl} alt="Reference map" draggable={false} />}
      </div>
    </div>
  );
}

export function AccountPanel({ onClose }) {
  const store = useStore(); const { account: a, data, accountNotes, setNotes } = store;
  const demo = String(a.Id).startsWith('demo');
  const where = [a.BillingCity, a.BillingState, a.BillingCountry].filter(Boolean).join(', ');
  const rows = [['Type', a.Type], ['Industry', a.Industry], ['Location', where], ['Employees', a.NumberOfEmployees?.toLocaleString()], ['Annual revenue', fmtMoney(a.AnnualRevenue)],
    ['Account owner', a.Owner], ['Parent account', a.Parent]].filter(([, v]) => v);
  const flags = [a.Target_Account__c && 'Target account', a.Sales_Focus__c && 'Sales focus', a.Strategic_Account__c && 'Strategic'].filter(Boolean);
  const open = data.opportunities.filter((o) => o.StageName && !/^closed/i.test(o.StageName));
  const closed = data.opportunities.filter((o) => !open.includes(o));
  const List = ({ title, items, render }) => (<><h4>{title} <em>{items.length}</em></h4>{items.length
    ? <ul className="rel">{items.slice(0, 25).map((i) => <li key={i.Id}>{render(i)}</li>)}{items.length > 25 && <li className="muted sm">+ {items.length - 25} more</li>}</ul> : <div className="muted sm">None</div>}</>);
  return (
    <aside className="side wide">
      <Head title={a.Name} sub={flags.join(' · ') || 'Account'} onClose={onClose} />
      <dl>{rows.map(([k, v]) => <React.Fragment key={k}><dt>{k}</dt><dd>{v}</dd></React.Fragment>)}
        {a.Website && <><dt>Website</dt><dd><a href={a.Website} target="_blank" rel="noreferrer">{a.Website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')} ↗</a></dd></>}</dl>
      {a.ParentId && <div className="muted sm" style={{ margin: '8px 0' }}>Part of <b>{a.Parent}</b> · <button className="link" onClick={() => store.open(a.ParentId, a.Parent)}>Open the parent / family board ↗</button></div>}
      {(data.family?.length || 0) > 1 && <>
        <h4>Accounts in this family <em>{data.family.length}</em></h4>
        <ul className="rel">{data.family.map((f) => (
          <li key={f.Id}><b>{f.Name}</b><span>{f.people} people{f.Target ? ' · Target' : ''}{f.SalesFocus ? ' · Sales focus' : ''}{f.Id !== a.Id && <> · <button className="link" onClick={() => store.open(f.Id, f.Name)}>open board</button></>}</span></li>))}</ul>
        {data.truncated && <div className="warn">Only the first 2,000 contacts were loaded for this family.</div>}
      </>}
      {!demo && <a className="btn ghost sm" href={`https://buildots.lightning.force.com/lightning/r/Account/${a.Id}/view`} target="_blank" rel="noreferrer">Open in Salesforce ↗</a>}
      {a.Description && <><h4>Salesforce description</h4><pre className="summary">{a.Description}</pre></>}
      <h4>Company info / research</h4>
      <textarea className="notes" rows={12} placeholder={'Revenue and rankings, history, how they are organised, key themes, events…\n(kept on this board only — not saved to Salesforce)'}
        value={accountNotes} onChange={(e) => setNotes(e.target.value)} />
      <List title="Open opportunities" items={open} render={(o) => <><b>{o.Name}</b><span>{o.StageName} · {fmtMoney(o.Amount) || '—'} · close {fmtDate(o.CloseDate)}</span></>} />
      <List title="Closed opportunities" items={closed} render={(o) => <><b>{o.Name}</b><span>{o.StageName} · {fmtMoney(o.Amount) || '—'} · {fmtDate(o.CloseDate)}</span></>} />
      <List title="Project leads" items={data.projectLeads} render={(o) => <><b>{o.Name}</b><span>{o.contactIds.length} contact{o.contactIds.length === 1 ? '' : 's'} linked</span></>} />
      <List title="CS projects" items={data.csProjects} render={(o) => <><b>{o.Name}</b><span>{o.Status || '—'} · {o.contactIds.length} contact{o.contactIds.length === 1 ? '' : 's'}</span></>} />
    </aside>
  );
}
