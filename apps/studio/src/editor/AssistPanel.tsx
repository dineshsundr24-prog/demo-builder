// AI assistant: describe a change in plain words. The AI either changes an existing screen
// ("rename Verify to Validate", "add an Emirates ID field") or adds a new, linked screen.
import React, { useRef, useState } from 'react';
import { Loader2, Sparkles, X } from 'lucide-react';
import type { DemoDocument } from '@demo/schema';
import { call, token } from '../GeneratePanel.tsx';

export type AssistOutcome = { action: 'added' | 'modified'; document: DemoDocument; screenId: string; changes: string[]; costUsd: number };
type Mode = 'auto' | 'modify' | 'add';

const EXAMPLES: Record<Mode, string[]> = {
  auto: ['Rename the Verify button to Validate', 'Add a new screen to freeze my card and change the PIN', 'Add an Emirates ID field after the mobile number'],
  modify: ['Change the heading to "Welcome back"', 'Add a field for Emirates ID expiry date', 'Remove the promotion banner'],
  add: ['Card management: freeze card, change PIN, set daily spending limit', 'Notifications: list of recent alerts with dates', 'Branch locator with a list of branches and opening hours'],
};

export function AssistPanel({ doc, currentScreen, initialMode = 'auto', onClose, onDone, onBlank }: { doc: DemoDocument; currentScreen: string; initialMode?: Mode; onClose: () => void; onDone: (o: AssistOutcome) => void; onBlank: () => void }) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [text, setText] = useState('');
  const [from, setFrom] = useState(''), [to, setTo] = useState(''), [menu, setMenu] = useState(false);
  const [access, setAccess] = useState(token());
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const box = useRef<HTMLTextAreaElement>(null);
  const current = doc.screens.find(s => s.id === currentScreen);
  const submit = async () => {
    if (text.trim().length < 3 || busy) return;
    try { sessionStorage.setItem('db-access', access.trim()); } catch { /* session storage blocked */ }
    setBusy(true); setError('');
    try {
      const out = await call<AssistOutcome>('/api/v2/assist', { method: 'POST', body: JSON.stringify({ document: doc, instruction: text, currentScreen, mode, from: from || null, to: to || null, addToMenu: menu }) });
      onDone(out);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const tabs: [Mode, string][] = [['auto', 'Let AI decide'], ['modify', 'Change "' + (current?.title ?? 'this screen') + '"'], ['add', 'New screen']];
  return <div className="assist-backdrop" onMouseDown={e => { if (e.target === e.currentTarget && !busy) onClose(); }}>
    <section className="assist" role="dialog" aria-modal="true" aria-label="AI assistant" data-testid="assist">
      <header><Sparkles size={16} /><strong>AI assistant</strong><button type="button" className="assist-close" aria-label="Close" onClick={onClose} disabled={busy}><X size={16} /></button></header>
      <div className="assist-modes" role="radiogroup" aria-label="What should the AI do">
        {tabs.map(([k, l]) => <button key={k} type="button" role="radio" aria-checked={mode === k} onClick={() => setMode(k)}>{l}</button>)}
      </div>
      <textarea ref={box} autoFocus rows={4} value={text} onChange={e => setText(e.target.value)} aria-label="Describe what you want"
        placeholder={mode === 'add' ? 'Describe the new screen: its purpose, the information and the actions it needs…' : 'Describe what to change or add, in plain words…'}
        onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(); }} />
      <div className="assist-examples">{EXAMPLES[mode].map(x => <button key={x} type="button" onClick={() => { setText(x); box.current?.focus(); }}>{x}</button>)}</div>
      {mode !== 'modify' ? <details className="assist-options" open={mode === 'add'}><summary>Options for a new screen</summary>
        <label>Opens from<select value={from} onChange={e => setFrom(e.target.value)}><option value="">AI chooses</option>{doc.screens.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}</select></label>
        <label>Leads to<select value={to} onChange={e => setTo(e.target.value)}><option value="">AI chooses</option>{doc.screens.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}</select></label>
        {doc.shell.kind !== 'none' ? <label className="assist-check"><input type="checkbox" checked={menu} onChange={e => setMenu(e.target.checked)} />Also add it to the app menu</label> : null}
      </details> : null}
      {!token() ? <label className="assist-token">Access token<input type="password" value={access} onChange={e => setAccess(e.target.value)} autoComplete="off" placeholder="Demo Builder access token" /></label> : null}
      {error ? <p className="studio-error" role="alert">{error}</p> : null}
      <footer>
        {mode === 'add' ? <button type="button" className="assist-link" onClick={onBlank} disabled={busy}>Create a blank screen instead</button> : <span />}
        <button type="button" className="assist-go" data-testid="assist-go" onClick={submit} disabled={busy || text.trim().length < 3 || !access.trim()}>
          {busy ? <><Loader2 size={15} className="spin" />Working…</> : <><Sparkles size={15} />{mode === 'add' ? 'Create screen' : mode === 'modify' ? 'Apply change' : 'Go'}</>}</button>
      </footer>
      <p className="insp-help">Changes appear in the demo for you to review: keep them or undo. About USD 0.002 per request.</p>
    </section>
  </div>;
}
