// Component palette from the registry, grouped by category and filtered by channel.
// Click adds after the selection (or inside it when it is a container); drag drops into Layers.
import React, { useState } from 'react';
import { components, type Channel } from '@demo/schema';
import { DRAG_TYPE } from './Layers.tsx';

const ORDER: [string, string][] = [['pattern', 'Designed blocks'], ['template', 'Journey templates'], ['layout', 'Layout'], ['content', 'Content'], ['input', 'Inputs'], ['action', 'Actions'], ['data', 'Data']];

export function Palette({ channel, onAdd }: { channel: Channel; onAdd: (type: string) => void }) {
  const [q, setQ] = useState('');
  const list = components.filter(c => c.channels.includes(channel) && (!q || (c.label + ' ' + c.type + ' ' + c.ai).toLowerCase().includes(q.toLowerCase())));
  return <div className="palette" data-testid="palette">
    <input type="search" placeholder="Search components" aria-label="Search components" value={q} onChange={e => setQ(e.target.value)} />
    {ORDER.map(([cat, title]) => {
      const items = list.filter(c => c.category === cat);
      return items.length ? <section key={cat}><h4>{title}</h4><div className="palette-grid">
        {items.map(c => <button key={c.type} type="button" draggable title={c.ai} data-type={c.type}
          onDragStart={e => { e.dataTransfer.setData(DRAG_TYPE, JSON.stringify({ insert: c.type })); e.dataTransfer.effectAllowed = 'copy'; }}
          onClick={() => onAdd(c.type)}>{c.label}</button>)}
      </div></section> : null;
    })}
  </div>;
}
