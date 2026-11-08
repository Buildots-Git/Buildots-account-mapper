import { regionOf, ES_STATES, titleRecognized } from './hierarchy.js';

export const FILTERS = [['role', 'Role'], ['es', 'ES status'], ['ecm', 'ECM'], ['goal', 'Target'], ['account', 'Account'], ['department', 'Department'], ['region', 'Region'], ['country', 'Country'], ['review', 'Title check']];
export const NO_FILTERS = { role: '', es: '', ecm: '', account: '', department: '', region: '', country: '', review: '' };

/** The value a dropdown filter compares against. */
export function filterValue(p, k) {
  switch (k) {
    case 'role': return p.Contact_Role__c || '';
    case 'es': return p.ES_Expansion_Status__c || '';
    case 'ecm': return p.Enterprise_Coalition_Member__c ? 'ECM only' : 'Not ECM';
    case 'goal': return p.goal ? 'Immediate targets' : 'Not a target';
    case 'account': return p.AccountName || '';
    case 'department': return p.Department || '';
    case 'region': return p.Region__c || regionOf(p) || '';
    case 'country': return p.MailingCountry || '';
    case 'review': return titleRecognized(p.Title) ? 'Recognised' : 'Needs review';
    default: return '';
  }
}
const ES_ABOVE = (v) => v.startsWith('≥ ');
export function passesFilters(p, f = NO_FILTERS) {
  return FILTERS.every(([k]) => {
    const want = f[k]; if (!want) return true;
    const have = filterValue(p, k);
    if (k === 'es' && ES_ABOVE(want)) return ES_STATES.indexOf(have) >= ES_STATES.indexOf(want.slice(2)) && ES_STATES.indexOf(have) >= 0;
    return have === want;
  });
}
export const filtersActive = (s) => !!s.q?.trim() || FILTERS.some(([k]) => s.filters?.[k]);
/** Options for a dropdown with how many people each would match (counts ignore that dropdown's own choice so you can switch). */
export function filterOptions(people, k, filters) {
  const others = people.filter((p) => passesFilters(p, { ...filters, [k]: '' }));
  const m = new Map();
  for (const p of others) { const v = filterValue(p, k); if (v) m.set(v, (m.get(v) || 0) + 1); }
  let list = [...m.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  if (k === 'es') {
    list = ES_STATES.filter((s) => m.has(s)).map((s) => [s, m.get(s)]);
    const above = ES_STATES.slice(1).map((s, i) => [`≥ ${s}`, others.filter((p) => passesFilters(p, { es: `≥ ${s}` })).length]);
    list = [...list, ...above.filter(([, n]) => n)];
  }
  return list;
}

export const SEARCH_FIELDS = [
  ['any', 'Everything'], ['name', 'Contact name'], ['department', 'Department'], ['region', 'Region'], ['country', 'Country'], ['role', 'Role'],
];

export const fieldValue = (p, f) => ({
  name: p.Name, department: p.Department, region: p.Region__c || regionOf(p), country: p.MailingCountry, role: p.Contact_Role__c,
}[f]);

/** Case-insensitive "contains" on one field, or on all of them for "any". Empty query matches everyone. */
export function matchesSearch(p, { field, q, filters }) {
  if (!passesFilters(p, filters)) return false;
  const t = (q || '').trim().toLowerCase();
  if (!t) return true;
  const vals = field === 'any' ? [p.Name, p.Title, p.Department, fieldValue(p, 'region'), p.MailingCountry, p.Contact_Role__c] : [fieldValue(p, field)];
  return vals.some((v) => String(v ?? '').toLowerCase().includes(t));
}

/** Distinct values of a field across everyone, for the suggestion list. */
export const distinctValues = (people, field) => [...new Set(people.map((p) => fieldValue(p, field)).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b)));

/** Is this person drawn on the board? Hidden people never; untitled ones only when the filter is off or they were added back. */
export const onBoard = (p, hideUntitled) => !p.hidden && (p.show || !(hideUntitled && !p.Title && !p.external));
