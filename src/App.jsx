import React, { useEffect, useState } from 'react';
import { useStore, effectiveTheme } from './store.js';
import Board from './Board.jsx';
import GridView from './GridView.jsx';
import Legend from './Legend.jsx';
import SearchBar from './SearchBar.jsx';
import Home from './Home.jsx';
import ThemeToggle from './ThemeToggle.jsx';
import { LoginScreen, SetupScreen, ForcedChangeScreen, UserMenu } from './AuthScreens.jsx';
import ReviewModal from './ReviewModal.jsx';
import CanvasToolbar from './CanvasToolbar.jsx';
import { DetailPanel, EnrichPanel, FieldPicker, AccessPanel, AddPersonPanel, ReferencePanel, ReferenceOverlay, CommentsPanel, PeoplePanel, AccountPanel } from './Panels.jsx';

function Loading({ name, full }) {
  const [sec, setSec] = useState(0);
  useEffect(() => { const t = setInterval(() => setSec((x) => x + 1), 1000); return () => clearInterval(t); }, []);
  return (
    <div className={`loading ${full ? 'full' : ''}`} role="status" aria-live="polite">
      <div className="spinner" />
      <div className="loading-t">Loading {name || 'account'}…</div>
      <div className="muted sm">Fetching contacts, opportunities and projects from Salesforce{sec > 3 ? ` · ${sec}s` : ''}</div>
    </div>
  );
}

function AccountSwitcher({ current, onClose }) {
  const { accounts, search, open } = useStore();
  const [q, setQ] = useState('');
  useEffect(() => { const t = setTimeout(() => search(q), 250); return () => clearTimeout(t); }, [q]);
  return (
    <div className="pop" onMouseLeave={onClose}>
      <input autoFocus placeholder="Switch to account…" value={q} onChange={(e) => setQ(e.target.value)} />
      <ul>{accounts.filter((a) => a.Id !== current).map((a) => <li key={a.Id} onClick={() => { onClose(); open(a.Id, a.Name); }}><b>{a.Name}</b><span className="muted sm">{[a.Industry, a.BillingCountry].filter(Boolean).join(' · ')}</span></li>)}</ul>
    </div>
  );
}

export default function App() {
  const s = useStore();
  const [menu, setMenu] = useState(null);
  const [toast, setToast] = useState(null);
  const [fatal, setFatal] = useState(null);
  useEffect(() => { s.initAuth(); }, []);
  const signedIn = !!s.auth.user && !s.auth.user.mustChange;
  useEffect(() => { if (signedIn && !s.status) s.init().catch((e) => setFatal(e.message)); }, [signedIn]);
  useEffect(() => {
    const k = (e) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z' || /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)) return;
      e.preventDefault(); e.shiftKey ? useStore.getState().redo() : useStore.getState().undo();
    };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, []);
  useEffect(() => { if (s.selected) setMenu((m) => (m === 'more' ? m : null)); }, [s.selected]);
  useEffect(() => { if (s.enrichTarget) setMenu('enrich'); }, [s.enrichTarget]);
  const say = (m) => { setToast(m); setTimeout(() => setToast(null), 3500); };
  if (!s.auth.checked) return <div className="center muted">Loading…</div>;
  if (s.auth.setupNeeded) return <SetupScreen />;
  if (!s.auth.user) return <LoginScreen />;
  if (s.auth.user.mustChange) return <ForcedChangeScreen />;
  if (fatal) return <div className="center"><div className="warn">Can’t reach the Account Mapper API ({fatal}). Check the terminal running <code>npm run dev</code> for errors.</div></div>;
  if (!s.status) return <div className="center muted">Loading…</div>;
  if (!s.account) return <>{s.status.demo && <div className="banner">Salesforce not reachable — showing demo data only.</div>}{s.error && <div className="banner err">{s.error}</div>}{s.loading ? <Loading name={s.loadingName} full /> : <Home />}</>;

  const close = () => setMenu(null);
  const suggestColors = () => {
    const sg = s.statusSuggestions(); const n = sg.green.length + sg.orange.length + sg.yellow.length;
    if (!n) { say('Nothing to suggest — everyone who can be colored already is'); return; }
    const msg = `Suggest colors from Salesforce for people who have none yet?\n\n` +
      `🟢 Green (${sg.green.length}): on a CS project that is Alignment / Onboarding / Adoption / Delivery / Wrap Up\n` +
      `🟠 Orange (${sg.orange.length}): on an open opportunity — talk first\n` +
      `🟡 Yellow (${sg.yellow.length}): no activities, no project, no open opportunity\n\n` +
      `People we can't tell about stay uncolored. You can change any of them, and ⌘Z undoes this.`;
    if (!confirm(msg)) return;
    for (const k of ['green', 'orange', 'yellow']) if (sg[k].length) s.setStatus(sg[k], k);
    say(`Colored ${n} people from Salesforce`);
  };
  const push = async () => {
    if (!confirm('Write the manual changes (Reports To, Region, Role, ES status) to Salesforce Contacts?')) return;
    try { const r = await s.push(); say(r.n ? `Pushed ${r.n} contact(s)${r.failed ? `, ${r.failed} failed` : ''}` : 'Nothing to push'); } catch (e) { say(e.message); }
  };
  return (
    <div className="app">
      <header className="top">
        <button className="btn ghost" title="Back to the homepage" onClick={() => { s.flushNow(); useStore.setState({ account: null, data: null, review: null, selected: null }); }}>⌂ Home</button>
        <div className="switch">
          <button className="btn ghost" title="Switch account" onClick={() => setMenu(menu === 'switch' ? null : 'switch')}>{s.loading && s.loadingName ? s.loadingName : s.account.Name} ▾</button>
          {menu === 'switch' && <AccountSwitcher current={s.account.Id} onClose={() => setMenu(null)} />}
        </div>
        <div className="seg">
          <button className={s.view === 'board' ? 'on' : ''} onClick={() => s.setShow('view', 'board')}>Board</button>
          <button className={s.view === 'grid' ? 'on' : ''} onClick={() => s.setShow('view', 'grid')}>Grid</button>
        </div>
        <span className="grow" />
        <button className="btn" title="Re-infer reporting lines from titles. Manual edits and Salesforce Reports-To are kept." onClick={() => { s.autoBuild(); say('Hierarchy updated from titles — your manual changes were kept (⌘Z to undo)'); }}>✨ Auto-build from titles</button>
        <div className="rel-menu">
          <button className="btn ghost" onClick={() => setMenu(menu === 'more' ? null : 'more')}>⋯</button>
          {menu === 'more' && <div className="pop" onMouseLeave={() => setMenu(null)}>
            <button className="item" onClick={() => { setMenu(null); if (confirm('Discard every manual and Salesforce reporting line on this board and rebuild purely from titles? (⌘Z undoes this)')) { s.autoBuild({ overwrite: true }); say('Rebuilt from titles only'); } }}>Rebuild from scratch (ignore existing links)</button>
            <button className="item" onClick={() => { s.resetLayout(); setMenu(null); }}>Reset card positions</button>
            <button className="item" onClick={() => { setMenu(null); suggestColors(); }}>Color contacts from Salesforce…</button>
            <button className="item" onClick={() => { setMenu(null); if (confirm('Remove the green / orange / yellow color from every card on this board?')) { const all = s.people().filter((p) => p.cstatus).map((p) => p.Id); s.setStatus(all, null); say('Colors cleared (⌘Z to undo)'); } }}>Clear all colors</button>
            <button className="item" disabled={!s.status.canWrite} title={s.status.canWrite ? '' : !s.status.switchOn ? 'Writes are switched off (ALLOW_WRITE=1)' : 'You don’t have permission to update Salesforce'} onClick={() => { setMenu(null); push(); }}>Push changes to Salesforce</button>
            {s.status.admin && <button className="item" onClick={() => setMenu('access')}>Manage write access…</button>}
          </div>}
        </div>
        <button className="btn ghost" title="Account details, research notes, opportunities and projects" onClick={() => setMenu(menu === 'account' ? null : 'account')}>Account info</button>
        <div className="undo seg">
          <button title="Undo (⌘Z)" disabled={!s.past.length} onClick={() => s.undo()}>↶</button>
          <button title="Redo (⇧⌘Z)" disabled={!s.future.length} onClick={() => s.redo()}>↷</button>
        </div>
        <button className="btn ghost" onClick={() => setMenu(menu === 'people' ? null : 'people')}>People</button>
        <button className="btn ghost" onClick={() => setMenu(menu === 'add' ? null : 'add')}>+ Person</button>
        <button className="btn ghost" onClick={() => setMenu(menu === 'fields' ? null : 'fields')}>Customize cards</button>
        <button className="btn ghost" onClick={() => setMenu(menu === 'comments' ? null : 'comments')}>Comments{Object.values(s.comments).flat().length ? ` (${Object.values(s.comments).flat().length})` : ''}</button>
        <button className="btn ghost" onClick={() => setMenu(menu === 'reference' ? null : 'reference')}>Miro{s.reference.embedUrl || s.reference.dataUrl ? ' ●' : ''}</button>
        <button className="btn ghost" onClick={() => setMenu(menu === 'enrich' ? null : 'enrich')}>Enrich</button>
        <ThemeToggle />
        <UserMenu />
      </header>
      {s.status.demo && <div className="banner">Demo data — Salesforce not connected.</div>}
      {!s.status.demo && !s.status.canWrite && <div className="banner info">Board-only mode — your changes are saved here but won’t update Salesforce.</div>}
      <SearchBar />
      {s.error && <div className="banner err">{s.error}</div>}
      <main className={`${s.view === 'grid' ? 'grid-mode' : ''} tool-${s.tool}`}>
        {s.loading && <Loading name={s.loadingName} />}
        {s.view === 'board' ? <><Board /><CanvasToolbar /><Legend /><ReferenceOverlay /></> : <GridView />}
        {menu === 'enrich' ? <EnrichPanel onClose={close} /> : menu === 'access' ? <AccessPanel onClose={close} /> : menu === 'fields' ? <FieldPicker onClose={close} />
          : menu === 'account' ? <AccountPanel onClose={close} /> : menu === 'people' ? <PeoplePanel onClose={close} /> : menu === 'comments' ? <CommentsPanel onClose={close} /> : menu === 'reference' ? <ReferencePanel onClose={close} /> : menu === 'add' ? <AddPersonPanel onClose={close} /> : <DetailPanel />}
      </main>
      <ReviewModal />
      {(toast || s.toast) && <div className="toast">{toast || s.toast}</div>}
    </div>
  );
}
