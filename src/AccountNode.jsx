import React from 'react';
import { Handle, Position } from '@xyflow/react';
import { useStore } from './store.js';
import Logo from './Logo.jsx';

const hue = (s) => [...String(s)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7);

/** A subsidiary / parent account in a family board: its people hang below it. */
export default function AccountNode({ data }) {
  const { acct, root, n, branch, vid, own, label } = data;
  const h = hue(acct.Name);
  const open = useStore((s) => s.open);
  return (
    <div className={`anode${root ? ' root' : ''}`} style={{ '--ah': h }}>
      <Handle type="target" position={Position.Top} />
      <div className="a-head">
        <Logo website={acct.Website} size={30} className="a-logo"><span className="a-ini">{acct.Name.slice(0, 2).toUpperCase()}</span></Logo>
        <div className="a-txt"><b title={acct.Name}>{label || acct.Name}</b><span>{n} {n === 1 ? 'person' : 'people'}{root ? ' · parent' : ''}</span></div>
      </div>
      <div className="a-foot">
        {!own && acct.Target && <span className="tb">Target</span>}{!own && acct.SalesFocus && <span className="tb">Sales focus</span>}
        {!root && !own && <button className="link nodrag" title="Open this account's own board" onClick={(e) => { e.stopPropagation(); open(acct.Id, acct.Name); }}>Open board ↗</button>}
      </div>
      {branch && <button className={`fold nodrag${branch.folded ? ' on' : ''}`} title={branch.folded ? `Show ${branch.n} people` : 'Hide this account’s people'} onClick={(e) => { e.stopPropagation(); useStore.getState().toggleBranch(vid, branch.folded); }}>{branch.folded ? `+${branch.n}` : '−'}</button>}
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
