import React from 'react';
import { Handle, Position } from '@xyflow/react';
import { ES_COLORS } from './hierarchy.js';
import { useStore } from './store.js';
import { ago, who } from './format.js';
import { SIGN_IN } from './links.js';

const val = (p, k) => {
  const v = k === 'OwnerId' ? p.Owner?.Name : p[k];
  if (v === true) return '✓'; if (v === false || v == null || v === '') return null;
  return String(v);
};

// The "in / ZI / Lu" card buttons open each tool's sign-in page. For LinkedIn the sign-in sends you on to the person's
// profile (or a search for them) once you are in; for ZoomInfo and Lusha the name is copied so you can paste it into their search.
const linkedinTarget = (p) => {
  if (p.Linkedin_Profile_URL__c) return /^https?:/.test(p.Linkedin_Profile_URL__c) ? p.Linkedin_Profile_URL__c : `https://${p.Linkedin_Profile_URL__c}`;
  const co = useStore.getState().account?.Name || '';
  return `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(`${p.Name} ${co}`)}`;
};
function openTool(kind, p) {
  const st = useStore.getState();
  if (kind === 'linkedin') { window.open(`${SIGN_IN.linkedin.url}?session_redirect=${encodeURIComponent(linkedinTarget(p))}`, '_blank', 'noopener'); return; }
  const text = `${p.Name} ${st.account?.Name || ''}`.trim();
  try { navigator.clipboard?.writeText(text); } catch { /* clipboard is a convenience only */ }
  window.open(SIGN_IN[kind].url, '_blank', 'noopener');
  st.flash(`Opened ${SIGN_IN[kind].label} sign-in — “${text}” is copied, paste it into their search`);
}

const DEF_HL = { role: true, es: true, ecm: true };
const DEF_LAYOUT = { target: true, office: true, comments: true, actions: true, labels: true, width: 220, font: 1 };

/** The card's content. Used on the board (wrapped with connection handles) and, without them, as the live preview in Customize. */
export function CardBody({ data, selected, children }) {
  const { p, color, showFields, counts, branchLabel, labels = {}, dim, hit, drop, notesList = [], hl = DEF_HL, layout = DEF_LAYOUT } = data;
  const L = { ...DEF_LAYOUT, ...layout };
  const ecm = hl.ecm && !!p.Enterprise_Coalition_Member__c;
  const role = hl.role && p.Contact_Role__c, es = hl.es && p.ES_Expansion_Status__c;
  const [fg, bg] = ES_COLORS[p.ES_Expansion_Status__c] || [];
  const extras = showFields.filter((k) => k !== 'Title' && val(p, k));
  const showBadges = counts.opps > 0 || counts.leads > 0 || counts.cs > 0 || (L.comments && counts.notes > 0);
  return (
    <div className={`cnode${selected ? ' sel' : ''}${p.external ? ' ext' : ''}${dim ? ' dim' : ''}${hit ? ' hit' : ''}${drop ? ' drop' : ''}${ecm ? ' ecm' : ''}${p.cstatus ? ` st st-${p.cstatus}` : ''}`}
      style={{ '--accent': color || '#cbd2dc', '--fs': L.font, width: L.width }}>
      {children}
      {ecm && <span className="ecm-star" title="Enterprise Coalition Member (ECM)">★</span>}
      {L.office && branchLabel && <div className="branch" style={{ color }}>{branchLabel}</div>}
      <div className="name">
        {p.Name}
        {L.target && p.Account_Target && <span className="target" title="Target / sales-focus account" />}
      </div>
      {showFields.includes('Title') && <div className="title">{p.Title || <i>No title</i>}</div>}
      {(role || es) && (
        <div className="pills">
          {role && <span className="pill role hl" title="Contact role">{p.Contact_Role__c}</span>}
          {es && <span className="pill es hl" title="ES / ECM status" style={{ color: fg, background: bg, borderColor: fg }}><b style={{ background: fg }} />ES · {p.ES_Expansion_Status__c}</span>}
        </div>
      )}
      {extras.map((k) => <div key={k} className="meta">{L.labels && <span>{labels[k] || k}</span>}{val(p, k).replace(/^https?:\/\/(www\.)?/, '').slice(0, 140)}</div>)}
      {showBadges && (
        <div className="badges">
          {counts.opps > 0 && <span title="Opportunities" className="b opp">$ {counts.opps}</span>}
          {counts.leads > 0 && <span title="Project leads" className="b lead">◎ {counts.leads}</span>}
          {counts.cs > 0 && <span title="CS projects" className="b cs">⚙ {counts.cs}</span>}
          {L.comments && counts.notes > 0 && <span title="Comments" className="b note">💬 {counts.notes}</span>}
        </div>
      )}
      {p.external && <div className="exttag">{p.source || 'external'}</div>}
      {L.actions && !p.isGroup && <div className="actions nodrag">
        <button title={p.Linkedin_Profile_URL__c ? 'Sign in to LinkedIn, then open this profile' : 'Sign in to LinkedIn, then search for this person'} onClick={(e) => { e.stopPropagation(); openTool('linkedin', p); }}>in</button>
        <button title="Open the ZoomInfo sign-in page (name copied)" onClick={(e) => { e.stopPropagation(); openTool('zoominfo', p); }}>ZI</button>
        <button title="Open the Lusha sign-in page (name copied)" onClick={(e) => { e.stopPropagation(); openTool('lusha', p); }}>Lu</button>
        <button title="Hide from board" onClick={(e) => { e.stopPropagation(); useStore.getState().setVisible([p.Id], false); }}>Hide</button>
      </div>}
      {L.comments && notesList.length > 0 && (
        <div className="cpop" role="tooltip">
          <div className="cpop-h">💬 {notesList.length} comment{notesList.length === 1 ? '' : 's'}</div>
          {notesList.slice(-4).map((c) => (
            <div key={c.id} className="cpop-c"><div className="cpop-m"><b>{who(c.author)}</b> · {ago(c.at)}</div><div className="cpop-t">{c.text}</div></div>
          ))}
          {notesList.length > 4 && <div className="cpop-m">+ {notesList.length - 4} earlier — click the card to see all</div>}
        </div>
      )}
    </div>
  );
}

export default function ContactNode(props) {
  return (
    <CardBody {...props}>
      <Handle type="target" position={Position.Top} />
      <Handle type="source" position={Position.Bottom} />
    </CardBody>
  );
}
