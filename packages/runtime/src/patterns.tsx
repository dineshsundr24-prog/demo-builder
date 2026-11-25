// Designed patterns: the AI supplies content, these components own the visual design.
import React, { useContext, useState } from 'react';
import { ChevronRight, Eye, EyeOff, ShieldCheck, Sparkles, CheckCircle2, TrendingUp, FileCheck2 } from 'lucide-react';
import type { Action, NodeT } from '@demo/schema';
import { useRuntime, useText, FormContext, prettyDates } from './nodes.tsx';
import { Icon } from './icons.tsx';

const attrs = (n: NodeT, cls: string) => ({ className: 'db-' + cls, 'data-node-id': n.id, 'data-node-type': n.type });
/** Brand mark: uploaded logo, otherwise initials on a brand gradient. */
const GENERIC_BRAND_WORDS = /^(bank|banking|digital|app|mobile|portal|staff|online|the|of|and|services?|group|llc|pjsc|clinics?|claims|hr)$/i;
export function BrandMark({ size = 64 }: { size?: number }) {
  const rt = useRuntime();
  const logo = rt.doc.theme.logo;
  if (logo) return <img className="db-brandmark db-brandmark-img" src={logo} alt={rt.doc.shell.brand + ' logo'} style={{ maxHeight: size, maxWidth: size * 3 }} />;
  // "Nexa Digital Banking" -> "N", "CareWell Clinics" -> "C": generic words never become initials.
  const all = rt.doc.shell.brand.replace(/[^A-Za-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
  const words = all.filter(w => !GENERIC_BRAND_WORDS.test(w));
  const initials = (words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? all[0] ?? 'D')[0]).toUpperCase();
  return <span className="db-brandmark" style={{ width: size, height: size, fontSize: size * 0.36 }} aria-label={rt.doc.shell.brand + ' logo'} role="img">{initials}</span>;
}
function useRun() {
  const rt = useRuntime(), formId = useContext(FormContext);
  return (actions: unknown) => rt.interactive && rt.run((actions as Action[]) ?? [], formId);
}
const maskAccount = (v: string) => { const digits = v.replace(/\s+/g, ''); return digits.length > 6 ? '•••• ' + digits.slice(-4) : v; };
const illustrations: Record<string, React.ReactNode> = {
  welcome: <Sparkles size={30} />, security: <ShieldCheck size={30} />, success: <CheckCircle2 size={30} />, growth: <TrendingUp size={30} />, documents: <FileCheck2 size={30} />,
};

function Hero({ node }: { node: NodeT }) {
  const t = useText();
  const art = illustrations[String(node.illustration)];
  return <section {...attrs(node, 'hero')} data-illustration={String(node.illustration)}>
    {node.showLogo ? <BrandMark size={72} /> : null}
    {art && !node.showLogo ? <span className="db-hero-art">{art}</span> : null}
    <h1>{t(node.title)}</h1>
    {node.subtitle ? <p>{t(node.subtitle)}</p> : null}
  </section>;
}
function BalanceCard({ node }: { node: NodeT }) {
  const t = useText(); const [hidden, setHidden] = useState(false);
  return <section {...attrs(node, 'balance')}>
    <div className="db-balance-top"><span>{t(node.label)}</span>
      <button type="button" className="db-balance-eye" aria-label={hidden ? 'Show balance' : 'Hide balance'} onClick={() => setHidden(h => !h)}>{hidden ? <Eye size={18} /> : <EyeOff size={18} />}</button></div>
    <div className="db-balance-amount">{hidden ? '••••••' : t(node.amount)}</div>
    {node.caption ? <div className="db-balance-caption">{t(node.caption)}</div> : null}
    {node.accountName || node.accountNumber ? <div className="db-balance-account"><span>{node.accountName ? t(node.accountName) : ''}</span><span>{node.accountNumber ? maskAccount(String(node.accountNumber)) : ''}</span></div> : null}
  </section>;
}
function QuickActions({ node }: { node: NodeT }) {
  const t = useText(), run = useRun();
  const items = node.items as { label: string; icon: string; actions: Action[] }[];
  return <section {...attrs(node, 'quick')}>
    {node.title ? <h3 className="db-pattern-title">{t(node.title)}</h3> : null}
    <div className="db-quick-grid" data-count={items.length}>{items.map((it, i) =>
      <button type="button" key={i} className="db-quick-item" onClick={() => run(it.actions)}><span className="db-quick-icon"><Icon name={it.icon} size={22} /></span><span>{t(it.label)}</span></button>)}</div>
  </section>;
}
function TransactionList({ node }: { node: NodeT }) {
  const t = useText(), run = useRun();
  const items = node.items as { title: string; subtitle?: string; amount: string; direction: string; icon: string }[];
  const viewAll = node.viewAll as { label: string; actions: Action[] } | undefined;
  return <section {...attrs(node, 'txns')}>
    {node.title || viewAll ? <div className="db-pattern-head">{node.title ? <h3 className="db-pattern-title">{t(node.title)}</h3> : <span />}
      {viewAll ? <button type="button" className="db-link" onClick={() => run(viewAll.actions)}>{t(viewAll.label)}</button> : null}</div> : null}
    <ul>{items.map((it, i) => <li key={i}><span className="db-txn-icon" data-direction={it.direction}><Icon name={it.icon} size={18} /></span>
      <span className="db-txn-main"><strong>{t(it.title)}</strong>{it.subtitle ? <small>{prettyDates(t(it.subtitle))}</small> : null}</span>
      <span className="db-txn-amount" data-direction={it.direction}>{t(it.amount)}</span></li>)}</ul>
  </section>;
}
function MenuList({ node }: { node: NodeT }) {
  const t = useText(), run = useRun();
  const items = node.items as { label: string; description?: string; icon: string; value?: string; danger?: boolean; actions: Action[] }[];
  return <section {...attrs(node, 'menu')}>
    {node.title ? <h3 className="db-pattern-title">{t(node.title)}</h3> : null}
    <ul>{items.map((it, i) => <li key={i}><button type="button" data-danger={!!it.danger} onClick={() => run(it.actions)}>
      <span className="db-menu-icon"><Icon name={it.icon} size={18} /></span>
      <span className="db-menu-main"><strong>{t(it.label)}</strong>{it.description ? <small>{t(it.description)}</small> : null}</span>
      {it.value ? <span className="db-menu-value">{t(it.value)}</span> : null}
      {!it.danger ? <ChevronRight size={18} className="db-menu-chevron" /> : null}</button></li>)}</ul>
  </section>;
}
function ProfileHeader({ node }: { node: NodeT }) {
  const t = useText();
  const name = t(node.name);
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();
  return <section {...attrs(node, 'profile')}><span className="db-avatar">{initials}</span>
    <div><strong>{name}</strong>{node.subtitle ? <small>{t(node.subtitle)}</small> : null}</div>
    {node.badge ? <span className="db-badge" data-tone="info">{String(node.badge)}</span> : null}</section>;
}
function ActionBar({ node }: { node: NodeT }) {
  const t = useText(), run = useRun(), rt = useRuntime();
  const p = node.primary as { label: string; actions: Action[] }, s = node.secondary as { label: string; actions: Action[] } | undefined;
  return <div {...attrs(node, 'actionbar')}>
    <button type="button" className="db-button" data-variant="primary" disabled={!!rt.session.busy} onClick={() => run(p.actions)}>{t(p.label)}</button>
    {s ? <button type="button" className="db-button" data-variant="secondary" disabled={!!rt.session.busy} onClick={() => run(s.actions)}>{t(s.label)}</button> : null}
  </div>;
}
function StatusTimeline({ node }: { node: NodeT }) {
  const t = useText();
  const steps = node.steps as { label: string; detail?: string; state: string }[];
  return <section {...attrs(node, 'timeline')}>
    {node.title ? <h3 className="db-pattern-title">{t(node.title)}</h3> : null}
    <ol>{steps.map((s, i) => <li key={i} data-state={s.state}><span className="db-tl-dot">{s.state === 'done' ? <CheckCircle2 size={16} /> : null}</span>
      <span><strong>{t(s.label)}</strong>{s.detail ? <small>{prettyDates(t(s.detail))}</small> : null}</span></li>)}</ol>
  </section>;
}
function Promo({ node }: { node: NodeT }) {
  const t = useText(), run = useRun();
  const cta = node.cta as { label: string; actions: Action[] } | undefined;
  return <section {...attrs(node, 'promo')}><span className="db-promo-icon"><Icon name={String(node.icon)} size={22} /></span>
    <div><strong>{t(node.title)}</strong>{node.body ? <p>{t(node.body)}</p> : null}
      {cta ? <button type="button" className="db-link" onClick={() => run(cta.actions)}>{t(cta.label)} →</button> : null}</div></section>;
}
function FeatureList({ node }: { node: NodeT }) {
  const t = useText();
  const items = node.items as { icon: string; title: string; text?: string; meta?: string }[];
  return <section {...attrs(node, 'features')}>
    {node.title ? <h3 className="db-pattern-title">{t(node.title)}</h3> : null}
    <ul>{items.map((it, i) => <li key={i}><span className="db-feature-icon"><Icon name={it.icon} size={18} /></span>
      <span className="db-feature-main"><strong>{t(it.title)}</strong>{it.text ? <small>{t(it.text)}</small> : null}</span>{it.meta ? <span className="db-feature-meta">{t(it.meta)}</span> : null}</li>)}</ul>
  </section>;
}
function Chart({ node }: { node: NodeT }) {
  const labels = node.labels as string[], values = (node.values as number[]).slice(0, labels.length);
  const max = Math.max(...values, 1), w = 320, h = 150, pad = 24, step = (w - pad) / values.length;
  const fmt = (v: number) => (v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(1) + 'k' : String(v));
  const y = (v: number) => h - 18 - (v / max) * (h - 36);
  return <section {...attrs(node, 'chart')}>
    <div className="db-pattern-head"><h3 className="db-pattern-title">{String(node.title)}</h3>{node.unit ? <small>{String(node.unit)}</small> : null}</div>
    <svg viewBox={'0 0 ' + w + ' ' + h} role="img" aria-label={String(node.title)}>
      <line x1={pad} x2={w} y1={h - 18} y2={h - 18} className="db-chart-axis" />
      {node.kind === 'line'
        ? <><polyline className="db-chart-line" points={values.map((v, i) => (pad + step * i + step / 2) + ',' + y(v)).join(' ')} />
            {values.map((v, i) => <circle key={i} className="db-chart-dot" cx={pad + step * i + step / 2} cy={y(v)} r={3.5}><title>{labels[i] + ': ' + v}</title></circle>)}</>
        : values.map((v, i) => <rect key={i} className="db-chart-bar" x={pad + step * i + step * 0.2} width={step * 0.6} y={y(v)} height={h - 18 - y(v)} rx={4}><title>{labels[i] + ': ' + v}</title></rect>)}
      {labels.map((l, i) => <text key={i} className="db-chart-label" x={pad + step * i + step / 2} y={h - 4} textAnchor="middle">{l}</text>)}
      <text className="db-chart-label" x={2} y={14}>{fmt(max)}</text>
    </svg>
  </section>;
}
export const patternRenderers: Record<string, (p: { node: NodeT }) => React.ReactElement> = { Hero, BalanceCard, QuickActions, TransactionList, MenuList, ProfileHeader, ActionBar, StatusTimeline, Promo, FeatureList, Chart };
