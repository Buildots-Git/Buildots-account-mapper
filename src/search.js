import { regionOf } from './hierarchy.js';

export const SEARCH_FIELDS = [
  ['any', 'Everything'], ['name', 'Contact name'], ['department', 'Department'], ['region', 'Region'], ['country', 'Country'], ['role', 'Role'],
];

export const fieldValue = (p, f) => ({
  name: p.Name, department: p.Department, region: p.Region__c || regionOf(p), country: p.MailingCountry, role: p.Contact_Role__c,
}[f]);

/** Case-insensitive "contains" on one field, or on all of them for "any". Empty query matches everyone. */
export function matchesSearch(p, { field, q }) {
  const t = (q || '').trim().toLowerCase();
  if (!t) return true;
  const vals = field === 'any' ? [p.Name, p.Title, p.Department, fieldValue(p, 'region'), p.MailingCountry, p.Contact_Role__c] : [fieldValue(p, field)];
  return vals.some((v) => String(v ?? '').toLowerCase().includes(t));
}

/** Distinct values of a field across everyone, for the suggestion list. */
export const distinctValues = (people, field) => [...new Set(people.map((p) => fieldValue(p, field)).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b)));

/** Is this person drawn on the board? Hidden people never; untitled ones only when the filter is off or they were added back. */
export const onBoard = (p, hideUntitled) => !p.hidden && (p.show || !(hideUntitled && !p.Title && !p.external));
