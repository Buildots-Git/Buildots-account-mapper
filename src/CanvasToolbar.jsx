import React, { useEffect } from 'react';
import { useStore } from './store.js';

const TOOLS = [
  ['select', '↖', 'Select', 'V', 'Move and select cards and notes'],
  ['note', '▤', 'Sticky note', 'N', 'Click the board to add a sticky note'],
  ['text', 'T', 'Text', 'T', 'Click the board to add a text box'],
  ['comment', '💬', 'Comment', 'C', 'Click the board to pin a comment'],
];

export default function CanvasToolbar() {
  const tool = useStore((s) => s.tool); const setTool = useStore((s) => s.setTool);
  const open = useStore((s) => s.items.filter((i) => i.type === 'comment' && !i.resolved).length);
  // Miro-style shortcuts (ignored while typing)
  useEffect(() => {
    const k = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey || /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable) return;
      const hit = TOOLS.find((t) => t[3].toLowerCase() === e.key.toLowerCase());
      if (hit) { e.preventDefault(); setTool(hit[0]); } else if (e.key === 'Escape') setTool('select');
    };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, []);
  return (
    <div className="ctools" role="toolbar" aria-label="Board tools">
      {TOOLS.map(([id, icon, label, key, tip]) => (
        <button key={id} className={tool === id ? 'on' : ''} title={`${label} (${key}) — ${tip}`} aria-pressed={tool === id} onClick={() => setTool(tool === id ? 'select' : id)}>
          <span className="ic">{icon}</span><small>{label}</small>
          {id === 'comment' && open > 0 && <i className="cnt">{open}</i>}
        </button>
      ))}
    </div>
  );
}
