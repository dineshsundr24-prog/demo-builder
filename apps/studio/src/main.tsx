import React, { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AlertTriangle, CheckCircle2, Monitor, Smartphone, Sparkles, Upload, XCircle } from 'lucide-react';
import { GeneratePanel } from './GeneratePanel.tsx';
import { DemoRuntime, type Session } from '@demo/runtime';
import '@demo/runtime/runtime.css';
import { validateDocument, migrateV1, DemoDocument, type Issue, type MigrationNote } from '@demo/schema';
import kapiko from '../../../packages/schema/fixtures/kapiko-mobile.json';
import portal from '../../../packages/schema/fixtures/staff-portal.json';
import './studio.css';

const samples: Record<string, DemoDocument> = { kapiko: kapiko as DemoDocument, portal: portal as DemoDocument };
const params = new URLSearchParams(location.search);

function Studio() {
  const [doc, setDoc] = useState<DemoDocument>(samples[params.get('doc') ?? 'kapiko'] ?? samples.kapiko);
  const [screenId, setScreenId] = useState(params.get('screen') ?? doc.screens[0].id);
  const [runKey, setRunKey] = useState(0);
  const [notes, setNotes] = useState<MigrationNote[]>([]);
  const [importError, setImportError] = useState('');
  const [genOpen, setGenOpen] = useState(params.get('generate') === '1');
  const issues = useMemo<Issue[]>(() => validateDocument(doc), [doc]);
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

  return <div className="studio">
    <aside className="studio-side">
      <div className="studio-brand">Demo Builder <span>v2 preview</span></div>
      <button type="button" className="studio-generate" onClick={() => setGenOpen(true)}><Sparkles size={15} />Generate with AI</button>
      <label className="studio-label">Project</label>
      <div className="studio-projects">
        {Object.entries(samples).map(([k, d]) => <button key={k} type="button" aria-pressed={doc.id === d.id} onClick={() => load(d)}>{d.channel === 'mobile' ? <Smartphone size={15} /> : <Monitor size={15} />}{d.name}</button>)}
        <label className="studio-import"><Upload size={15} />Import JSON (v1 or v2)<input type="file" accept="application/json,.json" onChange={e => e.target.files?.[0] && importFile(e.target.files[0])} /></label>
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
    {genOpen ? <GeneratePanel defaultChannel={doc.channel} onClose={() => setGenOpen(false)} onLoad={(d, w) => load(d, w.map(note => ({ path: '', note })))} /> : null}
    <main className="studio-stage">
      <div className={'device device-' + doc.channel} data-testid="device">
        <DemoRuntime key={doc.id + runKey} doc={doc} screenId={screenId} onScreenChange={setScreenId}
          onSession={(s: Session) => { (window as any).__session = s; }} />
      </div>
    </main>
  </div>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><Studio /></React.StrictMode>);
