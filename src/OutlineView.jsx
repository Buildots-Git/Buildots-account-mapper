import React, { useMemo, useState } from 'react';
import { useStore } from './store.js';
import { matchesSearch, onBoard, filtersActive } from './search.js';
import { ES_COLORS } from './hierarchy.js';

// The reporting tree as an indented list: scan a big org top-down without panning a canvas.
export default function OutlineView() {
  const store = useStore();
  const { psearch: search, hideUntitled, select, selected } = store;
  const people = useMemo(() => store.people().filter((p) => onBoard(p, hideUntitled)), [store.data, store.extras, store.overrides, hideUntitled]);
  const family = store.data?.family || [];
  const [open, setOpen] = useState({});
  const active = filtersActive(search);
  const { roots, kids, count } = useMemo(() => {
    const ids = new Set(people.map((p) => p.Id)); const by = Object.fromEntries(people.map((p) => [p.Id, p]));
    const parent = (p) => { let c = p.reportsTo, n = 0; while (c && !ids.has(c) && n++ < 40) c = by[c]?.reportsTo; return c && c !== p.Id && ids.has(c) ? c : null; };
    const k = {}, r = [];
    people.forEach((p) => { const par = parent(p); if (par) (k[par] ||= []).push(p); else r.push(p); });
    const cnt = {}; const c = (p) => (cnt[p.Id] ??= (k[p.Id] || []).reduce((a, x) => a + 1 + c(x), 0));
    people.forEach(c);
    return { roots: r, kids: k, count: cnt };
  }, [people]);
  const isOpen = (p, depth) => (p.Id in open ? open[p.Id] : active || depth < 1);
  const Row = ({ p, depth }) => {
    const ch = kids[p.Id] || []; const o = isOpen(p, depth); const hit = active && matchesSearch(p, search);
    const [fg] = ES_COLORS[p.ES_Expansion_Status__c] || [];
    return (
      <>
        <div className={`ol-row${p.Id === selected ? ' sel' : ''}${active && !hit ? ' dim' : ''}${hit ? ' hit' : ''}`} style={{ paddingLeft: 12 + depth * 20 }} onClick={() => select(p.Id)}>
          {ch.length ? <button className="ol-tw" onClick={(e) => { e.stopPropagation(); setOpen({ ...open, [p.Id]: !o }); }}>{o ? '▾' : '▸'}</button> : <span className="ol-tw" />}
          <b>{p.Name}</b>{p.Enterprise_Coalition_Member__c && <span className="ecm-dot"> ★</span>}
          <span className="muted"> {p.Title || 'No title'}</span>
          {p.Contact_Role__c && <span className="pill role">{p.Contact_Role__c}</span>}
          {p.ES_Expansion_Status__c && <span className="pill es" style={{ color: fg }}>{p.ES_Expansion_Status__c}</span>}
          {!!ch.length && !o && <span className="muted sm"> +{count[p.Id]}</span>}
        </div>
        {o && ch.map((c) => <Row key={c.Id} p={c} depth={depth + 1} />)}
      </>);
  };
  return (
    <div className="outline">
      <div className="grid-bar"><span className="muted">{people.length} people on the board</span><span className="grow" />
        <button className="link" onClick={() => setOpen(Object.fromEntries(people.map((p) => [p.Id, true])))}>Expand all</button>
        <button className="link" onClick={() => setOpen(Object.fromEntries(people.map((p) => [p.Id, false])))}>Collapse all</button></div>
      <div className="ol-scroll">{family.length > 1
        ? family.map((f) => { const rs = roots.filter((p) => p.AccountId === f.Id); if (!rs.length) return null; const k = `acct:${f.Id}`; const o = k in open ? open[k] : f.Id === family[0].Id || active;
          return (<React.Fragment key={f.Id}>
            <div className="ol-row ol-acct" onClick={() => setOpen({ ...open, [k]: !o })}><span className="ol-tw">{o ? '▾' : '▸'}</span><b>{f.Name}</b><span className="muted sm"> {f.people} people{f.Target ? ' · Target' : ''}</span></div>
            {o && rs.map((p) => <Row key={p.Id} p={p} depth={1} />)}
          </React.Fragment>); })
        : roots.map((p) => <Row key={p.Id} p={p} depth={0} />)}
        {family.length > 1 && roots.filter((p) => !family.some((f) => f.Id === p.AccountId)).map((p) => <Row key={p.Id} p={p} depth={0} />)}
      </div>
    </div>
  );
}
