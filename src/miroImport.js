import { inferHierarchy, colorToStatus } from './hierarchy.js';
import { useStore } from './store.js';

const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Turn a Miro board into a plan. Handles two layouts:
 *  - connector lines between people cards (reporting lines), and
 *  - "office columns": a short header card (e.g. Nashville) with people stacked underneath, no lines.
 * Nothing is applied here; the preview shows the plan first.
 */
export function buildPlan(items, connectors, people) {
  // 1. which Miro card is which person (longest name contained in the card text wins)
  const byItem = {};
  for (const it of items) {
    const t = norm(it.text);
    const hit = people.filter((p) => norm(p.Name).length >= 5 && t.includes(norm(p.Name))).sort((a, b) => b.Name.length - a.Name.length)[0];
    if (hit && !Object.values(byItem).some((m) => m.person.Id === hit.Id)) byItem[it.id] = { person: hit, item: it };
  }
  const matched = Object.values(byItem);

  // 2. the line under the name is the person's title as the team writes it on Miro ("Sr PM", "Ops Mngr Nash");
  //    anything after that ("Office Leader", "Used Doxel via HCA") is extra detail worth keeping as a comment.
  const miroTitle = {}; const extra = [];
  for (const { person, item } of matched) {
    const rest = item.text.split('\n').map((l) => l.trim()).filter(Boolean).filter((l) => !norm(l).includes(norm(person.Name)));
    if (rest[0]) miroTitle[person.Id] = rest[0];
    if (rest.length > 1) extra.push({ person, lines: rest.slice(1) });
  }

  // 3. office headers: unmatched one-line labels with at least two people below them
  const below = (h, m) => m.item.y > h.y + 10 && Math.abs(m.item.x - h.x) < 800;
  const headers = items.filter((i) => !byItem[i.id] && !i.text.includes('\n') && i.text.length <= 30 && matched.filter((m) => below(i, m)).length >= 2);
  const offices = new Map();
  for (const m of matched) {
    const cands = headers.filter((h) => h.y < m.item.y - 10);
    if (!cands.length) continue;
    // nearest header by horizontal distance, with a small penalty for being far above
    const h = cands.sort((a, b) => (Math.abs(a.x - m.item.x) + 0.3 * (m.item.y - a.y)) - (Math.abs(b.x - m.item.x) + 0.3 * (m.item.y - b.y)))[0];
    const name = h.text.trim();
    if (!offices.has(name)) offices.set(name, { name, members: [] });
    offices.get(name).members.push(m.person);
  }

  const officeOf = (p) => [...offices.values()].find((o) => o.members.some((m) => m.Id === p.Id))?.name;
  const notes = extra.map(({ person, lines }) => ({ person, text: lines.filter((l) => !officeOf(person) || norm(l) !== norm(officeOf(person))).join(' · ') })).filter((n) => n.text && norm(n.text).length > 5); // drop location tags like "Nash"

  // 4. connector lines between two matched people
  const links = [];
  for (const c of connectors) {
    const a = byItem[c.from], b = byItem[c.to]; if (!a || !b || a.person.Id === b.person.Id) continue;
    const [parent, child] = Math.abs(a.item.y - b.item.y) < 20 ? [a, b] : a.item.y < b.item.y ? [a, b] : [b, a];
    links.push({ child: child.person, parent: parent.person });
  }

  const statuses = matched.map((m) => ({ person: m.person, status: colorToStatus(m.item.color) })).filter((x) => x.status);
  const headerIds = new Set(headers.map((h) => h.id));
  const unmatched = items.filter((i) => !byItem[i.id] && !headerIds.has(i.id)).map((i) => { const [name, ...rest] = i.text.split('\n'); return { name: name.trim(), title: rest.join(' ').trim() }; })
    .filter((u) => u.name.length > 2 && u.name.length < 60);
  return { total: items.length, matched: matched.length, links, offices: [...offices.values()], notes, unmatched, miroTitle, statuses };
}

/** Apply a plan to the board (one undo step). Everything stays board-only. */
export function applyPlan(plan, { addNew = [] } = {}) {
  const st = useStore.getState();
  st.snapshot();
  const overrides = { ...st.overrides };
  const set = (id, f) => { overrides[id] = { ...overrides[id], ...f }; };
  const miroTitle = { ...plan.miroTitle };

  // people who are on the picture but not in Salesforce become board-only cards
  const offices = new Map(plan.offices.map((o) => [o.name, { name: o.name, members: [...o.members] }]));
  let created = 0;
  for (const u of addNew) {
    const id = st.addExtra({ Name: u.name.trim(), Title: u.title || '', source: 'Picture' });
    created++;
    if (u.title) miroTitle[id] = u.title;
    if (['green', 'orange', 'yellow'].includes(u.color)) set(id, { cstatus: u.color });
    if (u.group) { if (!offices.has(u.group)) offices.set(u.group, { name: u.group, members: [] }); offices.get(u.group).members.push({ Id: id, Name: u.name, Title: u.title || '' }); }
  }

  const locked = {};
  for (const l of plan.links) { set(l.child.Id, { reportsTo: l.parent.Id, manual: true }); locked[l.child.Id] = l.parent.Id; }
  const officeList = [...offices.values()].filter((o) => o.members.length >= 2);
  for (const o of officeList) {
    // a header card for the office, reused if it was imported before
    const header = st.people().find((p) => p.external && p.source === 'Miro' && p.isGroup && p.Name === o.name);
    const hid = header?.Id || st.addExtra({ Name: o.name, Title: 'Office', source: 'Miro', isGroup: true });
    set(hid, { region: o.name, reportsTo: null, manual: true });
    // inside an office, seniority decides who reports to whom; the most senior report to the header
    const inferred = inferHierarchy(o.members.map((m) => ({ ...m, Title: miroTitle[m.Id] || overrides[m.Id]?.title || m.Title })), Object.fromEntries(Object.entries(locked).filter(([k]) => o.members.some((m) => m.Id === k))));
    for (const m of o.members) {
      set(m.Id, { region: o.name, ...(m.Title ? {} : miroTitle[m.Id] ? { title: miroTitle[m.Id] } : {}) });
      if (m.Id in locked) continue;
      set(m.Id, { reportsTo: inferred[m.Id] || hid, manual: true });
    }
  }
  for (const x of plan.statuses || []) set(x.person.Id, { cstatus: x.status });
  // addExtra above created cards in the store; merge our overrides on top of whatever it set
  useStore.setState((s) => ({ overrides: { ...s.overrides, ...Object.fromEntries(Object.entries(overrides).map(([k, v]) => [k, { ...s.overrides[k], ...v }])) }, positions: {} }));
  for (const n of plan.notes) {
    const existing = (useStore.getState().comments[n.person.Id] || []).some((c) => c.text.includes(n.text));
    if (!existing) useStore.getState().addComment(n.person.Id, `From Miro: ${n.text}`);
  }
  useStore.getState().persist();
  return { created, colored: (plan.statuses || []).length, offices: officeList.length, people: officeList.reduce((a, o) => a + o.members.length, 0), notes: plan.notes.length };
}

// ---------------------------------------------------------------------------------------------
// Reading a picture instead of the Miro API
// ---------------------------------------------------------------------------------------------

/** Cut a big image into overlapping tiles so small text stays legible when it is read. Returns [{data, mediaType}]. */
export async function tileImage(dataUrl, { tile = 1400, overlap = 0.12, maxTiles = 12 } = {}) {
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Could not open that image')); i.src = dataUrl; });
  const W = img.naturalWidth, H = img.naturalHeight;
  let cols = Math.max(1, Math.ceil(W / (tile * (1 - overlap)))), rows = Math.max(1, Math.ceil(H / (tile * (1 - overlap))));
  if (W <= tile * 1.15) cols = 1; if (H <= tile * 1.15) rows = 1;
  while (cols * rows > maxTiles) { if (cols >= rows) cols--; else rows--; }
  const tw = Math.ceil(W / cols), th = Math.ceil(H / rows), ox = Math.round(tw * overlap), oy = Math.round(th * overlap);
  const out = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const sx = Math.max(0, c * tw - ox), sy = Math.max(0, r * th - oy);
    const sw = Math.min(W - sx, tw + ox * 2), sh = Math.min(H - sy, th + oy * 2);
    const scale = Math.min(1, 1568 / Math.max(sw, sh)); // the model sees at most ~1568px on the long side
    const cv = document.createElement('canvas'); cv.width = Math.round(sw * scale); cv.height = Math.round(sh * scale);
    cv.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, cv.width, cv.height);
    out.push({ mediaType: 'image/jpeg', data: cv.toDataURL('image/jpeg', 0.88).split(',')[1] });
  }
  return { tiles: out, cols, rows, width: W, height: H };
}

// Edit distance, for forgiving name matching ("Alejandro Granados" vs "Alejandro Granadoz").
const lev = (a, b) => { const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]); for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return d[a.length][b.length]; };

const looksComplete = (n) => /^[A-Z][A-Za-z'’.-]+( [A-Z][A-Za-z'’.-]+){1,2}$/.test((n || '').trim()) && (n.trim().split(/\s+/).at(-1).length >= 3);
const COLOR_STATUS = { green: 'green', orange: 'orange', yellow: 'yellow' };

/** Same plan shape as buildPlan(), so the same preview and Apply button work. */
export function buildPlanFromCards(cards, people) {
  const keyed = people.map((p) => ({ p, k: norm(p.Name) }));
  const byPerson = new Map(); const unmatched = [];
  const richness = (c) => (c.group ? 2 : 0) + (c.color && c.color !== 'neutral' ? 2 : 0) + (c.title ? 1 : 0) + (c.notes ? 1 : 0);
  for (const c of cards) {
    const k = norm(c.name); if (k.length < 4) continue;
    let hit = keyed.find((x) => x.k === k);
    if (!hit) { // a name cut off or smudged at the edge of the picture
      const parts = (c.name || '').trim().split(/\s+/); const first = norm(parts[0]), last = norm(parts.slice(1).join(' '));
      if (parts.length >= 2 && first.length >= 2 && last.length >= 3) {
        const cut = keyed.filter((x) => {
          const q = x.p.Name.trim().split(/\s+/); const f = norm(q[0]), l = norm(q.slice(1).join(' '));
          const sameFirst = f === first || (last === l && first.length >= 3 && f.startsWith(first));            // "Wes Juergen" -> Wesley Juergen
          const lastOk = l === last || (l.length > last.length && l.startsWith(last)) ||                             // "Mary Martiki" -> Martikian
            (last.length >= 5 && l.length >= last.length && lev(last, l.slice(0, last.length)) <= 1);            // "Rushtc" -> Rushton
          return sameFirst && lastOk;
        });
        if (cut.length === 1) hit = cut[0];
      }
    }
    if (!hit) { // allow a small typo, but only when it is clearly the single best candidate
      const cand = keyed.filter((x) => Math.abs(x.k.length - k.length) <= 3).map((x) => ({ x, d: lev(k, x.k) })).sort((a, b) => a.d - b.d);
      if (cand[0] && cand[0].d <= Math.max(1, Math.floor(k.length * 0.15)) && (!cand[1] || cand[1].d > cand[0].d)) hit = cand[0].x;
    }
    if (!hit) { unmatched.push({ name: c.name, title: c.title || '', group: c.group || null, color: c.color || null, complete: looksComplete(c.name) }); continue; }
    const prev = byPerson.get(hit.p.Id); // the same person seen twice (overlapping parts of the picture): keep the fuller card
    if (!prev) byPerson.set(hit.p.Id, { person: hit.p, card: { ...c } });
    else { const [keep, other] = richness(c) > richness(prev.card) ? [c, prev.card] : [prev.card, c]; prev.card = { ...other, ...Object.fromEntries(Object.entries(keep).filter(([, v]) => v && v !== 'neutral')) }; }
  }
  const matched = [...byPerson.values()];
  const offices = new Map();
  for (const m of matched) {
    const g = (m.card.group || '').trim(); if (!g || g.toLowerCase() === 'null') continue;
    if (!offices.has(g)) offices.set(g, { name: g, members: [] });
    offices.get(g).members.push(m.person);
  }
  const miroTitle = Object.fromEntries(matched.filter((m) => m.card.title).map((m) => [m.person.Id, m.card.title]));
  const notes = matched.filter((m) => m.card.notes && norm(m.card.notes).length > 5).map((m) => ({ person: m.person, text: m.card.notes }));
  const statuses = matched.map((m) => ({ person: m.person, status: COLOR_STATUS[(m.card.color || '').toLowerCase()] })).filter((x) => x.status);
  // an office needs at least two people to count as a column
  const real = [...offices.values()].filter((o) => o.members.length >= 2);
  return { total: cards.length, matched: matched.length, links: [], offices: real, notes, unmatched, miroTitle, statuses };
}
