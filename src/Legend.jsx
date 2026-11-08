import React, { useState } from 'react';
import { ES_STATES, ES_NEUTRAL, heatColor } from './hierarchy.js';

export default function Legend() {
  const [open, setOpen] = useState(false);
  return (
    <div className="legend">
      <button className="link" onClick={() => setOpen(!open)}>{open ? 'Legend ▾' : 'Legend ▸'}</button>
      {open && <>
        <div style={{ marginTop: 6 }}><span className="ecm-dot">★</span> Enterprise Coalition Member (ECM)</div>
        <div><span className="goal-dot">◎</span> Immediate target (click ◎ on a card)</div>
        <b className="sm" style={{ display: 'block' }}>Top bar and lines = ES status</b>
        {ES_STATES.map((k) => <div key={k}><span className="sw" style={{ background: heatColor(k) }} />{k}</div>)}
        <div><span className="sw" style={{ background: ES_NEUTRAL }} />No ES status</div>
        <div className="muted sm">Drop a card onto another to make it report to them. Shift-drag to select several. Hover a card for the × to remove a line. Press N, T or C to add a note, text or comment.</div>
      </>}
    </div>
  );
}
