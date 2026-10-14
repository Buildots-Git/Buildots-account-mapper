import { inferHierarchy, colorToStatus } from './hierarchy.js';
import { useStore } from './store.js';

// ---------------------------------------------------------------------------------------------
// Matching: a card on a picture/Miro board -> a Salesforce contact (with ranked candidates)
// ---------------------------------------------------------------------------------------------
const NICK = { bill: 'william', will: 'william', billy: 'william', bob: 'robert', rob: 'robert', bobby: 'robert', robbie: 'robert', mike: 'michael', jim: 'james', jimmy: 'james', tom: 'thomas', tommy: 'thomas',
  steve: 'steven', stephen: 'steven', chris: 'christopher', dave: 'david', matt: 'matthew', jeff: 'jeffrey', geoff: 'geoffrey', greg: 'gregory', joe: 'joseph', tony: 'anthony', rick: 'richard', rich: 'richard', dick: 'richard',
  dan: 'daniel', danny: 'daniel', nick: 'nicholas', ben: 'benjamin', sam: 'samuel', alex: 'alexander', andy: 'andrew', drew: 'andrew', ed: 'edward', eddie: 'edward', ted: 'edward', jon: 'jonathan', johnny: 'john', jack: 'john',
  liz: 'elizabeth', beth: 'elizabeth', jen: 'jennifer', jenny: 'jennifer', sue: 'susan', pete: 'peter', phil: 'phillip', ron: 'ronald', don: 'donald', ken: 'kenneth', tim: 'timothy', charlie: 'charles', chuck: 'charles', hank: 'henry', fred: 'frederick', josh: 'joshua', zach: 'zachary', zack: 'zachary', kate: 'katherine', katie: 'katherine', cathy: 'catherine' };
const TITLE_ABBR = { sr: 'senior', jr: 'junior', pm: 'project manager', mgr: 'manager', mngr: 'manager', dir: 'director', vp: 'vice president', svp: 'senior vice president', evp: 'executive vice president', exec: 'executive',
  eng: 'engineer', supt: 'superintendent', super: 'superintendent', ops: 'operations', precon: 'preconstruction', coord: 'coordinator', proj: 'project', admin: 'administrator' };
const STOP = new Set(['of', 'and', 'the', 'a', 'in', 'for', 'to', 'at']);

const letters = (s) => (s || '').toLowerCase().replace(/[^a-z]/g, '');
const lev = (a, b) => { const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]); for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return d[a.length][b.length]; };

/** "Smith, John", "J. Smith", extra spaces... -> { first, last } as lowercase letters only. */
export function splitName(raw) {
  let t = (raw || '').replace(/[»|_[\]]/g, ' ').replace(/\s+/g, ' ').trim();
  if (t.includes(',')) { const [l, f] = t.split(','); t = `${f} ${l}`.trim(); }
  const parts = t.split(' ').filter(Boolean);
  return { first: letters(parts[0]), last: letters(parts.slice(1).join(' ')), initial: parts[0]?.replace(/[^A-Za-z]/g, '').length === 1 };
}
const canon = (f) => NICK[f] || f;

/** -> { score 0..1, kind: 'exact' | 'cut' | 'part' | 'fuzzy' }. 'fuzzy'/'part' matches are never trusted on the name alone. */
export function nameDetail(readName, contactName) {
  const a = splitName(readName), b = splitName(contactName);
  if (!a.first || !b.first || !a.last || !b.last) return { score: 0, kind: 'none' };
  const fa = canon(a.first), fb = canon(b.first);
  let first = 0, firstKind = 'exact';
  if (fa === fb) first = 1;
  else if (a.initial && fb[0] === a.first[0]) { first = 0.6; firstKind = 'part'; }
  else if (a.first.length >= 3 && fb.startsWith(a.first)) { first = 0.85; firstKind = 'cut'; }          // "Wes" -> Wesley
  else if (a.first.length >= 3 && lev(a.first, b.first) <= 1) { first = 0.8; firstKind = 'fuzzy'; }
  let last = 0, lastKind = 'exact';
  if (a.last === b.last) last = 1;
  else if (a.last.length >= 3 && b.last.startsWith(a.last)) { last = 0.88; lastKind = 'cut'; }          // cut off at the edge: "Martiki" -> Martikian
  else if (a.last.length >= 5 && b.last.length > a.last.length && lev(a.last, b.last.slice(0, a.last.length)) <= 1) { last = 0.84; lastKind = 'cut'; } // smudged: "Rushtc" -> Rushton
  else if (a.last.length >= 4 && lev(a.last, b.last) <= Math.max(1, Math.floor(a.last.length * 0.2))) { last = 0.8; lastKind = 'fuzzy'; }
  if (!first || !last) return { score: 0, kind: 'none' };
  const kind = [firstKind, lastKind].includes('fuzzy') ? 'fuzzy' : [firstKind, lastKind].includes('part') ? 'part' : [firstKind, lastKind].includes('cut') ? 'cut' : 'exact';
  return { score: 0.4 * first + 0.6 * last, kind };
}
export const nameScore = (a, b) => nameDetail(a, b).score;

const titleTokens = (t) => new Set((t || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).flatMap((w) => (TITLE_ABBR[w] || w).split(' ')).filter((w) => w && !STOP.has(w) && !/^(i|ii|iii|iv)$/.test(w)));
export function titleScore(a, b) { const A = titleTokens(a), B = titleTokens(b); if (!A.size || !B.size) return 0; let n = 0; for (const w of A) if (B.has(w)) n++; return n / (A.size + B.size - n); }

/** Ranked Salesforce candidates for one card. Name decides; title and office only break ties and add confidence. */
export function rankCandidates(card, people, limit = 5) {
  return people.map((p) => {
    const { score: ns, kind } = nameDetail(card.name, p.Name); if (ns < 0.55) return null;
    const ts = titleScore(card.title, p.Title);
    const cs = card.group && (letters(p.MailingCity) === letters(card.group) || letters(p.Region__c) === letters(card.group)) ? 1 : 0;
    return { id: p.Id, name: p.Name, title: p.Title || '', score: ns * 0.78 + ts * 0.18 + cs * 0.04, nameScore: ns, kind, evidence: ts >= 0.3 || cs > 0 };
  }).filter(Boolean).sort((a, b) => b.score - a.score).slice(0, limit);
}

const looksComplete = (n) => /^[A-Z][A-Za-z'’.-]+( [A-Z][A-Za-z'’.-]+){1,2}$/.test((n || '').trim()) && (n.trim().split(/\s+/).at(-1).length >= 3);

/**
 * cards:   [{ id, name, title, group, color('green'|'orange'|'yellow'|'neutral'), notes }]
 * headers: [{ id, text }]
 * edges:   [{ from, to }]  ids of cards/headers (from = manager)
 * -> { rows, headers, source }
 */
export function buildRows(cards, headers, edges, people, source) {
  const used = new Set(); // each Salesforce contact can be matched once
  const rows = cards.map((c, i) => ({ id: c.id ?? `c${i}`, read: { name: c.name, title: c.title || '', group: c.group || '', color: c.color || 'neutral', notes: c.notes || '' },
    cands: rankCandidates(c, people), matchId: null, action: 'skip', group: c.group || '', color: ['green', 'orange', 'yellow'].includes(c.color) ? c.color : '', title: c.title || '', notes: c.notes || '', parent: null, sure: false }));
  // strongest matches first, so a weaker card can't steal someone's contact
  for (const r of [...rows].sort((a, b) => (b.cands[0]?.score || 0) - (a.cands[0]?.score || 0))) {
    const best = r.cands.find((c) => !used.has(c.id)); if (!best) continue;
    // exact names and clean cut-offs are trusted; anything fuzzier needs the title or office to agree
    const confident = best.kind === 'exact' || (best.kind === 'cut' && best.nameScore >= 0.9) || (best.nameScore >= 0.8 && best.evidence);
    if (confident) { r.matchId = best.id; r.action = 'match'; r.sure = best.kind === 'exact'; used.add(best.id); }
  }
  for (const r of rows) if (r.action === 'skip' && looksComplete(r.read.name)) r.action = 'new';
  // parents from connector lines
  for (const e of edges || []) { const child = rows.find((r) => r.id === e.to); if (child) child.parent = e.from; }
  return { rows, headers: (headers || []).map((h) => ({ id: h.id, text: h.text, parent: (edges || []).find((e) => e.to === h.id)?.from || null })), source };
}

/** Miro API items -> the same cards/headers/edges the picture reader produces. */
export function cardsFromMiro(items, connectors, people) {
  const norm = letters;
  const cards = [], itemCard = {};
  const ordered = [...items].sort((a, b) => a.y - b.y);
  for (const it of ordered) {
    const lines = it.text.split('\n').map((l) => l.trim()).filter(Boolean); if (!lines.length) continue;
    const t = norm(it.text);
    const hit = people.filter((p) => norm(p.Name).length >= 5 && t.includes(norm(p.Name))).sort((a, b) => b.Name.length - a.Name.length)[0];
    let name = null, rest = lines;
    if (hit) { name = hit.Name; rest = lines.filter((l) => !norm(l).includes(norm(hit.Name))); }
    else if (lines.length >= 2 && /^[A-Z][A-Za-z'’.-]+( [A-Z][A-Za-z'’.-]+){1,2}$/.test(lines[0])) { name = lines[0]; rest = lines.slice(1); }
    if (!name) continue;
    const c = { id: `m${cards.length}`, name, title: rest[0] || '', notes: rest.slice(1).join(' · '), color: colorToStatus(it.color) || 'neutral', x: it.x, y: it.y, itemId: it.id };
    cards.push(c); itemCard[it.id] = c;
  }
  const hdrItems = items.filter((i) => !itemCard[i.id] && !i.text.includes('\n') && i.text.length <= 30 && cards.filter((c) => c.y > i.y + 10 && Math.abs(c.x - i.x) < 800).length >= 2);
  const headers = hdrItems.map((h, i) => ({ id: `mh${i}`, text: h.text.trim(), x: h.x, y: h.y, itemId: h.id }));
  for (const c of cards) {
    const cand = headers.filter((h) => h.y < c.y - 10);
    if (cand.length) c.group = cand.sort((a, b) => (Math.abs(a.x - c.x) + 0.3 * (c.y - a.y)) - (Math.abs(b.x - c.x) + 0.3 * (c.y - b.y)))[0].text;
  }
  const nodeOf = {}; cards.forEach((c) => { nodeOf[c.itemId] = c; }); headers.forEach((h) => { nodeOf[h.itemId] = h; });
  const edges = [];
  for (const cn of connectors) { const a = nodeOf[cn.from], b = nodeOf[cn.to]; if (!a || !b || a === b) continue; const [p, c] = Math.abs(a.y - b.y) < 20 ? [a, b] : a.y < b.y ? [a, b] : [b, a]; edges.push({ from: p.id, to: c.id }); }
  return { cards, headers, edges };
}

// ---------------------------------------------------------------------------------------------
// Apply the reviewed rows to the board (one undo step)
// ---------------------------------------------------------------------------------------------
export function applyReview(review) {
  const st = useStore.getState();
  st.snapshot();
  const people = st.people(); const byId = Object.fromEntries(people.map((p) => [p.Id, p]));
  const overrides = { ...st.overrides };
  const set = (id, f) => { overrides[id] = { ...overrides[id], ...f }; };
  const stats = { matched: 0, created: 0, colored: 0, lines: 0, offices: 0, notes: 0 };

  // 1. who is each row on the board?
  const personOf = {}; // row id -> board person id
  for (const r of review.rows) {
    if (r.action === 'match' && byId[r.matchId]) { personOf[r.id] = r.matchId; stats.matched++; }
    else if (r.action === 'new') {
      const existing = people.find((p) => p.external && p.source === 'Picture' && letters(p.Name) === letters(r.read.name)); // re-import: reuse
      personOf[r.id] = existing?.Id || st.addExtra({ Name: r.read.name.trim(), Title: r.title || '', source: 'Picture' }); if (!existing) stats.created++;
    }
  }
  const rowByPerson = Object.fromEntries(review.rows.filter((r) => personOf[r.id]).map((r) => [personOf[r.id], r]));

  // 2. offices: a header card per office that has at least two people
  const officeMembers = new Map();
  for (const r of review.rows) { if (!personOf[r.id] || !r.group) continue; if (!officeMembers.has(r.group)) officeMembers.set(r.group, []); officeMembers.get(r.group).push(r); }
  const headerOf = {}; // office name -> header card id
  for (const [name, members] of officeMembers) {
    if (members.length < 2) continue;
    const existing = st.people().find((p) => p.external && p.source === 'Miro' && p.isGroup && p.Name === name);
    const hid = existing?.Id || st.addExtra({ Name: name, Title: 'Office', source: 'Miro', isGroup: true });
    headerOf[name] = hid; set(hid, { region: name, reportsTo: null, manual: true }); stats.offices++;
  }
  const headerRef = Object.fromEntries(review.headers.map((h) => [h.id, headerOf[h.text]]));

  // 3. per-person details
  for (const r of review.rows) {
    const pid = personOf[r.id]; if (!pid) continue;
    const p = byId[pid];
    set(pid, { ...(r.group ? { region: r.group } : {}), ...(r.color ? { cstatus: r.color } : {}), ...(p && !p.Title && r.title ? { title: r.title } : {}) });
    if (r.color) stats.colored++;
    if (r.notes && r.notes.length > 5) { const ex = (useStore.getState().comments[pid] || []).some((c) => c.text.includes(r.notes)); if (!ex) { useStore.getState().addComment(pid, `From ${review.source}: ${r.notes}`); stats.notes++; } }
  }

  // 4. reporting lines: explicit (drawn on the picture, or chosen here) first, then seniority inside each office
  const parentPerson = (ref) => personOf[ref] || headerRef[ref] || null;
  const locked = {};
  for (const r of review.rows) {
    const pid = personOf[r.id]; if (!pid || !r.parent) continue;
    const par = parentPerson(r.parent); if (!par || par === pid) continue;
    set(pid, { reportsTo: par, manual: true }); locked[pid] = par; stats.lines++;
  }
  for (const h of review.headers) { // an executive's line into an office header
    const hid = headerRef[h.id]; const par = h.parent && personOf[h.parent]; if (hid && par) { set(hid, { reportsTo: par, manual: true }); stats.lines++; }
  }
  for (const [name, members] of officeMembers) {
    const hid = headerOf[name]; if (!hid) continue;
    const list = members.map((r) => ({ Id: personOf[r.id], Name: r.read.name, Title: r.title || byId[personOf[r.id]]?.Title || '' }));
    const inferred = inferHierarchy(list, Object.fromEntries(Object.entries(locked).filter(([k]) => list.some((m) => m.Id === k))));
    for (const m of list) { if (m.Id in locked) continue; set(m.Id, { reportsTo: inferred[m.Id] || hid, manual: true }); }
  }

  useStore.setState((s) => ({ overrides: { ...s.overrides, ...Object.fromEntries(Object.entries(overrides).map(([k, v]) => [k, { ...s.overrides[k], ...v }])) }, positions: {} }));
  useStore.getState().persist();
  return stats;
}
