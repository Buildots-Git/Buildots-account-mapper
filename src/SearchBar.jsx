import React, { useEffect, useMemo } from 'react';
import { useStore } from './store.js';
import { titleRecognized } from './hierarchy.js';
import { SEARCH_FIELDS, FILTERS, matchesSearch, distinctValues, onBoard, filterOptions, filtersActive } from './search.js';

const PLACEHOLDER = { any: 'Search anyone…', name: 'Contact name…', department: 'Department…', region: 'Region…', country: 'Country…', role: 'Role…' };

export default function SearchBar() {
  const store = useStore();
  const { psearch: search, setSearch, view, hideUntitled } = store;
  const people = store.people();
  const active0 = filtersActive(search);
  const matched = useMemo(() => (active0 ? people.filter((p) => matchesSearch(p, search)) : []), [people, search, active0]);
  const suggestions = useMemo(() => (search.field === 'any' || search.field === 'name' ? [] : distinctValues(people, search.field)), [people, search.field]);
  const active = filtersActive(search);
  const filters = search.filters;
  const unrecognised = useMemo(() => people.filter((p) => !titleRecognized(p.Title)).length, [people]);

  // On the board, pan/zoom to the matches once typing pauses (only when it's a sensible number of cards).
  useEffect(() => {
    if (view !== 'board' || !active) return;
    const shown = matched.filter((p) => onBoard(p, hideUntitled));
    if (!shown.length || shown.length > 80) return;
    const t = setTimeout(() => useStore.getState().focus(shown.map((p) => p.Id)), 500);
    return () => clearTimeout(t);
  }, [search.q, search.field, view]);

  return (
    <div className="searchbar">
      <div className="sb-row">
        <span className="muted sm">Search by</span>
        <select value={search.field} onChange={(e) => setSearch({ field: e.target.value })}>
          {SEARCH_FIELDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <input list="search-suggest" placeholder={PLACEHOLDER[search.field]} value={search.q} onChange={(e) => setSearch({ q: e.target.value })} />
        <datalist id="search-suggest">{suggestions.map((v) => <option key={v} value={v} />)}</datalist>
        {FILTERS.filter(([k]) => (k !== 'review' || unrecognised > 0) && (k !== 'account' || (store.data?.family?.length || 0) > 1)).map(([k, label]) => {
          const opts = filterOptions(people, k, filters);
          return (
            <select key={k} className={`flt${filters[k] ? ' on' : ''}`} value={filters[k]} title={`Filter by ${label.toLowerCase()}`} onChange={(e) => useStore.getState().setFilter(k, e.target.value)}>
              <option value="">{label}: all</option>
              {opts.map(([v, n]) => <option key={v} value={v}>{v} ({n})</option>)}
            </select>);
        })}
        {active && <>
          <span className="sm"><b>{matched.length}</b> of {people.length} match</span>
          {view === 'board' && <label className="sm row" style={{ gap: 5 }}><input type="checkbox" checked={search.only} onChange={(e) => setSearch({ only: e.target.checked })} /> Only show matches</label>}
          <button className="link" onClick={() => store.clearFilters()}>Clear</button>
        </>}
        {view === 'board' && !active && <span className="sb-fold">
          <button className="link" onClick={() => store.setAllBranches('collapse')} title="Fold every team into its manager">Collapse all</button>
          <button className="link" onClick={() => store.setAllBranches('expand')} title="Show every team">Expand all</button>
          <button className="link" title="Fit the whole board in view (F)" onClick={() => store.fitAll?.()}>Fit view</button>
        </span>}
      </div>
      {!active && people.length > 30 && (
        <div className="sb-row start">
          <span className="muted sm">Start here:</span>
          <button className="chip" onClick={() => store.setFilter('ecm', 'ECM only')}>ECM only</button>
          <button className="chip" onClick={() => store.setFilter('es', '≥ Aware')}>Engaged (Aware+)</button>
          <button className="chip" onClick={() => store.setAllBranches(null)}>Top levels</button>
          {people.some((p) => p.Contact_Role__c) && <button className="chip" onClick={() => store.setFilter('role', filterOptions(people, 'role', {})[0]?.[0] || '')}>People with a role</button>}
          {unrecognised > 0 && <button className="chip warn" onClick={() => store.setFilter('review', 'Needs review')}>{unrecognised} titles to review</button>}
        </div>)}
    </div>
  );
}
