// The sf CLI sometimes prints extra JSON (e.g. an update-available warning) before its real result,
// depending on the environment. Scan the text for every top-level {...} document and return the
// one that carries `status` (the command result), otherwise the last one.
// Colour codes appear when a parent (e.g. concurrently) sets FORCE_COLOR, which breaks JSON.parse.
export const CLI_ENV = { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' };

export function parseSfJson(raw) {
  const text = String(raw).replace(/\u001b\[[0-9;]*m/g, '');
  const docs = [];
  let depth = 0, start = -1, inStr = false, esc = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"' && depth > 0) inStr = true;
    else if (ch === '{') { if (depth++ === 0) start = i; }
    else if (ch === '}' && depth > 0 && --depth === 0) {
      try { docs.push(JSON.parse(text.slice(start, i + 1))); } catch { /* not JSON, e.g. text in braces */ }
    }
  }
  const hit = [...docs].reverse().find((d) => d && 'status' in d) || docs.at(-1);
  if (!hit) throw new Error(`Could not read output from the sf CLI (got ${text.length} chars: ${JSON.stringify(String(text).slice(0, 300))})`);
  return hit;
}
