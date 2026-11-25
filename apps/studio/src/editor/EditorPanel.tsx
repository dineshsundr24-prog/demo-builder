// Right-hand editor panel: Properties (selected component or the screen), Layers, Add.
import React from 'react';
import { ArrowDown, ArrowUp, Copy, Trash2, Unlock, X } from 'lucide-react';
import { findNode, isContainer, type DemoDocument, type NodeT, type Screen } from '@demo/schema';
import { Inspector } from './Inspector.tsx';
import { Layers, type Drop } from './Layers.tsx';
import { Palette } from './Palette.tsx';

export type EditorApi = {
  doc: DemoDocument; screen: Screen; selected: string | null; select: (id: string | null) => void;
  updateNode: (id: string, patch: Record<string, unknown>) => void; renameNode: (id: string, next: string) => void;
  insert: (type: string, to?: Drop) => void; detach: (id: string) => void; move: (id: string, to: Drop) => void; remove: (id: string) => void; duplicate: (id: string) => void; nudge: (id: string, d: -1 | 1) => void;
  updateScreen: (patch: Partial<Pick<Screen, 'title' | 'subtitle' | 'shell'>>) => void; duplicateScreen: () => void; moveScreen: (d: -1 | 1) => void; removeScreen: () => void;
};

export type PanelTab = 'ai' | 'props' | 'layers' | 'add';
export function EditorPanel(api: EditorApi & { chat: React.ReactNode; tab: PanelTab; setTab: (t: PanelTab) => void }) {
  const { tab, setTab } = api;
  const loc = api.selected ? findNode(api.screen.children as NodeT[], api.selected) : null;
  const tabs: [PanelTab, string][] = [['ai', 'AI'], ['props', 'Properties'], ['layers', 'Layers'], ['add', 'Add']];
  return <aside className="editor-panel" data-testid="editor-panel" aria-label="Editor">
    <div className="editor-tabs" role="tablist">{tabs.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{l}</button>)}</div>
    {tab === 'ai' ? api.chat : null}
    <div className="editor-body" hidden={tab === 'ai'}>
      {tab === 'props' && (loc ? <>
        <div className="editor-node-tools" aria-label="Component actions">
          <button type="button" title="Move up" onClick={() => api.nudge(loc.node.id, -1)} disabled={loc.index === 0}><ArrowUp size={14} /></button>
          <button type="button" title="Move down" onClick={() => api.nudge(loc.node.id, 1)}><ArrowDown size={14} /></button>
          <button type="button" title="Duplicate (Ctrl+D)" onClick={() => api.duplicate(loc.node.id)}><Copy size={14} /></button>
          <button type="button" title="Delete (Del)" className="danger" onClick={() => api.remove(loc.node.id)}><Trash2 size={14} /></button>
          <button type="button" title="Deselect (Esc)" onClick={() => api.select(null)}><X size={14} /></button>
        </div>
        {loc.node.type === 'Template' ? <div className="insp-template" data-testid="template-note">
          <p>This is a ready-made journey step. Its texts, fields and buttons are built automatically, so they can't be edited one by one.</p>
          <button type="button" data-testid="customise-template" onClick={() => api.detach(loc.node.id)}><Unlock size={14} />Customise texts and buttons</button>
          <p className="insp-help">Turns it into normal components that look and work the same. You can undo this.</p>
        </div> : null}
        <Inspector key={api.screen.id + loc.node.id} doc={api.doc} node={loc.node} onChange={p => api.updateNode(loc.node.id, p)} onRename={next => api.renameNode(loc.node.id, next)} />
      </> : <ScreenSettings {...api} />)}
      {tab === 'layers' && <Layers nodes={api.screen.children as NodeT[]} selected={api.selected} onSelect={id => { api.select(id); }} onMove={api.move} onInsertType={(t, to) => api.insert(t, to)} />}
      {tab === 'add' && <>
        <p className="insp-help">{loc ? (isContainer(loc.node.type) ? 'Adds inside the selected ' + loc.node.type + '.' : 'Adds after the selected component.') : 'Adds at the end of the screen.'} You can also drag a block into Layers.</p>
        <Palette channel={api.doc.channel} onAdd={t => { api.insert(t); setTab('props'); }} />
      </>}
    </div>
  </aside>;
}

function ScreenSettings(api: EditorApi) {
  const s = api.screen, i = api.doc.screens.findIndex(x => x.id === s.id);
  return <div className="insp" data-testid="screen-settings">
    <div className="insp-head"><strong>Screen</strong><code className="insp-id">{s.id}</code></div>
    <p className="insp-help">Select a component on the screen or in Layers to edit it.</p>
    <div className="insp-field"><label className="insp-label" htmlFor="screen-title">Title</label><input id="screen-title" value={s.title} maxLength={85} onChange={e => api.updateScreen({ title: e.target.value })} /></div>
    <div className="insp-field"><label className="insp-label" htmlFor="screen-subtitle">Subtitle <span className="insp-opt">optional</span></label><input id="screen-subtitle" value={s.subtitle ?? ''} maxLength={140} onChange={e => api.updateScreen({ subtitle: e.target.value })} /></div>
    <div className="insp-field"><label className="insp-label" htmlFor="screen-shell">Navigation</label>
      <select id="screen-shell" value={s.shell} onChange={e => api.updateScreen({ shell: e.target.value as Screen['shell'] })}>
        <option value="default">Show app menu ({api.doc.shell.kind === 'none' ? 'none defined' : api.doc.shell.kind})</option>
        <option value="hidden">Focused flow (no menu)</option>
      </select></div>
    <div className="editor-node-tools">
      <button type="button" title="Move screen up" disabled={i === 0} onClick={() => api.moveScreen(-1)}><ArrowUp size={14} /></button>
      <button type="button" title="Move screen down" disabled={i === api.doc.screens.length - 1} onClick={() => api.moveScreen(1)}><ArrowDown size={14} /></button>
      <button type="button" title="Duplicate screen" onClick={api.duplicateScreen}><Copy size={14} /></button>
      <button type="button" title="Delete screen" className="danger" disabled={api.doc.screens.length <= 1} onClick={() => { if (confirm('Delete "' + s.title + '"? Links to it are removed.')) api.removeScreen(); }}><Trash2 size={14} /></button>
    </div>
  </div>;
}
