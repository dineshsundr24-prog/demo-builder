// Stand-in for MEYON's Demo tab (UAT/testing only): pick an approved sample story, review the prompt, choose
// Create or Extend, and open Demo Builder in a new tab exactly as MEYON will (one-time launch code).
import React, { useEffect, useState } from 'react';
import { ExternalLink, Monitor, Smartphone, Sparkles } from 'lucide-react';
import { launchApi, type SimBaseline, type SimScenario } from './demosApi.ts';
import { AccountBox, useSignedIn } from './Account.tsx';
import { uatToken } from '../account.ts';

export function SimLauncher() {
  const signedIn = !!useSignedIn() || !!uatToken(); // the API decides who may prepare launches (signed-in users)
  const [data, setData] = useState<{ project: { name: string }; tenant: { name: string }; scenarios: SimScenario[] } | null>(null);
  const [baselines, setBaselines] = useState<SimBaseline[]>([]);
  const [storyId, setStoryId] = useState(''), [prompt, setPrompt] = useState(''), [mode, setMode] = useState<'create' | 'extend'>('create');
  const [base, setBase] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false), [opened, setOpened] = useState('');
  const [suggesting, setSuggesting] = useState(false), [suggestNote, setSuggestNote] = useState('');
  useEffect(() => {
    if (!signedIn) return;
    launchApi.scenarios().then(d => { setData(d); setStoryId(d.scenarios[0]?.storyId ?? ''); setPrompt(d.scenarios[0]?.prompt ?? ''); }, e => setError(e.message));
    launchApi.baselines().then(setBaselines, () => setBaselines([]));
  }, [signedIn]);
  const scenario = data?.scenarios.find(s => s.storyId === storyId);
  const usable = baselines.filter(b => b.channel === scenario?.channel);
  const MARK = 'Screens to build (AI suggestion';
  /** Hybrid preparation: the approved sections stay as composed; AI adds a labelled screen suggestion the user can edit. */
  const suggest = async () => {
    setSuggesting(true); setError(''); setSuggestNote('');
    try {
      const b = usable.find(x => x.demoId === base) ?? usable[0];
      const r = await launchApi.suggest({ storyId, ...(mode === 'extend' && b ? { baseDemoId: b.demoId } : {}) });
      setPrompt(p => { const i = p.indexOf(MARK); return (i >= 0 ? p.slice(0, i).trimEnd() : p.trimEnd()) + '\n\n' + r.text; });
      setSuggestNote(r.screens + ' screens suggested' + (r.gaps.length ? ' · ' + r.gaps.length + ' open question' + (r.gaps.length > 1 ? 's' : '') + ' to review' : '') + ' · USD ' + r.costUsd.toFixed(3) + '. Review and edit before opening.');
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setSuggesting(false); }
  };
  const open = async () => {
    setBusy(true); setError('');
    try {
      const b = usable.find(x => x.demoId === base) ?? usable[0];
      const g = await launchApi.grant({ storyId, mode, prompt, ...(mode === 'extend' && b ? { baseDemoId: b.demoId, baseVersion: b.latestVersion } : {}) });
      const url = location.origin + location.pathname + '#launch=' + g.code;
      setOpened(url);
      window.open(url, '_blank', 'noopener');
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  return <div className="launch-page">
    <section className="launch-card sim-card" data-testid="sim">
      <div className="welcome-top"><p className="launch-eyebrow">MEYON simulator · testing only</p><AccountBox compact /></div>
      <h1>Open Demo Builder from MEYON</h1>
      <p className="muted">This page stands in for MEYON's Demo tab. It sends one approved sample story to Demo Builder the way MEYON will: a one-time link that expires in 5 minutes, exchanged server to server.
        Demos made this way belong to the simulated MEYON tenant, not to your personal saved demos.</p>
      {!signedIn ? <p className="studio-error">Sign in first.</p> : !data ? (error ? <p className="studio-error" role="alert">{error}</p> : <p>Loading sample stories…</p>) : <>
        <p className="launch-meta">Project <strong>{data.project.name}</strong> · {data.tenant.name}</p>
        <fieldset className="sim-stories"><legend>Approved user story</legend>{data.scenarios.map(s => <label key={s.storyId}>
          <input type="radio" name="story" checked={s.storyId === storyId} onChange={() => { setStoryId(s.storyId); setPrompt(s.prompt); setBase(''); setSuggestNote(''); }} />
          {s.channel === 'mobile' ? <Smartphone size={14} /> : <Monitor size={14} />}<strong>{s.storyId}</strong> {s.title} <span className="muted">v{s.version} · {s.criteria} criteria · {s.feature}</span></label>)}</fieldset>
        <fieldset className="sim-mode"><legend>Mode</legend>
          <label><input type="radio" name="mode" checked={mode === 'create'} onChange={() => setMode('create')} />Create new demo</label>
          <label><input type="radio" name="mode" checked={mode === 'extend'} disabled={!usable.length} onChange={() => setMode('extend')} />Extend existing demo{usable.length ? '' : ' (no saved version of this application type yet)'}</label>
          {mode === 'extend' ? <select aria-label="Base demo" value={base || usable[0]?.demoId} onChange={e => setBase(e.target.value)}>{usable.map(b => <option key={b.demoId} value={b.demoId}>{b.name} · v{b.latestVersion}{b.isPrimary ? ' · primary' : ''}</option>)}</select> : null}
        </fieldset>
        <label className="sim-prompt">Screen generation prompt (review and edit)<span className="muted small">Composed from the approved story, criteria and rules. Add an AI screen suggestion, then review and edit it.</span>
          <textarea rows={18} value={prompt} data-testid="sim-prompt" onChange={e => setPrompt(e.target.value)} /></label>
        <div className="launch-actions"><button type="button" className="gen-secondary" data-testid="sim-suggest" disabled={suggesting || busy} onClick={suggest}><Sparkles size={15} />{suggesting ? 'Suggesting screens…' : prompt.includes(MARK) ? 'Suggest screens again' : 'Suggest screens with AI'}</button>
          {suggestNote ? <span className="muted small" data-testid="sim-suggest-note">{suggestNote}</span> : null}</div>
        {error ? <p className="studio-error" role="alert">{error}</p> : null}
        <div className="launch-actions"><button type="button" className="gen-primary" data-testid="sim-open" disabled={busy || prompt.trim().length < 15} onClick={open}><ExternalLink size={15} />Open Demo Builder</button></div>
        {opened ? <p className="muted small" data-testid="sim-opened">Opened in a new tab. If your browser blocked it, <a href={opened} target="_blank" rel="noopener">open it here</a> (works once).</p> : null}
      </>}
    </section>
  </div>;
}
