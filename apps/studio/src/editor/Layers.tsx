// Layers: the screen's component tree. Click selects; drag a row onto another row to place it
// before/after it, or onto a container's middle to put it inside. Keyboard users use the toolbar.
import React, { useState } from 'react';
import { ChevronRight, GripVertical } from 'lucide-react';
import { componentLabel, isContainer, canContain, type NodeT } from '@demo/schema';

export type Drop = { parentId: string | null; index: number };
type Props = { nodes: NodeT[]; selected: string | null; onSelect: (id: string) => void; onMove: (id: string, to: Drop) => void; onInsertType: (type: string, to: Drop) => void };

const preview = (n: NodeT) => String(n.text ?? n.title ?? n.label ?? (n as any).primary?.label ?? n.name ?? n.headline ?? '').slice(0, 32);
export const DRAG_TYPE = 'application/x-demo-component';

export function Layers(props: Props) {
  const [over, setOver] = useState<{ id: string; where: 'before' | 'after' | 'inside' } | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const types = new Map<string, string>();
  const index = (ns: NodeT[]) => ns.forEach(n => { types.set(n.id, n.type); if (n.children) index(n.children as NodeT[]); });
  index(props.nodes);

  const row = (n: NodeT, parentId: string | null, i: number, depth: number): React.ReactNode => {
    const container = isContainer(n.type), open = !collapsed.has(n.id);
    const zone = (e: React.DragEvent) => {
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect(), y = (e.clientY - r.top) / r.height;
      return container && y > 0.3 && y < 0.7 ? 'inside' : y < 0.5 ? 'before' : 'after';
    };
    const target = (where: 'before' | 'after' | 'inside'): Drop => where === 'inside' ? { parentId: n.id, index: (n.children as NodeT[] | undefined)?.length ?? 0 } : { parentId, index: where === 'before' ? i : i + 1 };
    return <li key={n.id} role="treeitem" aria-selected={props.selected === n.id} aria-expanded={container ? open : undefined}>
      <div className={'layer-row' + (props.selected === n.id ? ' is-selected' : '') + (over?.id === n.id ? ' drop-' + over.where : '')}
        style={{ paddingLeft: 6 + depth * 14 }} draggable data-layer={n.id}
        onClick={() => props.onSelect(n.id)}
        onDragStart={e => { e.dataTransfer.setData(DRAG_TYPE, JSON.stringify({ move: n.id })); e.dataTransfer.effectAllowed = 'move'; }}
        onDragOver={e => { e.preventDefault(); setOver({ id: n.id, where: zone(e) }); }}
        onDragLeave={() => setOver(o => (o?.id === n.id ? null : o))}
        onDrop={e => {
          e.preventDefault(); const where = zone(e); setOver(null);
          const data = JSON.parse(e.dataTransfer.getData(DRAG_TYPE) || '{}');
          const to = target(where), parentType = to.parentId ? types.get(to.parentId)! : null;
          if (data.move && data.move !== n.id) { if (canContain(parentType, types.get(data.move)!)) props.onMove(data.move, to); }
          else if (data.insert && canContain(parentType, data.insert)) props.onInsertType(data.insert, to);
        }}>
        {container ? <button type="button" className="layer-toggle" aria-label={open ? 'Collapse' : 'Expand'} onClick={e => { e.stopPropagation(); setCollapsed(c => { const x = new Set(c); x.has(n.id) ? x.delete(n.id) : x.add(n.id); return x; }); }}><ChevronRight size={12} style={{ transform: open ? 'rotate(90deg)' : undefined }} /></button> : <span className="layer-toggle" />}
        <GripVertical size={12} className="layer-grip" />
        <span className="layer-type">{componentLabel(n.type)}</span>
        <span className="layer-text">{preview(n)}</span>
      </div>
      {container && open && (n.children as NodeT[] | undefined)?.length ? <ul role="group">{(n.children as NodeT[]).map((c, j) => row(c, n.id, j, depth + 1))}</ul> : null}
    </li>;
  };
  return <div className="layers" data-testid="layers">
    {props.nodes.length ? <ul role="tree" aria-label="Components on this screen">{props.nodes.map((n, i) => row(n, null, i, 0))}</ul> : null}
    <div className="layer-end" onDragOver={e => e.preventDefault()} onDrop={e => {
      e.preventDefault(); const data = JSON.parse(e.dataTransfer.getData(DRAG_TYPE) || '{}'); const to = { parentId: null, index: props.nodes.length };
      if (data.move) props.onMove(data.move, to); else if (data.insert) props.onInsertType(data.insert, to);
    }}>{props.nodes.length ? 'Drop here to place at the end' : 'Empty screen: add or drop a component here'}</div>
  </div>;
}
