// AI generation flow: brief -> editable plan -> approve -> live per-screen progress -> load.
import React, { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Loader2, Plus, RefreshCw, Sparkles, Trash2, X, XCircle, AlertTriangle } from 'lucide-react';
import type { DemoDocument } from '@demo/schema';

const env = import.meta.env as Record<string, string | undefined>;
export const API = env.VITE_API_URL || (env.VITE_API_HOST ? 'https://' + env.VITE_API_HOST : 'http://localhost:8787');
type Status = { model: string; store: string; storage?: 'connected' | 'unavailable'; budget: { spentUsd: number; limitUsd: number } | null; maxScreensPerJob: number };
type JobSummary = { id: string; status: string; request: { name?: string; channel?: string }; cost_usd: number; created_at: string };
type PlanScreen = { id: string; title: string; purpose: string; requirement: string; template: string | null; links: string[]; shell: string; locked: boolean };
type Job = { id: string; status: string; plan: { screens: PlanScreen[]; notes?: string[] } | null; warnings: string[]; error: { category: string; message: string; traceId: string } | null; cost_usd: number; input_tokens: number; output_tokens: number; trace_id: string };
type ScreenRow = { screen_id: string; title: string; status: string; attempts: number; issues: { code?: string; message?: string }[] };
const DONE = ['completed', 'completed_with_warnings', 'failed', 'cancelled'];
const token = () => { try { return sessionStorage.getItem('db-access') ?? ''; } catch { return ''; } };

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(API + path, { ...init, headers: { 'content-type': 'application/json', 'x-builder-access': token(), ...(init.headers || {}) } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Error((body as any).error ?? 'Request failed (' + res.status + ')');
  return body as T;
}

export function GeneratePanel({ onLoad, onClose, defaultChannel, resumeJobId }: { onLoad: (d: DemoDocument, notes: string[]) => void; onClose: () => void; defaultChannel: 'mobile' | 'portal'; resumeJobId?: string }) {
  const [access, setAccess] = useState(token());
  const [form, setForm] = useState({ name: '', company: '', channel: defaultChannel as 'mobile' | 'portal', brief: '' });
  const [job, setJob] = useState<Job | null>(resumeJobId ? ({ id: resumeJobId, status: 'loading', plan: null, warnings: [], error: null, cost_usd: 0, input_tokens: 0, output_tokens: 0, trace_id: '' }) : null);
  const [status, setStatus] = useState<Status | null>(null);
  const [recent, setRecent] = useState<JobSummary[] | null>(null);
  const [apiError, setApiError] = useState('');
  const [screens, setScreens] = useState<ScreenRow[]>([]);
  const [plan, setPlan] = useState<PlanScreen[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const loaded = useRef('');

  useEffect(() => { try { sessionStorage.setItem('db-access', access); } catch { /* private mode */ } }, [access]);
  // API health, model, storage and monthly budget (public endpoint); recent jobs need the token.
  useEffect(() => {
    let stop = false;
    fetch(API + '/api/v2/status').then(r => r.json()).then(s => {
      if (stop) return;
      // Older API builds report storage failures as budget: {error}; treat both shapes the same.
      const storageDown = s?.storage === 'unavailable' || (s?.budget && typeof s.budget.spentUsd !== 'number');
      setStatus({ ...s, storage: storageDown ? 'unavailable' : 'connected', budget: storageDown ? null : s.budget }); setApiError('');
    })
      .catch(() => { if (!stop) setStatus(null); if (!stop) setApiError('Cannot reach the generation API at ' + API + '. On the free plan it may take up to a minute to wake up; try again shortly.'); });
    return () => { stop = true; };
  }, [job?.status]);
  useEffect(() => {
    if (!access || job) return;
    let stop = false;
    call<{ jobs: JobSummary[] }>('/api/v2/jobs?limit=8').then(r => { if (!stop) setRecent(r.jobs); }).catch(() => { if (!stop) setRecent(null); });
    return () => { stop = true; };
  }, [access, job]);
  // One polling loop per user action (start, approve, retry, regenerate); it ends when the job
  // waits for plan approval or reaches a final state.
  const [poll, setPoll] = useState(0);
  const jobId = job?.id;
  useEffect(() => {
    if (!jobId) return;
    let stop = false, timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const snap = await call<{ job: Job; screens: ScreenRow[] }>('/api/v2/jobs/' + jobId);
        if (stop) return;
        setJob(snap.job); setScreens(snap.screens);
        if (snap.job.status === 'awaiting_plan_approval') { if (snap.job.plan) setPlan(p => (p.length ? p : snap.job.plan!.screens)); return; }
        if (['completed', 'completed_with_warnings'].includes(snap.job.status)) {
          const key = jobId + ':' + snap.screens.map(s => s.attempts).join();
          if (loaded.current !== key) { loaded.current = key; onLoad(await call<DemoDocument>('/api/v2/jobs/' + jobId + '/document'), snap.job.warnings); }
          return;
        }
        if (!DONE.includes(snap.job.status)) timer = setTimeout(tick, 1200);
      } catch (e) { if (!stop) setError(e instanceof Error ? e.message : 'Lost contact with the API'); }
    };
    void tick();
    return () => { stop = true; if (timer) clearTimeout(timer); };
  }, [jobId, poll]);

  const run = async (fn: () => Promise<unknown>) => { setBusy(true); setError(''); try { await fn(); setPoll(n => n + 1); } catch (e) { setError(e instanceof Error ? e.message : 'Failed'); } finally { setBusy(false); } };
  const start = () => run(async () => { setPlan([]); setScreens([]); setJob(await call<Job>('/api/v2/jobs', { method: 'POST', body: JSON.stringify({ request: { name: form.name || 'Demo', company: form.company, channel: form.channel }, brief: form.brief }) })); });
  const cancel = () => run(async () => { setJob(await call<Job>('/api/v2/jobs/' + job!.id + '/cancel', { method: 'POST', body: '{}' })); });
  const addScreen = () => setPlan(p => {
    const used = new Set(p.map(s => s.id)); let id = 'new-screen', n = 2; while (used.has(id)) id = 'new-screen-' + n++;
    return [...p, { id, title: 'New screen', purpose: 'Describe what this screen shows and what the user can do.', requirement: '', template: null, links: [], shell: 'default', locked: false }];
  });
  const approve = () => run(async () => { setJob(await call<Job>('/api/v2/jobs/' + job!.id + '/approve', { method: 'POST', body: JSON.stringify({ plan: { ...job!.plan, screens: plan } }) })); });
  const retry = () => run(async () => { await call('/api/v2/jobs/' + job!.id + '/retry', { method: 'POST', body: '{}' }); setJob({ ...job!, status: 'generating' }); });
  const regenerate = (id: string) => run(async () => { await call('/api/v2/jobs/' + job!.id + '/screens/' + id + '/regenerate', { method: 'POST', body: '{}' }); setJob({ ...job!, status: 'generating' }); });
  const editPlan = (i: number, patch: Partial<PlanScreen>) => setPlan(p => p.map((s, k) => (k === i ? { ...s, ...patch } : s)));
  const icon = (s: string) => s === 'valid' || s === 'repaired' ? <CheckCircle2 size={15} className="ok" /> : s === 'fallback' ? <AlertTriangle size={15} className="warn" /> : s === 'failed' ? <XCircle size={15} className="bad" /> : s === 'running' ? <Loader2 size={15} className="spin" /> : <span className="dot" />;

  return <div className="gen-scrim" role="dialog" aria-modal="true" aria-label="Generate with AI">
    <section className="gen-panel">
      <header><h2><Sparkles size={18} /> Generate with AI</h2><button type="button" className="gen-x" aria-label="Close" onClick={onClose}><X size={18} /></button></header>
      {!job || ['failed', 'cancelled'].includes(job.status) && !job.plan ? <div className="gen-body">
        <p className="gen-note gen-api" data-testid="api-status">{apiError ? <span className="bad">{apiError}</span> : status?.storage === 'unavailable' ? <span className="bad">The API is running but its storage is not connected, so generations cannot be saved. Ask the administrator to check SUPABASE_SECRET_KEY.</span> : status ? <>Connected · model {status.model} · storage {status.store}{typeof status.budget?.spentUsd === 'number' ? ' · AI spend this month USD ' + status.budget.spentUsd.toFixed(2) + ' of ' + status.budget.limitUsd : ''}</> : 'Connecting to the generation API…'}</p>
        <label>Access token<input type="password" value={access} onChange={e => setAccess(e.target.value)} placeholder="Demo Builder access token" autoComplete="off" /></label>
        <div className="gen-row"><label>Project name<input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></label>
          <label>Company<input value={form.company} onChange={e => setForm({ ...form, company: e.target.value })} /></label>
          <label>Channel<select value={form.channel} onChange={e => setForm({ ...form, channel: e.target.value as 'mobile' | 'portal' })}><option value="mobile">Mobile app</option><option value="portal">Staff portal</option></select></label></div>
        <label>Business requirements<textarea rows={12} value={form.brief} onChange={e => setForm({ ...form, brief: e.target.value })} placeholder={'Describe the app. Numbered screens are kept exactly, e.g.\n1. **Welcome:** brand, Sign In and Create Account\n2. **Sign In:** ...'} /></label>
        <p className="gen-note">Step 1 drafts a plan you can edit (about a cent). Nothing is generated until you approve it.</p>
        <button type="button" className="gen-primary" disabled={busy || !access || form.brief.trim().length < 15} onClick={start}>{busy ? 'Starting…' : 'Draft plan'}</button>
        {recent?.length ? <div className="gen-recent"><p className="studio-label">Recent generations</p><ul>{recent.map(j => <li key={j.id}>
          <span>{j.request?.name || 'Untitled'} <small>{j.request?.channel} · {j.status.replace(/_/g, ' ')} · USD {Number(j.cost_usd).toFixed(3)} · {new Date(j.created_at).toLocaleString()}</small></span>
          <button type="button" onClick={() => { setPlan([]); setScreens([]); setJob({ id: j.id, status: 'loading', plan: null, warnings: [], error: null, cost_usd: 0, input_tokens: 0, output_tokens: 0, trace_id: '' }); }}>Open</button></li>)}</ul></div> : null}
      </div> : null}
      {job?.status === 'planning' || job?.status === 'loading' ? <div className="gen-body gen-center"><Loader2 className="spin" size={22} /> {job.status === 'loading' ? 'Loading generation…' : 'Drafting the screen plan…'}</div> : null}
      {job?.status === 'awaiting_plan_approval' ? <div className="gen-body">
        <p className="gen-note">{plan.length} screens. Edit titles and descriptions or remove screens, then approve. {job.plan?.notes?.length ? job.plan.notes.join(' · ') : ''}</p>
        <ol className="gen-plan">{plan.map((s, i) => <li key={s.id}>
          <span className="gen-num">{i + 1}</span>
          <div><input aria-label={'Title of screen ' + (i + 1)} value={s.title} onChange={e => editPlan(i, { title: e.target.value })} />
            <textarea aria-label={'Description of screen ' + (i + 1)} rows={2} value={s.purpose} onChange={e => editPlan(i, { purpose: e.target.value })} />
            {s.template ? <small>Template: {s.template}</small> : null}</div>
          <button type="button" className="gen-icon" aria-label={'Remove ' + s.title} disabled={plan.length < 2} onClick={() => setPlan(p => p.filter((_, k) => k !== i))}><Trash2 size={15} /></button>
        </li>)}</ol>
        <button type="button" className="gen-secondary" onClick={addScreen}><Plus size={15} /> Add screen</button>
        <button type="button" className="gen-primary" disabled={busy || plan.some(s => !s.title.trim())} onClick={approve}>Approve and generate {plan.length} screens</button>
        <button type="button" className="gen-link" disabled={busy} onClick={cancel}>Discard this plan</button>
      </div> : null}
      {job && ['generating', 'linking', 'completed', 'completed_with_warnings', 'failed', 'cancelled'].includes(job.status) && job.plan ? <div className="gen-body">
        <p className="gen-status" data-status={job.status}>{({ generating: 'Generating screens…', linking: 'Connecting screens…', completed: 'Done: all screens generated and validated.', completed_with_warnings: 'Done with warnings: review the items below.', failed: 'Generation stopped.', cancelled: 'Cancelled.' } as Record<string, string>)[job.status]}
          <span> · {(job.input_tokens + job.output_tokens).toLocaleString()} tokens · USD {Number(job.cost_usd).toFixed(3)}</span></p>
        {job.error ? <p className="studio-error" role="alert">{job.error.message} <code>{job.error.traceId}</code></p> : null}
        <ul className="gen-progress">{screens.map(s => <li key={s.screen_id} data-status={s.status}>{icon(s.status)}<span>{s.title}</span><small>{s.status}</small>
          {DONE.includes(job.status) ? <button type="button" className="gen-icon" aria-label={'Regenerate ' + s.title} title="Regenerate this screen" disabled={busy} onClick={() => regenerate(s.screen_id)}><RefreshCw size={14} /></button> : null}</li>)}</ul>
        {job.warnings?.length ? <details><summary>{job.warnings.length} notes</summary><ul className="gen-warnings">{job.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></details> : null}
        <div className="gen-actions">
          {['completed_with_warnings', 'failed'].includes(job.status) ? <button type="button" disabled={busy} onClick={retry}>Retry failed screens</button> : null}
          {['generating', 'linking'].includes(job.status) ? <button type="button" disabled={busy} onClick={cancel}>Cancel</button> : null}
          {DONE.includes(job.status) ? <button type="button" onClick={() => { setJob(null); setPlan([]); setScreens([]); }}>New generation</button> : null}
        </div>
      </div> : null}
      {error ? <p className="studio-error" role="alert">{error}</p> : null}
    </section>
  </div>;
}
