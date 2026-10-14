// Reads a Miro board with the user's own access token and returns its text items and connectors.
const strip = (h = '') => h.replace(/<br\s*\/?>|<\/p>|<\/div>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\n{2,}/g, '\n').trim();

export function boardId(url) {
  const m = String(url).match(/(?:board|live-embed)\/([^/?#\s"']+)/);
  return m ? decodeURIComponent(m[1]) : String(url).trim();
}

async function pages(url, token) {
  const out = []; let next = url;
  for (let i = 0; i < 40 && next; i++) {
    const r = await fetch(next, { headers: { Authorization: `Bearer ${token}`, accept: 'application/json' } });
    if (r.status === 401 || r.status === 403) throw new Error('Miro rejected the token (needs boards:read, and access to this board)');
    if (!r.ok) throw new Error(`Miro ${r.status}: ${(await r.text()).slice(0, 160)}`);
    const j = await r.json(); out.push(...(j.data || []));
    next = j.links?.next || (j.cursor ? `${url}${url.includes('?') ? '&' : '?'}cursor=${encodeURIComponent(j.cursor)}` : null);
  }
  return out;
}

export async function importBoard(urlOrId, token) {
  const id = encodeURIComponent(boardId(urlOrId));
  const base = `https://api.miro.com/v2/boards/${id}`;
  const [items, connectors] = await Promise.all([pages(`${base}/items?limit=50`, token), pages(`${base}/connectors?limit=50`, token)]);
  return {
    items: items.filter((i) => ['sticky_note', 'card', 'shape', 'text', 'app_card'].includes(i.type))
      .map((i) => ({ id: i.id, text: strip(i.data?.content || i.data?.title || ''), x: i.position?.x ?? 0, y: i.position?.y ?? 0, w: i.geometry?.width ?? null, h: i.geometry?.height ?? null, color: i.style?.fillColor || null }))
      .filter((i) => i.text),
    connectors: connectors.map((c) => ({ from: c.startItem?.id, to: c.endItem?.id })).filter((c) => c.from && c.to),
  };
}
