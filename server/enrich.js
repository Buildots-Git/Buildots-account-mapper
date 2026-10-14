// Enrichment adapters. Each returns [{ name, title, email, phone, linkedin, city, source }].
// Credentials are the signed-in user's own (see creds.js); env vars remain as a shared fallback.
// Sales Navigator has no public API, so it is handled client-side via CSV import.
const split = (full) => { const p = full.trim().split(/\s+/); return { first: p[0], last: p.slice(1).join(' ') }; };

const jwtCache = new Map(); // user -> { jwt, exp }
async function zoominfoJwt(user, cred) {
  if (!cred) { if (process.env.ZOOMINFO_JWT) return process.env.ZOOMINFO_JWT; throw new Error('Connect your ZoomInfo login first'); }
  const hit = jwtCache.get(user);
  if (hit && hit.exp > Date.now()) return hit.jwt;
  const r = await fetch('https://api.zoominfo.com/authenticate', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: cred.username, password: cred.password }),
  });
  if (!r.ok) throw new Error(`ZoomInfo sign-in failed (${r.status}). Check the username/password, and that your licence includes API access.`);
  const { jwt } = await r.json();
  jwtCache.set(user, { jwt, exp: Date.now() + 50 * 60_000 });
  return jwt;
}

export async function zoominfo({ company, titles = [], names = [] }, ctx) {
  const jwt = await zoominfoJwt(ctx.user, ctx.cred);
  const search = async (body) => {
    const r = await fetch('https://api.zoominfo.com/search/contact', { method: 'POST', headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ rpp: 25, ...body }) });
    if (!r.ok) throw new Error(`ZoomInfo ${r.status}: ${(await r.text()).slice(0, 200)}`);
    return (await r.json()).data || [];
  };
  // Named lookups (from a card's ZI button) or a company-wide search.
  const rows = names.length
    ? (await Promise.all(names.map((n) => search({ companyName: company, fullName: n })))).flat()
    : await search({ companyName: company, managementLevel: 'C Level Execs,VP Level Execs,Director,Manager', jobTitle: titles.join(' OR ') || undefined, rpp: 50 });
  return rows.map((p) => ({
    name: `${p.firstName} ${p.lastName}`.trim(), title: p.jobTitle, email: p.email, phone: p.phone,
    linkedin: p.externalUrls?.find?.((u) => u.type === 'linkedin')?.url, city: p.city, source: 'ZoomInfo',
  }));
}

export async function lusha({ company, names = [] }, ctx) {
  const key = ctx.cred?.apiKey || process.env.LUSHA_API_KEY;
  if (!key) throw new Error('Connect your Lusha API key first');
  const out = [];
  for (const n of names) {
    const { first, last } = split(n);
    const u = new URL('https://api.lusha.com/v2/person');
    Object.entries({ firstName: first, lastName: last, companyName: company }).forEach(([k, v]) => u.searchParams.set(k, v));
    const r = await fetch(u, { headers: { api_key: key } });
    if (r.status === 401 || r.status === 403) throw new Error('Lusha rejected the API key');
    if (!r.ok) continue;
    const p = (await r.json()).contact?.data;
    if (!p) continue;
    out.push({ name: p.fullName || n, title: p.jobTitle?.title, email: p.emailAddresses?.[0]?.email, phone: p.phoneNumbers?.[0]?.number, linkedin: p.socialLinks?.linkedin, city: p.location?.city, source: 'Lusha' });
  }
  return out;
}

export const providers = { zoominfo, lusha };
