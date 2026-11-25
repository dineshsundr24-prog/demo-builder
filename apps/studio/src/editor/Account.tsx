// Account box: signed-in user (Supabase Auth) or the shared UAT access token.
import React, { useEffect, useState } from 'react';
import { LogIn, LogOut, UserRound } from 'lucide-react';
import { authConfigured, onAuthChange, sendSignInLink, signedInEmail, signInWithPassword, signOut, signUp, uatToken } from '../account.ts';

export function useSignedIn() {
  const [email, setEmail] = useState(signedInEmail());
  useEffect(() => onAuthChange(() => setEmail(signedInEmail())), []);
  return email;
}

export function AccountBox({ compact = false }: { compact?: boolean }) {
  const email = useSignedIn();
  const [open, setOpen] = useState(false);
  if (!authConfigured) return uatToken() ? <p className="account-line" data-testid="account"><UserRound size={14} />Shared UAT access</p> : null;
  return <div className={'account' + (compact ? ' compact' : '')} data-testid="account">
    {email ? <><span className="account-line"><UserRound size={14} /><span title={email}>{email}</span></span>
      <button type="button" className="account-btn" onClick={() => signOut()}><LogOut size={13} />Sign out</button></>
      : <button type="button" className="account-btn primary" onClick={() => setOpen(true)}><LogIn size={14} />Sign in to save demos</button>}
    {open ? <SignInDialog onClose={() => setOpen(false)} /> : null}
  </div>;
}

function SignInDialog({ onClose }: { onClose: () => void }) {
  const [email, setEmail] = useState(''), [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [info, setInfo] = useState('');
  const run = async (fn: () => Promise<unknown>, done?: string) => {
    setBusy(true); setError(''); setInfo('');
    try { await fn(); if (done) setInfo(done); else onClose(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  const createAccount = async () => {
    setBusy(true); setError(''); setInfo('');
    try { if (await signUp(email, password)) onClose(); else setInfo('Check your email to confirm your account, then sign in.'); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  const validEmail = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
  return <div className="signin-backdrop" onMouseDown={e => { if (e.target === e.currentTarget && !busy) onClose(); }}>
    <form className="signin" role="dialog" aria-modal="true" aria-label="Sign in" onSubmit={e => { e.preventDefault(); if (validEmail && password) void run(() => signInWithPassword(email, password)); }}>
      <h2>Sign in to Demo Builder</h2>
      <p className="muted">Your demos, versions and published links are saved to your account.</p>
      <label>Email<input type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} autoFocus /></label>
      <label>Password<input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} /></label>
      {error ? <p className="studio-error" role="alert">{error}</p> : null}
      {info ? <p className="signin-info" role="status">{info}</p> : null}
      <div className="signin-actions">
        <button type="submit" className="account-btn primary" disabled={busy || !validEmail || !password}>Sign in</button>
        <button type="button" className="account-btn" disabled={busy || !validEmail || password.length < 8} onClick={createAccount}>Create account</button>
      </div>
      <button type="button" className="signin-link" disabled={busy || !validEmail} onClick={() => run(() => sendSignInLink(email), 'We sent a sign-in link to ' + email + '.')}>Email me a sign-in link instead</button>
      <p className="muted small">New accounts need a password of at least 8 characters.</p>
      <button type="button" className="signin-close" aria-label="Close" onClick={onClose} disabled={busy}>×</button>
    </form>
  </div>;
}
