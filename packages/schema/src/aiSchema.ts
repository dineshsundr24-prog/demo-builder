// Strict, provider-ready JSON Schema for ONE screen, derived from the registry
// (Decisions D1/D2). The schema is identical for every call in a job so the
// provider can cache it; the returned screen id is checked by the validator.
import { z } from 'zod';
import { Screen } from './document.ts';
import { components } from './registry.ts';
import { templates } from './templates.ts';

const UNSUPPORTED = new Set(['$schema', 'default', 'minLength', 'maxLength', 'format', 'propertyNames', 'examples']);
export type AiContext = { channel: 'mobile' | 'portal'; screenIds: string[]; collectionIds: string[] };

export function aiScreenSchema(ctx: AiContext) {
  const raw = z.toJSONSchema(Screen, { io: 'input', unrepresentable: 'throw' }) as any;
  const templateIds = templates.filter(t => t.channels.includes(ctx.channel)).map(t => t.id);
  return strictify(raw, { screen: ctx.screenIds, collection: ctx.collectionIds, template: templateIds });
}
function strictify(node: any, refs: Record<string, string[]>): any {
  if (Array.isArray(node)) return node.map(n => strictify(n, refs));
  if (!node || typeof node !== 'object') return node;
  if (typeof node.ref === 'string') {
    const values = refs[node.ref];
    if (!values) throw Error('Unknown ref ' + node.ref);
    return { type: 'string', enum: values.length ? values : ['__none__'] };
  }
  const out: any = {};
  for (const [k, v] of Object.entries(node)) {
    if (UNSUPPORTED.has(k)) continue;
    if (k === 'oneOf') { out.anyOf = strictify(v, refs); continue; }
    if (k === 'properties' || k === '$defs') { out[k] = Object.fromEntries(Object.entries(v as object).map(([pk, pv]) => [pk, strictify(pv, refs)])); continue; }
    out[k] = strictify(v, refs);
  }
  if (out.type === 'object' && out.properties) {
    const required = new Set(out.required || []);
    for (const key of Object.keys(out.properties)) if (!required.has(key)) out.properties[key] = nullable(out.properties[key]);
    out.required = Object.keys(out.properties);
    out.additionalProperties = false;
  }
  return out;
}
function nullable(schema: any) {
  if (schema.anyOf) return { ...schema, anyOf: [...schema.anyOf, { type: 'null' }] };
  if (schema.$ref) return { anyOf: [schema, { type: 'null' }] };
  if (typeof schema.type === 'string') return { ...schema, type: [schema.type, 'null'], ...(schema.enum ? { enum: [...schema.enum, null] } : {}) };
  return { anyOf: [schema, { type: 'null' }] };
}
export function lintStrict(schema: any) {
  const problems: string[] = [];
  let properties = 0, enumValues = 0;
  const visit = (n: any, path: string) => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) return n.forEach((x, i) => visit(x, path + '[' + i + ']'));
    if (n.type === 'object') {
      if (n.additionalProperties !== false) problems.push(path + ': additionalProperties must be false');
      const keys = Object.keys(n.properties || {}); properties += keys.length;
      if (keys.some(k => !(n.required || []).includes(k))) problems.push(path + ': all properties must be required');
    }
    if (n.enum) enumValues += n.enum.length;
    for (const k of Object.keys(n)) if (UNSUPPORTED.has(k) || k === 'oneOf' || k === 'ref') problems.push(path + ': unsupported keyword ' + k);
    for (const [k, v] of Object.entries(n)) {
      // Keys of "properties"/"$defs" are names chosen by us, not JSON Schema keywords.
      if ((k === 'properties' || k === '$defs') && v && typeof v === 'object') for (const [name, sub] of Object.entries(v)) visit(sub, path + '.' + k + '.' + name);
      else visit(v, path + '.' + k);
    }
  };
  visit(schema, '$');
  if (schema.type !== 'object' || schema.anyOf) problems.push('$: root must be a plain object');
  if (enumValues > 1000) problems.push('$: more than 1000 enum values');
  return { problems, properties, enumValues, bytes: JSON.stringify(schema).length };
}
/** Strict decoding returns null for absent optionals; remove them. */
export function stripNulls<T>(value: T): T {
  if (Array.isArray(value)) return value.map(stripNulls) as T;
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== null).map(([k, v]) => [k, stripNulls(v)])) as T;
  return value;
}
/** Compact component guide for the model, generated from the registry. */
export function componentGuide(channel: 'mobile' | 'portal') {
  const comps = components.filter(c => c.channels.includes(channel)).map(c => '- ' + c.type + (c.container ? ' (container)' : '') + ': ' + c.ai).join('\n');
  const tmpl = templates.filter(t => t.channels.includes(channel)).map(t => '- ' + t.id + ': ' + t.description).join('\n');
  return 'Components:\n' + comps + '\nTemplates (use a Template node; set next):\n' + tmpl +
    '\nBindings: {{state.key}} for values entered earlier, {{record.field}} on screens opened from a table/list row, optional | aed | date | upper | mask.';
}
