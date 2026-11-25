// Story coverage: which screens demonstrate each approved acceptance criterion, and how visibly.
// Generated links come from the approved plan; the user can confirm a criterion on a screen or remove a link.
import React from 'react';
import { AlertTriangle, CheckCircle2, Link2, X, XCircle } from 'lucide-react';
import type { DemoDocument, TraceLink } from '@demo/schema';
import type { Criterion } from './demosApi.ts';

type Hit = { screenId: string; title: string; confidence: TraceLink['confidence']; source: TraceLink['source'] };
const RANK = { high: 3, medium: 2, low: 1 } as const;

/** Every criterion referenced by the document (in document order), with the screens that demonstrate it. */
export function coverageOf(doc: DemoDocument, story: string, criteria?: Criterion[]) {
  const hits = new Map<string, Hit[]>();
  for (const s of doc.screens) for (const t of s.trace ?? []) if (t.story === story) for (const c of t.criteria) {
    const list = hits.get(c) ?? []; if (!list.some(h => h.screenId === s.id)) list.push({ screenId: s.id, title: s.title, confidence: t.confidence, source: t.source }); hits.set(c, list);
  }
  const items = criteria ?? [...hits.keys()].map(id => ({ id, text: '' }));
  return items.map(c => { const h = hits.get(c.id) ?? []; return { ...c, hits: h, best: h.reduce<TraceLink['confidence'] | null>((b, x) => (!b || RANK[x.confidence] > RANK[b] ? x.confidence : b), null) }; });
}
/** Stories referenced by any screen. */
export const storiesOf = (doc: DemoDocument) => [...new Set(doc.screens.flatMap(s => (s.trace ?? []).map(t => t.story)))];

/** The user confirms that a screen demonstrates a criterion (manual links are kept on regeneration). */
export function linkCriterion(doc: DemoDocument, screenId: string, story: string, criterion: string): DemoDocument {
  return { ...doc, screens: doc.screens.map(s => {
    if (s.id !== screenId) return s;
    const rest = (s.trace ?? []).map(t => (t.story === story ? { ...t, criteria: t.criteria.filter(c => c !== criterion) } : t)).filter(t => t.criteria.length);
    const manual = rest.find(t => t.story === story && t.source === 'manual');
    const trace = manual ? rest.map(t => (t === manual ? { ...t, criteria: [...t.criteria, criterion] } : t)) : [...rest, { story, criteria: [criterion], confidence: 'high' as const, source: 'manual' as const }];
    return { ...s, trace: trace.slice(0, 10) };
  }) };
}
export function unlinkCriterion(doc: DemoDocument, screenId: string, story: string, criterion: string): DemoDocument {
  return { ...doc, screens: doc.screens.map(s => {
    if (s.id !== screenId || !s.trace) return s;
    const trace = s.trace.map(t => (t.story === story ? { ...t, criteria: t.criteria.filter(c => c !== criterion) } : t)).filter(t => t.criteria.length);
    if (trace.length) return { ...s, trace };
    const { trace: _t, ...rest } = s; void _t; return rest;
  }) };
}

const LABEL = { high: 'Shown', medium: 'Partly shown', low: 'Planned, not visible yet' } as const;

export function CoveragePanel({ doc, story, title, criteria, currentScreen, onOpen, onChange }: {
  doc: DemoDocument; story: string; title?: string; criteria?: Criterion[]; currentScreen: string;
  onOpen: (screenId: string) => void; onChange: (d: DemoDocument) => void;
}) {
  const rows = coverageOf(doc, story, criteria);
  const shown = rows.filter(r => r.best === 'high' || r.best === 'medium').length;
  const current = doc.screens.find(s => s.id === currentScreen);
  return <details className="coverage" open data-testid="coverage">
    <summary><strong>Story coverage</strong> <span className="muted">{story}</span><span className={'coverage-count' + (shown === rows.length ? ' ok' : '')}>{shown}/{rows.length}</span></summary>
    {title ? <p className="coverage-title">{title}</p> : null}
    <ol className="coverage-list">{rows.map(r => <li key={r.id} data-state={r.best ?? 'none'}>
      <span className="coverage-icon" title={r.best ? LABEL[r.best] : 'Not demonstrated'}>{r.best === 'high' ? <CheckCircle2 size={14} className="ok" /> : r.best ? <AlertTriangle size={14} className="warn" /> : <XCircle size={14} className="bad" />}</span>
      <div>
        <p>{r.text || r.id}</p>
        <div className="coverage-screens">
          {r.hits.length ? r.hits.map(h => <span key={h.screenId} className="coverage-chip" data-confidence={h.confidence}>
            <button type="button" onClick={() => onOpen(h.screenId)} title={LABEL[h.confidence] + (h.source === 'manual' ? ' (confirmed by you)' : '')}>{h.title}</button>
            <button type="button" aria-label={'Remove ' + h.title + ' from ' + r.id} onClick={() => onChange(unlinkCriterion(doc, h.screenId, story, r.id))}><X size={11} /></button></span>)
            : <span className="muted">Not demonstrated</span>}
          {current && !r.hits.some(h => h.screenId === current.id && h.source === 'manual') ? <button type="button" className="coverage-link" onClick={() => onChange(linkCriterion(doc, current.id, story, r.id))}
            title={'Confirm that "' + current.title + '" demonstrates this criterion'}><Link2 size={11} />This screen</button> : null}
        </div>
      </div>
    </li>)}</ol>
  </details>;
}
