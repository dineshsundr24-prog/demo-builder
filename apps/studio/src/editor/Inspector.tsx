// Properties panel generated from the registry's JSON Schema: every component (now and future)
// gets an editor without hand-written forms. Screen/collection/template references become pickers;
// discriminated unions (actions) become a type picker plus that variant's fields.
import React from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { propsJsonSchema, templateIds, componentLabel, type DemoDocument, type NodeT } from '@demo/schema';

type Ctx = { doc: DemoDocument; defs: Record<string, any>; fields?: { id: string; label: string }[] };
// Props that name a field of the component's data collection (shown as a picker of its fields).
const FIELD_KEYS = new Set(['field', 'filterField', 'dateFilterField', 'titleField', 'subtitleField', 'badgeField']);
type FieldProps = { schema: any; value: any; onChange: (v: any) => void; label: string; required: boolean; ctx: Ctx; path: string };

const humanize = (k: string) => k.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[-_]/g, ' ').replace(/^./, c => c.toUpperCase());
function resolve(s: any, defs: Record<string, any>): any {
  if (s?.$ref) return resolve(defs[s.$ref.split('/').pop()], defs);
  return s ?? {};
}
const variants = (s: any) => (s.oneOf ?? s.anyOf) as any[] | undefined;
const variantKey = (v: any) => v?.properties?.type?.const as string | undefined;

/** A sensible starting value for a schema (used when adding list items or switching variants). */
export function defaultFor(s0: any, ctx: Ctx): any {
  const s = resolve(s0, ctx.defs);
  const vs = variants(s);
  if (vs) return defaultFor(vs[0], ctx);
  if (s.const !== undefined) return s.const;
  if (s.enum) return s.enum[0];
  if (s.ref === 'screen') return ctx.doc.screens[0]?.id ?? '';
  if (s.ref === 'collection') return ctx.doc.collections[0]?.id ?? '';
  if (s.ref === 'template') return templateIds[0];
  switch (s.type) {
    case 'string': return s.minLength ? 'New' : '';
    case 'number': case 'integer': return s.minimum ?? 0;
    case 'boolean': return false;
    case 'array': return Array.from({ length: s.minItems ?? 0 }, () => defaultFor(s.items, ctx));
    case 'object': return Object.fromEntries((s.required ?? []).map((k: string) => [k, defaultFor(s.properties[k], ctx)]));
    default: return '';
  }
}

function Field({ schema, value, onChange, label, required, ctx, path }: FieldProps) {
  const s = resolve(schema, ctx.defs);
  const id = 'f-' + path.replace(/[^A-Za-z0-9]+/g, '-');
  const vs = variants(s);
  if (vs && vs.every(variantKey)) return <VariantField {...{ schema: s, value, onChange, label, required, ctx, path }} />;
  const clearable = !required;
  const set = (v: any) => onChange(v === '' && clearable ? undefined : v);
  const head = <label className="insp-label" htmlFor={id}>{label}{required ? '' : <span className="insp-opt"> optional</span>}</label>;
  const pick = (options: { value: string; label: string }[]) => <div className="insp-field">{head}
    <select id={id} value={value ?? ''} onChange={e => set(e.target.value)}>
      {clearable || value === undefined ? <option value="">—</option> : null}
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select></div>;
  const key = path.split('.').pop() ?? '';
  if (ctx.fields?.length && s.type === 'string' && FIELD_KEYS.has(key)) return pick(ctx.fields.map(f => ({ value: f.id, label: f.label })));
  if (ctx.fields?.length && s.type === 'array' && key === 'moreFilters') return <fieldset className="insp-group"><legend>{label}{required ? '' : <span className="insp-opt"> optional</span>}</legend>
    {ctx.fields.map(f => <label key={f.id} className="insp-check-row"><input type="checkbox" checked={(value ?? []).includes(f.id)} disabled={!(value ?? []).includes(f.id) && (value ?? []).length >= (s.maxItems ?? 2)}
      onChange={e => { const next = e.target.checked ? [...(value ?? []), f.id] : (value ?? []).filter((x: string) => x !== f.id); onChange(next.length ? next : undefined); }} />{f.label}</label>)}</fieldset>;
  if (s.ref === 'screen') return pick(ctx.doc.screens.map(x => ({ value: x.id, label: x.title })));
  if (s.ref === 'collection') return pick(ctx.doc.collections.map(x => ({ value: x.id, label: x.label })));
  if (s.ref === 'template') return pick(templateIds.map(t => ({ value: t, label: t })));
  if (s.enum) return pick(s.enum.map((v: any) => ({ value: String(v), label: String(v) })));
  if (s.type === 'boolean') return <div className="insp-field insp-check"><label htmlFor={id}><input id={id} type="checkbox" checked={!!value} onChange={e => onChange(e.target.checked)} />{label}</label></div>;
  if (s.type === 'number' || s.type === 'integer') return <div className="insp-field">{head}<input id={id} type="number" value={value ?? ''} min={s.minimum} max={s.maximum} onChange={e => set(e.target.value === '' ? '' : Number(e.target.value))} /></div>;
  if (s.type === 'string') {
    const long = (s.maxLength ?? 0) > 120;
    return <div className="insp-field">{head}{long
      ? <textarea id={id} rows={3} value={value ?? ''} maxLength={s.maxLength} onChange={e => set(e.target.value)} />
      : <input id={id} type="text" value={value ?? ''} maxLength={s.maxLength} onChange={e => set(e.target.value)} />}</div>;
  }
  if (s.type === 'array') {
    const items = resolve(s.items, ctx.defs);
    if (items.type === 'string' && !items.enum && !items.ref) return <div className="insp-field">{head}<textarea id={id} rows={3} placeholder="One per line" value={(value ?? []).join('\n')} onChange={e => onChange(e.target.value.split('\n').map(x => x.trimStart()).filter((x, i, a) => x || i < a.length - 1))} /></div>;
    if (items.type === 'number') return <div className="insp-field">{head}<input id={id} type="text" placeholder="Comma separated" value={(value ?? []).join(', ')} onChange={e => onChange(e.target.value.split(',').map(x => x.trim()).filter(Boolean).map(Number).filter(n => !Number.isNaN(n)))} /></div>;
    return <ListField {...{ schema: s, value: value ?? [], onChange, label, required, ctx, path }} />;
  }
  if (s.type === 'object') {
    if (value === undefined && clearable) return <div className="insp-field">{head}<button type="button" className="insp-add" onClick={() => onChange(defaultFor(s, ctx))}><Plus size={13} />Add {label.toLowerCase()}</button></div>;
    return <fieldset className="insp-group"><legend>{label}{clearable ? <button type="button" className="insp-icon" title={'Remove ' + label} onClick={() => onChange(undefined)}><Trash2 size={12} /></button> : null}</legend>
      <ObjectFields schema={s} value={value ?? {}} onChange={onChange} ctx={ctx} path={path} /></fieldset>;
  }
  return null;
}

function ObjectFields({ schema, value, onChange, ctx, path, skip = [] }: { schema: any; value: any; onChange: (v: any) => void; ctx: Ctx; path: string; skip?: string[] }) {
  const req = new Set<string>(schema.required ?? []);
  return <>{Object.entries(schema.properties ?? {}).filter(([k]) => !skip.includes(k)).map(([k, ps]) =>
    <Field key={k} schema={ps} value={value?.[k]} required={req.has(k)} label={humanize(k)} ctx={ctx} path={path + '.' + k}
      onChange={v => { const next = { ...value, [k]: v }; if (v === undefined) delete next[k]; onChange(next); }} />)}</>;
}

function VariantField({ schema, value, onChange, label, ctx, path }: FieldProps) {
  const vs = variants(schema)!;
  const current = vs.find(v => variantKey(v) === value?.type) ?? vs[0];
  return <div className="insp-variant">
    <select aria-label={label + ' type'} value={variantKey(current)} onChange={e => onChange(defaultFor(vs.find(v => variantKey(v) === e.target.value), ctx))}>
      {vs.map(v => <option key={variantKey(v)} value={variantKey(v)}>{humanize(variantKey(v)!)}</option>)}
    </select>
    {current.description ? <p className="insp-help">{current.description}</p> : null}
    <ObjectFields schema={current} value={value} onChange={onChange} ctx={ctx} path={path} skip={['type']} />
  </div>;
}

function ListField({ schema, value, onChange, label, ctx, path }: FieldProps) {
  const items: any[] = value;
  const max = schema.maxItems ?? 50, min = schema.minItems ?? 0;
  const itemSchema = resolve(schema.items, ctx.defs);
  const set = (i: number, v: any) => onChange(items.map((x, j) => (j === i ? v : x)));
  const move = (i: number, d: number) => { const l = [...items]; [l[i], l[i + d]] = [l[i + d], l[i]]; onChange(l); };
  const title = (it: any, i: number) => String(it?.label ?? it?.title ?? it?.type ?? it?.field ?? (typeof it === 'string' ? it : '#' + (i + 1)));
  return <fieldset className="insp-group insp-list"><legend>{label} <span className="insp-opt">{items.length}{max < 50 ? ' / ' + max : ''}</span></legend>
    {items.map((it, i) => <details key={i} className="insp-item" open={items.length <= 2}>
      <summary><span>{humanize(title(it, i))}</span>
        <span className="insp-item-tools" onClick={e => e.preventDefault()}>
          <button type="button" className="insp-icon" title="Move up" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp size={12} /></button>
          <button type="button" className="insp-icon" title="Move down" disabled={i === items.length - 1} onClick={() => move(i, 1)}><ArrowDown size={12} /></button>
          <button type="button" className="insp-icon" title="Remove" disabled={items.length <= min} onClick={() => onChange(items.filter((_, j) => j !== i))}><Trash2 size={12} /></button>
        </span></summary>
      {itemSchema.type === 'object' && !variants(itemSchema)
        ? <div className="insp-item-body"><ObjectFields schema={itemSchema} value={it} onChange={v => set(i, v)} ctx={ctx} path={path + '.' + i} /></div>
        : <Field schema={itemSchema} value={it} onChange={v => set(i, v)} label={label + ' ' + (i + 1)} required ctx={ctx} path={path + '.' + i} />}
    </details>)}
    <button type="button" className="insp-add" disabled={items.length >= max} onClick={() => onChange([...items, defaultFor(itemSchema, ctx)])}><Plus size={13} />Add {itemSchema.properties?.type ? 'action' : 'item'}</button>
  </fieldset>;
}

export function Inspector({ doc, node, onChange, onRename }: { doc: DemoDocument; node: NodeT; onChange: (patch: Record<string, unknown>) => void; onRename: (id: string) => void }) {
  const schema = propsJsonSchema(node.type);
  if (!schema) return <p className="insp-help">No editable properties for {node.type}.</p>;
  const col = typeof node.collection === 'string' ? doc.collections.find(c => c.id === node.collection) : undefined;
  const ctx: Ctx = { doc, defs: schema.$defs ?? {}, ...(col ? { fields: col.fields } : {}) };
  const { type: _t, id: _i, children: _c, ...props } = node; void _t; void _i; void _c;
  return <div className="insp" data-testid="inspector">
    <div className="insp-head"><strong>{componentLabel(node.type)}</strong>
      <input aria-label="Component id" className="insp-id" defaultValue={node.id} key={node.id} onBlur={e => e.target.value.trim() && e.target.value !== node.id && onRename(e.target.value.trim())} /></div>
    <ObjectFields schema={schema} value={props} ctx={ctx} path={node.id}
      onChange={next => { const patch: Record<string, unknown> = { ...next }; for (const k of Object.keys(props)) if (!(k in next)) patch[k] = undefined; onChange(patch); }} />
  </div>;
}
