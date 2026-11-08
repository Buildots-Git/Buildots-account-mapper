import React, { useEffect, useState } from 'react';
import { useStore, api, jsonOpts } from './store.js';
import ThemeToggle from './ThemeToggle.jsx';
import AdminPanel from './AdminPanel.jsx';

const RULES = 'At least 10 characters. Avoid common words and your username.';

function PasswordInput({ label, value, onChange, autoComplete, autoFocus, onEnter }) {
  const [show, setShow] = useState(false);
  return (
    <label className="f">{label}
      <span className="pwrow">
        <input type={show ? 'text' : 'password'} value={value} autoComplete={autoComplete} autoFocus={autoFocus} spellCheck={false}
          onChange={(e) => onChange(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') onEnter?.(); }} />
        <button type="button" className="link" tabIndex={-1} onClick={() => setShow(!show)}>{show ? 'Hide' : 'Show'}</button>
      </span>
    </label>
  );
}

function Shell({ title, sub, children }) {
  const notice = useStore((s) => s.auth.notice);
  return (
    <div className="authwrap">
      <div className="authtop"><ThemeToggle /></div>
      <div className="authcard">
        <div className="logo"><span className="logo-mark">◈</span> Account Mapper</div>
        <h1>{title}</h1>
        {sub && <p className="muted">{sub}</p>}
        {notice && <div className="warn">{notice}</div>}
        {children}
      </div>
    </div>
  );
}

export function LoginScreen() {
  const signIn = useStore((s) => s.signIn);
  const sso = useStore((s) => s.auth.sso); const notice = useStore((s) => s.auth.notice);
  const [showPw, setShowPw] = useState(false);
  const pwForm = !sso || sso.passwordLogin || showPw;
  const [u, setU] = useState(''); const [p, setP] = useState(''); const [err, setErr] = useState(null); const [busy, setBusy] = useState(false);
  const go = async () => {
    if (!u.trim() || !p || busy) return; setBusy(true); setErr(null);
    try { await signIn(u, p); } catch (e) { setErr(e.message); setP(''); } finally { setBusy(false); }
  };
  return (
    <Shell title="Sign in" sub={sso ? `Sign in with your company ${sso.label} account.` : 'Use your Account Mapper username and password.'}>
      {notice && <div className="warn" role="alert">{notice}</div>}
      {sso && <a className="btn" href="/api/auth/okta/login" style={{ textAlign: 'center', textDecoration: 'none' }}>Sign in with {sso.label}</a>}
      {sso && !pwForm && <button className="link" onClick={() => setShowPw(true)}>Admin password sign-in</button>}
      {sso && pwForm && <div className="muted sm" style={{ textAlign: 'center' }}>— or use a password —</div>}
      {pwForm && <>
      <label className="f">Username<input autoFocus autoComplete="username" autoCapitalize="none" value={u} onChange={(e) => setU(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') document.querySelector('.authcard input[type=password],.authcard .pwrow input')?.focus(); }} /></label>
      <PasswordInput label="Password" value={p} onChange={setP} autoComplete="current-password" onEnter={go} />
      {err && <div className="warn" role="alert">{err}</div>}
      <button className="btn" disabled={busy || !u.trim() || !p} onClick={go}>{busy ? 'Signing in…' : 'Sign in'}</button>
      <p className="muted sm">Forgot your password? Ask an admin to reset it for you.</p>
      </>}
    </Shell>
  );
}

export function SetupScreen() {
  const setupAccount = useStore((s) => s.setupAccount); const auth = useStore((s) => s.auth);
  const [u, setU] = useState(''); const [p, setP] = useState(''); const [p2, setP2] = useState(''); const [code, setCode] = useState(''); const [err, setErr] = useState(null); const [busy, setBusy] = useState(false);
  const mismatch = p2 && p !== p2;
  const go = async () => {
    if (busy || mismatch) return; setBusy(true); setErr(null);
    try { await setupAccount(u, p, code); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <Shell title="Create the first account" sub="No accounts exist yet. This one becomes the admin, and can add everyone else.">
      <label className="f">Username<input autoFocus autoComplete="username" autoCapitalize="none" placeholder="e.g. your work email" value={u} onChange={(e) => setU(e.target.value)} /></label>
      <PasswordInput label="Choose a password" value={p} onChange={setP} autoComplete="new-password" />
      <PasswordInput label="Repeat the password" value={p2} onChange={setP2} autoComplete="new-password" onEnter={go} />
      <div className="muted sm">{RULES}</div>
      {auth.setupCodeRequired && <label className="f">Setup code (shown in the server terminal)<input value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" /></label>}
      {mismatch && <div className="warn">The two passwords don’t match.</div>}
      {err && <div className="warn" role="alert">{err}</div>}
      <button className="btn" disabled={busy || !u.trim() || !p || p !== p2} onClick={go}>{busy ? 'Creating…' : 'Create account and continue'}</button>
    </Shell>
  );
}

/** Used both for a voluntary change and when an admin set a temporary password. */
export function ChangePasswordForm({ forced, onDone }) {
  const changePassword = useStore((s) => s.changePassword);
  const [cur, setCur] = useState(''); const [a, setA] = useState(''); const [b, setB] = useState(''); const [err, setErr] = useState(null); const [busy, setBusy] = useState(false); const [ok, setOk] = useState(false);
  const go = async () => {
    if (busy || a !== b) return; setBusy(true); setErr(null);
    try { await changePassword(cur, a); setOk(true); onDone?.(); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  if (ok && !forced) return <div className="ok">Password changed. Your other sessions were signed out.</div>;
  return (
    <>
      <PasswordInput label={forced ? 'Temporary password you were given' : 'Current password'} value={cur} onChange={setCur} autoComplete="current-password" autoFocus />
      <PasswordInput label="New password" value={a} onChange={setA} autoComplete="new-password" />
      <PasswordInput label="Repeat the new password" value={b} onChange={setB} autoComplete="new-password" onEnter={go} />
      <div className="muted sm">{RULES}</div>
      {b && a !== b && <div className="warn">The two passwords don’t match.</div>}
      {err && <div className="warn" role="alert">{err}</div>}
      <button className="btn" disabled={busy || !cur || !a || a !== b} onClick={go}>{busy ? 'Saving…' : 'Change password'}</button>
    </>
  );
}
export function ForcedChangeScreen() {
  const signOut = useStore((s) => s.signOut);
  return (
    <Shell title="Choose your own password" sub="An admin gave you a temporary password. Pick one that only you know before you continue.">
      <ChangePasswordForm forced />
      <button className="link" onClick={signOut}>Sign out</button>
    </Shell>
  );
}

// ------------------------------------------------------------------------------------------ user menu + admin
const suggest = () => { const a = new Uint8Array(15); crypto.getRandomValues(a); return btoa(String.fromCharCode(...a)).replace(/[+/=]/g, 'x').slice(0, 16) + 'A7'; };

const ROLE_HELP = { admin: 'Everything, including users, the audit log and backups', editor: 'Changes boards. May push to Salesforce if switched on below', viewer: 'Looks only: cannot change or save anything' };

/** Which accounts this person may open: everything, or only the ones picked here. */
function AccessEditor({ u, onSave, onClose }) {
  const [mode, setMode] = useState(u.access); const [boards, setBoards] = useState(u.boards || []);
  const [q, setQ] = useState(''); const [hits, setHits] = useState([]);
  useEffect(() => { if (q.trim().length < 2) { setHits([]); return; } const t = setTimeout(() => api(`/accounts?q=${encodeURIComponent(q)}`).then((r) => setHits(r.filter((a) => !a.Id.startsWith('demo')).slice(0, 8))).catch(() => {}), 250); return () => clearTimeout(t); }, [q]);
  return (
    <div className="acc-edit">
      <label className="radiorow"><input type="radio" checked={mode === 'all'} onChange={() => setMode('all')} /> Every account</label>
      <label className="radiorow"><input type="radio" checked={mode === 'assigned'} onChange={() => setMode('assigned')} /> Only the accounts I pick ({boards.length})</label>
      {mode === 'assigned' && <>
        <div className="pickrow">{boards.map((b) => <span key={b.id} className="tagx">{b.name}<button aria-label={`Remove ${b.name}`} onClick={() => setBoards(boards.filter((x) => x.id !== b.id))}>×</button></span>)}{!boards.length && <span className="muted sm">None yet — they will see an empty home screen.</span>}</div>
        <input placeholder="Search an account to add…" value={q} onChange={(e) => setQ(e.target.value)} />
        {hits.map((h) => <button key={h.Id} className="item" disabled={boards.some((b) => b.id === h.Id)} onClick={() => { setBoards([...boards, { id: h.Id, name: h.Name }]); setQ(''); setHits([]); }}>{h.Name}{h.BillingCountry ? ` · ${h.BillingCountry}` : ''}</button>)}
      </>}
      <div className="row" style={{ justifyContent: 'start', gap: 8 }}><button className="btn sm" onClick={() => onSave(mode, boards)}>Save</button><button className="link" onClick={onClose}>Cancel</button></div>
    </div>
  );
}

function UsersModal({ onClose }) {
  const me = useStore((s) => s.auth.user);
  const [list, setList] = useState(null); const [err, setErr] = useState(null); const [note, setNote] = useState(null); const [editing, setEditing] = useState(null);
  const [nu, setNu] = useState({ username: '', password: suggest(), role: 'editor' });
  const load = () => api('/users').then(setList).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);
  const run = async (fn, msg) => { setErr(null); setNote(null); try { setList(await fn()); if (msg) setNote(msg); } catch (e) { setErr(e.message); } };
  const put = (name, body) => () => api(`/users/${encodeURIComponent(name)}`, jsonOpts('PUT', body));
  return (
    <div className="modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={{ width: 'min(920px,97vw)', height: 'auto', maxHeight: '88vh' }} role="dialog" aria-label="Users">
        <header className="modal-h"><div><h3>Users</h3><div className="muted sm">New users start as <b>editors</b> without Salesforce write access and must choose their own password at first sign-in.</div></div><button className="x" onClick={onClose} aria-label="Close">×</button></header>
        <div className="modal-body" style={{ padding: '0 18px 12px' }}>
          {err && <div className="warn">{err}</div>}{note && <div className="ok">{note}</div>}
          <table className="rv" style={{ tableLayout: 'auto' }}>
            <thead><tr><th>Username</th><th>Role</th><th title="May write board changes back to Salesforce. Admins always can; viewers never.">Salesforce write</th><th title="Which accounts they can open">Accounts</th><th>Last sign-in</th><th /></tr></thead>
            <tbody>{(list || []).map((u) => (
              <React.Fragment key={u.username}>
              <tr className={u.disabled ? 'off' : ''}>
                <td><b>{u.username}</b>{u.username === me.username && <span className="chip ok">you</span>}{u.mustChange && <span className="chip chk">temporary password</span>}{u.disabled && <span className="chip skip">deactivated</span>}</td>
                <td><select style={{ minWidth: 104 }} value={u.role} title={ROLE_HELP[u.role]} disabled={u.username === me.username || u.disabled} onChange={(e) => run(put(u.username, { role: e.target.value }))}><option value="admin">Admin</option><option value="editor">Editor</option><option value="viewer">Viewer</option></select></td>
                <td><label className="row" style={{ gap: 6 }} title={u.role === 'admin' ? 'Admins can always write to Salesforce' : u.role === 'viewer' ? 'Viewers cannot change anything' : 'Allow this user to push changes to Salesforce'}><input type="checkbox" checked={u.canPush} disabled={u.role !== 'editor' || u.disabled} onChange={(e) => run(put(u.username, { canPush: e.target.checked }))} />{u.role === 'admin' ? 'always' : u.role === 'viewer' ? 'never' : u.canPush ? 'allowed' : 'board only'}</label></td>
                <td>{u.role === 'admin' ? <span className="muted sm">every account</span> : <button className="link" disabled={u.disabled} onClick={() => setEditing(editing === u.username ? null : u.username)}>{u.access === 'all' ? 'Every account' : `${u.boards.length} selected`} ▾</button>}</td>
                <td className="muted sm">{u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : 'never'}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {!u.disabled && <><button className="link" onClick={() => { const pw = suggest(); if (confirm(`Reset the password for ${u.username}? They will be signed out and must choose a new one.\n\nTemporary password:  ${pw}\n\nCopy it now — it is not shown again.`)) run(put(u.username, { password: pw }), `Password reset for ${u.username}. Give them: ${pw}`); }}>Reset password</button> · </>}
                  {u.username !== me.username && (u.disabled
                    ? <><button className="link" onClick={() => run(put(u.username, { disabled: false }), `${u.username} can sign in again. Their stored keys and Salesforce link were deleted and must be set up again.`)}>Reactivate</button> · </>
                    : <><button className="link danger" title="Ends their sessions, deletes their stored keys and Salesforce link, blocks sign-in. Their work stays on the boards." onClick={() => { if (confirm(`Deactivate ${u.username}?\n\n• they are signed out everywhere right now\n• they cannot sign in (including SSO)\n• their stored ZoomInfo / Lusha / Miro / Anthropic keys and Salesforce link are deleted\n• their boards, comments and history stay\n\nYou can reactivate them later.`)) run(put(u.username, { disabled: true }), `${u.username} was deactivated and their stored keys were deleted.`); }}>Deactivate</button> · </>)}
                  {u.username !== me.username && <button className="link danger" onClick={() => { if (confirm(`Remove ${u.username} completely? They lose access immediately. (Deactivate keeps the account on the list.)`)) run(() => api(`/users/${encodeURIComponent(u.username)}`, { method: 'DELETE' })); }}>Remove</button>}
                </td>
              </tr>
              {editing === u.username && <tr><td colSpan={6}><AccessEditor u={u} onClose={() => setEditing(null)} onSave={(mode, boards) => { run(put(u.username, { access: mode, boards }), `Saved account access for ${u.username}.`); setEditing(null); }} /></td></tr>}
              </React.Fragment>))}</tbody>
          </table>
          <h4>Add a user</h4>
          <div className="adduser">
            <input placeholder="username (e.g. email)" autoCapitalize="none" value={nu.username} onChange={(e) => setNu({ ...nu, username: e.target.value })} />
            <input value={nu.password} onChange={(e) => setNu({ ...nu, password: e.target.value })} title="Temporary password" />
            <select value={nu.role} onChange={(e) => setNu({ ...nu, role: e.target.value })} title={ROLE_HELP[nu.role]}><option value="editor">Editor</option><option value="viewer">Viewer</option><option value="admin">Admin</option></select>
            <button className="btn sm" disabled={!nu.username.trim()} onClick={() => run(() => api('/users', jsonOpts('POST', nu)), `Created ${nu.username}. Give them the temporary password: ${nu.password}`).then(() => setNu({ username: '', password: suggest(), role: 'editor' }))}>Add</button>
          </div>
          <p className="muted sm">The temporary password is only shown here. Send it to them privately. <b>Admin</b>: {ROLE_HELP.admin}. <b>Editor</b>: {ROLE_HELP.editor}. <b>Viewer</b>: {ROLE_HELP.viewer}.</p>
        </div>
      </div>
    </div>
  );
}

/** Shown instead of the app when per-user Salesforce login is on and this person has not linked their Salesforce account yet. */
export function ConnectSalesforce() {
  const notice = useStore((s) => s.sfNotice); const signOut = useStore((s) => s.signOut); const connect = useStore((s) => s.connectSalesforce);
  const [err, setErr] = useState('');
  return (
    <div className="center">
      <div className="card" style={{ width: 'min(440px,94vw)', padding: 22, display: 'grid', gap: 12 }}>
        <h2 style={{ margin: 0 }}>Connect your Salesforce account</h2>
        <p className="muted" style={{ margin: 0 }}>Account Mapper reads and updates Salesforce as <b>you</b>, so you see only what your Salesforce permissions allow, and any change is recorded under your name in Salesforce. You sign in to Salesforce on their page; we never see your password.</p>
        {(notice || err) && <div className="warn">{err || notice}</div>}
        <button className="btn primary" onClick={() => connect().catch((e) => setErr(e.message))}>Connect Salesforce</button>
        <button className="link" onClick={() => signOut()}>Sign out</button>
      </div>
    </div>
  );
}

export function UserMenu() {
  const user = useStore((s) => s.auth.user); const signOut = useStore((s) => s.signOut);
  const sfLogin = useStore((s) => s.status?.sfLogin); const connect = useStore((s) => s.connectSalesforce); const disconnect = useStore((s) => s.disconnectSalesforce);
  const [open, setOpen] = useState(false); const [dlg, setDlg] = useState(null);
  if (!user) return null;
  return (
    <div className="rel-menu usermenu">
      <button className="btn ghost" onClick={() => setOpen(!open)} title="Account">
        <span className="avatar">{user.username[0].toUpperCase()}</span> <span className="uname">{user.username.split('@')[0]}</span> ▾
      </button>
      {open && (
        <div className="pop" onMouseLeave={() => setOpen(false)}>
          <div className="muted sm" style={{ padding: '2px 8px' }}>Signed in as <b>{user.username}</b> · {user.role}</div>
          {sfLogin && <div className="muted sm" style={{ padding: '2px 8px' }}>Salesforce: {sfLogin.connected ? <>as <b>{sfLogin.label || 'you'}</b></> : 'not connected'}</div>}
          {sfLogin?.connected && <button className="item" onClick={() => { setOpen(false); if (confirm('Disconnect your Salesforce account? You will need to connect again to use the tool.')) disconnect(); }}>Disconnect Salesforce</button>}
          <button className="item" onClick={() => { setOpen(false); setDlg('password'); }}>Change password</button>
          {user.role === 'admin' && <button className="item" onClick={() => { setOpen(false); setDlg('users'); }}>Manage users…</button>}
          {user.role === 'admin' && <button className="item" onClick={() => { setOpen(false); setDlg('audit'); }}>Audit log &amp; backups…</button>}
          <button className="item" onClick={() => { setOpen(false); signOut(); }}>Sign out</button>
        </div>
      )}
      {dlg === 'users' && <UsersModal onClose={() => setDlg(null)} />}
      {dlg === 'audit' && <AdminPanel onClose={() => setDlg(null)} />}
      {dlg === 'password' && (
        <div className="modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) setDlg(null); }}>
          <div className="modal" style={{ width: 'min(420px,96vw)', height: 'auto', padding: 18, gap: 10 }} role="dialog" aria-label="Change password">
            <div className="row"><h3 style={{ margin: 0 }}>Change password</h3><button className="x" onClick={() => setDlg(null)}>×</button></div>
            <ChangePasswordForm onDone={() => {}} />
          </div>
        </div>
      )}
    </div>
  );
}
