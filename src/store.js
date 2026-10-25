import { create } from 'zustand';
import { inferHierarchy, regionOf } from './hierarchy.js';

const CSRF = { 'X-Requested-With': 'account-mapper' };
export const api = (p, o = {}) => fetch(`/api${p}`, { ...o, headers: { ...CSRF, ...(o.headers || {}) } }).then(async (r) => {
  const j = await r.json().catch(() => null);
  if (r.status === 401 && j?.code === 'auth' && !p.startsWith('/auth/')) useStore.getState().sessionExpired();
  if (!r.ok) throw new Error(j?.error || r.statusText);
  return j;
});
export const jsonOpts = (method, body) => ({ method, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'account-mapper' }, body: JSON.stringify(body) });
let saveTimer, fieldTimer, pending = false, saving = false, again = false, searchSeq = 0;
export const hasPendingSave = () => pending;

// Theme: 'system' follows the OS; 'light' / 'dark' are explicit. Remembered per browser.
const readTheme = () => { try { return localStorage.getItem('am-theme') || 'system'; } catch { return 'system'; } };
export const effectiveTheme = (t) => (t === 'system' ? (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : t);
export function applyTheme(t) {
  const root = document.documentElement;
  if (t === 'system') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', t);
}

// How a contact card looks. Per board; "save as my default" makes it the starting point for boards you haven't customised.
export const DEFAULT_LAYOUT = { target: true, office: true, comments: true, actions: true, labels: true, width: 220, font: 1 };
const DEFAULT_HL = { role: true, es: true, ecm: true };
const DEFAULT_REL = { opps: true, leads: true, cs: true };
export const PRESETS = {
  compact: { label: 'Compact', note: 'Name and title', fields: ['Title'], hl: { role: false, es: false, ecm: true }, rel: { opps: false, leads: false, cs: false }, layout: { target: true, office: false, comments: false, actions: false, labels: false, width: 190, font: 0.95 } },
  standard: { label: 'Standard', note: 'Role, status, counts', fields: ['Title'], hl: DEFAULT_HL, rel: DEFAULT_REL, layout: DEFAULT_LAYOUT },
  detailed: { label: 'Detailed', note: 'Plus email, phone, city', fields: ['Title', 'Email', 'Phone', 'MailingCity', 'Department'], hl: DEFAULT_HL, rel: DEFAULT_REL, layout: { ...DEFAULT_LAYOUT, width: 280 } },
};
const readCardDefault = () => { try { return JSON.parse(localStorage.getItem('am-card-default') || 'null'); } catch { return null; } };
const readNoteStyle = () => { try { return { font: 'hand', size: 15, ...JSON.parse(localStorage.getItem('am-note-style') || '{}') }; } catch { return { font: 'hand', size: 15 }; } };

const DEFAULT_REF = { dataUrl: null, embedUrl: null, name: null, opacity: 0.9, visible: true, w: 520 };

export const useStore = create((set, get) => ({
  theme: readTheme(), _sys: 0,
  auth: { checked: false, setupNeeded: false, setupCodeRequired: false, user: null, notice: null }, loadingName: null, boardRev: 0, conflict: null, review: null, cardLayout: DEFAULT_LAYOUT, noteStyle: readNoteStyle(), items: [], tool: 'select', openPin: null, freshItem: null, recent: [], status: null, accounts: [], account: null, data: null, loading: false, error: null, fieldCatalog: [],
  // board state, persisted per account
  overrides: {}, // contactId -> { reportsTo, manual, region, role, es, enterprise, title, hidden, fields }
  positions: {}, extras: [], reference: DEFAULT_REF, accountNotes: '', toast: null, comments: {}, // comments: personId | '__board' -> [{ id, author, at, text }]
  showFields: ['Title'], showRelated: { opps: true, leads: true, cs: true }, hideUntitled: true, highlight: { role: true, es: true, ecm: true },
  view: 'board', psearch: { field: 'any', q: '', only: true, filters: { role: '', es: '', ecm: '', account: '', department: '', region: '', country: '', review: '' } }, collapsed: {}, collapseAll: null, outline: false, gridCols: ['title', 'reportsTo', 'role', 'es', 'vis'], selected: null, past: [], future: [], enrichTarget: null, focusId: null,

  setTheme(t) {
    try { localStorage.setItem('am-theme', t); } catch { /* private mode etc. - still applies for this session */ }
    applyTheme(t); set({ theme: t });
  },
  // ---- sign-in ----
  async initAuth() {
    try { const a = await api('/auth/state'); const q = new URLSearchParams(location.search); const err = q.get('sso_error');
      if (err) history.replaceState(null, '', location.pathname);
      set({ auth: { checked: true, setupNeeded: a.setupNeeded, setupCodeRequired: a.setupCodeRequired, sso: a.sso || null, user: a.user,
        notice: err ? (q.get('sso_msg') || (err === 'off' ? 'Single sign-on is not set up on this server.' : err === 'config' ? 'Single sign-on is misconfigured. Ask an admin.' : 'Sign-in failed. Try again.')) : null } }); }
    catch { set({ auth: { checked: true, setupNeeded: false, setupCodeRequired: false, user: null, notice: 'Cannot reach the server. Is it running?' } }); }
  },
  async signIn(username, password) { const r = await api('/auth/login', jsonOpts('POST', { username, password })); set((s) => ({ auth: { ...s.auth, user: r.user, notice: null } })); },
  async setupAccount(username, password, code) { const r = await api('/auth/setup', jsonOpts('POST', { username, password, code })); set((s) => ({ auth: { ...s.auth, setupNeeded: false, user: r.user, notice: null } })); },
  async signOut() {
    get().flushNow(); await api('/auth/logout', jsonOpts('POST', {})).catch(() => {});
    set((s) => ({ auth: { ...s.auth, user: null, notice: null }, status: null, account: null, data: null, review: null, selected: null, accounts: [], recent: [] }));
  },
  sessionExpired() { set((s) => ({ auth: { ...s.auth, user: null, notice: 'Your session ended — please sign in again.' }, status: null, account: null, data: null })); },
  async changePassword(current, next) { await api('/auth/password', jsonOpts('POST', { current, next })); set((s) => ({ auth: { ...s.auth, user: { ...s.auth.user, mustChange: false } } })); },

  async init() { set({ status: await api('/status') }); await get().search(''); },
  async refreshStatus() { set({ status: await api('/status') }); },
  async search(q) {
    const n = ++searchSeq; // a slow answer to an older search must not overwrite the newer one
    try { const r = await api(`/accounts?q=${encodeURIComponent(q)}`); if (n === searchSeq) set({ accounts: r }); } catch { /* keep the last results */ }
  },

  async fetchData(id, fields) {
    const extra = fields.filter((f) => f !== 'Title').join(',');
    return api(`/accounts/${id}${extra ? `?fields=${encodeURIComponent(extra)}` : ''}`);
  },

  async open(id, name) {
    set({ loading: true, loadingName: name || null, error: null, selected: null, past: [], future: [], collapsed: {}, collapseAll: null, psearch: { field: 'any', q: '', only: true, filters: { role: '', es: '', ecm: '', account: '', department: '', region: '', country: '', review: '' } } });
    try {
      const board = await api(`/boards/${id}`);
      const dflt = board?.cardLayout ? null : readCardDefault(); // a board never customised starts from the user's saved default
      const showFields = board?.showFields || dflt?.fields || ['Title'];
      const [data, fieldCatalog] = await Promise.all([get().fetchData(id, showFields), api('/contact-fields').catch(() => [])]);
      if (!Array.isArray(fieldCatalog)) throw new Error('The API server is out of date — stop and restart npm run dev');
      set({ account: data.account, data, fieldCatalog, loading: false, boardRev: board?._rev || 0, conflict: null, cardLayout: { ...DEFAULT_LAYOUT, ...(board?.cardLayout || dflt?.layout || {}) },
        overrides: board?.overrides || {}, positions: board?.positions || {}, extras: board?.extras || [], comments: board?.comments || {}, items: board?.items || [], tool: 'select', accountNotes: board?.accountNotes || '',
        reference: { ...DEFAULT_REF, ...(board?.reference || {}) }, showFields,
        showRelated: board?.showRelated || dflt?.rel || DEFAULT_REL, hideUntitled: board?.hideUntitled ?? true, highlight: { ...DEFAULT_HL, ...(board?.highlight || dflt?.hl || {}) }, gridCols: board?.gridCols || ['title', 'reportsTo', 'role', 'es', 'vis'] });
      // the homepage's "recent boards" tile
      const a = data.account;
      api(`/recent/${id}/open`, jsonOpts('POST', { name: a.Name, industry: a.Industry, country: a.BillingCountry, type: a.Type, website: a.Website || null, subsidiaries: Math.max(0, (data.family?.length || 1) - 1), parent: a.Parent || null, target: !!a.Target_Account__c, salesFocus: !!a.Sales_Focus__c, contacts: data.contacts.length })).catch(() => {});
    } catch (e) { set({ loading: false, error: e.message }); }
  },
  async loadRecent() { try { set({ recent: await api('/recent') }); } catch { /* the homepage works without it */ } },
  async removeRecent(id) { await api(`/recent/${id}`, { method: 'DELETE' }).catch(() => {}); get().loadRecent(); },

  persist() {
    clearTimeout(saveTimer); pending = true;
    saveTimer = setTimeout(() => get().flushNow(), 400);
  },
  /** Save right now (also used when the page is closing, so a reload can't swallow a pending change). */
  flushNow(keepalive = false, force = false) {
    clearTimeout(saveTimer); pending = false;
    const { account, data, overrides, positions, extras, showFields, showRelated, hideUntitled, reference, comments, gridCols, accountNotes, highlight, items, cardLayout, boardRev, conflict } = get();
    if (!account || (conflict && !force)) return; // somebody else changed this board: hold our save until the user chooses
    if (saving) { again = true; return; }          // one save at a time, so a quick second edit can't look like a conflict with the first
    const meta = data ? { name: account.Name, industry: account.Industry, country: account.BillingCountry, type: account.Type, target: !!account.Target_Account__c, salesFocus: !!account.Sales_Focus__c, contacts: data.contacts.length } : undefined;
    const body = { overrides, positions, extras, showFields, showRelated, hideUntitled, reference, comments, gridCols, accountNotes, highlight, items, cardLayout, meta, baseRev: boardRev, ...(force ? { force: true } : {}) };
    saving = true;
    fetch(`/api/boards/${account.Id}`, { ...jsonOpts('PUT', body), keepalive: keepalive && JSON.stringify({ reference }).length < 60000 })
      .then(async (r) => {
        const j = await r.json().catch(() => null);
        if (r.status === 409 && j?.code === 'conflict') set({ conflict: { by: j.by, at: j.at, rev: j.rev } });
        else if (r.status === 401) get().sessionExpired();
        else if (r.ok && j?.rev) set({ boardRev: j.rev });
      })
      .catch(() => {})
      .finally(() => { saving = false; if (again) { again = false; get().flushNow(); } });
  },
  /** Somebody else saved this board first. Take their version (losing our unsaved edits), or keep ours and overwrite theirs. */
  async reloadBoard() { const a = get().account; if (!a) return; set({ conflict: null }); await get().open(a.Id, a.Name); },
  keepMine() { const c = get().conflict; set({ conflict: null, boardRev: c?.rev ?? get().boardRev }); get().flushNow(false, true); },

  // ---- card appearance ----
  setLayout(patch) { set((s) => ({ cardLayout: { ...s.cardLayout, ...patch } })); get().persist(); },
  applyPreset(name) {
    const pr = PRESETS[name]; if (!pr) return;
    set({ cardLayout: { ...pr.layout }, highlight: { ...pr.hl }, showRelated: { ...pr.rel } });
    get().setCardFields(pr.fields); // reloads the fields the preset needs
  },
  resetCard() { get().applyPreset('standard'); },
  saveCardDefault() {
    const { cardLayout, highlight, showRelated, showFields } = get();
    try { localStorage.setItem('am-card-default', JSON.stringify({ layout: cardLayout, hl: highlight, rel: showRelated, fields: showFields })); } catch { /* private mode */ }
    get().flash('Saved. New boards will start with this card layout.');
  },
  setNoteStyle(patch) { const n = { ...get().noteStyle, ...patch }; set({ noteStyle: n }); try { localStorage.setItem('am-note-style', JSON.stringify(n)); } catch {} },

  // ---- comments (kept out of undo history so a stray ⌘Z never deletes a note) ----
  addComment(key, text) {
    const t = text.trim(); if (!t) return;
    const c = { id: `c-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, author: get().status?.me || 'unknown', at: new Date().toISOString(), text: t };
    set((s) => ({ comments: { ...s.comments, [key]: [...(s.comments[key] || []), c] } })); get().persist();
  },
  deleteComment(key, id) { set((s) => ({ comments: { ...s.comments, [key]: (s.comments[key] || []).filter((c) => c.id !== id) } })); get().persist(); },

  // ---- undo / redo over everything the user can change on the board ----
  snapshot() { const { overrides, positions, extras, items, past } = get(); set({ past: [...past.slice(-49), { overrides, positions, extras, items }], future: [] }); },
  undo() { const { past, future, overrides, positions, extras, items } = get(); if (!past.length) return; set({ ...past.at(-1), past: past.slice(0, -1), future: [...future, { overrides, positions, extras, items }] }); get().persist(); },
  redo() { const { past, future, overrides, positions, extras, items } = get(); if (!future.length) return; set({ ...future.at(-1), future: future.slice(0, -1), past: [...past, { overrides, positions, extras, items }] }); get().persist(); },

  patch(id, fields) { get().snapshot(); set((s) => ({ overrides: { ...s.overrides, [id]: { ...s.overrides[id], ...fields } } })); get().persist(); },
  setPosition(id, pos) { get().snapshot(); set((s) => ({ positions: { ...s.positions, [id]: pos } })); get().persist(); },
  resetLayout() { get().snapshot(); set({ positions: {} }); get().persist(); },
  setShow(k, v) { set({ [k]: v }); get().persist(); },
  select(id) { set({ selected: id }); },
  /** Ask the board to pan/zoom to a card. */
  focus(id) { set({ focusId: id }); }, // a card id, or an array of ids to fit in view
  flash(msg) { set({ toast: msg }); setTimeout(() => get().toast === msg && set({ toast: null }), 3800); },

  /** Save several card positions as one undo step (a multi-card drag). */
  setPositions(map) { get().snapshot(); set((s) => ({ positions: { ...s.positions, ...map } })); get().persist(); },

  /** Drop cards onto a manager: they now report to them. Skips anything that would create a loop. */
  reparent(ids, parentId) {
    const people = get().people(); const byId = Object.fromEntries(people.map((p) => [p.Id, p]));
    const below = (root) => { const out = new Set(); const walk = (id) => people.filter((p) => p.reportsTo === id).forEach((c) => { if (!out.has(c.Id)) { out.add(c.Id); walk(c.Id); } }); walk(root); return out; };
    const ok = ids.filter((id) => id !== parentId && !below(id).has(parentId) && byId[id]?.reportsTo !== parentId);
    if (!ok.length) { get().flash(ids.length === 1 && ids[0] === parentId ? 'A card can’t report to itself' : 'Already reports there, or that would create a loop'); return 0; }
    get().snapshot();
    set((s) => {
      const o = { ...s.overrides }; const pos = { ...s.positions };
      ok.forEach((id) => { o[id] = { ...o[id], reportsTo: parentId, manual: true }; delete pos[id]; });
      return { overrides: o, positions: pos };
    });
    get().persist();
    get().flash(`${ok.length > 1 ? `${ok.length} people now report` : `${byId[ok[0]].Name} now reports`} to ${byId[parentId].Name}  (⌘Z to undo)`);
    return ok.length;
  },

  setStatus(ids, status) { get().snapshot(); set((s) => { const o = { ...s.overrides }; ids.forEach((id) => { o[id] = { ...o[id], cstatus: status }; }); return { overrides: o }; }); get().persist(); },
  setNotes(text) { set({ accountNotes: text }); get().persist(); },

  /** What Salesforce can tell us about the KEY, for people with no colour yet. Conservative on purpose. */
  statusSuggestions() {
    const { data } = get(); const people = get().people();
    const activeStatuses = new Set(['Alignment', 'Onboarding', 'Adoption', 'Delivery', 'Wrap Up']);
    const inActive = new Set(data.csProjects.filter((p) => activeStatuses.has(p.Status)).flatMap((p) => p.contactIds));
    const inOpen = new Set(data.opportunities.filter((o) => o.StageName && !/^closed/i.test(o.StageName)).flatMap((o) => o.contactIds));
    const out = { green: [], orange: [], yellow: [] };
    for (const p of people) {
      if (p.cstatus || p.external) continue;
      if (inActive.has(p.Id)) out.green.push(p.Id);
      else if (inOpen.has(p.Id)) out.orange.push(p.Id);
      else if (!(p.Number_of_Activities__c > 0) && p.Title) out.yellow.push(p.Id); // never touched, no project, no open deal
    }
    return out;
  },

  // ---- import review (picture / Miro) ----
  setReview(r) { set({ review: r }); },
  closeReview() { set({ review: null }); },
  updateRow(id, patch) { set((s) => (s.review ? { review: { ...s.review, rows: s.review.rows.map((r) => (r.id === id ? { ...r, ...patch } : r)) } } : {})); },
  /** fn(row) -> patch | null, applied to every row. */
  updateRows(fn) { set((s) => (s.review ? { review: { ...s.review, rows: s.review.rows.map((r) => ({ ...r, ...(fn(r) || {}) })) } } : {})); },
  // ---- free-form items on the canvas, like Miro: sticky notes, text, comment pins ----
  setTool(t) { set({ tool: t, openPin: null }); },
  setOpenPin(id) { set({ openPin: id }); },
  addItem(item) {
    get().snapshot();
    const id = `i-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const me = get().status?.me || 'unknown';
    const base = { id, type: item.type, x: item.x, y: item.y, author: me, at: new Date().toISOString() };
    const ns = get().noteStyle;
    const full = item.type === 'note' ? { ...base, w: 200, h: 160, color: item.color || 'yellow', text: '', font: ns.font, fs: ns.size }
      : item.type === 'text' ? { ...base, w: 220, h: 40, text: '', font: 'sans', fs: 20 }
      : { ...base, resolved: false, thread: [] }; // comment pin
    set((s) => ({ items: [...s.items, full], tool: 'select', openPin: item.type === 'comment' ? id : null, freshItem: id })); get().persist(); return id;
  },
  updateItem(id, patch, snap = false) { if (snap) get().snapshot(); set((s) => ({ items: s.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) })); get().persist(); },
  moveItems(map) { get().snapshot(); set((s) => ({ items: s.items.map((i) => (map[i.id] ? { ...i, ...map[i.id] } : i)) })); get().persist(); },
  deleteItems(ids) { get().snapshot(); set((s) => ({ items: s.items.filter((i) => !ids.includes(i.id)), openPin: ids.includes(s.openPin) ? null : s.openPin })); get().persist(); },
  replyToPin(id, text) {
    const t = text.trim(); if (!t) return;
    const c = { id: `r-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`, author: get().status?.me || 'unknown', at: new Date().toISOString(), text: t };
    set((s) => ({ items: s.items.map((i) => (i.id === id ? { ...i, thread: [...(i.thread || []), c] } : i)) })); get().persist();
  },
  setSearch(patch) { set((s) => ({ psearch: { ...s.psearch, ...patch } })); },
  setFilter(k, v) { set((s) => ({ psearch: { ...s.psearch, filters: { ...s.psearch.filters, [k]: v } } })); },
  clearFilters() { set((s) => ({ psearch: { ...s.psearch, q: '', filters: { role: '', es: '', ecm: '', account: '', department: '', region: '', country: '', review: '' } } })); },
  // Branches: collapsed[id] true/false overrides the default (everything below the top levels starts folded).
  toggleBranch(id, now) { set((s) => ({ collapsed: { ...s.collapsed, [id]: !now } })); },
  setAllBranches(mode) { set({ collapsed: {}, collapseAll: mode }); },
  /** Show or hide several people at once (one undo step). Showing also re-adds untitled people the filter would drop. */
  setVisible(ids, visible) {
    get().snapshot();
    set((s) => { const o = { ...s.overrides }; ids.forEach((id) => { o[id] = { ...o[id], hidden: !visible, show: visible }; }); return { overrides: o }; });
    get().persist();
  },
  /** Card buttons: open the Enrich panel focused on one person. */
  enrichPerson(id, provider) { set({ enrichTarget: { id, provider } }); },

  addExtra(p) {
    get().snapshot();
    const Id = p.Id || `x-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    set((s) => ({ extras: [...s.extras, { ...p, Id, external: true }] })); get().persist(); return Id;
  },
  removeExtra(id) { get().snapshot(); set((s) => ({ extras: s.extras.filter((e) => e.Id !== id) })); get().persist(); },

  /** Choose which Salesforce Contact fields appear on the cards; re-fetches so the values are loaded. */
  setCardFields(fields) {
    set({ showFields: fields }); get().persist();
    clearTimeout(fieldTimer);
    fieldTimer = setTimeout(async () => {
      const { account, showFields } = get(); if (!account) return;
      try { set({ data: await get().fetchData(account.Id, showFields) }); } catch (e) { set({ error: e.message }); }
    }, 350);
  },

  /** Re-infer parents from titles. Anything the user set by hand (or Salesforce Reports-To) is kept unless overwrite. */
  autoBuild({ overwrite = false } = {}) {
    get().snapshot();
    const s = get(); const people = s.people(); const locked = {};
    if (!overwrite) for (const p of people) {
      const o = s.overrides[p.Id];
      if (o?.manual) locked[p.Id] = o.reportsTo;
      else if (p.ReportsToId && !p.external) locked[p.Id] = p.ReportsToId;
    }
    const inferred = inferHierarchy(people, locked);
    const next = { ...s.overrides };
    for (const p of people) {
      if (p.Id in locked) continue;
      next[p.Id] = { ...next[p.Id], reportsTo: inferred[p.Id], manual: false };
    }
    if (overwrite) for (const k of Object.keys(next)) if (next[k].manual) next[k] = { ...next[k], manual: false };
    set({ overrides: next, positions: overwrite ? {} : s.positions }); get().persist();
  },

  /** Effective people list with overrides applied. */
  people() {
    const { data, extras, overrides } = get();
    if (!data) return [];
    return [...data.contacts, ...extras].map((c) => {
      const o = overrides[c.Id] || {};
      return {
        ...c, ...(o.fields || {}), Title: o.title ?? c.Title, Region__c: o.region ?? c.Region__c ?? null,
        Contact_Role__c: o.role ?? c.Contact_Role__c, ES_Expansion_Status__c: o.es ?? c.ES_Expansion_Status__c,
        Account_Target: o.enterprise ?? c.Account_Target, Enterprise_Coalition_Member__c: o.ecm ?? c.Enterprise_Coalition_Member__c, hidden: !!o.hidden, show: !!o.show, cstatus: o.cstatus ?? null,
        reportsTo: 'reportsTo' in o ? o.reportsTo : (c.ReportsToId ?? null), manual: !!o.manual,
      };
    });
  },

  /** Edits that differ from what Salesforce holds, per contact: {Id, ReportsToId?, Region__c?, Contact_Role__c?, ES_Expansion_Status__c?}. */
  pendingChanges() {
    const { overrides, data } = get();
    if (!data) return [];
    const orig = new Map(data.contacts.map((c) => [c.Id, c]));
    const diff = (a, b) => (a ?? null) !== (b ?? null);
    return Object.entries(overrides).filter(([id]) => orig.has(id)).map(([Id, o]) => {
      const c = orig.get(Id), f = { Id };
      if ('reportsTo' in o && o.manual && diff(o.reportsTo, c.ReportsToId)) f.ReportsToId = o.reportsTo;
      if (o.region !== undefined && diff(o.region, c.Region__c)) f.Region__c = o.region;
      if (o.role !== undefined && diff(o.role, c.Contact_Role__c)) f.Contact_Role__c = o.role;
      if (o.es !== undefined && diff(o.es, c.ES_Expansion_Status__c)) f.ES_Expansion_Status__c = o.es;
      return f;
    }).filter((f) => Object.keys(f).length > 1);
  },
  async push() {
    const changes = get().pendingChanges();
    if (!changes.length) return { n: 0 };
    const res = await api('/push', jsonOpts('POST', { changes }));
    return { n: changes.length, failed: res.filter((r) => !r.success).length };
  },
}));
export { regionOf };
