import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Menu, X } from 'lucide-react';
import { resolveText, walk, type Action, type DemoDocument, type NodeT } from '@demo/schema';
import { createSession, dismissToast, openRecord as openRecordFn, runActions, setField as setFieldFn, type Session } from './engine.ts';
import { Nodes, RuntimeContext, type RuntimeApi } from './nodes.tsx';
import { Icon as BrandIcon } from './icons.tsx';

const Icon = ({ name }: { name: string }) => <BrandIcon name={name} size={18} />;

export type DemoRuntimeProps = {
  doc: DemoDocument;
  screenId?: string;                         // controlled screen (editor); otherwise internal
  onScreenChange?: (id: string) => void;
  interactive?: boolean;                     // false in design mode: no actions run
  wrap?: RuntimeApi['wrap'];
  onSession?: (s: Session) => void;          // test/debug hook
};

export function themeStyle(doc: DemoDocument): React.CSSProperties {
  const r = { sm: '6px', md: '10px', lg: '16px' }[doc.theme.radius];
  const font = { system: 'system-ui, -apple-system, "Segoe UI", sans-serif', inter: 'Inter, system-ui, sans-serif', serif: 'Georgia, "Times New Roman", serif', rounded: '"SF Pro Rounded", "Nunito", ui-rounded, system-ui, sans-serif' }[doc.theme.font];
  return { '--db-primary': doc.theme.primary, '--db-secondary': doc.theme.secondary, '--db-accent': doc.theme.accent, '--db-radius': r, '--db-font': font } as React.CSSProperties;
}

export function DemoRuntime({ doc, screenId, onScreenChange, interactive = true, wrap, onSession }: DemoRuntimeProps) {
  const [session, setSession] = useState<Session>(() => createSession(doc, screenId));
  const running = useRef(false);
  // Controlled screen from the editor.
  useEffect(() => { if (screenId && screenId !== session.screenId) setSession(s => ({ ...s, screenId, errors: {} })); }, [screenId]);
  // Keep collections in sync with edited documents (design mode).
  useEffect(() => { setSession(s => ({ ...s, collections: Object.fromEntries(doc.collections.map(c => [c.id, s.collections[c.id] && interactive ? s.collections[c.id] : structuredClone(c.rows)])) })); }, [doc.collections]);
  useEffect(() => { onSession?.(session); }, [session]);
  const lastScreen = useRef(session.screenId);
  useEffect(() => { if (lastScreen.current !== session.screenId) { lastScreen.current = session.screenId; onScreenChange?.(session.screenId); } }, [session.screenId]);

  const latest = useRef(session);
  latest.current = session;
  // A "confirm" action pauses the chain on an in-app dialog (never the browser's own confirm box).
  const [asking, setAsking] = useState<{ title: string; message?: string; confirmLabel: string; answer: (ok: boolean) => void } | null>(null);
  const confirm = useCallback((c: { title: string; message?: string; confirmLabel: string }) => new Promise<boolean>(resolve => setAsking({ ...c, answer: ok => { setAsking(null); resolve(ok); } })), []);
  const run = useCallback((actions: Action[], formId?: string) => {
    if (running.current) return; // one action chain at a time
    running.current = true;
    void runActions(doc, latest.current, actions, { formId, confirm, onUpdate: next => { latest.current = next; setSession(next); } })
      .finally(() => { running.current = false; });
  }, [doc]);
  const api: RuntimeApi = useMemo(() => ({
    doc, session, interactive, wrap, run,
    setField: (k, v) => setSession(s => setFieldFn(s, k, v)),
    openRecord: (c, row, screen) => setSession(s => openRecordFn(doc, s, c, row, screen)),
  }), [doc, session, interactive, wrap, run]);

  useEffect(() => {
    if (!session.toasts.length) return;
    const t = setTimeout(() => setSession(s => dismissToast(s, s.toasts[0].id)), 3200);
    return () => clearTimeout(t);
  }, [session.toasts]);

  // Preview convenience: a details screen opened without a selected row (e.g. from the studio's
  // screen list) shows the first sample record of the table/list that normally opens it.
  useEffect(() => {
    if (session.record) return;
    const sources: string[] = [];
    for (const s of doc.screens) walk(s.children as NodeT[], '', n => {
      if ((n.type === 'Table' || n.type === 'List') && ((n.rowAction as any)?.screen === session.screenId || (n.itemAction as any)?.screen === session.screenId)) sources.push(String(n.collection));
    });
    const c = sources.length ? doc.collections.find(x => x.id === sources[0]) : undefined;
    const row = c && (session.collections[c.id] ?? c.rows)[0];
    if (c && row) setSession(s => (s.record ? s : { ...s, record: { collection: c.id, key: row[c.key], row: { ...row } } }));
  }, [session.screenId]);
  const screen = doc.screens.find(s => s.id === session.screenId) ?? doc.screens[0];
  const text = (t: string) => resolveText(t, { state: session.state, record: session.record?.row ?? null, params: {} });
  const showShell = screen.shell !== 'hidden' && doc.shell.kind !== 'none';
  const canBack = doc.shell.showBack && session.history.length > 0;
  const go = (target: string) => interactive && run([{ type: 'navigate', screen: target }]);
  const [drawer, setDrawer] = useState(false);
  const menuItems = doc.shell.items;
  const active = (id: string) => id === screen.id;

  // On mobile screens with an app bar, a first heading that repeats the title is not shown twice.
  const norm = (v: unknown) => String(v ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const first = (screen.children as NodeT[])[0];
  const bodyNodes = (doc.channel === 'mobile' && showShell && first?.type === 'Heading' && norm(text(String(first.text))) === norm(text(screen.title)))
    ? (screen.children as NodeT[]).slice(1) : (screen.children as NodeT[]);
  const body = <main className="db-screen" data-screen-id={screen.id} data-shell={screen.shell}>
    {doc.channel === 'portal' ? <header className="db-page-head">
      {canBack ? <button type="button" className="db-back" aria-label="Back" onClick={() => interactive && run([{ type: 'back' }])}><ArrowLeft size={18} /></button> : null}
      <div><h1>{text(screen.title)}</h1>{screen.subtitle ? <p>{text(screen.subtitle)}</p> : null}</div></header> : null}
    <div className="db-screen-body"><Nodes nodes={bodyNodes} /></div>
  </main>;

  return <RuntimeContext.Provider value={api}>
    <div className="db-app" data-channel={doc.channel} data-shell={showShell ? doc.shell.kind : 'none'} style={themeStyle(doc)}>
      {doc.channel === 'mobile' ? <>
        <header className="db-appbar" data-minimal={screen.shell === 'hidden'}>
          {canBack ? <button type="button" className="db-icon-btn" aria-label="Back" onClick={() => interactive && run([{ type: 'back' }])}><ArrowLeft size={20} /></button> : <span className="db-icon-btn" />}
          {/* Focused flows (welcome, sign-in) have no title bar text; the screen content carries the title. */}
          <div className="db-appbar-title">{screen.shell !== 'hidden' ? <strong>{text(screen.title)}</strong> : null}</div>
          {showShell && doc.shell.kind === 'drawer' ? <button type="button" className="db-icon-btn" aria-label="Menu" onClick={() => setDrawer(true)}><Menu size={20} /></button> : <span className="db-icon-btn" />}
        </header>
        {body}
        {showShell && doc.shell.kind === 'tabs' ? <nav className="db-tabs" aria-label="Main">{menuItems.map(it =>
          <button type="button" key={it.id} aria-current={active(it.screen) ? 'page' : undefined} onClick={() => go(it.screen)}><Icon name={it.icon} /><span>{it.label}</span></button>)}</nav> : null}
        {drawer ? <div className="db-drawer-scrim" onClick={() => setDrawer(false)}><nav className="db-drawer" aria-label="Menu" onClick={e => e.stopPropagation()}>
          <div className="db-drawer-head"><strong>{doc.shell.brand}</strong><button type="button" className="db-icon-btn" aria-label="Close menu" onClick={() => setDrawer(false)}><X size={18} /></button></div>
          {menuItems.map(it => <button type="button" key={it.id} aria-current={active(it.screen) ? 'page' : undefined} onClick={() => { setDrawer(false); go(it.screen); }}><Icon name={it.icon} />{it.label}</button>)}
        </nav></div> : null}
      </> : <>
        {showShell && doc.shell.kind === 'sidebar' ? <aside className="db-sidebar"><div className="db-brand">{doc.shell.brand}</div><nav aria-label="Main">
          {menuItems.map(it => <div key={it.id}>
            <button type="button" aria-current={active(it.screen) ? 'page' : undefined} onClick={() => go(it.screen)}><Icon name={it.icon} />{it.label}</button>
            {it.children?.map(c => <button type="button" key={c.id} className="db-sub" aria-current={active(c.screen) ? 'page' : undefined} onClick={() => go(c.screen)}>{c.label}</button>)}
          </div>)}</nav></aside> : null}
        {body}
      </>}
      {session.busy ? <div className="db-busy" role="status"><span className="db-spinner" />{session.busy}</div> : null}
      {asking ? <div className="db-confirm-scrim"><div className="db-confirm" role="alertdialog" aria-modal="true" aria-label={asking.title}>
        <strong>{asking.title}</strong>{asking.message ? <p>{asking.message}</p> : null}
        <div className="db-confirm-actions"><button type="button" className="db-button" data-variant="secondary" onClick={() => asking.answer(false)}>Cancel</button>
          <button type="button" className="db-button" data-variant="primary" autoFocus onClick={() => asking.answer(true)}>{asking.confirmLabel}</button></div>
      </div></div> : null}
      <div className="db-toasts" aria-live="polite">{session.toasts.map(t => <div key={t.id} className="db-toast" data-tone={t.tone}>{t.message}</div>)}</div>
    </div>
  </RuntimeContext.Provider>;
}
