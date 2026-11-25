// Account box: signed-in user (Supabase Auth) or the shared UAT access token.
import React, { useEffect, useState } from 'react';
import { KeyRound, LogIn, LogOut, UserRound } from 'lucide-react';
import { authConfigured, meyonSession, onAuthChange, setMeyonSession, setPassword, signedInEmail, signInWithPassword, signOut, uatToken } from '../account.ts';

export function useSignedIn() {
  const [email, setEmail] = useState(signedInEmail());
  useEffect(() => onAuthChange(() => setEmail(signedInEmail())), []);
  return email;
}

export function AccountBox({ compact = false, mustSetPassword = false }: { compact?: boolean; mustSetPassword?: boolean }) {
  const email = useSignedIn();
  const [open, setOpen] = useState(false), [pwOpen, setPwOpen] = useState(mustSetPassword);
  useEffect(() => { if (mustSetPassword) setPwOpen(true); }, [mustSetPassword]);
  // A tab opened from MEYON works in that launch's project only, as the MEYON tenant.
  if (meyonSession()) return <div className={'account' + (compact ? ' compact' : '')} data-testid="account"><span className="account-line"><UserRound size={14} />Opened from MEYON</span>
    <span className="account-actions"><button type="button" className="account-btn" title="End the MEYON session in this tab" onClick={() => { setMeyonSession(null); location.assign(location.pathname); }}><LogOut size={13} />Leave</button></span></div>;
  if (!authConfigured) return uatToken() ? <p className="account-line" data-testid="account"><UserRound size={14} />Shared UAT access</p> : null;
  return <div className={'account' + (compact ? ' compact' : '')} data-testid="account">
    {email ? <><span className="account-line"><UserRound size={14} /><span title={email}>{email}</span></span>
      <span className="account-actions"><button type="button" className="account-btn" onClick={() => setPwOpen(true)}><KeyRound size={13} />Change password</button>
      <button type="button" className="account-btn" onClick={() => signOut()}><LogOut size={13} />Sign out</button></span></>
      : <button type="button" className="account-btn primary" onClick={() => setOpen(true)}><LogIn size={14} />Sign in</button>}
    {open ? <SignInDialog onClose={() => setOpen(false)} /> : null}
    {pwOpen && email ? <PasswordDialog first={mustSetPassword} onClose={() => setPwOpen(false)} /> : null}
  </div>;
}

function SignInDialog({ onClose }: { onClose: () => void }) {
  const [email, setEmail] = useState(''), [password, setPw] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const validEmail = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
  const submit = async () => {
    setBusy(true); setError('');
    try { await signInWithPassword(email, password); onClose(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  return <div className="signin-backdrop" onMouseDown={e => { if (e.target === e.currentTarget && !busy) onClose(); }}>
    <form className="signin" role="dialog" aria-modal="true" aria-label="Sign in" onSubmit={e => { e.preventDefault(); if (validEmail && password) void submit(); }}>
      <h2>Sign in to Demo Builder</h2>
      <label>Email<input type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} autoFocus /></label>
      <label>Password<input type="password" autoComplete="current-password" value={password} onChange={e => setPw(e.target.value)} /></label>
      {error ? <p className="studio-error" role="alert">{error}</p> : null}
      <div className="signin-actions"><button type="submit" className="account-btn primary" disabled={busy || !validEmail || !password}>{busy ? 'Signing in…' : 'Sign in'}</button></div>
      <button type="button" className="signin-close" aria-label="Close" onClick={onClose} disabled={busy}>×</button>
    </form>
  </div>;
}

function PasswordDialog({ first, onClose }: { first: boolean; onClose: () => void }) {
  const [pw, setPw] = useState(''), [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [done, setDone] = useState(false);
  const ok = pw.length >= 8 && pw === again;
  const submit = async () => {
    setBusy(true); setError('');
    try { await setPassword(pw); setDone(true); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  return <div className="signin-backdrop">
    <form className="signin" role="dialog" aria-modal="true" aria-label={first ? 'Set your password' : 'Change password'} onSubmit={e => { e.preventDefault(); if (ok) void submit(); }}>
      <h2>{first ? 'Set your password' : 'Change password'}</h2>
      {done ? <><p className="signin-info" role="status">Password saved. Use it to sign in from now on.</p>
        <div className="signin-actions"><button type="button" className="account-btn primary" onClick={onClose}>Continue</button></div></> : <>
        <label>New password<input type="password" autoComplete="new-password" value={pw} onChange={e => setPw(e.target.value)} autoFocus /></label>
        <label>Repeat new password<input type="password" autoComplete="new-password" value={again} onChange={e => setAgain(e.target.value)} /></label>
        <p className="muted small">At least 8 characters.{again && pw !== again ? ' The passwords do not match.' : ''}</p>
        {error ? <p className="studio-error" role="alert">{error}</p> : null}
        <div className="signin-actions"><button type="submit" className="account-btn primary" disabled={busy || !ok}>{busy ? 'Saving…' : 'Save password'}</button></div>
        {first ? null : <button type="button" className="signin-close" aria-label="Close" onClick={onClose} disabled={busy}>×</button>}</>}
    </form>
  </div>;
}
