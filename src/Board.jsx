import React, { useMemo, useCallback, useEffect } from 'react';
import { ReactFlow, applyNodeChanges, Background, BackgroundVariant, Controls, MiniMap, BaseEdge, EdgeLabelRenderer, getSmoothStepPath, useReactFlow, useNodesInitialized, ReactFlowProvider } from '@xyflow/react';
import AccountNode from './AccountNode.jsx';
import ContactNode from './ContactNode.jsx';
import { NoteNode, TextNode, PinNode } from './ItemNodes.jsx';
import { useStore, effectiveTheme } from './store.js';
import { regionOf, regionColor, heatColor } from './hierarchy.js';
import { matchesSearch, onBoard, filtersActive } from './search.js';

const W = 220, H = 120;

/**
 * Tidy-tree layout. Subtrees sit side by side under their manager; a manager with many direct
 * reports who have no reports of their own gets them wrapped into a compact grid instead of one
 * very wide row. Returns { [id]: {x, y} } (top-left of each card).
 */
function layoutTree(people, parentOf, W, H) {
  const GX = 36, GY = 80, COLS = 4, WRAP_AT = 6;
  const kids = {};
  const order = [...people].sort((a, b) => (a.Name || '').localeCompare(b.Name || ''));
  order.forEach((p) => { (kids[parentOf(p) || '__root'] ||= []).push(p.Id); });
  const seen = new Set();
  const measure = (id) => {
    if (seen.has(id)) return null;
    seen.add(id);
    const ks = (kids[id] || []).map(measure).filter(Boolean);
    const grid = ks.length >= WRAP_AT && ks.every((k) => !k.ks.length);
    const cols = Math.min(COLS, ks.length), rows = Math.ceil(ks.length / COLS);
    const w = grid ? Math.max(W, cols * W + (cols - 1) * GX) : Math.max(W, ks.reduce((a, k) => a + k.w, 0) + GX * Math.max(0, ks.length - 1));
    const h = grid ? H + GY + rows * H + (rows - 1) * 24 : H + (ks.length ? GY + Math.max(...ks.map((k) => k.h)) : 0);
    return { id, ks, grid, cols, w, h };
  };
  const roots = (kids.__root || []).map(measure).filter(Boolean);
  // anything caught in a cycle (only possible through manual edits) becomes its own root
  order.forEach((p) => { if (!seen.has(p.Id)) { const m = measure(p.Id); if (m) roots.push(m); } });
  const pos = {};
  const place = (n, x0, y) => {
    pos[n.id] = { x: x0 + n.w / 2 - W / 2, y };
    if (n.grid) {
      const gw = n.cols * W + (n.cols - 1) * GX, gx = x0 + (n.w - gw) / 2;
      n.ks.forEach((k, i) => { pos[k.id] = { x: gx + (i % n.cols) * (W + GX), y: y + H + GY + Math.floor(i / n.cols) * (H + 24) }; });
    } else { let c = x0; n.ks.forEach((k) => { place(k, c, y + H + GY); c += k.w + GX; }); }
  };
  let cx = 0; roots.forEach((r) => { place(r, cx, 0); cx += r.w + GX * 2; });
  return pos;
}
const nodeTypes = { contact: ContactNode, account: AccountNode, note: NoteNode, text: TextNode, pin: PinNode };

// A reporting line with a × button (shown on hover, or when either end is selected) to remove it.
function LinkEdge({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, style, id, data }) {
  const [path] = getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  const lx = targetX, ly = targetY - 22; // sits right above the card the line leads into
  return (
    <>
      <BaseEdge id={id} path={path} style={style} interactionWidth={26} />
      {data.show && (
        <EdgeLabelRenderer>
          <button className="edge-x nodrag nopan" style={{ transform: `translate(-50%,-50%) translate(${lx}px,${ly}px)` }}
            title="Remove this reporting line" onMouseEnter={data.onEnter} onMouseLeave={data.onLeave} onClick={data.onRemove}>×</button>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
const edgeTypes = { link: LinkEdge };

const PEND_LABEL = [['ReportsToId', 'Reports To'], ['Region__c', 'Region'], ['Contact_Role__c', 'Role'], ['ES_Expansion_Status__c', 'ES status']];
export function useGraph() {
  const { data, extras, overrides, positions, showFields, showRelated, hideUntitled, fieldCatalog, comments, psearch: search, highlight, items, freshItem, cardLayout, collapsed, collapseAll } = useStore();
  const labels = useMemo(() => Object.fromEntries(fieldCatalog.map((f) => [f.name, f.label])), [fieldCatalog]);
  return useMemo(() => {
    const everyone = useStore.getState().people();
    const pend = new Map(useStore.getState().pendingChanges().map((f) => [f.Id, PEND_LABEL.filter(([k]) => k in f).map(([, l]) => l)]));
    const searching = filtersActive(search);
    const hit = (p) => matchesSearch(p, search);
    // With "only show matches" the matching people stay, plus the managers above them so you still see where they sit.
    const onB = everyone.filter((p) => onBoard(p, hideUntitled));
    // Account families: each subsidiary becomes a node of its own that its people hang from (STO -> Layton -> Layton's team).
    const fam = data.family || []; const famMode = fam.length > 1; const famById = Object.fromEntries(fam.map((f) => [f.Id, f]));
    // The parent's own contacts get their own group so every account folds separately.
    const rootId = fam[0]?.Id; const ownKey = `acct:${rootId}:own`;
    const acctParent = (p) => (famMode && !p.virtual && p.AccountId && famById[p.AccountId] ? (p.AccountId === rootId ? ownKey : `acct:${p.AccountId}`) : null);
    let onBV = onB;
    if (famMode) {
      const need = new Set([fam[0].Id]);
      for (const a of new Set(onB.map((p) => p.AccountId).filter((a) => famById[a]))) { let c = a, n = 0; while (c && famById[c] && !need.has(c) && n++ < 10) { need.add(c); c = famById[c].ParentId; } }
      onBV = [...(onB.some((p) => p.AccountId === rootId) ? [{ Id: ownKey, virtual: true, own: true, Name: `${fam[0].Name} — own contacts`, acct: fam[0], reportsTo: `acct:${rootId}` }] : []), ...fam.filter((f) => need.has(f.Id)).map((f) => ({ Id: `acct:${f.Id}`, virtual: true, Name: f.Name, acct: f, reportsTo: f.ParentId && need.has(f.ParentId) ? `acct:${f.ParentId}` : null })), ...onB];
    }
    let keep = null;
    if (searching && search.only) {
      keep = new Set(); const by0 = Object.fromEntries(onBV.map((p) => [p.Id, p]));
      onB.forEach((p) => { if (!hit(p)) return; let c = p.Id, n = 0; while (c && !keep.has(c) && by0[c] && n++ < 60) { keep.add(c); c = by0[c].reportsTo || acctParent(by0[c]); } });
    }
    const shownAll = onBV.filter((p) => !keep || keep.has(p.Id));
    const ids = new Set(shownAll.map((p) => p.Id));
    const byId = Object.fromEntries(shownAll.map((p) => [p.Id, p]));
    const allById = Object.fromEntries(everyone.map((p) => [p.Id, p]));
    // Hiding someone doesn't break the tree: their reports attach to the nearest manager still on the board.
    const parentOf = (p) => {
      let cur = p.reportsTo; let hops = 0;
      while (cur && !ids.has(cur) && hops++ < 60) cur = allById[cur]?.reportsTo;
      if (cur && cur !== p.Id && ids.has(cur)) return cur;
      const ap = acctParent(p); return ap && ids.has(ap) ? ap : null;
    };
    // A person inherits their region from the nearest ancestor that has one.
    const regionCache = {};
    const region = (p) => {
      if (p.Id in regionCache) return regionCache[p.Id];
      regionCache[p.Id] = null; // cycle guard
      const own = regionOf(p); const par = parentOf(p);
      return (regionCache[p.Id] = own || (par ? region(byId[par]) : null));
    };
    // Branches fold away: below the top levels by default (big boards only), or as the user chose. A search/filter shows everything.
    const kids = {};
    shownAll.forEach((p) => { const par = parentOf(p); if (par) (kids[par] ||= []).push(p.Id); });
    const depthC = {};
    const depthOf = (id, n = 0) => (id in depthC ? depthC[id] : (depthC[id] = (() => { const par = byId[id] && parentOf(byId[id]); return par && n < 40 ? 1 + depthOf(par, n + 1) : 0; })()));
    const descC = {};
    const desc = (id) => (id in descC ? descC[id] : (descC[id] = (kids[id] || []).reduce((a, k) => a + (byId[k]?.virtual ? 0 : 1) + desc(k), 0)));
    // Default view: reveal levels top-down only while the board stays small enough to read at a glance (~30 cards).
    let foldDepth = 99;
    if (!famMode && shownAll.length > 40) {
      const byDepth = {}; shownAll.forEach((p) => { const d = depthOf(p.Id); byDepth[d] = (byDepth[d] || 0) + 1; });
      let total = 0; foldDepth = 0;
      for (let d = 0; byDepth[d]; d++) { total += byDepth[d]; if (total > 30 && d > 0) break; foldDepth = d; }
    }
    // Family boards: account groups start folded (so you see the whole company at a glance); inside one, two levels show.
    const teamDepth = (id) => { let d = 0, cur = id, n = 0; while (cur && !byId[cur]?.virtual && n++ < 60) { d++; cur = parentOf(byId[cur]); } return d; };
    const isFolded = (id) => {
      if (searching || !kids[id]) return false;
      if (id in collapsed) return collapsed[id];
      if (collapseAll === 'expand') return false;
      if (collapseAll === 'collapse') return true;
      if (famMode) return byId[id].virtual ? kids[id].some((k) => !byId[k]?.virtual) : teamDepth(id) >= 2;
      return depthOf(id) >= foldDepth;
    };
    const hiddenByFold = (p) => { let cur = parentOf(p); let n = 0; while (cur && n++ < 60) { if (isFolded(cur)) return true; cur = parentOf(byId[cur]); } return false; };
    const people = shownAll.filter((p) => !hiddenByFold(p));
    const regions = [...new Set(people.map(region).filter(Boolean))];
    const counts = (id) => ({
      opps: showRelated.opps ? data.opportunities.filter((o) => o.contactIds.includes(id)).length : 0,
      leads: showRelated.leads ? data.projectLeads.filter((o) => o.contactIds.includes(id)).length : 0,
      cs: showRelated.cs ? data.csProjects.filter((o) => o.contactIds.includes(id)).length : 0,
    });

    // rows are spaced to fit the tallest card the current settings can produce, so wide / detailed cards don't overlap
    const extra = showFields.filter((k) => k !== 'Title').length;
    const rowH = 56 + (showFields.includes('Title') ? 20 : 0) + (highlight.role || highlight.es ? 30 : 0) + extra * 18 + (showRelated.opps || showRelated.leads || showRelated.cs || cardLayout.comments ? 26 : 0) + (cardLayout.actions ? 30 : 0) + 24;
    const auto = layoutTree(people, parentOf, cardLayout.width, Math.max(120, Math.round(rowH * (0.8 + 0.2 * cardLayout.font))));

    // A hand-placed card that now sits on top of another card (its manager changed, or the layout moved on) goes back to its automatic spot.
    const spot = {}; const bw = cardLayout.width, bh = Math.max(80, rowH - 40);
    people.forEach((p) => { spot[p.Id] = positions[p.Id] || auto[p.Id]; });
    people.forEach((p) => {
      const me = positions[p.Id]; if (!me) return;
      const hit = people.some((q) => q.Id !== p.Id && Math.abs(me.x - spot[q.Id].x) < bw && Math.abs(me.y - spot[q.Id].y) < bh);
      if (hit && auto[p.Id]) spot[p.Id] = auto[p.Id];
    });

    const nodes = people.map((p) => {
      if (p.virtual) {
        const { x, y } = spot[p.Id];
        return { id: p.Id, type: 'account', deletable: false, position: { x, y }, data: { acct: p.acct, vid: p.Id, own: !!p.own, label: p.own ? 'Own contacts' : p.Name, root: !p.own && p.acct.Id === data.account.Id, n: desc(p.Id), branch: kids[p.Id] ? { n: desc(p.Id), folded: isFolded(p.Id) } : null } };
      }
      const par = parentOf(p); const r = region(p); const pr = par ? region(byId[par]) : null;
      const { x, y } = spot[p.Id];
      return { id: p.Id, type: 'contact', deletable: false, position: { x, y },
        data: { branch: kids[p.Id] ? { n: desc(p.Id), folded: isFolded(p.Id) } : null, hl: highlight, layout: cardLayout, acc: data.account.Id, labels, p, color: heatColor(p.ES_Expansion_Status__c), regionTint: regionColor(r, regions), showFields, counts: { ...counts(p.Id), notes: (comments[p.Id] || []).length }, notesList: comments[p.Id] || [], branchLabel: r && r !== pr ? r.toUpperCase() : null, dim: searching && !hit(p), hit: searching && hit(p), pend: pend.get(p.Id) || null } };
    });
    const edges = people.filter(parentOf).map((p) => ({
      id: `e-${parentOf(p)}-${p.Id}`, source: parentOf(p), target: p.Id, type: 'link',
      style: { stroke: heatColor(p.ES_Expansion_Status__c), strokeWidth: 1.8 },
    }));
    const itemNodes = items.map((it) => ({
      id: it.id, type: it.type === 'comment' ? 'pin' : it.type, position: { x: it.x, y: it.y }, zIndex: 5, deletable: true,
      ...(it.type === 'comment' ? {} : { style: { width: it.w, height: it.h } }),
      data: { item: it, fresh: freshItem === it.id },
    }));
    return { nodes: [...nodes, ...itemNodes], edges, people };
  }, [data, extras, overrides, positions, showFields, showRelated, hideUntitled, labels, comments, search, highlight, items, freshItem, cardLayout, collapsed, collapseAll]);
}

function Inner() {
  const { nodes: graphNodes, edges } = useGraph();
  const { setPositions, patch, select, selected } = useStore();
  const { fitView, screenToFlowPosition } = useReactFlow();
  const focusId = useStore((s) => s.focusId);
  // `_sys` changes when the computer's light/dark setting does, so 'system' mode follows it live.
  const colorMode = useStore((s) => (s._sys, effectiveTheme(s.theme)));
  const accountId = useStore((s) => s.account?.Id);
  const cardW = useStore((s) => s.cardLayout.width);
  const rf = useReactFlow(); const rfRef = React.useRef(rf); rfRef.current = rf; // stable handle: this effect must run once per account
  React.useEffect(() => {
    if (!focusId) return;
    const t = setTimeout(() => { const ids = [].concat(focusId); fitView({ nodes: ids.map((id) => ({ id })), padding: ids.length > 1 ? 0.25 : 3, maxZoom: 1.1, duration: 500 }); useStore.setState({ focusId: null }); }, 80);
    return () => clearTimeout(t);
  }, [focusId, fitView]);

  // Cards live in local state while being dragged so they follow the cursor; the store only hears about the drop.
  const [nodes, setNodes] = React.useState(() => graphNodes);
  React.useEffect(() => {
    setNodes((prev) => { const sel = new Set(prev.filter((n) => n.selected).map((n) => n.id)); return graphNodes.map((n) => ({ ...n, selected: sel.has(n.id) || n.id === selected })); });
  }, [graphNodes, selected]);
  const onNodesChange = useCallback((changes) => setNodes((ns) => applyNodeChanges(changes, ns)), []);

  // On opening an account: fit everything, but never smaller than a readable zoom. A very wide org opens
  // centred on the top of the tree instead of as unreadable specks ("Fit View" still shows it all).
  const initialized = useNodesInitialized(); // true once every card has been measured
  const fittedFor = React.useRef(null);
  React.useEffect(() => {
    // Wait until the cards on screen are this account's (after a switch the old ones linger for a moment) and measured.
    if (!initialized || fittedFor.current === accountId || !nodes.length || nodes[0].data?.acc !== accountId) return;
    fittedFor.current = accountId; // runs once per account; React Flow updates `nodes` right after fitting, so don't cancel on that
    (async () => {
      const { fitView: fit, getViewport, getNodes, setCenter } = rfRef.current;
      await fit({ padding: 0.08, duration: 0 });
      await new Promise((r) => setTimeout(r, 60));
      if (getViewport().zoom < 0.4) {
        const ns = getNodes(); if (!ns.length) return;
        const top = ns.reduce((a, b) => (b.position.y < a.position.y ? b : a));
        setCenter(top.position.x + cardW / 2, top.position.y + 230, { zoom: 0.45, duration: 0 });
      }
    })();
  }, [initialized, accountId, nodes]);

  // The card under the pointer while dragging is the drop target ("report to this person").
  const [dropTarget, setDropTarget] = React.useState(null);
  const under = (e, dragged) => {
    const x = e.clientX ?? e.touches?.[0]?.clientX, y = e.clientY ?? e.touches?.[0]?.clientY;
    if (x == null) return null;
    const el = document.elementsFromPoint(x, y).find((el) => el.classList?.contains('react-flow__node') && !dragged.includes(el.dataset.id));
    return el?.dataset.id || null;
  };
  const isPerson = (n) => n.type === 'contact';
  const onNodeDrag = useCallback((e, node, all) => { const moved = all?.length ? all : [node]; setDropTarget(moved.every(isPerson) ? under(e, moved.map((n) => n.id)) : null); }, []);
  const onDragStop = useCallback((e, node, all) => {
    const moved = all?.length ? all : [node];
    const things = moved.filter((n) => !isPerson(n) && n.type !== 'account'), people = moved.filter((n) => isPerson(n) || n.type === 'account');
    setDropTarget(null);
    if (things.length) useStore.getState().moveItems(Object.fromEntries(things.map((n) => [n.id, { x: n.position.x, y: n.position.y }])));
    if (!people.length) return;
    // Dropping on an account node (or when an account node moved) is just a move; only dropping on a person re-parents.
    const target = things.length || people.some((n) => n.type === 'account') ? null : under(e, people.map((n) => n.id));
    if (target && !String(target).startsWith('acct:')) { useStore.getState().reparent(people.map((n) => n.id), target); return; }
    setPositions(Object.fromEntries(people.map((n) => [n.id, n.position])));
  }, [setPositions]);

  // The toolbar's tools: click the canvas to drop a note / text box / comment pin right there.
  const tool = useStore((s) => s.tool);
  const onPaneClick = useCallback((e) => {
    const st = useStore.getState();
    document.activeElement?.blur?.(); // finish any text being edited before placing something new
    if (st.tool === 'select') { st.setOpenPin(null); select(null); return; }
    const pos = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    st.addItem(st.tool === 'comment' ? { type: 'comment', x: pos.x - 18, y: pos.y - 18 } : { type: st.tool, x: pos.x - (st.tool === 'note' ? 100 : 110), y: pos.y - (st.tool === 'note' ? 80 : 20) });
  }, [screenToFlowPosition, select]);
  // Delete / Backspace removes the selected people from the board (Salesforce untouched; ⌘Z undoes)
  useEffect(() => {
    const k = (e) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      if (e.metaKey || e.ctrlKey || e.altKey || /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable) return;
      const st = useStore.getState(); if (st.view !== 'board') return;
      const ids = new Set(rfRef.current.getNodes().filter((n) => n.selected && n.type === 'contact').map((n) => n.id));
      if (st.selected) ids.add(st.selected);
      const ok = [...ids].filter((id) => !String(id).startsWith('acct:'));
      if (ok.length) { e.preventDefault(); st.removeFromBoard(ok); }
    };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, []);
  const onNodesDelete = useCallback((ns) => { const ids = ns.filter((n) => n.type !== 'contact').map((n) => n.id); if (ids.length) useStore.getState().deleteItems(ids); }, []);

  // Drag a person from the People panel onto the canvas to put them on the board right there.
  const onDrop = useCallback((e) => {
    const raw = e.dataTransfer.getData('text/plain'); if (!raw.startsWith('contact:')) return;
    e.preventDefault();
    const id = raw.slice(8); const pos = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    const st = useStore.getState(); st.setVisible([id], true); st.setPositions({ [id]: { x: pos.x - cardW / 2, y: pos.y - 40 } }); st.select(id);
  }, [screenToFlowPosition, cardW]);

  // Fit everything in view: double-click empty canvas, press F, or use the Fit view button. Panning is limited so nobody can get lost.
  const fitAll = useCallback(() => fitView({ padding: 0.15, duration: 400, maxZoom: 1, minZoom: 0.25 }), [fitView]);
  React.useEffect(() => {
    useStore.setState({ fitAll });
    const key = (e) => { if ((e.key === 'f' || e.key === 'F') && !e.metaKey && !e.ctrlKey && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '') && !document.activeElement?.isContentEditable) fitAll(); };
    window.addEventListener('keydown', key);
    return () => { window.removeEventListener('keydown', key); useStore.setState({ fitAll: null }); };
  }, [fitAll]);
  const extent = React.useMemo(() => {
    if (!nodes.length) return undefined;
    const xs = nodes.map((n) => n.position.x), ys = nodes.map((n) => n.position.y), m = 1200;
    return [[Math.min(...xs) - m, Math.min(...ys) - m], [Math.max(...xs) + cardW + m, Math.max(...ys) + 400 + m]];
  }, [nodes, cardW]);
  const [hover, setHover] = React.useState(null);
  const [hoverNode, setHoverNode] = React.useState(null);
  const edgesWithUi = React.useMemo(() => edges.map((e) => ({
    ...e,
    data: { show: hover === e.id || hoverNode === e.target || selected === e.target,
      onEnter: () => setHover(e.id), onLeave: () => setHover(null), onRemove: () => { setHover(null); patch(e.target, { reportsTo: null, manual: true }); } },
  })), [edges, hover, hoverNode, selected, patch]);
  const onConnect = useCallback((c) => patch(c.target, { reportsTo: c.source, manual: true }), [patch]);
  const onEdgesDelete = useCallback((es) => es.forEach((e) => patch(e.target, { reportsTo: null, manual: true })), [patch]);
  const shown = React.useMemo(() => nodes.map((n) => (n.id === dropTarget ? { ...n, data: { ...n.data, drop: true } } : n)), [nodes, dropTarget]);
  return (
    <ReactFlow
      key={useStore.getState().account?.Id}
      nodes={shown} edges={edgesWithUi} nodeTypes={nodeTypes} edgeTypes={edgeTypes} onNodesChange={onNodesChange}
      onNodeMouseEnter={(_e, n) => setHoverNode(n.id)} onNodeMouseLeave={() => setHoverNode(null)} onEdgeMouseEnter={(_e, ed) => setHover(ed.id)} onEdgeMouseLeave={() => setHover(null)}
      onConnect={onConnect} onEdgesDelete={onEdgesDelete} onNodeDrag={onNodeDrag} onNodeDragStop={onDragStop}
      onDragOver={(e) => { if (e.dataTransfer.types.includes('text/plain')) e.preventDefault(); }} onDrop={onDrop}
      onNodeClick={(_e, n) => { if (n.type === 'contact') select(n.id); }} onPaneClick={onPaneClick} onNodesDelete={onNodesDelete} selectionKeyCode="Shift" multiSelectionKeyCode={['Meta', 'Control']}
      colorMode={colorMode} minZoom={0.1} maxZoom={2} translateExtent={extent} zoomOnDoubleClick={false} onDoubleClick={(e) => { if (e.target.classList?.contains('react-flow__pane')) fitAll(); }} proOptions={{ hideAttribution: true }} deleteKeyCode={['Backspace', 'Delete']}
      defaultEdgeOptions={{ markerEnd: undefined }}
    >
      <Background variant={BackgroundVariant.Dots} gap={22} size={1.4} color="var(--dot)" />
      <Controls position="bottom-left" showInteractive={false} />
      <MiniMap position="bottom-right" pannable zoomable nodeColor={(n) => n.data.color || '#cbd2dc'} maskColor="rgba(120,130,150,.12)" />
    </ReactFlow>
  );
}

export default function Board() { return <ReactFlowProvider><Inner /></ReactFlowProvider>; }
