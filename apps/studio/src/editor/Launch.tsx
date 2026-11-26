// Opening Demo Builder from MEYON: exchange the one-time launch code, show what was sent for confirmation,
// then continue in the Studio (Create: plan review; Extend: the base demo).
import React, { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, FileText, Layers, Loader2, Lock, Monitor, Smartphone, Sparkles, XCircle } from 'lucide-react';
import { meyonSession, setMeyonSession } from '../account.ts';
import { launchApi, type ConfirmResult, type LaunchView } from './demosApi.ts';

export type LaunchContext = { launch: LaunchView; result: ConfirmResult };

/** The launch code arrives in the URL fragment (never sent to servers or logged); it is removed immediately. */
export function takeLaunchCode(): string | null {
  const m = /(?:^#|&)launch=([A-Za-z0-9_-]{32,128})/.exec(location.hash);
  if (!/launch=/.test(location.hash)) return null;
  history.replaceState(null, '', location.pathname + location.search);
  return m ? m[1] : '';
}
// A code works once: React's development double-render must not exchange it twice.
const exchanges = new Map<string, ReturnType<typeof launchApi.exchange>>();
const typeLabel = (c: 'mobile' | 'portal') => (c === 'mobile' ? 'Mobile App' : 'Staff Portal');

type Phase = { kind: 'loading'; text: string } | { kind: 'error'; text: string } | { kind: 'confirm'; launch: LaunchView } | { kind: 'cancelled' };

export function LaunchGate({ code, render }: { code: string | null; render: (ctx: LaunchContext | null) => React.ReactElement }) {
  const [phase, setPhase] = useState<Phase | null>(code !== null || meyonSession() ? { kind: 'loading', text: 'Opening from MEYON…' } : null);
  const [ctx, setCtx] = useState<LaunchContext | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');

  useEffect(() => {
    if (code === null && !meyonSession()) return;
    let stop = false;
    (async () => {
      try {
        if (code !== null) {
          if (!code) throw Error('This launch link is not valid. Open Demo Builder again from MEYON.');
          if (!exchanges.has(code)) exchanges.set(code, launchApi.exchange(code));
          const s = await exchanges.get(code)!;
          setMeyonSession(s);
        }
        const id = meyonSession()!.launchId;
        const launch = await launchApi.get(id);
        if (stop) return;
        if (launch.status === 'cancelled') setPhase({ kind: 'cancelled' });
        else if (launch.status === 'confirmed') { setCtx({ launch, result: { mode: launch.mode, jobId: launch.jobId, demoId: launch.demoId, already: true } }); setPhase(null); }
        else setPhase({ kind: 'confirm', launch });
      } catch (e) {
        if (stop) return;
        if ((e as { status?: number }).status === 401) setMeyonSession(null);
        setPhase({ kind: 'error', text: e instanceof Error ? e.message : String(e) });
      }
    })();
    return () => { stop = true; };
  }, [code]);

  if (!phase) return render(ctx);
  if (phase.kind === 'loading') return <div className="launch-page"><p className="launch-loading"><Loader2 className="spin" size={20} />{phase.text}</p></div>;
  if (phase.kind === 'error') return <div className="launch-page"><section className="launch-card" role="alert" data-testid="launch-error"><h1><XCircle size={20} className="bad" />Demo Builder could not open this launch</h1><p>{phase.text}</p>
    <p className="muted">Launch links work once and expire after 5 minutes. Return to MEYON and choose <strong>Open Demo Builder</strong> again.</p></section></div>;
  if (phase.kind === 'cancelled') return <div className="launch-page"><section className="launch-card" data-testid="launch-cancelled"><h1>Launch cancelled</h1><p>Nothing was created. You can close this tab and return to MEYON.</p></section></div>;

  const l = phase.launch, base = l.base, check = base?.check;
  const blocked = l.mode === 'extend' && !check?.ok;
  const act = async (fn: () => Promise<void>) => { setBusy(true); setError(''); try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } };
  const confirm = () => act(async () => { const result = await launchApi.confirm(l.id); setCtx({ launch: { ...l, status: 'confirmed', jobId: result.jobId ?? null, demoId: result.demoId ?? l.demoId }, result }); setPhase(null); });
  const cancel = () => act(async () => { await launchApi.cancel(l.id); setMeyonSession(null); setPhase({ kind: 'cancelled' }); });

  return <div className="launch-page">
    <section className="launch-card" data-testid="launch-confirm" aria-labelledby="launch-title">
      <p className="launch-eyebrow">Opened from MEYON · {l.tenant.name}</p>
      <h1 id="launch-title">{l.mode === 'create' ? 'Create a new demo for this story' : 'Extend an existing demo with this story'}</h1>
      <dl className="launch-facts">
        <dt>Project</dt><dd>{l.project.name} <span className="muted">{l.project.id}</span></dd>
        <dt>Application</dt><dd>{l.channel === 'mobile' ? <Smartphone size={14} /> : <Monitor size={14} />}{typeLabel(l.channel)}</dd>
        <dt>User story</dt><dd><strong>{l.story.id}</strong> · {l.story.title} <span className="muted">version {l.story.artifactVersion}</span></dd>
        {l.feature ? <><dt>Feature</dt><dd>{l.feature.name} <span className="muted">{l.feature.id}</span></dd></> : null}
        <dt>Launched by</dt><dd>{l.actor.name}{l.actor.verified ? '' : <span className="muted"> (shared MEYON login, not an individual identity)</span>}</dd>
        {base ? <><dt>Base demo</dt><dd data-testid="launch-base">{check?.ok ? <><Layers size={14} /><strong>{check.name}</strong> · version {check.version}
          {check.newerExists ? <span className="launch-warn"><AlertTriangle size={13} />A newer version (v{check.latestVersion}) exists. This launch uses v{check.version}, as chosen in MEYON.</span> : null}</>
          : <span className="bad"><XCircle size={13} />{check?.problem ?? 'Not available'}</span>}</dd></> : null}
      </dl>

      <h2><Lock size={15} />Approved acceptance criteria <span className="muted">must be demonstrated</span></h2>
      <ol className="launch-criteria" data-testid="launch-criteria">{l.approved.acceptanceCriteria.map(c => <li key={c.id}>{c.text} <code>{c.id}</code></li>)}</ol>
      {l.approved.businessRules.length ? <><h2><Lock size={15} />Approved business rules</h2><ul className="launch-list">{l.approved.businessRules.map(r => <li key={r.id}>{r.text} <code>{r.id}</code></li>)}</ul></> : null}
      {l.approved.actors.length || l.approved.integrations.length ? <p className="launch-meta">{l.approved.actors.length ? <>Actors: {l.approved.actors.join(', ')}. </> : null}
        {l.approved.integrations.length ? <>Simulated integrations (never real): {l.approved.integrations.join(', ')}.</> : null}</p> : null}
      {l.suggestions.length ? <details className="launch-suggestions"><summary><Sparkles size={14} />{l.suggestions.length} optional AI suggestion{l.suggestions.length > 1 ? 's' : ''} (not approved requirements)</summary>
        <ul className="launch-list">{l.suggestions.map((s, i) => <li key={i}>{s}</li>)}</ul></details> : null}
      <details className="launch-prompt" open><summary><FileText size={14} />Prompt reviewed in MEYON (revision {l.prompt.revision})</summary><pre>{l.prompt.text}</pre></details>
      <details className="launch-sources"><summary>Sources</summary><ul>{l.sources.map((s, i) => <li key={i}>{s.kind} {s.ref} · version {s.version} · <code>{s.hash.slice(0, 12)}</code></li>)}</ul></details>

      <p className="launch-next">{l.mode === 'create'
        ? <><CheckCircle2 size={14} />Next: AI drafts a screen plan from this story. You review and approve it before any screen is generated.</>
        : <><CheckCircle2 size={14} />Next: the base demo opens in the editor with this story's coverage. Saving creates a new version; published versions stay unchanged.</>}</p>
      {error ? <p className="studio-error" role="alert">{error}</p> : null}
      <div className="launch-actions">
        <button type="button" className="gen-primary" data-testid="launch-go" disabled={busy || blocked} onClick={confirm}>{busy ? 'Working…' : l.mode === 'create' ? 'Confirm and draft the screen plan' : 'Confirm and open the base demo'}</button>
        <button type="button" className="gen-link" data-testid="launch-cancel" disabled={busy} onClick={cancel}>Cancel</button>
      </div>
    </section>
  </div>;
}
