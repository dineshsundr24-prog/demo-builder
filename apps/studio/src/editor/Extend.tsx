// EXTEND review dialog: propose a change plan against the exact base version, let the user choose what to apply,
// apply it (progress), and report the journey check and the new version. When the demo changed meanwhile, the
// user chooses: plan again on the latest version, apply to a copy of the planned version, or cancel.
import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, GitFork, Layers, Loader2, Minus, Pencil, Plus, RefreshCw, Sparkles, X, XCircle } from 'lucide-react';
import { extendApi, type ChangeItem, type Criterion, type ExtendTask, type PlanResponse } from './demosApi.ts';

type Phase = { kind: 'planning' } | { kind: 'review' } | { kind: 'applying'; task: ExtendTask | null } | { kind: 'done'; task: ExtendTask } | { kind: 'conflict'; message: string; latest: number } | { kind: 'error'; message: string };

export function ExtendDialog({ launchId, story, criteria, onClose, onDone }: {
  launchId: string; story: { id: string; title: string }; criteria: Criterion[];
  onClose: () => void; onDone: (demoId: string) => void;
}) {
  const [phase, setPhase] = useState<Phase>({ kind: 'planning' });
  const [res, setRes] = useState<PlanResponse | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [cost, setCost] = useState(0);
  const lastBase = useRef<'latest' | undefined>(undefined);
  const stop = useRef(false);
  useEffect(() => { stop.current = false; return () => { stop.current = true; }; }, []);
  const ac = (id: string) => { const i = criteria.findIndex(c => c.id === id); return i >= 0 ? 'AC' + (i + 1) : id; };
  const acText = (id: string) => criteria.find(c => c.id === id)?.text ?? id;

  const propose = async (base?: 'latest') => {
    setPhase({ kind: 'planning' }); lastBase.current = base;
    try {
      const r = await extendApi.plan(launchId, base);
      setRes(r); setCost(c => c + r.costUsd);
      setChosen(new Set(r.plan.items.filter(i => i.kind !== 'remove').map(i => i.key))); // removals are never pre-selected
      setPhase({ kind: 'review' });
    } catch (e) { setPhase({ kind: 'error', message: e instanceof Error ? e.message : String(e) }); }
  };
  useEffect(() => { void propose(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const apply = async (mode?: 'fork') => {
    if (!res) return;
    setPhase({ kind: 'applying', task: null });
    try {
      const { taskId } = await extendApi.apply(launchId, res.planId, [...chosen], mode);
      for (;;) {
        if (stop.current) return;
        const t = await extendApi.task(taskId);
        if (t.status === 'running') { setPhase({ kind: 'applying', task: t }); await new Promise(r => setTimeout(r, 1000)); continue; }
        if (t.status === 'failed') { setPhase({ kind: 'error', message: t.error ?? 'Applying the changes failed' }); return; }
        setCost(c => c + (t.result?.costUsd ?? 0)); setPhase({ kind: 'done', task: t }); return;
      }
    } catch (e) {
      const err = e as Error & { status?: number };
      if (err.status === 409) setPhase({ kind: 'conflict', message: err.message, latest: Number(/version (\d+)/.exec(err.message)?.[1] ?? 0) });
      else setPhase({ kind: 'error', message: err.message });
    }
  };

  const toggle = (k: string) => setChosen(s => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const group = (kind: ChangeItem['kind']) => res?.plan.items.filter(i => i.kind === kind) ?? [];
  const chips = (ids: string[]) => ids.length ? <span className="ext-chips">{ids.map(id => <span key={id} className="ext-chip" title={acText(id)}>{ac(id)}</span>)}</span> : null;
  const shared = (i: ChangeItem) => i.kind !== 'add' && i.sharedWith.length ? <p className="ext-warn"><AlertTriangle size={13} />This screen also demonstrates {i.sharedWith.join(', ')}. Check that coverage after applying.</p> : null;
  const item = (i: ChangeItem) => <li key={i.key} className="ext-item" data-kind={i.kind}>
    <label><input type="checkbox" checked={chosen.has(i.key)} onChange={() => toggle(i.key)} aria-label={(i.kind === 'add' ? 'Add ' : i.kind === 'modify' ? 'Change ' : 'Remove ') + i.title} />
      <strong>{i.title}</strong>{i.kind !== 'remove' ? chips(i.criteria) : null}</label>
    {i.kind === 'add' ? <><p>{i.purpose}</p>{i.details.length ? <ul className="ext-details">{i.details.map((d, k) => <li key={k}>{d}</li>)}</ul> : null}</> : null}
    {i.kind === 'modify' ? <p>{i.change}</p> : null}
    {i.kind === 'remove' ? <p>{i.reason}</p> : null}
    {shared(i)}
  </li>;

  const b = res?.base;
  return <div className="gen-scrim" role="dialog" aria-modal="true" aria-label={'Extend with ' + story.id}>
    <section className="gen-panel ext-panel" data-testid="extend">
      <header><h2><Layers size={18} /> Extend with {story.id}</h2><button type="button" className="gen-x" aria-label="Close" onClick={onClose} disabled={phase.kind === 'applying'}><X size={18} /></button></header>
      <div className="gen-body">
        <p className="ext-story"><strong>{story.title}</strong>{b ? <> · base: <strong>{b.name}</strong> version {b.version}</> : null}</p>
        {phase.kind === 'planning' ? <p className="gen-center"><Loader2 className="spin" size={18} /> Analysing the story and the existing demo…</p> : null}

        {phase.kind === 'review' && res ? <>
          {b?.changedSince ? <p className="ext-warn" data-testid="ext-base-moved"><AlertTriangle size={13} />This demo has changed since MEYON launched it (latest is version {b.latestVersion}). The plan is based on version {b.version}.
            <button type="button" className="link-btn" onClick={() => propose('latest')}>Plan on the latest version instead</button></p> : null}
          <p className="ext-summary">{res.plan.summary}</p>
          {group('add').length ? <><h3><Plus size={14} />New screens</h3><ul className="ext-list">{group('add').map(item)}</ul></> : null}
          {group('modify').length ? <><h3><Pencil size={14} />Changed screens</h3><ul className="ext-list">{group('modify').map(item)}</ul></> : null}
          {group('remove').length ? <><h3><Minus size={14} />Possibly no longer needed <span className="muted">(not removed unless you tick it)</span></h3><ul className="ext-list">{group('remove').map(item)}</ul></> : null}
          {res.plan.navigation.length ? <><h3>Navigation</h3><ul className="ext-plain">{res.plan.navigation.map((n, k) => <li key={k}>{n}</li>)}</ul></> : null}
          <details className="ext-unchanged"><summary>{res.plan.unchanged.length} screens stay exactly as they are</summary><ul className="ext-plain">{res.plan.unchanged.map(u => <li key={u.screenId}>{u.title}</li>)}</ul></details>
          {res.plan.uncovered.length ? <p className="ext-warn" data-testid="ext-uncovered"><AlertTriangle size={13} />Not addressed by any change: {res.plan.uncovered.map(id => ac(id) + ' ' + acText(id)).join('; ')}</p> : null}
          {res.plan.gaps.length ? <><h3>Open questions</h3><ul className="ext-plain">{res.plan.gaps.map((g, k) => <li key={k}>{g}</li>)}</ul></> : null}
          <p className="gen-note">Applying creates the next version when every existing journey still works. Published versions never change. About USD 0.01 per change.</p>
          <div className="launch-actions">
            <button type="button" className="gen-primary" data-testid="ext-apply" disabled={!chosen.size} onClick={() => apply()}>Apply {chosen.size} change{chosen.size === 1 ? '' : 's'}</button>
            <button type="button" className="gen-secondary ext-again" onClick={() => propose(lastBase.current)}><RefreshCw size={14} />Propose again</button>
            <button type="button" className="gen-link" onClick={onClose}>Cancel</button>
          </div>
        </> : null}

        {phase.kind === 'applying' ? <div data-testid="ext-progress"><p className="gen-center"><Loader2 className="spin" size={18} /> {phase.task ? phase.task.label + (phase.task.done < phase.task.total ? ' (' + (phase.task.done + 1) + ' of ' + phase.task.total + ')' : '') : 'Starting…'}</p>
          <progress max={phase.task?.total ?? 1} value={phase.task?.done ?? 0} /></div> : null}

        {phase.kind === 'done' && phase.task.result ? (() => { const r = phase.task.result!, j = r.journey; return <div data-testid="ext-done">
          <p className={j.passed ? 'ext-ok' : 'ext-warn'}>{j.passed ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
            {j.passed ? 'Every journey still works: ' + j.reachableAfter + ' screens reachable (was ' + j.reachableBefore + ').' : 'Journey check found problems, so no version was created. The changes are in the draft for you to fix.'}</p>
          {!j.passed ? <ul className="ext-plain">{[...j.lostScreens.map(s => '"' + s + '" can no longer be reached'), ...j.unreachableNew.map(s => 'New screen "' + s + '" cannot be reached'), ...j.newErrors].map((m, k) => <li key={k}>{m}</li>)}</ul> : null}
          <p>{r.version ? <>Saved as <strong>version {r.version}</strong>{r.forked ? ' of a new copy of the demo' : ''}.</> : 'Saved to the draft.'} AI cost for this extension: USD {cost.toFixed(3)}.</p>
          <ul className="ext-plain">{r.applied.flatMap(a => a.summary).slice(0, 12).map((s, k) => <li key={k}>{s}</li>)}</ul>
          <div className="launch-actions"><button type="button" className="gen-primary" data-testid="ext-open" onClick={() => onDone(r.demoId)}>Open the updated demo</button></div>
        </div>; })() : null}

        {phase.kind === 'conflict' ? <div data-testid="ext-conflict"><p className="ext-warn"><AlertTriangle size={14} />{phase.message}</p>
          <p>Choose how to continue. Nothing has been changed yet.</p>
          <div className="ext-choices">
            <button type="button" className="gen-primary" data-testid="ext-refresh" onClick={() => propose('latest')}><RefreshCw size={14} />Plan again on the latest version</button>
            <button type="button" className="gen-secondary" data-testid="ext-fork" onClick={() => apply('fork')}><GitFork size={14} />Apply to a copy of version {b?.version}</button>
            <button type="button" className="gen-link" onClick={onClose}>Cancel</button>
          </div></div> : null}

        {phase.kind === 'error' ? <div><p className="studio-error" role="alert"><XCircle size={14} /> {phase.message}</p>
          <div className="launch-actions"><button type="button" className="gen-secondary" onClick={() => propose(lastBase.current)}><Sparkles size={14} />Try again</button><button type="button" className="gen-link" onClick={onClose}>Close</button></div></div> : null}
      </div>
    </section>
  </div>;
}
