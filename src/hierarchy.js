// Title -> seniority rank (0 = top). Order matters: first match wins.
const RULES = [
  [0, /\b(ceo|chief executive|chairman|chairwoman|owner|founder|co-?founder|managing partner|co-?founding partner)\b|^president\b|\bpresident (&|and) (ceo|coo)/i],
  [1, /\b(coo|cfo|cto|cio|cmo|cpo|chief|general counsel|evp|executive vice president|partner|principal)\b/i],
  [2, /\b(region(al)?|division|divisional|market|business unit|district|office)\b.*\b(president|head|lead(er)?|manager|mngr|vp|vice president|director)\b|(?<!vice )\bpresident\b/i],
  [2, /\bsvp\b|senior vice president|office leader/i],
  [3, /\bvp\b|vice president|\bhead of\b|director|\bdir\b\.?|\bproj(ect)?\.? dir\b|controller|\bleader\b/i],
  [3, /\b(operations|ops) (manager|mngr)\b|\bmanager,? (of )?operations\b/i],
  [4, /project executive|senior project manager|\bsr\.? (project manager|pm|manager)\b|senior manager|general manager|construction manager|\bsupervisor\b/i],
  [5, /project manager|\bpm\b|manager|mngr|superintendent|lead\b/i],
  [6, /./],
];
// Titles often arrive glued ("VicePresidentof Operations") or abbreviated; normalise before matching.
export const normTitle = (t) => String(t ?? '')
  .replace(/([a-z])([A-Z])/g, '$1 $2')
  .replace(/\bvice ?president ?of\b/gi, 'vice president of')
  .replace(/\b(vice ?president)(?=[a-z])/gi, 'vice president ')
  .replace(/\bsr\b\.?/gi, 'senior').replace(/\bmgr\b\.?/gi, 'manager').replace(/\bexec\b\.?/gi, 'executive')
  .replace(/\s+/g, ' ').trim();
export const rankOf = (title) => (RULES.find(([, re]) => re.test(normTitle(title))) || [6])[0];
// Flag titles that sound senior but fell to the bottom (or arrive as one glued word): likely misread, worth a look.
const SENIORISH = /\b(vp|president|chief|head|director|manager|mngr|lead(er)?|partner|principal|officer|controller|supervisor|owner|founder|chair\w*)\b/i;
export const titleRecognized = (title) => {
  const t = normTitle(title); if (!t) return true;
  const fell = RULES.findIndex(([, re]) => re.test(t)) === RULES.length - 1;
  return !(fell && (SENIORISH.test(t) || /^\S{16,}$/.test(String(title).trim())));
};

const REGION_RE = /\b(west|east|central|north|south|northeast|southeast|northwest|southwest|midwest|emea|apac|uk|europe)\b/i;
export const regionOf = (c) => c.Region__c || (c.Title || '').match(REGION_RE)?.[1]?.replace(/^./, (x) => x.toUpperCase()) || null;

const isCorporateChief = (t) => /\b(chief|cfo|cio|cto|cmo|cpo|general counsel|evp)\b/i.test(t ?? '') && !/\b(coo|operating)\b/i.test(t ?? '') && !/ceo|executive officer/i.test(t ?? '');
const isOps = (t) => /\b(coo|operating|operations|ops|construction|project|proj|pm|region|division|superintendent)\b/i.test(t ?? '');
// Support functions (scheduling, finance...) sit beside operations, not above project managers.
const isSupport = (t) => /\b(schedul\w*|estimat\w*|account(ing|s)|financ\w*|payroll|hr|human resources|legal|procurement|purchasing|safety|quality|marketing|it|technology|innovation)\b/i.test(t ?? '');
const opsBonus = (t) => (/\b(ops|operations|proj(ect)?\.? dir\w*|project director|division|office)\b/i.test(t ?? '') ? 1 : 0);
const words = (s) => new Set(String(s ?? '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3 && !['project', 'executive', 'manager', 'senior', 'region', 'president', 'director'].includes(w)));
const overlap = (a, b) => [...words(a)].filter((w) => words(b).has(w)).length;

/**
 * Infer reportsTo for every contact from titles only.
 * Returns { [id]: parentId | null }. Contacts listed in `locked` keep their given parent.
 */
export function inferHierarchy(people, locked = {}) {
  const info = people.map((p) => ({ p, rank: rankOf(p.Title), region: regionOf(p) }));
  const byId = Object.fromEntries(info.map((i) => [i.p.Id, i]));
  const out = {};
  for (const me of info) {
    if (me.p.Id in locked) { out[me.p.Id] = locked[me.p.Id]; continue; }
    if (me.rank === 0 || !me.p.Title) { out[me.p.Id] = null; continue; } // no title -> nothing to infer from
    let pool = info.filter((o) => o.p.Id !== me.p.Id && o.rank < me.rank);
    if (!pool.length) { out[me.p.Id] = null; continue; }
    // Corporate chiefs report straight to the CEO; everyone else to the closest level above.
    if (isCorporateChief(me.p.Title)) {
      const top = pool.filter((o) => o.rank === 0);
      if (top.length) pool = top;
    } else if (me.rank >= 2) {
      const coo = pool.filter((o) => /\b(coo|operating)\b/i.test(o.p.Title || ''));
      const closest = Math.max(...pool.map((o) => o.rank));
      const near = pool.filter((o) => o.rank === closest);
      // Prefer a same-region manager; otherwise the COO for operational roles; otherwise closest level.
      const sameRegion = me.region ? near.filter((o) => o.region === me.region) : [];
      pool = sameRegion.length ? sameRegion : (isOps(me.p.Title) && coo.length && closest <= 1 ? coo : near);
    } else {
      const closest = Math.max(...pool.map((o) => o.rank));
      pool = pool.filter((o) => o.rank === closest);
    }
    const score = (o) => (o.region && o.region === me.region ? 4 : 0) + overlap(me.p.Title, o.p.Title) * 2 + (o.p.Department && o.p.Department === me.p.Department ? 1 : 0) + (isOps(me.p.Title) ? opsBonus(o.p.Title) : 0);
    if (isOps(me.p.Title) && me.rank >= 4) { const ok = pool.filter((o) => !isSupport(o.p.Title)); if (ok.length) pool = ok; }
    pool.sort((a, b) => score(b) - score(a) || a.p.Name.localeCompare(b.p.Name));
    out[me.p.Id] = pool[0].p.Id;
  }
  // Break any accidental cycles (can only come from locked data).
  for (const id of Object.keys(out)) {
    const seen = new Set([id]); let cur = out[id];
    while (cur) { if (seen.has(cur)) { out[id] = null; break; } seen.add(cur); cur = out[cur]; }
  }
  return out;
}

export const REGION_COLORS = { West: '#00b8e6', East: '#e5483b', Central: '#e8a317', North: '#7c5cff', South: '#16a34a' };
const PALETTE = ['#00b8e6', '#e5483b', '#e8a317', '#7c5cff', '#16a34a', '#d946ef', '#0ea5a4'];
export const regionColor = (r, all = []) => (!r ? null : REGION_COLORS[r] || PALETTE[Math.abs([...all].indexOf(r)) % PALETTE.length]);

export const ES_STATES = ['Targeted', 'Aware', 'Involved', 'Advocate', 'Buyer', 'Won'];
export const ES_COLORS = {
  Targeted: ['#6b7280', '#eef0f3'], Aware: ['#2c5fa8', '#e6eefa'], Involved: ['#2f7d4f', '#e4f3ea'],
  Advocate: ['#7b3fb0', '#f1e8fa'], Buyer: ['#b0621c', '#fbeee0'], Won: ['#1d6b3a', '#d9f0e1'],
};
export const ROLES = ['Champion', 'Decision Maker', 'Executive Sponsor', 'Economic Buyer', 'Technical Buyer', 'Influencer', 'BIM Manager', 'Other'];

// The "KEY" on the team's Miro board: how to treat each contact.
export const CONTACT_STATUS = {
  green: { label: 'Active / have met', lines: ['On active project', 'Have met', 'Or have regular scheduled calls'], bg: '#86d39a' },
  orange: { label: 'Talk first', lines: ['Conversations / plans in the works', 'Do not contact — talk first'], bg: '#f0b783' },
  yellow: { label: 'Contact them', lines: ['No prior conversations', 'No prior meetings', 'Not on active projects'], bg: '#fdf5b8' },
};

/** Map a Miro fill colour (hex like "#74d68d" or a name like "light_green") to a status, or null if it's neutral. */
export function colorToStatus(c) {
  if (!c) return null;
  const name = String(c).toLowerCase();
  if (!name.startsWith('#')) return name.includes('green') ? 'green' : name.includes('orange') ? 'orange' : name.includes('yellow') ? 'yellow' : null;
  const h = name.slice(1); if (h.length !== 6) return null;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (d < 0.15) return null; // white / grey / beige: no colour meaning
  let hue = d === 0 ? 0 : max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  hue = (hue * 60 + 360) % 360;
  if (hue >= 75 && hue <= 170) return 'green';
  if (hue >= 14 && hue < 42) return 'orange';
  if (hue >= 42 && hue < 75) return 'yellow';
  return null; // red key header, blues, etc.
}
