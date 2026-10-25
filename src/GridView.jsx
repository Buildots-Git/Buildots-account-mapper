import React, { useMemo, useState } from 'react';
import { useStore } from './store.js';
import { ES_STATES, ROLES, rankOf, CONTACT_STATUS, titleRecognized } from './hierarchy.js';
import { matchesSearch, onBoard } from './search.js';

// Every column the grid can show. `w` is its width in px; the table scrolls sideways only if you add many.
const COLS = [
  { k: 'account', label: 'Account', w: 170 }, { k: 'title', label: 'Title', w: 210 }, { k: 'reportsTo', label: 'Reports to', w: 190 }, { k: 'department', label: 'Department', w: 130 },
  { k: 'region', label: 'Region', w: 120 }, { k: 'country', label: 'Country', w: 110 }, { k: 'role', label: 'Role', w: 140 },
  { k: 'es', label: 'ES status', w: 110 }, { k: 'status', label: 'Contact status', w: 150 }, { k: 'ecm', label: 'ECM ★', w: 70 }, { k: 'email', label: 'Email', w: 210 },
  { k: 'source', label: 'Source', w: 95 }, { k: 'vis', label: 'On board', w: 80 },
];

export default function GridView() {
  const store = useStore();
  const { patch, select, selected, psearch: search, gridCols, hideUntitled, setVisible } = store;
  const people = useMemo(() => store.people(), [store.data, store.extras, store.overrides]);
  const pend = useMemo(() => new Set(store.pendingChanges().map((f) => f.Id)), [store.data, store.overrides]);
  const [menu, setMenu] = useState(false);
  const family = (store.data?.family?.length || 0) > 1;
  const cols = COLS.filter((c) => (c.k === 'account' ? family : gridCols.includes(c.k)));
  const setCols = (list) => store.setShow('gridCols', list);
  const rows = useMemo(() => people.filter((p) => matchesSearch(p, search)).sort((a, b) => rankOf(a.Title) - rankOf(b.Title) || a.Name.localeCompare(b.Name)), [people, search]);
  const byId = useMemo(() => Object.fromEntries(people.map((p) => [p.Id, p])), [people]);
  const depth = (p, n = 0) => { const par = byId[p.reportsTo]; return par && n < 8 ? depth(par, n + 1) : n; };
  const NAME_W = 190;
  const onCount = rows.filter((p) => onBoard(p, hideUntitled)).length;
  const allOn = rows.length > 0 && onCount === rows.length;
  const ids = rows.map((p) => p.Id);
  const headRef = (el) => { if (el) el.indeterminate = onCount > 0 && !allOn; };

  const cell = (c, p) => {
    switch (c.k) {
      case 'title': return <input className={titleRecognized(p.Title) ? '' : 'needs-review'} placeholder={titleRecognized(p.Title) ? '' : 'Title not recognised'}  title={p.Title || ''} defaultValue={p.Title || ''} onBlur={(e) => e.target.value !== (p.Title || '') && patch(p.Id, { title: e.target.value })} />;
      case 'reportsTo': return (
        <select title="Reports to" value={p.reportsTo || ''} onChange={(e) => patch(p.Id, { reportsTo: e.target.value || null, manual: true })}>
          <option value="">— top —</option>
          {people.filter((o) => o.Id !== p.Id).sort((a, b) => a.Name.localeCompare(b.Name)).map((o) => <option key={o.Id} value={o.Id}>{o.Name}</option>)}
        </select>);
      case 'account': return <span className="ell" title={p.AccountName || ''}>{p.AccountName}</span>;
      case 'department': return <span className="ell" title={p.Department || ''}>{p.Department}</span>;
      case 'region': return <input defaultValue={p.Region__c || ''} onBlur={(e) => e.target.value !== (p.Region__c || '') && patch(p.Id, { region: e.target.value || null })} />;
      case 'country': return <span className="ell">{p.MailingCountry}</span>;
      case 'role': return <select value={p.Contact_Role__c || ''} onChange={(e) => patch(p.Id, { role: e.target.value || null })}><option value="" />{ROLES.map((r) => <option key={r}>{r}</option>)}</select>;
      case 'es': return <select value={p.ES_Expansion_Status__c || ''} onChange={(e) => patch(p.Id, { es: e.target.value || null })}><option value="" />{ES_STATES.map((r) => <option key={r}>{r}</option>)}</select>;
      case 'status': return <select value={p.cstatus || ''} onChange={(e) => store.setStatus([p.Id], e.target.value || null)}><option value="" />{Object.entries(CONTACT_STATUS).map(([k, v]) => <option key={k} value={k}>{k === 'green' ? '🟢' : k === 'orange' ? '🟠' : '🟡'} {v.label}</option>)}</select>;
      case 'ecm': return <input type="checkbox" title="Enterprise Coalition Member" checked={!!p.Enterprise_Coalition_Member__c} onChange={(e) => patch(p.Id, { ecm: e.target.checked })} />;
      case 'email': return <span className="ell" title={p.Email || ''}>{p.Email}</span>;
      case 'source': return <span className="muted ell">{p.external ? p.source || 'external' : 'Salesforce'}</span>;
      case 'vis': return <input type="checkbox" title="Show this person on the board" checked={onBoard(p, hideUntitled)} onChange={(e) => setVisible([p.Id], e.target.checked)} />;
      default: return null;
    }
  };

  return (
    <div className="grid-wrap">
      <div className="grid-bar">
        <span className="muted">{rows.length} of {people.length} people</span>
        <button className="btn ghost sm" disabled={!rows.length || allOn} title="Put everyone in the current list on the board" onClick={() => setVisible(ids, true)}>Select all</button>
        <button className="btn ghost sm" disabled={!onCount} title="Take everyone in the current list off the board" onClick={() => setVisible(ids, false)}>Deselect all</button>
        <span className="muted sm">{onCount} on board{rows.length !== people.length ? ' (in this list)' : ''}</span>
        <span className="grow" />
        <div className="rel-menu">
          <button className="btn ghost sm" onClick={() => setMenu(!menu)}>Columns ▾</button>
          {menu && <div className="pop" onMouseLeave={() => setMenu(false)}>
            <h4>Show columns</h4>
            {COLS.filter((c) => c.k !== 'account').map((c) => <label key={c.k}><input type="checkbox" checked={gridCols.includes(c.k)} onChange={() => setCols(gridCols.includes(c.k) ? gridCols.filter((x) => x !== c.k) : COLS.map((x) => x.k).filter((k) => k === c.k || gridCols.includes(k)))} /> {c.label}</label>)}
            <button className="link" onClick={() => setCols(['title', 'reportsTo', 'role', 'es', 'vis'])}>Reset to compact</button>
          </div>}
        </div>
      </div>
      <div className="grid-scroll">
        <table className="grid" style={{ width: NAME_W + cols.reduce((a, c) => a + c.w, 0) }}>
          <colgroup><col style={{ width: NAME_W }} />{cols.map((c) => <col key={c.k} style={{ width: c.w }} />)}</colgroup>
          <thead><tr><th className="sticky">Name</th>{cols.map((c) => <th key={c.k}>{c.k === 'vis' ? <label className="row" style={{ gap: 4 }} title="Select / deselect everyone in this list"><input type="checkbox" ref={headRef} checked={allOn} onChange={(e) => setVisible(ids, e.target.checked)} />{c.label}</label> : c.label}</th>)}</tr></thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.Id} className={`${p.Id === selected ? 'sel' : ''}${onBoard(p, hideUntitled) ? '' : ' off'}`} onClick={() => select(p.Id)}>
                <td className="sticky" style={{ paddingLeft: 8 + Math.min(depth(p), 5) * 10 }}><b className="ell" title={p.Name}>{p.Name}</b>{p.manual && <span className="dot-manual" title="Reporting line set by hand" />}{pend.has(p.Id) && <span className="pend-chip" title="Changed here, not in Salesforce yet — use ⋯ → Push changes to Salesforce">↑ unpushed</span>}</td>
                {cols.map((c) => <td key={c.k}>{cell(c, p)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <div className="muted" style={{ padding: 20 }}>No one matches that search.</div>}
      </div>
    </div>
  );
}
