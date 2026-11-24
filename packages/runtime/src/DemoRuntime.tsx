import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type LucideIcon, ArrowLeft, BarChart3, Bell, Check, Circle, CreditCard, FileText, Folder, Home, LayoutDashboard, List as ListIcon, Menu, Settings, User, X } from 'lucide-react';
import { resolveText, type Action, type DemoDocument, type NodeT } from '@demo/schema';
import { createSession, dismissToast, openRecord as openRecordFn, runActions, setField as setFieldFn, type Session } from './engine.ts';
import { Nodes, RuntimeContext, type RuntimeApi } from './nodes.tsx';

const icons: Record<string, LucideIcon> = {
  home: Home, list: ListIcon, user: User, 'layout-dashboard': LayoutDashboard, folder: Folder, check: Check, 'bar-chart': BarChart3,
  settings: Settings, bell: Bell, 'credit-card': CreditCard, file: FileText, circle: Circle,
};
const Icon = ({ name }: { name: string }) => { const C = icons[name] ?? Circle; return <C size={18} />; };

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
  const font = { system: 'system-ui, -apple-system, "Segoe UI", sans-serif', inter: 'Inter, system-ui, sans-serif', serif: 'Georgia, "Times New Roman", serif' }[doc.theme.font];
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
  const run = useCallback((actions: Action[], formId?: string) => {
    if (running.current) return; // one action chain at a time
    running.current = true;
    void runActions(doc, latest.current, actions, { formId, onUpdate: next => { latest.current = next; setSession(next); } })
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

  const screen = doc.screens.find(s => s.id === session.screenId) ?? doc.screens[0];
  const text = (t: string) => resolveText(t, { state: session.state, record: session.record?.row ?? null, params: {} });
  const showShell = screen.shell !== 'hidden' && doc.shell.kind !== 'none';
  const canBack = doc.shell.showBack && session.history.length > 0;
  const go = (target: string) => interactive && run([{ type: 'navigate', screen: target }]);
  const [drawer, setDrawer] = useState(false);
  const menuItems = doc.shell.items;
  const active = (id: string) => id === screen.id;

  const body = <main className="db-screen" data-screen-id={screen.id}>
    {doc.channel === 'portal' ? <header className="db-page-head">
      {canBack ? <button type="button" className="db-back" aria-label="Back" onClick={() => interactive && run([{ type: 'back' }])}><ArrowLeft size={18} /></button> : null}
      <div><h1>{text(screen.title)}</h1>{screen.subtitle ? <p>{text(screen.subtitle)}</p> : null}</div></header> : null}
    <div className="db-screen-body"><Nodes nodes={screen.children as NodeT[]} /></div>
  </main>;

  return <RuntimeContext.Provider value={api}>
    <div className="db-app" data-channel={doc.channel} data-shell={showShell ? doc.shell.kind : 'none'} style={themeStyle(doc)}>
      {doc.channel === 'mobile' ? <>
        <header className="db-appbar">
          {canBack ? <button type="button" className="db-icon-btn" aria-label="Back" onClick={() => interactive && run([{ type: 'back' }])}><ArrowLeft size={20} /></button> : <span className="db-icon-btn" />}
          <div className="db-appbar-title"><strong>{text(screen.title)}</strong>{screen.subtitle ? <small>{text(screen.subtitle)}</small> : null}</div>
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
      <div className="db-toasts" aria-live="polite">{session.toasts.map(t => <div key={t.id} className="db-toast" data-tone={t.tone}>{t.message}</div>)}</div>
    </div>
  </RuntimeContext.Provider>;
}
