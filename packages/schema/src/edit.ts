// Pure, immutable editing operations on a DemoDocument (the visual editor's command layer).
// Every operation returns a new document and never mutates its input, so the editor can keep
// an undo history by reference. Ids stay unique per screen (the validator's rule).
import { z } from 'zod';
import { componentByType, containerTypes, createNode, type NodeT } from './registry.ts';
import type { DemoDocument, Screen } from './document.ts';

export type NodeLocation = { parentId: string | null; index: number; path: number[] };

const clone = <T>(v: T): T => structuredClone(v);
const kids = (n: NodeT): NodeT[] => (Array.isArray(n.children) ? (n.children as NodeT[]) : []);

export function findNode(nodes: NodeT[], id: string, parentId: string | null = null, path: number[] = []): (NodeLocation & { node: NodeT }) | null {
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (n.id === id) return { node: n, parentId, index: i, path: [...path, i] };
    const hit = findNode(kids(n), id, n.id, [...path, i]);
    if (hit) return hit;
  }
  return null;
}
export function allIds(nodes: NodeT[], out = new Set<string>()): Set<string> {
  for (const n of nodes) { out.add(n.id); allIds(kids(n), out); }
  return out;
}
export function uniqueId(base: string, taken: Set<string>): string {
  const root = (base.replace(/[^A-Za-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').replace(/-\d+$/, '') || 'node').slice(0, 56);
  if (!taken.has(root)) return root;
  for (let n = 2; ; n++) if (!taken.has(root + '-' + n)) return root + '-' + n;
}
/** Give a subtree fresh ids that do not collide with `taken` (used by insert and duplicate). */
function reId(node: NodeT, taken: Set<string>): NodeT {
  const id = uniqueId(node.id || node.type.toLowerCase(), taken); taken.add(id);
  return { ...node, id, ...(Array.isArray(node.children) ? { children: kids(node).map(c => reId(c, taken)) } : {}) };
}

function mapScreen(doc: DemoDocument, screenId: string, fn: (s: Screen) => Screen): DemoDocument {
  if (!doc.screens.some(s => s.id === screenId)) throw Error('Unknown screen ' + screenId);
  return { ...doc, screens: doc.screens.map(s => (s.id === screenId ? fn(s) : s)) };
}
/** Replace the children list of `parentId` (null = the screen root). */
function withChildren(nodes: NodeT[], parentId: string | null, fn: (list: NodeT[]) => NodeT[]): NodeT[] {
  if (parentId === null) return fn(nodes);
  return nodes.map(n => (n.id === parentId ? { ...n, children: fn(kids(n)) } : Array.isArray(n.children) ? { ...n, children: withChildren(kids(n), parentId, fn) } : n));
}
function isInside(nodes: NodeT[], ancestorId: string, id: string): boolean {
  const a = findNode(nodes, ancestorId); return !!a && !!findNode(kids(a.node), id);
}

export function updateNode(doc: DemoDocument, screenId: string, nodeId: string, patch: Record<string, unknown>): DemoDocument {
  const { type: _t, id: _i, children: _c, ...props } = patch; void _t; void _i; void _c;
  const update = (nodes: NodeT[]): NodeT[] => nodes.map(n => {
    if (n.id === nodeId) { const next: NodeT = { ...n, ...props }; for (const [k, v] of Object.entries(props)) if (v === undefined) delete next[k]; return next; }
    return Array.isArray(n.children) ? { ...n, children: update(kids(n)) } : n;
  });
  return mapScreen(doc, screenId, s => ({ ...s, children: update(s.children as NodeT[]) }));
}
/** Rename a component id (unique on the screen); references from submit actions follow. */
export function renameNode(doc: DemoDocument, screenId: string, nodeId: string, nextId: string): DemoDocument {
  const screen = doc.screens.find(s => s.id === screenId)!;
  const taken = allIds(screen.children as NodeT[]); taken.delete(nodeId);
  const id = uniqueId(nextId, taken);
  const visit = (v: any): any => Array.isArray(v) ? v.map(visit) : v && typeof v === 'object'
    ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, (k === 'id' && x === nodeId) || (k === 'form' && x === nodeId) ? id : visit(x)])) : v;
  return mapScreen(doc, screenId, s => ({ ...s, children: visit(s.children) }));
}
export function canContain(parentType: string | null, childType: string): boolean {
  if (parentType === null) return true;
  if (!containerTypes.has(parentType)) return false;
  return !(childType === 'Form' && parentType === 'Form');
}
/** Insert a new component (by type) or a given subtree at parent/index; returns the doc and the new id. */
export function insertNode(doc: DemoDocument, screenId: string, parentId: string | null, index: number, what: string | NodeT): { doc: DemoDocument; id: string } {
  const screen = doc.screens.find(s => s.id === screenId);
  if (!screen) throw Error('Unknown screen ' + screenId);
  const nodes = screen.children as NodeT[];
  const parent = parentId === null ? null : findNode(nodes, parentId);
  if (parentId !== null && !parent) throw Error('Unknown parent ' + parentId);
  const node = typeof what === 'string' ? createNode(what, what.toLowerCase()) : clone(what);
  if (!canContain(parent?.node.type ?? null, node.type)) throw Error(node.type + ' cannot be placed inside ' + parent!.node.type);
  const fresh = reId(node, allIds(nodes));
  const next = withChildren(nodes, parentId, list => { const l = [...list]; l.splice(Math.max(0, Math.min(index, l.length)), 0, fresh); return l; });
  return { doc: mapScreen(doc, screenId, s => ({ ...s, children: next })), id: fresh.id };
}
export function removeNode(doc: DemoDocument, screenId: string, nodeId: string): DemoDocument {
  const drop = (nodes: NodeT[]): NodeT[] => nodes.filter(n => n.id !== nodeId).map(n => (Array.isArray(n.children) ? { ...n, children: drop(kids(n)) } : n));
  return mapScreen(doc, screenId, s => ({ ...s, children: drop(s.children as NodeT[]) }));
}
export function duplicateNode(doc: DemoDocument, screenId: string, nodeId: string): { doc: DemoDocument; id: string } {
  const screen = doc.screens.find(s => s.id === screenId)!;
  const loc = findNode(screen.children as NodeT[], nodeId);
  if (!loc) throw Error('Unknown component ' + nodeId);
  return insertNode(doc, screenId, loc.parentId, loc.index + 1, loc.node);
}
/** Move a component to parent/index (index counted in the target list before removal). */
export function moveNode(doc: DemoDocument, screenId: string, nodeId: string, parentId: string | null, index: number): DemoDocument {
  const screen = doc.screens.find(s => s.id === screenId)!;
  const nodes = screen.children as NodeT[];
  const loc = findNode(nodes, nodeId);
  if (!loc) throw Error('Unknown component ' + nodeId);
  if (parentId === nodeId || (parentId && isInside(nodes, nodeId, parentId))) throw Error('A component cannot be moved inside itself');
  const parent = parentId === null ? null : findNode(nodes, parentId);
  if (!canContain(parent?.node.type ?? null, loc.node.type)) throw Error(loc.node.type + ' cannot be placed inside ' + parent!.node.type);
  const adjusted = loc.parentId === parentId && loc.index < index ? index - 1 : index;
  const without = withChildren(nodes, loc.parentId, list => list.filter(n => n.id !== nodeId));
  const next = withChildren(without, parentId, list => { const l = [...list]; l.splice(Math.max(0, Math.min(adjusted, l.length)), 0, loc.node); return l; });
  return mapScreen(doc, screenId, s => ({ ...s, children: next }));
}
/** Move up (-1) or down (+1) among siblings. */
export function nudgeNode(doc: DemoDocument, screenId: string, nodeId: string, delta: -1 | 1): DemoDocument {
  const loc = findNode(doc.screens.find(s => s.id === screenId)!.children as NodeT[], nodeId);
  if (!loc) return doc;
  return moveNode(doc, screenId, nodeId, loc.parentId, loc.index + (delta > 0 ? 2 : -1));
}

// ---------- screens ----------
export function addScreen(doc: DemoDocument, title: string, afterId?: string): { doc: DemoDocument; id: string } {
  const id = uniqueId(title.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'screen', new Set(doc.screens.map(s => s.id)));
  const screen: Screen = { id, title: title.slice(0, 85) || 'New screen', shell: 'default', children: [] };
  const at = afterId ? doc.screens.findIndex(s => s.id === afterId) + 1 : doc.screens.length;
  const screens = [...doc.screens]; screens.splice(at <= 0 ? screens.length : at, 0, screen);
  return { doc: { ...doc, screens }, id };
}
export function updateScreen(doc: DemoDocument, screenId: string, patch: Partial<Pick<Screen, 'title' | 'subtitle' | 'shell'>>): DemoDocument {
  return mapScreen(doc, screenId, s => { const next = { ...s, ...patch }; if (patch.subtitle === '') delete next.subtitle; return next; });
}
export function duplicateScreen(doc: DemoDocument, screenId: string): { doc: DemoDocument; id: string } {
  const src = doc.screens.find(s => s.id === screenId)!;
  const { doc: d, id } = addScreen(doc, src.title + ' copy', screenId);
  return { doc: { ...d, screens: d.screens.map(s => (s.id === id ? { ...clone(src), id, title: (src.title + ' (copy)').slice(0, 85) } : s)) }, id };
}
/** Delete a screen; navigation to it is removed and shell items pointing to it are dropped. */
export function removeScreen(doc: DemoDocument, screenId: string): DemoDocument {
  if (doc.screens.length <= 1) throw Error('A demo needs at least one screen');
  const strip = (v: any): any => {
    if (Array.isArray(v)) return v.filter(x => !(x && typeof x === 'object' && x.type === 'navigate' && x.screen === screenId)).map(strip);
    if (v && typeof v === 'object') {
      const out: any = {};
      for (const [k, x] of Object.entries(v)) { if ((k === 'next' || k === 'alt') && x === screenId) continue; if ((k === 'rowAction' || k === 'itemAction') && (x as any)?.screen === screenId) continue; out[k] = strip(x); }
      return out;
    }
    return v;
  };
  const screens = doc.screens.filter(s => s.id !== screenId).map(s => ({ ...s, children: strip(s.children) }));
  const items = doc.shell.items.filter(i => i.screen !== screenId);
  return { ...doc, screens, shell: { ...doc.shell, items, kind: items.length ? doc.shell.kind : doc.shell.kind } };
}
export function moveScreen(doc: DemoDocument, screenId: string, delta: -1 | 1): DemoDocument {
  const i = doc.screens.findIndex(s => s.id === screenId), j = i + delta;
  if (i < 0 || j < 0 || j >= doc.screens.length) return doc;
  const screens = [...doc.screens]; [screens[i], screens[j]] = [screens[j], screens[i]];
  return { ...doc, screens };
}
export const isContainer = (type: string) => containerTypes.has(type);
export const componentLabel = (type: string) => componentByType.get(type)?.label ?? type;

const propSchemas = new Map<string, any>();
/** JSON Schema of a component's props (drives the editor inspector; refs: screen/collection/template). */
export function propsJsonSchema(type: string): any {
  if (!propSchemas.has(type)) {
    const def = componentByType.get(type);
    propSchemas.set(type, def ? z.toJSONSchema(def.props, { io: 'input', unrepresentable: 'any' }) : null);
  }
  return propSchemas.get(type);
}
