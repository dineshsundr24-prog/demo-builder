// AI assistant chat, docked next to the demo. Each request either changes a screen or adds a
// new linked screen; the reply lists what changed, and the latest change can be undone here.
import React, { useEffect, useRef, useState } from 'react';
import { ArrowUp, Loader2, Settings2, Sparkles, Undo2 } from 'lucide-react';
import type { DemoDocument } from '@demo/schema';
import { call, token } from '../GeneratePanel.tsx';

export type AssistOutcome = { action: 'added' | 'modified' | 'flow' | 'none'; document: DemoDocument; screenId: string; changes: string[]; reply?: string; costUsd: number };
export type ChatMode = 'auto' | 'modify' | 'add' | 'flow';
export type ChatMessage =
  | { id: number; role: 'user'; text: string; mode: ChatMode; screenTitle: string }
  | { id: number; role: 'assistant'; text: string; changes?: string[]; screenId?: string; costUsd?: number; state: 'applied' | 'undone' | 'error' | 'info' };

const EXAMPLES = ['Rename the Verify button to Validate', 'Add a new screen to freeze my card and change the PIN', 'Add Cards to the app menu and remove Settings', 'Delete the Promotions screen and move Profile after Dashboard'];
let seq = 0;

type Props = {
  doc: DemoDocument; currentScreen: string; messages: ChatMessage[]; setMessages: (f: (m: ChatMessage[]) => ChatMessage[]) => void;
  mode: ChatMode; setMode: (m: ChatMode) => void; undoable: boolean; onApply: (o: AssistOutcome) => void; onUndo: () => void; onOpenScreen: (id: string) => void; onBlank: () => void;
};

export function AssistChat({ doc, currentScreen, messages, setMessages, mode, setMode, undoable, onApply, onUndo, onOpenScreen, onBlank }: Props) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [access, setAccess] = useState(token());
  const [opts, setOpts] = useState(false);
  const [from, setFrom] = useState(''), [to, setTo] = useState(''), [menu, setMenu] = useState(false);
  const list = useRef<HTMLDivElement>(null), box = useRef<HTMLTextAreaElement>(null);
  const current = doc.screens.find(s => s.id === currentScreen);
  const title = (id?: string) => doc.screens.find(s => s.id === id)?.title ?? id ?? '';
  useEffect(() => { list.current?.scrollTo({ top: list.current.scrollHeight, behavior: 'smooth' }); }, [messages.length, busy]);
  useEffect(() => { box.current?.focus(); }, [mode]);
  const lastApplied = [...messages].reverse().find(m => m.role === 'assistant' && m.state === 'applied')?.id;

  const send = async (raw = text) => {
    const instruction = raw.trim();
    if (instruction.length < 3 || busy) return;
    try { sessionStorage.setItem('db-access', access.trim()); } catch { /* blocked */ }
    // Recent turns give follow-ups ("make it red") their context.
    const history = messages.filter(m => m.role === 'user' || (m.role === 'assistant' && m.state === 'applied')).slice(-6)
      .map(m => (m.role === 'user' ? 'User: ' + m.text : 'Assistant: ' + m.text + (m.changes?.length ? ' (' + m.changes.join('; ') + ')' : ''))).map(s => s.slice(0, 300));
    setMessages(m => [...m, { id: ++seq, role: 'user', text: instruction, mode, screenTitle: current?.title ?? '' }]);
    setText(''); setBusy(true);
    try {
      const out = await call<AssistOutcome>('/api/v2/assist', { method: 'POST', body: JSON.stringify({ document: doc, instruction, currentScreen, mode, history, from: from || null, to: to || null, addToMenu: menu }) });
      const name = out.document.screens.find(s => s.id === out.screenId)?.title ?? out.screenId;
      if (out.action === 'none') {
        setMessages(m => [...m, { id: ++seq, role: 'assistant', state: 'info', costUsd: out.costUsd, text: out.reply || 'Nothing needed to change on "' + name + '". Try describing it differently.' }]);
      } else {
        onApply(out);
        const lead = out.action === 'added' ? 'I added the screen "' + name + '".' : out.action === 'flow' ? 'I updated the app structure.' : 'I updated "' + name + '".';
        setMessages(m => [...m, { id: ++seq, role: 'assistant', state: 'applied', screenId: out.screenId, costUsd: out.costUsd, changes: out.changes, text: out.reply ? out.reply : lead }]);
      }
      setFrom(''); setTo(''); setMenu(false);
    } catch (e) {
      setMessages(m => [...m, { id: ++seq, role: 'assistant', state: 'error', text: e instanceof Error ? e.message : String(e) }]);
    } finally { setBusy(false); }
  };
  const undo = (id: number) => { onUndo(); setMessages(m => m.map(x => (x.id === id && x.role === 'assistant' ? { ...x, state: 'undone' } : x))); };

  return <div className="chat" data-testid="assist">
    <div className="chat-list" ref={list} aria-live="polite">
      {!messages.length ? <div className="chat-welcome">
        <Sparkles size={18} />
        <p><strong>Tell me what to change or add.</strong> I can change the screen you're on or another screen, create a new linked screen, and manage the app menu and the list of screens (add, rename, reorder, delete).</p>
        <div className="chat-examples">{EXAMPLES.map(x => <button key={x} type="button" onClick={() => setText(x)}>{x}</button>)}</div>
      </div> : null}
      {messages.map(m => m.role === 'user'
        ? <div key={m.id} className="msg msg-user"><p>{m.text}</p><small>{m.mode === 'add' ? 'New screen' : m.mode === 'flow' ? 'Menu & screens' : m.mode === 'modify' ? 'On "' + m.screenTitle + '"' : 'Viewing "' + m.screenTitle + '"'}</small></div>
        : <div key={m.id} className={'msg msg-ai msg-' + m.state}>
            <p>{m.text}</p>
            {m.changes?.length && m.changes[0] !== 'No visible change' ? <ul>{m.changes.map((c, i) => <li key={i}>{c}</li>)}</ul> : null}
            {m.state === 'applied' || m.state === 'undone' ? <div className="msg-actions">
              {m.screenId && m.screenId !== currentScreen && m.state === 'applied' ? <button type="button" onClick={() => onOpenScreen(m.screenId!)}>Show "{title(m.screenId)}"</button> : null}
              {m.state === 'applied' && m.id === lastApplied && undoable ? <button type="button" data-testid="assist-undo" onClick={() => undo(m.id)}><Undo2 size={12} />Undo</button> : null}
              {m.state === 'undone' ? <span className="msg-undone">Undone</span> : null}
              {m.costUsd ? <span className="msg-cost">USD {m.costUsd.toFixed(3)}</span> : null}
            </div> : null}
          </div>)}
      {busy ? <div className="msg msg-ai msg-busy"><Loader2 size={14} className="spin" /> Working on it…</div> : null}
    </div>

    <div className="chat-compose">
      <div className="chat-modes" role="radiogroup" aria-label="What should the AI do">
        {([['auto', 'Auto'], ['modify', 'This screen'], ['add', 'New screen'], ['flow', 'Menu & screens']] as [ChatMode, string][]).map(([k, l]) =>
          <button key={k} type="button" role="radio" aria-checked={mode === k} onClick={() => setMode(k)}>{l}</button>)}
        {mode === 'add' || mode === 'auto' ? <button type="button" className="chat-opt-toggle" aria-expanded={opts} title="New screen options" aria-label="New screen options" onClick={() => setOpts(o => !o)}><Settings2 size={14} /></button> : null}
      </div>
      {opts && (mode === 'add' || mode === 'auto') ? <div className="chat-options">
        <label>Opens from<select value={from} onChange={e => setFrom(e.target.value)}><option value="">AI chooses</option>{doc.screens.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}</select></label>
        <label>Leads to<select value={to} onChange={e => setTo(e.target.value)}><option value="">AI chooses</option>{doc.screens.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}</select></label>
        {doc.shell.kind !== 'none' ? <label className="chat-check"><input type="checkbox" checked={menu} onChange={e => setMenu(e.target.checked)} />Add to app menu</label> : null}
      </div> : null}
      {!token() ? <input className="chat-token" type="password" aria-label="Access token" placeholder="Demo Builder access token" value={access} onChange={e => setAccess(e.target.value)} autoComplete="off" /> : null}
      <div className="chat-input">
        <textarea ref={box} rows={2} value={text} onChange={e => setText(e.target.value)} aria-label="Message the AI assistant"
          placeholder={mode === 'flow' ? 'e.g. Add Cards to the menu, delete the Promotions screen…' : mode === 'add' ? 'Describe the new screen…' : mode === 'modify' ? 'What should change on "' + (current?.title ?? 'this screen') + '"?' : 'Describe a change or a new screen…'}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }} />
        <button type="button" className="chat-send" data-testid="assist-go" aria-label="Send" disabled={busy || text.trim().length < 3 || !access.trim()} onClick={() => send()}><ArrowUp size={16} /></button>
      </div>
      {mode === 'add' ? <button type="button" className="chat-blank" onClick={onBlank}>Create a blank screen instead</button> : null}
      <p className="chat-foot">Enter to send · Shift+Enter for a new line · about USD 0.002–0.004 per request</p>
    </div>
  </div>;
}
