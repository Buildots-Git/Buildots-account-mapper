// Reads a hand-made org chart / relationship map (e.g. a Miro export) with Claude's vision.
// The image arrives as one or more tiles (a big board is cut up so small text stays legible).
const BASE = process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com';
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';

const PROMPT = (n, k, account, roster) => `You are reading ${n > 1 ? `part ${k} of ${n} of ` : ''}a screenshot of a hand-made org chart / relationship map of the customer "${account}".
Cards are boxes holding a person's name (often a blue underlined link), their job title, and sometimes extra notes. The box fill colour is a status:
green = active / have met, orange = talk first / do not contact, yellow = contact them (no prior conversation), red/pink = a heading or legend, white/grey/beige = no status.
Some boxes are HEADERS (an office, region or team name such as "Houston" or "Dallas") with people stacked under them or joined to them by lines.

Known contacts on this account (use this spelling when a name clearly matches one of them):
${roster.join('; ')}

Return ONLY a JSON object, no prose:
{"cards":[{"name":"","title":"","group":"header text this card sits under, or null","color":"green|orange|yellow|red|neutral","notes":"any extra text on the card beyond name and title, or null"}]}
Rules: include only people cards, not headers or legend boxes. Skip anything you cannot read; never invent names. If a name is cut off at the edge of the image, skip it.`;

function extractJson(text) {
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  if (a < 0 || b < a) throw new Error('The model did not return JSON');
  return JSON.parse(text.slice(a, b + 1));
}

async function readTile(img, i, n, { apiKey, account, roster }) {
  const r = await fetch(`${BASE}/v1/messages`, {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: MODEL, max_tokens: 4096,
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.data } },
        { type: 'text', text: PROMPT(n, i + 1, account, roster) },
      ] }],
    }),
  });
  if (r.status === 401 || r.status === 403) throw new Error('Anthropic rejected the API key');
  if (r.status === 429) throw new Error('Anthropic rate limit reached — wait a minute and try again');
  if (!r.ok) throw new Error(`Anthropic ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  const text = (j.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
  return extractJson(text).cards || [];
}

/** Read every tile (3 at a time) and merge, keeping the richest copy of a person seen in overlapping tiles. */
export async function readOrgChart({ images, names, account, apiKey }) {
  if (!apiKey) throw new Error('Connect your Anthropic API key first');
  const roster = names.slice(0, 700);
  const out = new Array(images.length);
  let next = 0;
  const worker = async () => { while (next < images.length) { const i = next++; out[i] = await readTile(images[i], i, images.length, { apiKey, account, roster }); } };
  await Promise.all(Array.from({ length: Math.min(3, images.length) }, worker));
  const key = (c) => (c.name || '').toLowerCase().replace(/[^a-z]/g, '');
  const score = (c) => (c.group ? 2 : 0) + (c.color && c.color !== 'neutral' ? 2 : 0) + (c.title ? 1 : 0) + (c.notes ? 1 : 0);
  const best = new Map();
  for (const c of out.flat()) { if (!key(c)) continue; const k = key(c); if (!best.has(k) || score(c) > score(best.get(k))) best.set(k, c); }
  return [...best.values()];
}
