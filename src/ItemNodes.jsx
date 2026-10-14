import React, { useEffect, useRef, useState } from 'react';
import { NodeResizer } from '@xyflow/react';
import { useStore } from './store.js';
import { ago, who } from './format.js';

// Fonts a note can use. System font stacks, so nothing is downloaded and every computer shows its closest match.
export const FONTS = {
  hand: { label: 'Handwriting', css: "'Segoe Print','Bradley Hand','Comic Sans MS',cursive" },
  marker: { label: 'Marker', css: "'Marker Felt','Chalkboard SE','Comic Sans MS',cursive" },
  sans: { label: 'Sans-serif', css: "system-ui,-apple-system,'Segoe UI',Roboto,sans-serif" },
  rounded: { label: 'Rounded', css: "'Arial Rounded MT Bold','Nunito','Varela Round',system-ui,sans-serif" },
  serif: { label: 'Serif', css: "Georgia,'Times New Roman',serif" },
  typewriter: { label: 'Typewriter', css: "'American Typewriter','Courier New',Courier,monospace" },
  mono: { label: 'Monospace', css: "ui-monospace,Menlo,Consolas,monospace" },
};
export const fontCss = (k) => (FONTS[k] || FONTS.hand).css;
const SIZES = [11, 13, 15, 18, 22, 28, 36];
const stepSize = (cur, d) => { const i = SIZES.findIndex((x) => x >= cur); const j = Math.min(SIZES.length - 1, Math.max(0, (i < 0 ? SIZES.length - 1 : i) + d)); return SIZES[j]; };

/** Font family + size controls shared by notes and text boxes. */
function FontBar({ it }) {
  const st = useStore.getState;
  const set = (patch) => { st().updateItem(it.id, patch, true); st().setNoteStyle({ ...(patch.font ? { font: patch.font } : {}), ...(patch.fs ? { size: patch.fs } : {}) }); };
  return (
    <>
      <select className="fontsel" title="Font" value={it.font || 'hand'} onChange={(e) => set({ font: e.target.value })} style={{ fontFamily: fontCss(it.font) }}>
        {Object.entries(FONTS).map(([k, f]) => <option key={k} value={k} style={{ fontFamily: f.css }}>{f.label}</option>)}
      </select>
      <button className="sz" title="Smaller text" onClick={() => set({ fs: stepSize(it.fs || 15, -1) })}>A−</button>
      <button className="sz" title="Larger text" onClick={() => set({ fs: stepSize(it.fs || 15, 1) })}>A+</button>
    </>
  );
}

export const NOTE_COLORS = { yellow: '#fff3a3', orange: '#ffd0a1', green: '#bdf0c9', pink: '#ffc6dd', blue: '#bfdcff', purple: '#dccbff', grey: '#e3e6ec' };

/** A node is hidden for a moment while React Flow measures it, and hidden elements can't take focus: retry until it sticks. */
function useFocusWhenNew(fresh, ref) {
  useEffect(() => {
    if (!fresh) return;
    let n = 0; const t = setInterval(() => {
      ref.current?.focus({ preventScroll: true });
      if (document.activeElement === ref.current || ++n > 15) { clearInterval(t); useStore.setState({ freshItem: null }); }
    }, 40);
    return () => clearInterval(t);
  }, []);
}

/** Typing is one undo step: snapshot when you start, not on every key. */
function useEditable(id) {
  const st = useStore.getState;
  return { onFocus: () => st().snapshot(), onChange: (e) => st().updateItem(id, { text: e.target.value }), onKeyDown: (e) => { e.stopPropagation(); if (e.key === 'Escape') e.target.blur(); } };
}

export function NoteNode({ data, selected }) {
  const it = data.item; const ref = useRef(null); const ed = useEditable(it.id);
  const [editing, setEditing] = useState(!!data.fresh); // not editing = the whole note drags like a card; double-click to edit
  useFocusWhenNew(data.fresh, ref);
  const edit = () => { setEditing(true); setTimeout(() => ref.current?.focus(), 0); };
  return (
    <div className={`note${selected ? ' sel' : ''}`} style={{ background: NOTE_COLORS[it.color] || NOTE_COLORS.yellow }} onDoubleClick={edit}>
      <NodeResizer isVisible={selected} minWidth={130} minHeight={100} lineStyle={{ borderColor: '#4b5bff' }} handleStyle={{ width: 9, height: 9, borderRadius: 3 }}
        onResizeEnd={(_e, p) => useStore.getState().updateItem(it.id, { x: p.x, y: p.y, w: Math.round(p.width), h: Math.round(p.height) }, true)} />
      {selected && (
        <div className="note-colors nodrag" onMouseDown={(e) => e.stopPropagation()}>
          {Object.entries(NOTE_COLORS).map(([k, c]) => <button key={k} title={k} className={it.color === k ? 'on' : ''} style={{ background: c }} onClick={() => useStore.getState().updateItem(it.id, { color: k }, true)} />)}
          <span className="sep" />
          <FontBar it={it} />
          <button className="del" title="Delete note" onClick={() => useStore.getState().deleteItems([it.id])}>🗑</button>
        </div>
      )}
      <textarea ref={ref} className={editing ? 'nodrag nowheel' : 'noedit'} readOnly={!editing} placeholder="Double-click to write…" value={it.text} style={{ fontFamily: fontCss(it.font), fontSize: it.fs || 15 }} {...ed} onBlur={() => setEditing(false)} />
      <div className="note-by">{who(it.author)} · {ago(it.at)}</div>
    </div>
  );
}

export function TextNode({ data, selected }) {
  const it = data.item; const ref = useRef(null); const ed = useEditable(it.id);
  const [editing, setEditing] = useState(!!data.fresh);
  useFocusWhenNew(data.fresh, ref);
  const edit = () => { setEditing(true); setTimeout(() => ref.current?.focus(), 0); };
  return (
    <div className={`textbox${selected ? ' sel' : ''}`} onDoubleClick={edit}>
      <NodeResizer isVisible={selected} minWidth={80} minHeight={32} lineStyle={{ borderColor: '#4b5bff' }} handleStyle={{ width: 8, height: 8, borderRadius: 3 }}
        onResizeEnd={(_e, p) => useStore.getState().updateItem(it.id, { x: p.x, y: p.y, w: Math.round(p.width), h: Math.round(p.height) }, true)} />
      <textarea ref={ref} className={editing ? 'nodrag nowheel' : 'noedit'} readOnly={!editing} placeholder="Double-click to type" value={it.text} style={{ fontFamily: fontCss(it.font), fontSize: it.fs || 20 }} {...ed} onBlur={() => setEditing(false)} />
      {selected && <div className="textbox-bar nodrag" onMouseDown={(e) => e.stopPropagation()}><FontBar it={it} /><button className="del" title="Delete" onClick={() => useStore.getState().deleteItems([it.id])}>🗑</button></div>}
    </div>
  );
}

/** A comment pin: a bubble anywhere on the board; click it to read and reply to the thread. */
export function PinNode({ data, selected }) {
  const it = data.item; const st = useStore.getState;
  const open = useStore((s) => s.openPin === it.id);
  const me = useStore((s) => s.status?.me);
  const [text, setText] = useState(''); const box = useRef(null);
  useEffect(() => {
    if (!open) return;
    let n = 0; const t = setInterval(() => { box.current?.focus({ preventScroll: true }); if (document.activeElement === box.current || ++n > 15) clearInterval(t); }, 40);
    return () => clearInterval(t);
  }, [open]);
  const post = () => { st().replyToPin(it.id, text); setText(''); };
  const n = (it.thread || []).length;
  return (
    <div className={`pin${it.resolved ? ' done' : ''}${selected ? ' sel' : ''}`}>
      <button className="pin-bubble nodrag-off" title={n ? `${n} comment${n === 1 ? '' : 's'}` : 'New comment'} onClick={(e) => { e.stopPropagation(); st().setOpenPin(open ? null : it.id); }}>
        {it.resolved ? '✓' : n || '💬'}
      </button>
      {open && (
        <div className="pin-pop nodrag nowheel" onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
          <div className="pin-h"><b>Comment</b>{it.resolved && <span className="chip ok">resolved</span>}<span className="grow" />
            <button className="link" onClick={() => st().updateItem(it.id, { resolved: !it.resolved }, true)}>{it.resolved ? 'Reopen' : 'Resolve'}</button>
            <button className="link danger" onClick={() => { st().deleteItems([it.id]); st().setOpenPin(null); }}>Delete</button></div>
          <div className="pin-thread">
            {(it.thread || []).map((c) => <div key={c.id} className="pin-c"><div className="muted sm"><b>{who(c.author)}</b> · {ago(c.at)}</div><div>{c.text}</div></div>)}
            {!n && <div className="muted sm">Start the conversation…</div>}
          </div>
          <textarea ref={box} rows={2} placeholder={n ? 'Reply…' : 'Write a comment…'} value={text} onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); post(); } if (e.key === 'Escape') st().setOpenPin(null); }} />
          <div className="row"><span className="muted sm">Enter to send · board-only{me ? '' : ''}</span><button className="btn sm" disabled={!text.trim()} onClick={post}>{n ? 'Reply' : 'Comment'}</button></div>
        </div>
      )}
    </div>
  );
}
