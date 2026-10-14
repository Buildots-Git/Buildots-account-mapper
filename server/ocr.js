// Reads a picture of an org chart with OCR, entirely on this computer (no AI service, nothing is uploaded).
// Pipeline: cut the picture into overlapping tiles -> clean up (blue link text -> black, drop underlines and box borders)
// -> OCR each tile -> merge lines -> group lines into cards (a blue name line plus the lines under it)
// -> find column headers (Houston, Dallas...) -> sample each card's fill colour.
import sharp from 'sharp';
import { createRequire } from 'node:module';
import path from 'node:path';
import { createWorker } from 'tesseract.js';

const require = createRequire(import.meta.url);
const LANG_DIR = path.join(path.dirname(require.resolve('@tesseract.js-data/eng/package.json')), '4.0.0_best_int');

const isBlue = (r, g, b) => b > 170 && r < 130 && g < 175 && b - r > 60; // the colour of link text
const isDark = (r, g, b) => r < 110 && g < 110 && b < 110;

/** Turn blue link text black, everything light white, then erase long thin strokes (underlines and box borders). */
async function clean(img) {
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height, C = info.channels, out = Buffer.alloc(W * H);
  for (let i = 0; i < W * H; i++) { const r = data[i * C], g = data[i * C + 1], b = data[i * C + 2]; out[i] = isBlue(r, g, b) || isDark(r, g, b) ? 0 : 255; }
  const RUN = Math.max(40, Math.round(W * 0.03));
  for (let y = 0; y < H; y++) {
    let x = 0;
    while (x < W) {
      if (out[y * W + x] === 0) {
        let e = x; while (e < W && out[y * W + e] === 0) e++;
        if (e - x >= RUN) for (let k = x; k < e; k++) { const up = y > 0 ? out[(y - 1) * W + k] : 255, dn = y < H - 1 ? out[(y + 1) * W + k] : 255; if (up === 255 || dn === 255) out[y * W + k] = 255; }
        x = e;
      } else x++;
    }
  }
  return sharp(out, { raw: { width: W, height: H, channels: 1 } }).png().toBuffer();
}

const TITLE_WORDS = /\b(manager|mngr|director|project|vp|president|executive|superintendent|engineer|coordinator|precon|senior|sr|regional|area|healthcare|technology|facilities|operations|technical|controls|chief|office|leader|industrial|pm|vdc|bizdev|webinar|field|relations|community|scheduler|estimator|safety|quality|controller|administrator|assistant|lead|head|officer|services|commercial|division)\b/i;

export async function readChart({ buffer, onProgress }) {
  const meta = await sharp(buffer).metadata();
  const W = meta.width, H = meta.height;
  const TILE = 1600, STRIDE = 900;
  const worker = await createWorker('eng', 1, { langPath: LANG_DIR, gzip: true, cacheMethod: 'none', logger: () => {} });
  await worker.setParameters({ tessedit_pageseg_mode: '11', preserve_interword_spaces: '1', user_defined_dpi: '300' }); // dpi hint silences the resolution warnings
  const raw = [];
  const xs = [], ys = [];
  for (let t = 0; t < H; t += STRIDE) { ys.push(t); if (t + TILE >= H) break; }
  for (let l = 0; l < W; l += STRIDE) { xs.push(l); if (l + TILE >= W) break; }
  let done = 0;
  for (const top of ys) for (const left of xs) {
    const width = Math.min(TILE, W - left), height = Math.min(TILE, H - top);
    if (width >= 250 && height >= 250) {
      const buf = await clean(sharp(buffer).extract({ left, top, width, height }));
      const { data } = await worker.recognize(buf, {}, { blocks: true });
      for (const b of data.blocks || []) for (const p of b.paragraphs) for (const ln of p.lines) {
        const text = ln.text.replace(/\s+/g, ' ').trim();
        if (text.length >= 2) raw.push({ text, conf: ln.confidence, x: left + ln.bbox.x0, y: top + ln.bbox.y0, w: ln.bbox.x1 - ln.bbox.x0, h: ln.bbox.y1 - ln.bbox.y0 });
      }
    }
    onProgress?.(++done, xs.length * ys.length);
  }
  await worker.terminate();

  // the same line seen in overlapping tiles: keep the longest (uncut) read
  const lines = [];
  for (const l of raw.sort((a, b) => b.text.length - a.text.length || b.conf - a.conf)) {
    if (!lines.some((k) => Math.abs(k.y - l.y) < Math.min(k.h, l.h) * 0.7 && l.x < k.x + k.w && k.x < l.x + l.w)) lines.push(l);
  }

  // colour information straight from the pixels
  const { data: px, info } = await sharp(buffer).raw().toBuffer({ resolveWithObject: true });
  const C = info.channels, at = (x, y) => { const i = (Math.min(H - 1, Math.max(0, y)) * W + Math.min(W - 1, Math.max(0, x))) * C; return [px[i], px[i + 1], px[i + 2]]; };
  for (const l of lines) {
    let blue = 0, dark = 0;
    for (let y = l.y; y < l.y + l.h; y += 2) for (let x = l.x; x < l.x + l.w; x += 2) { const [r, g, b] = at(x, y); if (isBlue(r, g, b)) blue++; else if (isDark(r, g, b)) dark++; }
    l.blue = blue / (blue + dark + 1) > 0.35 && blue > 12;
  }
  const hex = ([r, g, b]) => '#' + [r, g, b].map((v) => Math.round(v / 8) * 8).map((v) => Math.min(255, v).toString(16).padStart(2, '0')).join('');
  const fillAround = (x0, y0, x1, y1) => { // the box colour: the most common colour in the padding just left of / above the text
    const votes = new Map();
    const pts = [[x0 - 18, y0 - 6], [x0 - 18, (y0 + y1) / 2], [x0 - 18, y1 + 6], [x1 + 18, y0 - 6], [x1 + 18, (y0 + y1) / 2], [x1 + 18, y1 + 6], [(x0 + x1) / 2, y0 - 10], [(x0 + x1) / 2, y1 + 10]];
    for (const [x, y] of pts) { const [r, g, b] = at(Math.round(x), Math.round(y)); if (r + g + b < 120) continue; const k = hex([r, g, b]); votes.set(k, (votes.get(k) || 0) + 1); }
    return [...votes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  };

  // group lines into cards: a name line plus the non-blue lines stacked right under it
  const exec = (l) => l.text.includes('»');
  const names = lines.filter((l) => l.blue && !exec(l) && /[A-Za-z]{2}/.test(l.text) && l.text.split(' ').length <= 5).sort((a, b) => a.y - b.y);
  const used = new Set(names);
  const cards = [];
  const NAME_LIKE = /^[A-Z][A-Za-z'’.-]{1,}( [A-Z][A-Za-z'’.-]+){1,2}$/;
  const cleanText = (t) => t.replace(/[|\[\]_]/g, '').replace(/\s+/g, ' ').trim();
  const buildCard = (n, allNames, requireTitleWord) => {
    const attached = []; let last = n;
    const near = lines.filter((l) => !used.has(l) && l !== n && !l.blue && !exec(l) && l.y >= n.y + n.h * 0.5 && Math.abs((l.x + l.w / 2) - (n.x + n.w / 2)) < Math.max(n.w, l.w) * 0.65 + 70).sort((a, b) => a.y - b.y);
    for (const l of near) {
      if (l.y - (last.y + last.h) > last.h * 1.3 || l.y > n.y + n.h * 7) break;
      if (allNames.some((m) => m !== n && m.y < l.y && m.y > last.y && Math.abs((m.x + m.w / 2) - (n.x + n.w / 2)) < n.w)) break;
      attached.push(l); last = l;
    }
    if (requireTitleWord && !(attached.length && TITLE_WORDS.test(attached.map((a) => a.text).join(' ')))) return null;
    attached.forEach((a) => used.add(a)); used.add(n);
    const x0 = Math.min(n.x, ...attached.map((a) => a.x)), x1 = Math.max(n.x + n.w, ...attached.map((a) => a.x + a.w));
    return { name: cleanText(n.text), title: cleanText(attached.map((a) => a.text).join(' ')), x: (x0 + x1) / 2, y: n.y, bbox: [x0, n.y, x1, last.y + last.h], fill: fillAround(x0, n.y, x1, last.y + last.h), conf: n.conf, linked: n.blue };
  };
  for (const n of names) cards.push(buildCard(n, names, false));
  // people whose name is plain black text (not linked to a Salesforce record on the board)
  const plain = lines.filter((l) => !used.has(l) && !l.blue && !exec(l) && NAME_LIKE.test(l.text) && !TITLE_WORDS.test(l.text) && l.text.length <= 28).sort((a, b) => a.y - b.y);
  for (const n of plain) { if (used.has(n)) continue; const c = buildCard(n, [...names, ...plain], true); if (c) cards.push(c); }
  // top-of-chart boxes written as "NAME»TITLE"
  const cap = (t) => t.toLowerCase().replace(/(^|[\s.'-])([a-z])/g, (m, a, b) => a + b.toUpperCase()).trim();
  for (const l of lines) {
    if (used.has(l) || !exec(l)) continue;
    const [nm, ttl] = l.text.split('»');
    const cont = lines.find((m) => !used.has(m) && m !== l && !exec(m) && m.y > l.y && m.y - (l.y + l.h) < l.h * 1.2 && Math.abs((m.x + m.w / 2) - (l.x + l.w / 2)) < l.w * 0.6 + 60);
    used.add(l); if (cont) used.add(cont);
    if (cleanText(nm).length > 3) cards.push({ name: cap(cleanText(nm)), title: cleanText([ttl, cont && cont.text].filter(Boolean).join(' ')), x: l.x + l.w / 2, y: l.y, bbox: [Math.min(l.x, cont ? cont.x : l.x), l.y, Math.max(l.x + l.w, cont ? cont.x + cont.w : 0), cont ? cont.y + cont.h : l.y + l.h], fill: fillAround(l.x, l.y, l.x + l.w, l.y + l.h), conf: l.conf, linked: false });
  }

  // column headers: short, non-blue, not part of a card, with several cards underneath
  const leftovers = lines.filter((l) => !used.has(l) && !l.blue && /^[A-Za-z][A-Za-z .&-]{2,23}$/.test(l.text) && l.text.split(' ').length <= 3 && !TITLE_WORDS.test(l.text));
  const headers = leftovers.filter((h) => cards.filter((c) => c.y > h.y + h.h && Math.abs(c.x - (h.x + h.w / 2)) < 650).length >= 3).map((h) => ({ text: h.text.trim(), x: h.x + h.w / 2, y: h.y, bbox: [h.x, h.y, h.x + h.w, h.y + h.h] }));
  for (const c of cards) {
    const cand = headers.filter((h) => h.y < c.y - 20 && Math.abs(h.x - c.x) < 650);
    if (cand.length) c.group = cand.sort((a, b) => (Math.abs(a.x - c.x) + 0.3 * (c.y - a.y)) - (Math.abs(b.x - c.x) + 0.3 * (c.y - b.y)))[0].text;
  }
  cards.forEach((c, i) => { c.id = `c${i}`; }); headers.forEach((h, i) => { h.id = `h${i}`; });
  const geo = findGeometry({ px, W, H, C, lines, nodes: [...cards.map((c) => ({ id: c.id, kind: 'card', bbox: c.bbox, name: c.name })), ...headers.map((h) => ({ id: h.id, kind: 'header', bbox: h.bbox, name: h.text }))] });
  for (const n of [...cards, ...headers]) { const g = geo.boxes[n.id]; if (g) { n.box = g.box; n.boxApprox = !!g.approx; if (g.fill) n.fill = g.fill; } }
  return { cards, headers: headers.map((h) => ({ id: h.id, text: h.text, x: h.x, y: h.y, box: h.box || null })), edges: geo.edges, linesRead: lines.length, width: W, height: H };
}

// ---------------------------------------------------------------------------------------------
// Geometry: the real box around each card (for fill colour) and the connector lines between boxes
// ---------------------------------------------------------------------------------------------
function findGeometry({ px, W, H, C, lines, nodes }) {
  const nameOf = Object.fromEntries(nodes.map((n) => [n.id, n.name]));
  const dark = (x, y) => { if (x < 0 || y < 0 || x >= W || y >= H) return false; const i = (y * W + x) * C; return px[i] < 110 && px[i + 1] < 110 && px[i + 2] < 110; };
  const rgb = (x, y) => { const i = (Math.min(H - 1, Math.max(0, y)) * W + Math.min(W - 1, Math.max(0, x))) * C; return [px[i], px[i + 1], px[i + 2]]; };
  const frac = (fn, a, b, step) => { let d = 0, n = 0; for (let t = a; t <= b; t += step) { n++; if (fn(t)) d++; } return n ? d / n : 0; };

  // 1. the box around each node: scan outwards from the text until a long straight dark stroke is hit on every side
  const PAD = 170, FR = 0.8;
  const boxes = {};
  for (const n of nodes) {
    const [x0, y0, x1, y1] = n.bbox; if (x1 - x0 < 20 || y1 - y0 < 10) continue;
    const find = (dir, test) => { for (let d = 4; d <= PAD; d++) if (test(dir * d)) { let t = 1; while (t < 14 && test(dir * (d + t))) t++; return { at: dir * d, t }; } return null; };
    const L = find(-1, (d) => frac((y) => dark(x0 + d, y), y0, y1, 2) >= FR), R = find(1, (d) => frac((y) => dark(x1 + d, y), y0, y1, 2) >= FR);
    const T = find(-1, (d) => frac((x) => dark(x, y0 + d), x0, x1, 2) >= FR), B = find(1, (d) => frac((x) => dark(x, y1 + d), x0, x1, 2) >= FR);
    if (!(L && R && T && B)) continue;
    const box = { x0: x0 + L.at, y0: y0 + T.at, x1: x1 + R.at, y1: y1 + B.at, t: Math.max(L.t, R.t, T.t, B.t) };
    // fill colour: the most common colour inside the box, away from the text
    const votes = new Map();
    const ex = (x, y) => lines.some((l) => x > l.x - 8 && x < l.x + l.w + 8 && y > l.y - 8 && y < l.y + l.h + 8);
    for (let y = box.y0 + box.t + 6; y < box.y1 - 2; y += 10) for (let x = box.x0 + box.t + 6; x < box.x1 - 2; x += 10) {
      if (ex(x, y)) continue; const [r, g, b] = rgb(x, y); if (r + g + b < 200) continue;
      const k = '#' + [r, g, b].map((v) => Math.min(255, Math.round(v / 8) * 8).toString(16).padStart(2, '0')).join(''); votes.set(k, (votes.get(k) || 0) + 1);
    }
    boxes[n.id] = { box, fill: [...votes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null };
  }
  // nodes whose exact border could not be found (odd fills, cut off at the edge): a box a little bigger than the text, so lines can still attach
  for (const n of nodes) {
    if (boxes[n.id] || !n.bbox) continue; const [x0, y0, x1, y1] = n.bbox; if (x1 - x0 < 20 || y1 - y0 < 10) continue;
    boxes[n.id] = { box: { x0: x0 - 28, y0: y0 - 24, x1: x1 + 28, y1: y1 + 24, t: 6 }, fill: undefined, approx: true };
  }

  // 2. a line mask at 1/3 size: dark pixels, minus text and minus the boxes we found (so only connectors remain)
  const S = 3, w = Math.ceil(W / S), h = Math.ceil(H / S);
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let on = 0; for (let dy = 0; dy < S && !on; dy++) for (let dx = 0; dx < S; dx++) if (dark(x * S + dx, y * S + dy)) { on = 1; break; }
    mask[y * w + x] = on;
  }
  const erase = (x0, y0, x1, y1) => { for (let y = Math.max(0, Math.floor(y0 / S)); y <= Math.min(h - 1, Math.ceil(y1 / S)); y++) for (let x = Math.max(0, Math.floor(x0 / S)); x <= Math.min(w - 1, Math.ceil(x1 / S)); x++) mask[y * w + x] = 0; };
  for (const l of lines) erase(l.x - 10, l.y - 10, l.x + l.w + 10, l.y + l.h + 10);
  const ids = Object.keys(boxes);
  for (const id of ids) { const b = boxes[id].box; const m = b.t + 9; erase(b.x0 - m, b.y0 - m, b.x1 + m, b.y1 + m); }

  // which node's box is near a pixel (connector ends stop ~10px short of the box, so look a little further)
  const label = new Int32Array(w * h).fill(-1), near = new Int32Array(w * h).fill(-1);
  const stamp = (arr, b, pad, k) => { for (let y = Math.max(0, Math.floor((b.y0 - pad) / S)); y <= Math.min(h - 1, Math.ceil((b.y1 + pad) / S)); y++) for (let x = Math.max(0, Math.floor((b.x0 - pad) / S)); x <= Math.min(w - 1, Math.ceil((b.x1 + pad) / S)); x++) arr[y * w + x] = k; };
  ids.forEach((id, k) => { stamp(label, boxes[id].box, boxes[id].box.t + 30, k); stamp(near, boxes[id].box, boxes[id].box.t + 60, k); });

  // 3. connected pieces of line
  const comp = new Int32Array(w * h).fill(-1); const comps = [];
  for (let i = 0; i < w * h; i++) {
    if (!mask[i] || comp[i] !== -1) continue;
    const id = comps.length, stack = [i], px_ = []; comp[i] = id;
    while (stack.length) { const c = stack.pop(); px_.push(c); const cx = c % w, cy = (c - cx) / w;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const nx = cx + dx, ny = cy + dy; if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue; const j = ny * w + nx; if (mask[j] && comp[j] === -1) { comp[j] = id; stack.push(j); } } }
    if (px_.length >= 12) comps.push(px_); else px_.forEach((c) => { comp[c] = -2; });
  }
  // thick blobs (arrowheads) survive erosion; the thin connector lines do not
  const er = new Uint8Array(w * h);
  for (let y = 2; y < h - 2; y++) for (let x = 2; x < w - 2; x++) { let all = 1; for (let dy = -2; dy <= 2 && all; dy++) for (let dx = -2; dx <= 2; dx++) if (!mask[(y + dy) * w + x + dx]) { all = 0; break; } er[y * w + x] = all; }
  const seen = new Uint8Array(w * h); const heads = [];
  for (let i = 0; i < w * h; i++) {
    if (!er[i] || seen[i]) continue; const stack = [i]; seen[i] = 1; let sx = 0, sy = 0, n = 0;
    while (stack.length) { const c = stack.pop(); const cx = c % w, cy = (c - cx) / w; sx += cx; sy += cy; n++;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const nx = cx + dx, ny = cy + dy; if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue; const j = ny * w + nx; if (er[j] && !seen[j]) { seen[j] = 1; stack.push(j); } } }
    if (n >= 3 && n <= 400) heads.push({ x: sx / n, y: sy / n, comp: comp[i] });
  }

  // 4. turn each piece of line into parent -> child edges
  const centre = (id) => { const b = boxes[id].box; return { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2, top: b.y0, bottom: b.y1 }; };
  const edges = [];
  comps.forEach((pxs, cid) => {
    const touched = new Set();
    for (const c of pxs) { const k = label[c]; if (k >= 0) touched.add(ids[k]); }
    if (process.env.GEO_DEBUG && touched.size >= 1 && pxs.length > 40) console.error('comp', cid, 'px', pxs.length, 'touches', [...touched].map((i) => nameOf[i]).join(' | '));
    if (touched.size < 2) return;
    const children = new Set();
    for (const hd of heads) if (hd.comp === cid) { const k = near[Math.round(hd.y) * w + Math.round(hd.x)]; if (k >= 0 && touched.has(ids[k])) children.add(ids[k]); }
    if (process.env.GEO_DEBUG) console.error('   heads->children', [...children].map((i) => nameOf[i]).join(' | ') || '(none)');
    let kind = 'arrow';
    let kids = [...children], parents = [...touched].filter((id) => !children.has(id));
    if (!kids.length) { // plain lines: the box highest up is the parent, the ones clearly below it are the children
      kind = 'plain';
      // only trust an arrow-less line if it is a real stroke (not two boxes that merely touch) between exactly-detected boxes
      if (pxs.length < 40) return;
      const sorted = [...touched].filter((id) => !boxes[id].approx).sort((a, b) => centre(a).y - centre(b).y);
      if (sorted.length < 2) return;
      parents = [sorted[0]]; kids = sorted.slice(1).filter((id) => centre(id).top > centre(sorted[0]).bottom + 30);
    }
    for (const c of kids) {
      // choose the parent closest above this child
      const above = parents.filter((p) => centre(p).y < centre(c).y - 10);
      const pool = above.length ? above : parents; if (!pool.length) continue;
      const p = pool.sort((a, b) => (centre(c).y - centre(a).y) - (centre(c).y - centre(b).y))[0];
      if (p !== c) edges.push({ from: p, to: c, kind });
    }
  });
  // one parent per child: keep the nearest
  const best = new Map();
  for (const e of edges) { const d = centre(e.to).y - centre(e.from).y; if (!best.has(e.to) || (d > 0 && d < best.get(e.to).d)) best.set(e.to, { ...e, d }); }
  return { boxes, edges: [...best.values()].map(({ from, to, kind }) => ({ from, to, kind })) };
}
