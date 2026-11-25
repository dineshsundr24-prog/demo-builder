// One renderer per registry component. Editor canvas, Run preview and the
// published viewer all render through these, so they cannot drift apart.
import React, { createContext, useContext, useMemo, useState } from 'react';
import { expandTemplate, resolveText, formatters, type NodeT, type DemoDocument, type Action } from '@demo/schema';
import { patternRenderers, BrandMark } from './patterns.tsx';
import { getPath, filterRows, csvFor, type Session } from './engine.ts';

export type RuntimeApi = {
  doc: DemoDocument;
  session: Session;
  setField: (key: string, value: string) => void;
  run: (actions: Action[], formId?: string) => void;
  openRecord: (collection: string, row: Record<string, string>, screen: string) => void;
  /** Editor hook: wrap each rendered node (selection outlines, drop targets). */
  wrap?: (node: NodeT, element: React.ReactElement) => React.ReactElement;
  interactive: boolean;
};
export const RuntimeContext = createContext<RuntimeApi | null>(null);
export const FormContext = createContext<string | undefined>(undefined);
export const useRuntime = () => { const r = useContext(RuntimeContext); if (!r) throw Error('RuntimeContext missing'); return r; };
export const useText = () => { const r = useRuntime(); return (t: unknown) => resolveText(String(t ?? ''), { state: r.session.state, record: r.session.record?.row ?? null, params: {} }); };

export function Nodes({ nodes }: { nodes: NodeT[] }) { return <>{nodes.map(n => <NodeView key={n.id} node={n} />)}</>; }
export function NodeView({ node }: { node: NodeT }) {
  const rt = useRuntime();
  const Renderer = renderers[node.type] ?? patternRenderers[node.type] ?? Unknown;
  const el = <Renderer node={node} />;
  return rt.wrap ? rt.wrap(node, el) : el;
}
const Kids = ({ node }: { node: NodeT }) => <Nodes nodes={(node.children as NodeT[]) ?? []} />;
const attrs = (n: NodeT, cls: string, extra: Record<string, unknown> = {}) => ({ className: 'db-' + cls, 'data-node-id': n.id, 'data-node-type': n.type, ...extra });

function Unknown({ node }: { node: NodeT }) { return <div {...attrs(node, 'unknown')}>Unsupported component {node.type}</div>; }
function Stack({ node }: { node: NodeT }) { return <div {...attrs(node, 'stack')} data-direction={String(node.direction)} data-gap={String(node.gap)} data-align={String(node.align ?? 'stretch')}><Kids node={node} /></div>; }
function Grid({ node }: { node: NodeT }) { return <div {...attrs(node, 'grid')} data-columns={String(node.columns)} data-gap={String(node.gap)}><Kids node={node} /></div>; }
function Section({ node }: { node: NodeT }) { const t = useText(); return <section {...attrs(node, 'section')}><h2>{t(node.title)}</h2>{node.description ? <p className="db-muted">{t(node.description)}</p> : null}<div className="db-section-body"><Kids node={node} /></div></section>; }
function Card({ node }: { node: NodeT }) { const t = useText(); return <section {...attrs(node, 'card')} data-tone={String(node.tone ?? 'default')}>{node.title ? <h3>{t(node.title)}</h3> : null}<div className="db-card-body"><Kids node={node} /></div></section>; }
function Form({ node }: { node: NodeT }) {
  const t = useText();
  return <FormContext.Provider value={node.id}><form {...attrs(node, 'form')} noValidate onSubmit={e => e.preventDefault()}>{node.title ? <h3>{t(node.title)}</h3> : null}<Kids node={node} /></form></FormContext.Provider>;
}
function Heading({ node }: { node: NodeT }) { const t = useText(); return React.createElement('h' + node.level, attrs(node, 'heading'), t(node.text)); }
function Text({ node }: { node: NodeT }) { const t = useText(); return <p {...attrs(node, 'text')} data-tone={String(node.tone ?? 'default')}>{t(node.text)}</p>; }
function Notice({ node }: { node: NodeT }) { const t = useText(); return <div {...attrs(node, 'notice')} data-tone={String(node.tone)} role="note"><strong>{t(node.title)}</strong>{node.body ? <span>{t(node.body)}</span> : null}</div>; }
function Stat({ node }: { node: NodeT }) { const t = useText(); return <div {...attrs(node, 'stat')}><span className="db-stat-label">{t(node.label)}</span><span className="db-stat-value" data-long={t(node.value).length > 12 ? '' : undefined}>{prettyDates(t(node.value))}</span>{node.delta ? <span className="db-stat-delta">{String(node.delta)}</span> : null}</div>; }
function Image({ node }: { node: NodeT }) {
  const rt = useRuntime();
  if (node.kind === 'logo') return <div {...attrs(node, 'image')} data-kind="logo"><BrandMark size={72} /></div>;
  const initials = rt.doc.shell.brand.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
  return <div {...attrs(node, 'image')} data-kind={String(node.kind)} role="img" aria-label={String(node.alt)}>{node.kind === 'logo' || node.kind === 'avatar' ? initials : node.kind === 'camera-frame' ? <span className="db-face-oval" /> : null}</div>;
}
function Progress({ node }: { node: NodeT }) { return <div {...attrs(node, 'progress')}><div className="db-progress-head"><span>{String(node.label)}</span><span>{String(node.value)}%</span></div><div className="db-progress-track"><div style={{ width: Number(node.value) + '%' }} /></div></div>; }
function Steps({ node }: { node: NodeT }) {
  const steps = node.steps as string[], cur = Number(node.current);
  return <ol {...attrs(node, 'steps')}>{steps.map((s, i) => <li key={i} data-state={i + 1 < cur ? 'done' : i + 1 === cur ? 'current' : 'todo'}><span>{i + 1}</span>{s}</li>)}</ol>;
}
function Badge({ node }: { node: NodeT }) { const t = useText(); return <span {...attrs(node, 'badge')} data-tone={String(node.tone)}>{t(node.text)}</span>; }
function Divider({ node }: { node: NodeT }) { return <hr {...attrs(node, 'divider')} />; }
// Long unbroken numbers (account numbers, IBANs) are grouped in fours so they wrap cleanly.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "2024-06-09" (alone or inside text, optionally with a time) reads as "9 Jun 2024". */
export const prettyDates = (v: string) => v.replace(/\b(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}:\d{2})(?::\d{2})?Z?)?\b/g, (m, y, mo, d, time) => {
  const month = MONTHS[Number(mo) - 1]; if (!month || Number(d) < 1 || Number(d) > 31) return m;
  return Number(d) + ' ' + month + ' ' + y + (time ? ', ' + time : '');
});
const readable = (v: string) => prettyDates(/^[A-Z]{0,2}\d[\dA-Z]{11,}$/.test(v.replace(/\s/g, '')) && !/\s/.test(v) ? v.replace(/(.{4})(?=.)/g, '$1 ') : v);
function RecordFields({ node }: { node: NodeT }) { const t = useText(); return <dl {...attrs(node, 'fields')}>{(node.items as any[]).map((it, i) => <div key={i}><dt>{it.label}</dt><dd>{readable(t(it.value))}</dd></div>)}</dl>; }

function useField(node: NodeT) {
  const rt = useRuntime();
  const key = String(node.field);
  const value = String(getPath(rt.session.state, key) ?? '');
  return { key, value, error: rt.session.errors[key], set: (v: string) => rt.setField(key, v), id: 'f-' + node.id };
}
const Label = ({ node, id }: { node: NodeT; id: string }) => <label htmlFor={id}>{String(node.label)}{node.required ? <span className="db-req" aria-hidden> *</span> : null}</label>;
const Err = ({ e }: { e?: string }) => (e ? <span className="db-error" role="alert">{e}</span> : null);
function Input({ node }: { node: NodeT }) {
  const f = useField(node);
  const type = ({ email: 'email', password: 'password', number: 'number', date: 'date', phone: 'tel', otp: 'text', currency: 'text', text: 'text' } as Record<string, string>)[String(node.inputType)] ?? 'text';
  const [show, setShow] = useState(false);
  return <div {...attrs(node, 'field')} data-invalid={!!f.error}>
    <Label node={node} id={f.id} />
    <div className="db-input-wrap">
      {node.inputType === 'currency' ? <span className="db-prefix">AED</span> : null}
      <input id={f.id} name={f.key} type={type === 'password' && show ? 'text' : type} inputMode={node.inputType === 'otp' || node.inputType === 'currency' ? 'numeric' : undefined}
        maxLength={node.inputType === 'otp' ? 8 : undefined} placeholder={node.placeholder ? String(node.placeholder) : undefined} value={f.value} aria-invalid={!!f.error}
        onChange={e => f.set(e.target.value)} />
      {type === 'password' ? <button type="button" className="db-reveal" onClick={() => setShow(v => !v)}>{show ? 'Hide' : 'Show'}</button> : null}
    </div>
    <Err e={f.error} />
  </div>;
}
function Select({ node }: { node: NodeT }) {
  const f = useField(node);
  return <div {...attrs(node, 'field')} data-invalid={!!f.error}><Label node={node} id={f.id} />
    <select id={f.id} name={f.key} value={f.value} aria-invalid={!!f.error} onChange={e => f.set(e.target.value)}><option value="">Select…</option>{(node.options as string[]).map(o => <option key={o}>{o}</option>)}</select><Err e={f.error} /></div>;
}
function Radio({ node }: { node: NodeT }) {
  const f = useField(node);
  return <fieldset {...attrs(node, 'radio')} data-invalid={!!f.error}><legend>{String(node.label)}{node.required ? ' *' : ''}</legend>
    {(node.options as string[]).map(o => <label key={o}><input type="radio" name={f.key} checked={f.value === o} onChange={() => f.set(o)} />{o}</label>)}<Err e={f.error} /></fieldset>;
}
function Checkbox({ node }: { node: NodeT }) {
  const f = useField(node);
  return <div {...attrs(node, 'check')} data-invalid={!!f.error}><label><input type="checkbox" name={f.key} checked={f.value === 'true'} onChange={e => f.set(e.target.checked ? 'true' : '')} /><span>{String(node.label)}{node.required ? ' *' : ''}</span></label><Err e={f.error} /></div>;
}
function Toggle({ node }: { node: NodeT }) {
  const f = useField(node);
  return <label {...attrs(node, 'toggle')}><span>{String(node.label)}</span><input type="checkbox" role="switch" checked={f.value === 'true'} onChange={e => f.set(e.target.checked ? 'true' : 'false')} /></label>;
}
function Upload({ node }: { node: NodeT }) {
  const f = useField(node);
  return <div {...attrs(node, 'upload')} data-invalid={!!f.error}><Label node={node} id={f.id} />
    <label className="db-dropzone"><input id={f.id} type="file" onChange={e => f.set(e.target.files?.[0]?.name ?? '')} /><span>{f.value ? '📄 ' + f.value : 'Choose a file (stays in your browser)'}</span></label><Err e={f.error} /></div>;
}
function Button({ node }: { node: NodeT }) {
  const rt = useRuntime(), formId = useContext(FormContext), t = useText();
  return <button {...attrs(node, 'button')} type="button" data-variant={String(node.variant)} disabled={!!rt.session.busy}
    onClick={() => rt.interactive && rt.run(node.actions as Action[], formId)}>{t(node.label)}</button>;
}
const statusTone = (v: string) => /approv|complet|active|verified|success/i.test(v) ? 'success' : /reject|fail|declin|overdue/i.test(v) ? 'error' : /pending|review|progress|returned|draft/i.test(v) ? 'warning' : 'neutral';
function Cell({ value, format }: { value: string | undefined; format?: string }) {
  const v = value ?? '';
  if (format === 'status') return <span className="db-badge" data-tone={statusTone(v)}>{v}</span>;
  if (format === 'aed' || format === 'date') return <>{formatters[format](v)}</>;
  return <>{v}</>;
}
function Table({ node }: { node: NodeT }) {
  const rt = useRuntime();
  const columns = node.columns as { field: string; label: string; format?: string }[];
  const rows = rt.session.collections[String(node.collection)] ?? [];
  const fieldsOf = useMemo(() => new Map((rt.doc.collections.find(c => c.id === node.collection)?.fields ?? []).map(f => [f.id, f.label])), [rt.doc.collections, node.collection]);
  const [q, setQ] = useState(''), [equals, setEquals] = useState<Record<string, string>>({}), [from, setFrom] = useState(''), [to, setTo] = useState('');
  // A dropdown over unique values (names, ids) filters nothing useful: such filters are not shown.
  const categorical = (f: string) => rows.length < 4 || new Set(rows.map(r => r[f])).size < rows.length;
  const filterFields = [node.filterField, ...((node.moreFilters as string[] | undefined) ?? [])].filter((f): f is string => typeof f === 'string' && !!f && categorical(f));
  const dateField = node.dateFilterField ? String(node.dateFilterField) : undefined;
  const options = useMemo(() => Object.fromEntries(filterFields.map(f => [f, [...new Set(rows.map(r => r[f]).filter(Boolean))]])), [rows, filterFields.join()]);
  const shown = filterRows(rows, { search: node.searchable ? q : '', fields: columns.map(c => c.field), equals, ...(dateField ? { date: { field: dateField, from, to } } : {}) });
  const action = node.rowAction as { label: string; screen: string } | undefined;
  const labelOf = (f: string) => columns.find(c => c.field === f)?.label ?? fieldsOf.get(f) ?? f;
  const filtered = !!(q || from || to || Object.values(equals).some(Boolean));
  const download = () => { const url = URL.createObjectURL(new Blob([csvFor(shown, columns)], { type: 'text/csv' })); const a = document.createElement('a'); a.href = url; a.download = String(node.collection) + '.csv'; a.click(); URL.revokeObjectURL(url); };
  return <div {...attrs(node, 'table')}>
    {(node.title || node.searchable || filterFields.length || dateField || node.exportCsv) ? <div className="db-table-bar">
      {node.title ? <h3>{String(node.title)}</h3> : <span />}
      <div className="db-table-tools">
        {node.searchable ? <input type="search" aria-label="Search" placeholder="Search…" value={q} onChange={e => setQ(e.target.value)} /> : null}
        {filterFields.map(f => <select key={f} aria-label={'Filter by ' + labelOf(f)} value={equals[f] ?? ''} onChange={e => setEquals(x => ({ ...x, [f]: e.target.value }))}>
          <option value="">{'All ' + labelOf(f).toLowerCase()}</option>{(options[f] ?? []).map(o => <option key={o}>{o}</option>)}</select>)}
        {dateField ? <span className="db-date-range" role="group" aria-label={labelOf(dateField) + ' range'}>
          <label>{labelOf(dateField)} from<input type="date" aria-label={labelOf(dateField) + ' from'} value={from} onChange={e => setFrom(e.target.value)} /></label>
          <label>to<input type="date" aria-label={labelOf(dateField) + ' to'} value={to} onChange={e => setTo(e.target.value)} /></label></span> : null}
        {filtered ? <button type="button" className="db-link" onClick={() => { setQ(''); setEquals({}); setFrom(''); setTo(''); }}>Clear</button> : null}
        {node.exportCsv ? <button type="button" className="db-link" onClick={download}>Export CSV</button> : null}
      </div></div> : null}
    <div className="db-table-scroll"><table><thead><tr>{columns.map(c => <th key={c.field}>{c.label}</th>)}{action ? <th /> : null}</tr></thead>
      <tbody>{shown.map((r, i) => <tr key={i}>{columns.map(c => <td key={c.field} data-format={c.format ?? 'text'}><Cell value={r[c.field]} format={c.format} /></td>)}
        {action ? <td><button type="button" className="db-row-action" onClick={() => rt.interactive && rt.openRecord(String(node.collection), r, action.screen)}>{action.label}</button></td> : null}</tr>)}
        {!shown.length ? <tr><td colSpan={columns.length + 1} className="db-empty">No matching records</td></tr> : null}</tbody></table></div>
    {filtered ? <p className="db-table-count">{shown.length} of {rows.length} records</p> : null}
  </div>;
}
function List({ node }: { node: NodeT }) {
  const rt = useRuntime();
  const all = rt.session.collections[String(node.collection)] ?? [];
  const action = node.itemAction as { screen: string } | undefined;
  const [q, setQ] = useState(''), [chip, setChip] = useState('');
  const filterField = node.filterField ? String(node.filterField) : undefined;
  const chips = useMemo(() => (filterField ? [...new Set(all.map(r => r[filterField]).filter(Boolean))] : []), [all, filterField]);
  const rows = filterRows(all, { search: node.searchable ? q : '', equals: filterField && chip ? { [filterField]: chip } : {} });
  const items = <ul className="db-list">{rows.map((r, i) => <li key={i}>
    <button type="button" disabled={!action} onClick={() => action && rt.interactive && rt.openRecord(String(node.collection), r, action.screen)}>
      <span className="db-list-main"><strong>{r[String(node.titleField)]}</strong>{node.subtitleField ? <small>{prettyDates(String(r[String(node.subtitleField)] ?? ''))}</small> : null}</span>
      {node.badgeField ? <span className="db-badge" data-tone={statusTone(r[String(node.badgeField)] ?? '')}>{r[String(node.badgeField)]}</span> : null}
    </button></li>)}
    {!rows.length ? <li className="db-empty">No matching items</li> : null}</ul>;
  if (!node.searchable && !filterField) return <div {...attrs(node, 'list-wrap')}>{items}</div>;
  return <div {...attrs(node, 'list-wrap')}>
    {node.searchable ? <input className="db-list-search" type="search" aria-label="Search" placeholder="Search…" value={q} onChange={e => setQ(e.target.value)} /> : null}
    {chips.length ? <div className="db-chips" role="group" aria-label="Filter">{['', ...chips].map(c => <button key={c || 'all'} type="button" aria-pressed={chip === c} onClick={() => setChip(c)}>{c || 'All'}</button>)}</div> : null}
    {items}
  </div>;
}
function Template({ node }: { node: NodeT }) { return <div {...attrs(node, 'template')}><Nodes nodes={expandTemplate(node)} /></div>; }

export const renderers: Record<string, (p: { node: NodeT }) => React.ReactElement> = {
  Stack, Grid, Section, Card, Form, Heading, Text, Notice, Stat, Image, Progress, Steps, Badge, Divider, RecordFields,
  Input, Select, Radio, Checkbox, Toggle, Upload, Button, Table, List, Template,
};
