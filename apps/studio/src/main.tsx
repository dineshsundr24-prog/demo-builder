import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AlertTriangle, CheckCircle2, Download, ExternalLink, Eye, FolderOpen, History, Monitor, MousePointer2, Plus, Redo2, Smartphone, Sparkles, Undo2, Upload, XCircle } from 'lucide-react';
import { GeneratePanel } from './GeneratePanel.tsx';
import { ErrorBoundary } from './ErrorBoundary.tsx';
import { BrandFields } from './BrandFields.tsx';
import { DemoRuntime, type Session } from '@demo/runtime';
import '@demo/runtime/runtime.css';
import { validateDocument, migrateV1, DemoDocument, findNode, isContainer, insertNode, moveNode, removeNode, duplicateNode, updateNode, renameNode, nudgeNode, allIds, detachTemplate, addScreen, updateScreen, duplicateScreen, moveScreen, removeScreen, type Issue, type MigrationNote, type NodeT } from '@demo/schema';
import { useHistory, saveLocal, loadLocal, DRAFT_KEY, PRESENT_KEY } from './editor/history.ts';
import { EditorPanel } from './editor/EditorPanel.tsx';
import { Present } from './editor/Present.tsx';
import { AssistPanel, type AssistOutcome } from './editor/AssistPanel.tsx';
import kapiko from '../../../packages/schema/fixtures/kapiko-mobile.json';
import portal from '../../../packages/schema/fixtures/staff-portal.json';
import './studio.css';

const samples: Record<string, DemoDocument> = { kapiko: kapiko as DemoDocument, portal: portal as DemoDocument };
const params = new URLSearchParams(location.search);

function Studio() {
  // No sample is loaded by default: the studio opens on "Create a new demo" (examples are optional).
  const history = useHistory(samples[params.get('doc') ?? ''] ?? null);
  const doc = history.doc;
  const [screenId, setScreenId] = useState(params.get('screen') ?? doc?.screens[0].id ?? '');
  const [channel, setChannel] = useState<'mobile' | 'portal'>(params.get('channel') === 'portal' ? 'portal' : 'mobile');
  const [resume, setResume] = useState<string | undefined>();
  const [runKey, setRunKey] = useState(0);
  const [notes, setNotes] = useState<MigrationNote[]>([]);
  const [importError, setImportError] = useState('');
  const [genOpen, setGenOpen] = useState(params.get('generate') === '1');
  const [mode, setMode] = useState<'preview' | 'edit'>(params.get('mode') === 'edit' ? 'edit' : 'preview');
  const [selected, setSelected] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [editError, setEditError] = useState('');
  const [draft] = useState(() => (params.get('doc') ? null : loadLocal(DRAFT_KEY)));
  const presenting = useRef(false);
  const [assist, setAssist] = useState<null | { mode: 'auto' | 'modify' | 'add' }>(null);
  const [review, setReview] = useState<null | (AssistOutcome & { previousScreen: string })>(null);
  // Portals render at desktop width (1280px) and are scaled to fit the stage, never squeezed.
  const stageRef = useRef<HTMLElement | null>(null);
  const [stage, setStage] = useState({ w: 1280, h: 800 });
  useEffect(() => {
    const el = stageRef.current; if (!el) return;
    const ro = new ResizeObserver(([e]) => setStage({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el); return () => ro.disconnect();
  });
  const issues = useMemo<Issue[]>(() => (doc ? validateDocument(doc) : []), [doc]);
  const errors = issues.filter(i => i.severity === 'error'), warnings = issues.filter(i => i.severity === 'warning');
  const screen = doc?.screens.find(s => s.id === screenId) ?? doc?.screens[0];

  // Keep a local draft (survives reloads) and feed the presenter window.
  useEffect(() => { if (!doc) return; const t = setTimeout(() => { saveLocal(DRAFT_KEY, doc); if (presenting.current) saveLocal(PRESENT_KEY, doc); }, 300); return () => clearTimeout(t); }, [doc]);
  useEffect(() => { if (selected && screen && !findNode(screen.children as NodeT[], selected)) setSelected(null); }, [screen, selected]);

  const load = (d: DemoDocument, n: MigrationNote[] = []) => { history.reset(d); setScreenId(d.screens[0].id); setNotes(n); setImportError(''); setSelected(null); setRunKey(k => k + 1); };
  const importFile = async (file: File) => {
    try {
      const json = JSON.parse(await file.text());
      if (json.schemaVersion === 1) { const r = migrateV1(json); load(r.document, r.notes); }
      else if (json.schemaVersion === 2) { const parsed = DemoDocument.safeParse(json); if (!parsed.success) throw Error('Not a valid v2 document: ' + parsed.error.issues[0]?.message); load(parsed.data); }
      else throw Error('Unsupported file: expected a Demo Builder export (schemaVersion 1 or 2).');
    } catch (e) { setImportError(e instanceof Error ? e.message : 'Import failed'); }
  };
  /** Apply an edit through the history; a refused operation (e.g. form inside form) is reported, not thrown. */
  const edit = useCallback((fn: (d: DemoDocument) => DemoDocument | { doc: DemoDocument; id: string }, key?: string) => {
    if (!history.doc) return;
    try { const r = fn(history.doc); if ('screens' in r) history.commit(r, key); else { history.commit(r.doc, key); setSelected(r.id); } setEditError(''); }
    catch (e) { setEditError(e instanceof Error ? e.message : String(e)); }
  }, [history]);
  const sid = screen?.id ?? '';
  const insertAt = (type: string, to?: { parentId: string | null; index: number }) => edit(d => {
    if (to) return insertNode(d, sid, to.parentId, to.index, type);
    const s = d.screens.find(x => x.id === sid)!, loc = selected ? findNode(s.children as NodeT[], selected) : null;
    if (loc && isContainer(loc.node.type) && !(type === 'Form' && loc.node.type === 'Form')) return insertNode(d, sid, loc.node.id, ((loc.node.children as NodeT[]) ?? []).length, type);
    if (loc) return insertNode(d, sid, loc.parentId, loc.index + 1, type);
    return insertNode(d, sid, null, s.children.length, type);
  });

  // Keyboard: undo/redo everywhere; delete/duplicate/escape for the selection (not while typing).
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target as HTMLElement)?.tagName ?? '') || (e.target as HTMLElement)?.isContentEditable;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z' && !typing) { e.preventDefault(); e.shiftKey ? history.redo() : history.undo(); return; }
      if (mod && e.key.toLowerCase() === 'y' && !typing) { e.preventDefault(); history.redo(); return; }
      if (mode !== 'edit' || typing || !selected) return;
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); edit(d => removeNode(d, sid, selected)); setSelected(null); }
      else if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); edit(d => duplicateNode(d, sid, selected)); }
      else if (e.key === 'Escape') setSelected(null);
    };
    addEventListener('keydown', on); return () => removeEventListener('keydown', on);
  }, [history, mode, selected, sid, edit]);

  /** In edit mode a click on the canvas selects the nearest component of this screen (template parts select the template). */
  const pick = (target: EventTarget | null): string | null => {
    if (!screen) return null;
    let el = (target as HTMLElement | null)?.closest?.('[data-node-id]') as HTMLElement | null;
    while (el) { const id = el.getAttribute('data-node-id')!; if (findNode(screen.children as NodeT[], id)) return id; el = el.parentElement?.closest('[data-node-id]') as HTMLElement | null; }
    return null;
  };
  const presentWindow = () => { if (!doc) return; presenting.current = true; saveLocal(PRESENT_KEY, doc); window.open(location.pathname + '?present=1', 'demo-present'); };
  const openGenerator = (c: 'mobile' | 'portal', jobId?: string) => { setChannel(c); setResume(jobId); setGenOpen(true); };
  const download = () => {
    if (!doc) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = (doc.id || 'demo') + '.json'; a.click(); URL.revokeObjectURL(url);
  };
  const panel = genOpen ? <GeneratePanel key={channel + (resume ?? '')} defaultChannel={channel} resumeJobId={resume} onClose={() => setGenOpen(false)} onLoad={(d, w) => load(d, w.map(note => ({ path: '', note })))} /> : null;
  const importInput = <label className="studio-import"><Upload size={15} />Import JSON (v1 or v2)<input type="file" accept="application/json,.json" onChange={e => e.target.files?.[0] && importFile(e.target.files[0])} /></label>;

  if (!doc) return <div className="studio-welcome">
    <main>
      <div className="studio-brand">MEYON Demo Builder <span>v2 preview</span></div>
      <h1>Create a new demo</h1>
      <p>Describe your business requirements; AI drafts a screen plan you can edit, then generates a clickable application.</p>
      <div className="welcome-cards">
        <button type="button" data-testid="new-mobile" onClick={() => openGenerator('mobile')}><Smartphone size={28} /><strong>Mobile application</strong><span>Customer-facing app: onboarding, accounts, service requests…</span></button>
        <button type="button" data-testid="new-portal" onClick={() => openGenerator('portal')}><Monitor size={28} /><strong>Staff portal</strong><span>Back-office web portal: dashboards, queues, reviews, reports…</span></button>
      </div>
      <div className="welcome-more">
        <button type="button" onClick={() => openGenerator('mobile')}><FolderOpen size={15} />Open a previous generation</button>
        {importInput}
      </div>
      {draft ? <button type="button" className="welcome-draft" data-testid="continue-draft" onClick={() => load(draft)}><History size={15} />Continue editing <strong>{draft.name}</strong></button> : null}
      {importError ? <p className="studio-error" role="alert">{importError}</p> : null}
      <details className="welcome-examples"><summary>Examples used during development</summary>
        {Object.entries(samples).map(([k, d]) => <button key={k} type="button" onClick={() => load(d)}>{d.channel === 'mobile' ? <Smartphone size={15} /> : <Monitor size={15} />}{d.name}</button>)}
      </details>
    </main>
    {panel}
  </div>;

  return <div className="studio">
    <aside className="studio-side">
      <div className="studio-brand">Demo Builder <span>v2 preview</span></div>
      <button type="button" className="studio-generate" onClick={() => openGenerator(doc.channel)}><Sparkles size={15} />Generate with AI</button>
      <label className="studio-label">Project</label>
      <div className="studio-projects">
        <p className="studio-current">{doc.channel === 'mobile' ? <Smartphone size={15} /> : <Monitor size={15} />}<strong>{doc.name}</strong></p>
        <button type="button" onClick={() => { history.reset(null); setNotes([]); setSelected(null); saveLocal(DRAFT_KEY, null); }}><Plus size={15} />New demo</button>
        <button type="button" onClick={download}><Download size={15} />Download JSON</button>
        <details className="studio-brand-edit"><summary>Brand</summary>
          <BrandFields compact value={{ logo: doc.theme.logo, primary: doc.theme.primary, secondary: doc.theme.secondary, accent: doc.theme.accent, font: doc.theme.font }}
            onChange={b => history.commit({ ...doc, theme: { ...doc.theme, primary: b.primary ?? doc.theme.primary, secondary: b.secondary ?? doc.theme.secondary, accent: b.accent ?? doc.theme.accent, font: b.font ?? doc.theme.font, ...(b.logo ? { logo: b.logo } : { logo: undefined }) } })} />
        </details>
        {importInput}
      </div>
      {importError ? <p className="studio-error" role="alert">{importError}</p> : null}
      <label className="studio-label">Screens · {doc.screens.length}</label>
      <ol className="studio-screens">{doc.screens.map((s, i) => {
        const n = issues.filter(x => x.screenId === s.id);
        return <li key={s.id}><button type="button" aria-current={s.id === screenId ? 'page' : undefined} onClick={() => { setScreenId(s.id); setSelected(null); }}>
          <span className="studio-num">{String(i + 1).padStart(2, '0')}</span><span className="studio-title">{s.title}</span>
          {n.some(x => x.severity === 'error') ? <XCircle size={14} className="bad" /> : n.length ? <AlertTriangle size={14} className="warn" /> : null}
        </button></li>;
      })}</ol>
      <button type="button" className="studio-add-screen" data-testid="add-screen" onClick={() => setAssist({ mode: 'add' })}><Plus size={14} />Add screen</button>
      <label className="studio-label">Validation</label>
      <div className="studio-validation" data-testid="validation">
        {errors.length === 0 ? <p className="ok"><CheckCircle2 size={15} /> No errors{warnings.length ? ' · ' + warnings.length + ' warning' + (warnings.length > 1 ? 's' : '') : ''}</p> : <p className="bad"><XCircle size={15} /> {errors.length} error{errors.length > 1 ? 's' : ''}</p>}
        <ul>{issues.slice(0, 30).map((i, k) => <li key={k} data-severity={i.severity}><code>{i.code}</code> {i.message}</li>)}</ul>
        {notes.length ? <><p className="studio-label">Notes</p><ul>{notes.map((n, k) => <li key={k} data-severity="warning">{n.note}</li>)}</ul></> : null}
      </div>
      <button type="button" className="studio-restart" onClick={() => { setScreenId(doc.screens[0].id); setRunKey(k => k + 1); }}>Restart demo</button>
    </aside>
    {panel}
    {assist && screen ? <AssistPanel doc={doc} currentScreen={screen.id} initialMode={assist.mode} onClose={() => setAssist(null)}
      onBlank={() => { setAssist(null); const title = prompt('Screen title', 'New screen'); if (title?.trim()) edit(d => { const r = addScreen(d, title.trim(), screen?.id); setScreenId(r.id); return r.doc; }); }}
      onDone={out => { const prev = screen.id; history.commit(out.document); setScreenId(out.screenId); setSelected(null); setRunKey(k => k + 1); setReview({ ...out, previousScreen: prev }); setAssist(null); }} /> : null}
    <main ref={stageRef} className={'studio-stage' + (mode === 'edit' ? ' is-editing' : '')}>
      <div className="stage-toolbar" role="toolbar" aria-label="Stage">
        <div className="seg" role="group" aria-label="Mode">
          <button type="button" aria-pressed={mode === 'preview'} onClick={() => { setMode('preview'); setSelected(null); }}><Eye size={14} />Preview</button>
          <button type="button" aria-pressed={mode === 'edit'} data-testid="mode-edit" onClick={() => setMode('edit')}><MousePointer2 size={14} />Edit</button>
        </div>
        <button type="button" title="Undo (Ctrl+Z)" aria-label="Undo" disabled={!history.canUndo} onClick={history.undo}><Undo2 size={15} /></button>
        <button type="button" title="Redo (Ctrl+Shift+Z)" aria-label="Redo" disabled={!history.canRedo} onClick={history.redo}><Redo2 size={15} /></button>
        <button type="button" className="ai-btn" data-testid="open-assist" onClick={() => setAssist({ mode: 'auto' })}><Sparkles size={14} />AI assistant</button>
        <span className="stage-spacer" />
        <button type="button" data-testid="open-window" onClick={presentWindow}><ExternalLink size={14} />Open in new window</button>
      </div>
      {editError ? <p className="studio-error stage-error" role="alert">{editError}</p> : null}
      {review ? <div className="assist-review" role="status" data-testid="assist-review">
        <div><strong><Sparkles size={14} /> {review.action === 'added' ? 'AI added "' + (doc.screens.find(x => x.id === review.screenId)?.title ?? review.screenId) + '"' : 'AI changed "' + (doc.screens.find(x => x.id === review.screenId)?.title ?? review.screenId) + '"'}</strong>
          <ul>{review.changes.map((c, i) => <li key={i}>{c}</li>)}</ul></div>
        <div className="assist-review-actions">
          <button type="button" onClick={() => setReview(null)}>Keep</button>
          <button type="button" data-testid="assist-undo" onClick={() => { history.undo(); setScreenId(review.previousScreen); setReview(null); }}>Undo</button>
        </div>
      </div> : null}
      {mode === 'edit' && screen && !screen.children.length && !review ? <div className="assist-empty"><p>This screen is empty.</p>
        <button type="button" className="ai-btn" onClick={() => setAssist({ mode: 'modify' })}><Sparkles size={14} />Build it with AI</button><span>or add components from the <strong>Add</strong> tab.</span></div> : null}
      <div className={'device device-' + doc.channel} data-testid="device"
        style={doc.channel === 'portal' ? ({ width: 1280, height: Math.max(560, (stage.h - 60) / Math.min(1, Math.max(0.45, stage.w / 1280))), zoom: Math.min(1, Math.max(0.45, stage.w / 1280)) } as React.CSSProperties) : undefined}
        onClickCapture={mode === 'edit' ? e => { const id = pick(e.target); e.preventDefault(); e.stopPropagation(); setSelected(id); } : undefined}
        onMouseOverCapture={mode === 'edit' ? e => setHover(pick(e.target)) : undefined} onMouseLeave={() => setHover(null)}>
        {mode === 'edit' ? <style>{(hover && hover !== selected ? '[data-testid="device"] [data-node-id="' + CSS.escape(hover) + '"]{outline:1px dashed #2563eb;outline-offset:2px;cursor:pointer}' : '')
          + (selected ? '[data-testid="device"] [data-node-id="' + CSS.escape(selected) + '"]{outline:2px solid #2563eb;outline-offset:2px;border-radius:4px}' : '')}</style> : null}
        <DemoRuntime key={doc.id + runKey} doc={doc} screenId={screenId} onScreenChange={setScreenId} interactive={mode === 'preview'}
          onSession={(s: Session) => { (window as any).__session = s; }} />
      </div>
    </main>
    {mode === 'edit' && screen ? <EditorPanel doc={doc} screen={screen} selected={selected} select={setSelected}
      updateNode={(id, patch) => edit(d => updateNode(d, sid, id, patch), 'node:' + id + ':' + Object.keys(patch).join(','))}
      renameNode={(id, next) => edit(d => { const r = renameNode(d, sid, id, next); const before = allIds(d.screens.find(x => x.id === sid)!.children as NodeT[]); const added = [...allIds(r.screens.find(x => x.id === sid)!.children as NodeT[])].find(x => !before.has(x)); if (added) setSelected(added); return r; })}
      insert={insertAt} detach={id => edit(d => detachTemplate(d, sid, id))} move={(id, to) => edit(d => moveNode(d, sid, id, to.parentId, to.index))}
      remove={id => { edit(d => removeNode(d, sid, id)); setSelected(null); }} duplicate={id => edit(d => duplicateNode(d, sid, id))} nudge={(id, dd) => edit(d => nudgeNode(d, sid, id, dd))}
      updateScreen={patch => edit(d => updateScreen(d, sid, patch), 'screen:' + sid + ':' + Object.keys(patch).join(','))}
      duplicateScreen={() => edit(d => { const r = duplicateScreen(d, sid); setScreenId(r.id); return r.doc; })}
      moveScreen={dd => edit(d => moveScreen(d, sid, dd))}
      removeScreen={() => { const i = doc.screens.findIndex(x => x.id === sid); edit(d => removeScreen(d, sid)); setScreenId(doc.screens[i === 0 ? 1 : i - 1].id); }} /> : null}
  </div>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><ErrorBoundary>{params.get('present') ? <Present /> : <Studio />}</ErrorBoundary></React.StrictMode>);
