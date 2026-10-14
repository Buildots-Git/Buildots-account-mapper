import React, { useEffect, useState } from 'react';
import { useStore, api, jsonOpts } from './store.js';
import ThemeToggle from './ThemeToggle.jsx';

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
  const [u, setU] = useState(''); const [p, setP] = useState(''); const [err, setErr] = useState(null); const [busy, setBusy] = useState(false);
  const go = async () => {
    if (!u.trim() || !p || busy) return; setBusy(true); setErr(null);
    try { await signIn(u, p); } catch (e) { setErr(e.message); setP(''); } finally { setBusy(false); }
  };
  return (
    <Shell title="Sign in" sub="Use your Account Mapper username and password.">
      <label className="f">Username<input autoFocus autoComplete="username" autoCapitalize="none" value={u} onChange={(e) => setU(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') document.querySelector('.authcard input[type=password],.authcard .pwrow input')?.focus(); }} /></label>
      <PasswordInput label="Password" value={p} onChange={setP} autoComplete="current-password" onEnter={go} />
      {err && <div className="warn" role="alert">{err}</div>}
      <button className="btn" disabled={busy || !u.trim() || !p} onClick={go}>{busy ? 'Signing in…' : 'Sign in'}</button>
      <p className="muted sm">Forgot your password? Ask an admin to reset it for you.</p>
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

function UsersModal({ onClose }) {
  const me = useStore((s) => s.auth.user);
  const [list, setList] = useState(null); const [err, setErr] = useState(null); const [note, setNote] = useState(null);
  const [nu, setNu] = useState({ username: '', password: suggest(), role: 'user' });
  const load = () => api('/users').then(setList).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);
  const run = async (fn, msg) => { setErr(null); setNote(null); try { setList(await fn()); if (msg) setNote(msg); } catch (e) { setErr(e.message); } };
  return (
    <div className="modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={{ width: 'min(760px,96vw)', height: 'auto', maxHeight: '88vh' }} role="dialog" aria-label="Users">
        <header className="modal-h"><div><h3>Users</h3><div className="muted sm">New users must choose their own password the first time they sign in.</div></div><button className="x" onClick={onClose} aria-label="Close">×</button></header>
        <div className="modal-body" style={{ padding: '0 18px 12px' }}>
          {err && <div className="warn">{err}</div>}{note && <div className="ok">{note}</div>}
          <table className="rv" style={{ tableLayout: 'auto' }}>
            <thead><tr><th>Username</th><th>Role</th><th>Last sign-in</th><th /></tr></thead>
            <tbody>{(list || []).map((u) => (
              <tr key={u.username}>
                <td><b>{u.username}</b>{u.username === me.username && <span className="chip ok">you</span>}{u.mustChange && <span className="chip chk">temporary password</span>}</td>
                <td><select value={u.role} disabled={u.username === me.username} onChange={(e) => run(() => api(`/users/${encodeURIComponent(u.username)}`, jsonOpts('PUT', { role: e.target.value })))}><option value="user">User</option><option value="admin">Admin</option></select></td>
                <td className="muted sm">{u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : 'never'}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="link" onClick={() => { const pw = suggest(); if (confirm(`Reset the password for ${u.username}? They will be signed out and must choose a new one.\n\nTemporary password:  ${pw}\n\nCopy it now — it is not shown again.`)) run(() => api(`/users/${encodeURIComponent(u.username)}`, jsonOpts('PUT', { password: pw })), `Password reset for ${u.username}. Give them: ${pw}`); }}>Reset password</button>
                  {u.username !== me.username && <> · <button className="link danger" onClick={() => { if (confirm(`Remove ${u.username}? They lose access immediately.`)) run(() => api(`/users/${encodeURIComponent(u.username)}`, { method: 'DELETE' })); }}>Remove</button></>}
                </td>
              </tr>))}</tbody>
          </table>
          <h4>Add a user</h4>
          <div className="adduser">
            <input placeholder="username (e.g. email)" autoCapitalize="none" value={nu.username} onChange={(e) => setNu({ ...nu, username: e.target.value })} />
            <input value={nu.password} onChange={(e) => setNu({ ...nu, password: e.target.value })} title="Temporary password" />
            <select value={nu.role} onChange={(e) => setNu({ ...nu, role: e.target.value })}><option value="user">User</option><option value="admin">Admin</option></select>
            <button className="btn sm" disabled={!nu.username.trim()} onClick={() => run(() => api('/users', jsonOpts('POST', nu)), `Created ${nu.username}. Give them the temporary password: ${nu.password}`).then(() => setNu({ username: '', password: suggest(), role: 'user' }))}>Add</button>
          </div>
          <p className="muted sm">The temporary password is only shown here. Send it to them privately.</p>
        </div>
      </div>
    </div>
  );
}

export function UserMenu() {
  const user = useStore((s) => s.auth.user); const signOut = useStore((s) => s.signOut);
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
          <button className="item" onClick={() => { setOpen(false); setDlg('password'); }}>Change password</button>
          {user.role === 'admin' && <button className="item" onClick={() => { setOpen(false); setDlg('users'); }}>Manage users…</button>}
          <button className="item" onClick={() => { setOpen(false); signOut(); }}>Sign out</button>
        </div>
      )}
      {dlg === 'users' && <UsersModal onClose={() => setDlg(null)} />}
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
