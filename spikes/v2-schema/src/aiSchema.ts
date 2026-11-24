// Derive a provider-ready, strict JSON Schema for ONE screen from the registry.
// Strict structured-output rules applied (OpenAI strict mode, also valid for
// other providers' JSON-schema decoding):
//   - every object: additionalProperties:false and all properties required
//   - optional properties become nullable (null is stripped after decoding)
//   - oneOf -> anyOf; unsupported keywords removed (enforced by the validator)
//   - reference markers become enums of the real IDs for this generation job
import { z } from 'zod';
import { Screen } from './registry.ts';

const UNSUPPORTED = new Set(['$schema', 'default', 'minLength', 'maxLength', 'format', 'propertyNames', 'examples']);

export type SchemaContext = { screenIds: string[]; collectionIds: string[]; templateIds: string[]; screenId?: string };

export function aiScreenSchema(ctx: SchemaContext, opts: { maxDepth?: number } = {}) {
  const raw = z.toJSONSchema(Screen, { io: 'input', unrepresentable: 'throw' }) as any;
  let out = strictify(raw, ctx);
  if (ctx.screenId) out.properties.id = { type: 'string', enum: [ctx.screenId] };
  if (opts.maxDepth) out = unroll(out, opts.maxDepth);
  return out;
}

function enumFor(ref: string, ctx: SchemaContext) {
  const values = ref === 'screen' ? ctx.screenIds : ref === 'collection' ? ctx.collectionIds : ref === 'template' ? ctx.templateIds : null;
  if (!values) throw Error('Unknown ref ' + ref);
  // An empty enum is invalid JSON Schema; use an impossible sentinel instead.
  return { type: 'string', enum: values.length ? values : ['__none__'] };
}

function strictify(node: any, ctx: SchemaContext): any {
  if (Array.isArray(node)) return node.map(n => strictify(n, ctx));
  if (!node || typeof node !== 'object') return node;
  if (typeof node.ref === 'string') return enumFor(node.ref, ctx);
  const out: any = {};
  for (const [k, v] of Object.entries(node)) {
    if (UNSUPPORTED.has(k)) continue;
    if (k === 'oneOf') { out.anyOf = strictify(v, ctx); continue; }
    if (k === 'properties' || k === '$defs') { out[k] = Object.fromEntries(Object.entries(v as any).map(([pk, pv]) => [pk, strictify(pv, ctx)])); continue; }
    out[k] = strictify(v, ctx);
  }
  if (out.type === 'object' && out.properties) {
    const required = new Set(out.required || []);
    for (const key of Object.keys(out.properties)) {
      if (!required.has(key)) out.properties[key] = nullable(out.properties[key]);
    }
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

// Alternative variant without $ref recursion: inline the node union to a fixed
// depth. Used if a provider/model rejects recursive schemas.
function unroll(schema: any, depth: number) {
  const defs = schema.$defs || {};
  const nodeKey = Object.keys(defs)[0];
  if (!nodeKey) return schema;
  const nodeDef = defs[nodeKey];
  const build = (level: number): any => {
    const copy = structuredClone(nodeDef);
    const visit = (n: any) => {
      if (!n || typeof n !== 'object') return;
      if (n.properties?.children) {
        if (level >= depth) { delete n.properties.children; n.required = n.required.filter((r: string) => r !== 'children'); n.__leafOnly = true; }
        else n.properties.children = { type: 'array', items: build(level + 1) };
        return; // children subtree is already built; do not descend into it
      }
      for (const v of Object.values(n)) if (typeof v === 'object') visit(v);
    };
    visit(copy);
    // Containers without children at the depth limit are removed from the union.
    if (level >= depth && copy.anyOf) copy.anyOf = copy.anyOf.filter((o: any) => !o.__leafOnly);
    return JSON.parse(JSON.stringify(copy, (k, v) => (k === '__leafOnly' ? undefined : v)));
  };
  const out = structuredClone(schema);
  delete out.$defs;
  out.properties.children = { type: 'array', items: build(1) };
  return out;
}

// Lint against documented strict-mode constraints so incompatibilities are caught
// before paying for an API call.
export function lintStrict(schema: any) {
  const problems: string[] = [];
  let properties = 0, enumValues = 0, maxDepth = 0;
  const walk = (n: any, path: string, depth: number) => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) { n.forEach((x, i) => walk(x, path + '[' + i + ']', depth)); return; }
    if (n.type === 'object' || (Array.isArray(n.type) && n.type.includes('object'))) {
      maxDepth = Math.max(maxDepth, depth);
      if (n.additionalProperties !== false) problems.push(path + ': additionalProperties must be false');
      const keys = Object.keys(n.properties || {});
      properties += keys.length;
      if (keys.some(k => !(n.required || []).includes(k))) problems.push(path + ': all properties must be required');
    }
    if (n.enum) enumValues += n.enum.length;
    for (const k of Object.keys(n)) if (UNSUPPORTED.has(k) || k === 'oneOf' || k === 'ref') problems.push(path + ': unsupported keyword ' + k);
    for (const [k, v] of Object.entries(n)) walk(v, path + '.' + k, (k === 'properties' ? depth + 1 : depth));
  };
  walk(schema, '$', 0);
  if (schema.type !== 'object') problems.push('$: root must be an object');
  if (schema.anyOf) problems.push('$: root must not be anyOf');
  return { problems, properties, enumValues, objectDepth: maxDepth, bytes: JSON.stringify(schema).length };
}

// Decoded strict output uses null for "absent"; remove nulls before validation.
export function stripNulls<T>(value: T): T {
  if (Array.isArray(value)) return value.map(stripNulls) as any;
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== null).map(([k, v]) => [k, stripNulls(v)])) as any;
  return value;
}
