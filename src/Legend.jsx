import React, { useState } from 'react';
import { ES_STATES, ES_NEUTRAL, heatColor, CONTACT_STATUS } from './hierarchy.js';

export default function Legend() {
  const [open, setOpen] = useState(false);
  return (
    <div className="legend">
      <button className="link" onClick={() => setOpen(!open)}>{open ? 'Legend ▾' : 'Legend ▸'}</button>
      {open && <>
        <b className="sm">Key</b>
        <div className="key">{Object.entries(CONTACT_STATUS).map(([k, v]) => <div className="k" key={k}><i style={{ background: v.bg }} /><span><b>{v.label}</b><br /><span className="muted">{v.lines.join(' · ')}</span></span></div>)}</div>
        <div style={{ marginTop: 6 }}><span className="ecm-dot">★</span> Enterprise Coalition Member (ECM)</div>
        <b className="sm" style={{ display: 'block', marginTop: 8 }}>Top bar and lines = ES status</b>
        {ES_STATES.map((k) => <div key={k}><span className="sw" style={{ background: heatColor(k) }} />{k}</div>)}
        <div><span className="sw" style={{ background: ES_NEUTRAL }} />No ES status</div>
        <div className="muted sm">Drop a card onto another to make it report to them. Shift-drag to select several. Hover a card for the × to remove a line. Press N, T or C to add a note, text or comment.</div>
      </>}
    </div>
  );
}
