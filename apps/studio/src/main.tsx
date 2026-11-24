import React, { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AlertTriangle, CheckCircle2, Download, FolderOpen, Monitor, Plus, Smartphone, Sparkles, Upload, XCircle } from 'lucide-react';
import { GeneratePanel } from './GeneratePanel.tsx';
import { ErrorBoundary } from './ErrorBoundary.tsx';
import { DemoRuntime, type Session } from '@demo/runtime';
import '@demo/runtime/runtime.css';
import { validateDocument, migrateV1, DemoDocument, type Issue, type MigrationNote } from '@demo/schema';
import kapiko from '../../../packages/schema/fixtures/kapiko-mobile.json';
import portal from '../../../packages/schema/fixtures/staff-portal.json';
import './studio.css';

const samples: Record<string, DemoDocument> = { kapiko: kapiko as DemoDocument, portal: portal as DemoDocument };
const params = new URLSearchParams(location.search);

function Studio() {
  // No sample is loaded by default: the studio opens on "Create a new demo" (examples are optional).
  const [doc, setDoc] = useState<DemoDocument | null>(samples[params.get('doc') ?? ''] ?? null);
  const [screenId, setScreenId] = useState(params.get('screen') ?? doc?.screens[0].id ?? '');
  const [channel, setChannel] = useState<'mobile' | 'portal'>(params.get('channel') === 'portal' ? 'portal' : 'mobile');
  const [resume, setResume] = useState<string | undefined>();
  const [runKey, setRunKey] = useState(0);
  const [notes, setNotes] = useState<MigrationNote[]>([]);
  const [importError, setImportError] = useState('');
  const [genOpen, setGenOpen] = useState(params.get('generate') === '1');
  const issues = useMemo<Issue[]>(() => (doc ? validateDocument(doc) : []), [doc]);
  const errors = issues.filter(i => i.severity === 'error'), warnings = issues.filter(i => i.severity === 'warning');

  const load = (d: DemoDocument, n: MigrationNote[] = []) => { setDoc(d); setScreenId(d.screens[0].id); setNotes(n); setImportError(''); setRunKey(k => k + 1); };
  const importFile = async (file: File) => {
    try {
      const json = JSON.parse(await file.text());
      if (json.schemaVersion === 1) { const r = migrateV1(json); load(r.document, r.notes); }
      else if (json.schemaVersion === 2) { const parsed = DemoDocument.safeParse(json); if (!parsed.success) throw Error('Not a valid v2 document: ' + parsed.error.issues[0]?.message); load(parsed.data); }
      else throw Error('Unsupported file: expected a Demo Builder export (schemaVersion 1 or 2).');
    } catch (e) { setImportError(e instanceof Error ? e.message : 'Import failed'); }
  };
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
        <button type="button" onClick={() => { setDoc(null); setNotes([]); }}><Plus size={15} />New demo</button>
        <button type="button" onClick={download}><Download size={15} />Download JSON</button>
        {importInput}
      </div>
      {importError ? <p className="studio-error" role="alert">{importError}</p> : null}
      <label className="studio-label">Screens · {doc.screens.length}</label>
      <ol className="studio-screens">{doc.screens.map((s, i) => {
        const n = issues.filter(x => x.screenId === s.id);
        return <li key={s.id}><button type="button" aria-current={s.id === screenId ? 'page' : undefined} onClick={() => setScreenId(s.id)}>
          <span className="studio-num">{String(i + 1).padStart(2, '0')}</span><span className="studio-title">{s.title}</span>
          {n.some(x => x.severity === 'error') ? <XCircle size={14} className="bad" /> : n.length ? <AlertTriangle size={14} className="warn" /> : null}
        </button></li>;
      })}</ol>
      <label className="studio-label">Validation</label>
      <div className="studio-validation" data-testid="validation">
        {errors.length === 0 ? <p className="ok"><CheckCircle2 size={15} /> No errors{warnings.length ? ' · ' + warnings.length + ' warning' + (warnings.length > 1 ? 's' : '') : ''}</p> : <p className="bad"><XCircle size={15} /> {errors.length} error{errors.length > 1 ? 's' : ''}</p>}
        <ul>{issues.slice(0, 30).map((i, k) => <li key={k} data-severity={i.severity}><code>{i.code}</code> {i.message}</li>)}</ul>
        {notes.length ? <><p className="studio-label">Notes</p><ul>{notes.map((n, k) => <li key={k} data-severity="warning">{n.note}</li>)}</ul></> : null}
      </div>
      <button type="button" className="studio-restart" onClick={() => { setScreenId(doc.screens[0].id); setRunKey(k => k + 1); }}>Restart demo</button>
    </aside>
    {panel}
    <main className="studio-stage">
      <div className={'device device-' + doc.channel} data-testid="device">
        <DemoRuntime key={doc.id + runKey} doc={doc} screenId={screenId} onScreenChange={setScreenId}
          onSession={(s: Session) => { (window as any).__session = s; }} />
      </div>
    </main>
  </div>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><ErrorBoundary><Studio /></ErrorBoundary></React.StrictMode>);
