// Component palette from the registry, grouped by category and filtered by channel.
// Click adds after the selection (or inside it when it is a container); drag drops into Layers.
import React, { useState } from 'react';
import { components, type Channel } from '@demo/schema';
import { DRAG_TYPE } from './Layers.tsx';

// Everyday words people search for, mapped to components (or to how the app already does it).
const SYNONYMS: [RegExp, string][] = [[/\bback|return|previous/i, 'back'], [/title|header|headline/i, 'heading'], [/paragraph|label|description|copy/i, 'text'], [/link|cta|action/i, 'button'],
  [/picture|photo|image|logo|icon/i, 'image'], [/field|textbox|entry/i, 'input'], [/dropdown|picker|choice/i, 'select'], [/table|grid|records/i, 'table'], [/kpi|metric|number/i, 'stat'], [/alert|banner|warning|info/i, 'notice']];
const ORDER: [string, string][] = [['pattern', 'Designed blocks'], ['template', 'Journey templates'], ['layout', 'Layout'], ['content', 'Content'], ['input', 'Inputs'], ['action', 'Actions'], ['data', 'Data']];

export function Palette({ channel, onAdd }: { channel: Channel; onAdd: (type: string) => void }) {
  const [q, setQ] = useState('');
  const terms = [q.toLowerCase(), ...q.toLowerCase().split(/\s+/).filter(w => w.length > 2), ...SYNONYMS.filter(([r]) => r.test(q)).map(([, t]) => t)].filter(Boolean);
  const list = components.filter(c => c.channels.includes(channel) && (!q || terms.some(t => t.split(/\s+/).every(w => (c.label + ' ' + c.type + ' ' + c.ai).toLowerCase().includes(w)))));
  const backHint = /\bback|return|previous/i.test(q);
  return <div className="palette" data-testid="palette">
    <input type="search" placeholder="Search components" aria-label="Search components" value={q} onChange={e => setQ(e.target.value)} />
    {backHint ? <p className="palette-hint">The back arrow appears automatically in the top bar whenever there is a previous screen. To send people to a specific screen, add a <strong>Button</strong> and choose its screen.</p> : null}
    {q && !list.length ? <p className="palette-hint">No component matches "{q}". Try the <strong>AI assistant</strong> and describe what you need.</p> : null}
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
