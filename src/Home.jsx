import Logo from './Logo.jsx';
import React, { useEffect, useMemo, useState } from 'react';
import { useStore } from './store.js';
import ThemeToggle from './ThemeToggle.jsx';
import { UserMenu } from './AuthScreens.jsx';
import { SIGN_IN } from './links.js';
import { ago } from './format.js';

const hue = (s) => [...String(s)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7);
const initials = (n) => String(n).replace(/[^A-Za-z0-9 ]/g, ' ').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

/** One account as a tile. `item` is normalised from either a Salesforce search result or a recent board. */
function Tile({ item, onOpen, onRemove }) {
  const h = hue(item.name);
  const s = item.stats;
  return (
    <div className="tile" role="button" tabIndex={0} onClick={() => onOpen(item)} onKeyDown={(e) => { if (e.key === 'Enter') onOpen(item); }}>
      <div className="tile-top" style={{ background: `linear-gradient(135deg, hsl(${h} 70% 55%), hsl(${(h + 40) % 360} 70% 42%))` }}>
        <span className="tile-ini"><Logo website={item.website} size={56} className="tile-logo">{initials(item.name)}</Logo></span>
        <div className="tile-badges">
          {item.target && <span className="tb">Target</span>}
          {item.salesFocus && <span className="tb">Sales focus</span>}
          {item.demo && <span className="tb">Demo</span>}
        </div>
        {onRemove && <button className="tile-x" title="Remove from recent" onClick={(e) => { e.stopPropagation(); onRemove(item); }}>×</button>}
      </div>
      <div className="tile-body">
        <b className="tile-name" title={item.name}>{item.name}</b>
        <span className="muted sm">{[item.industry, item.country].filter(Boolean).join(' · ') || 'Account'}</span>
        {s ? (
          <div className="tile-stats">
            {item.contacts != null && <span>{item.contacts} people</span>}
            {s.edits > 0 && <span>{s.edits} edits</span>}
            {s.added > 0 && <span>+{s.added} added</span>}
            {s.comments > 0 && <span>💬 {s.comments}</span>}
            {s.reference && <span>🖼 reference</span>}
          </div>
        ) : item.hasBoard ? <div className="tile-stats"><span>Board saved</span></div> : null}
      </div>
      {item.openedAt && <div className="tile-foot muted sm">Opened {ago(item.openedAt)}</div>}
    </div>
  );
}

export default function Home() {
  const { accounts, search, open, recent, loadRecent, removeRecent, status } = useStore();
  const [q, setQ] = useState('');
  useEffect(() => { loadRecent(); }, []);
  useEffect(() => { const t = setTimeout(() => search(q), 250); return () => clearTimeout(t); }, [q]);

  const recentIds = useMemo(() => new Set(recent.map((r) => r.id)), [recent]);
  const fromSearch = (a) => ({ id: a.Id, name: a.Name, industry: a.Industry, country: a.BillingCountry, target: a.Target_Account__c, salesFocus: a.Sales_Focus__c, demo: String(a.Id).startsWith('demo'), hasBoard: recentIds.has(a.Id) });
  const fromRecent = (r) => ({ ...r, demo: String(r.id).startsWith('demo') });
  const searching = q.trim().length > 0;
  const results = accounts.map(fromSearch);
  const suggestions = results.filter((a) => !recentIds.has(a.id));
  const openItem = (it) => open(it.id, it.name);
  const matchesQ = (r) => r.name.toLowerCase().includes(q.trim().toLowerCase());

  return (
    <div className="home">
      <header className="home-top">
        <div className="logo"><span className="logo-mark">◈</span> Account Mapper</div>
        <span className="grow" />
        <ThemeToggle />
        <UserMenu />
      </header>

      <section className="hero">
        <h1>{searching ? 'Search results' : 'Where to next?'}</h1>
        <div className="searchbig">
          <span aria-hidden>⌕</span>
          <input autoFocus placeholder="Search any Salesforce account…" value={q} onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && results[0]) openItem(results[0]); if (e.key === 'Escape') setQ(''); }} />
          {q && <button className="link" onClick={() => setQ('')}>Clear</button>}
        </div>
      </section>

      {searching ? (
        <section>
          <h2>Accounts matching “{q.trim()}” <em>{results.length}</em></h2>
          {recent.filter(matchesQ).length > 0 && <>
            <h3 className="sub">Your boards</h3>
            <div className="tiles">{recent.filter(matchesQ).map((r) => <Tile key={r.id} item={fromRecent(r)} onOpen={openItem} />)}</div>
            <h3 className="sub">All accounts</h3>
          </>}
          <div className="tiles">{results.filter((a) => !recent.filter(matchesQ).some((r) => r.id === a.id)).map((a) => <Tile key={a.id} item={a} onOpen={openItem} />)}</div>
          {!results.length && <div className="muted" style={{ padding: '24px 0' }}>No accounts match. Try part of the company name.</div>}
        </section>
      ) : (
        <>
          <section>
            <h2>Recent boards <em>{recent.length}</em></h2>
            {recent.length
              ? <div className="tiles">{recent.map((r) => <Tile key={r.id} item={fromRecent(r)} onOpen={openItem} onRemove={(it) => removeRecent(it.id)} />)}</div>
              : <div className="empty">Boards you open show up here, with your edits, comments and reference pictures kept for next time.</div>}
          </section>
          {suggestions.length > 0 && (
            <section>
              <h2>Sales focus accounts <em>{suggestions.length}</em></h2>
              <div className="tiles">{suggestions.map((a) => <Tile key={a.id} item={a} onOpen={openItem} />)}</div>
            </section>
          )}
        </>
      )}

      <section>
        <h2>Sign in to your tools</h2>
        <div className="signins">
          {Object.entries(SIGN_IN).map(([k, v]) => (
            <a key={k} className="signin" href={v.url} target="_blank" rel="noopener noreferrer"><b>{v.label}</b><span className="muted sm">{v.hint}</span><span className="go">Sign in ↗</span></a>
          ))}
        </div>
      </section>
    </div>
  );
}
