import React, { useEffect, useMemo } from 'react';
import { useStore } from './store.js';
import { SEARCH_FIELDS, matchesSearch, distinctValues, onBoard } from './search.js';

const PLACEHOLDER = { any: 'Search anyone…', name: 'Contact name…', department: 'Department…', region: 'Region…', country: 'Country…', role: 'Role…' };

export default function SearchBar() {
  const store = useStore();
  const { psearch: search, setSearch, view, hideUntitled } = store;
  const people = store.people();
  const matched = useMemo(() => (search.q.trim() ? people.filter((p) => matchesSearch(p, search)) : []), [people, search]);
  const suggestions = useMemo(() => (search.field === 'any' || search.field === 'name' ? [] : distinctValues(people, search.field)), [people, search.field]);
  const active = !!search.q.trim();

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
      <span className="muted sm">Search by</span>
      <select value={search.field} onChange={(e) => setSearch({ field: e.target.value })}>
        {SEARCH_FIELDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
      </select>
      <input list="search-suggest" placeholder={PLACEHOLDER[search.field]} value={search.q} onChange={(e) => setSearch({ q: e.target.value })} />
      <datalist id="search-suggest">{suggestions.map((v) => <option key={v} value={v} />)}</datalist>
      {active && <>
        <span className="sm"><b>{matched.length}</b> of {people.length} match</span>
        {view === 'board' && <label className="sm row" style={{ gap: 5 }}><input type="checkbox" checked={search.only} onChange={(e) => setSearch({ only: e.target.checked })} /> Only show matches</label>}
        <button className="link" onClick={() => setSearch({ q: '' })}>Clear</button>
      </>}
    </div>
  );
}
