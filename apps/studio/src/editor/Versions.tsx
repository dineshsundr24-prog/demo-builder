// Saved-demo controls in the sidebar: draft status, save a version, version history with publish /
// copy link / restore / fork, primary baseline. Versions are immutable on the server.
import React, { useState } from 'react';
import { Check, Copy, GitFork, Link2, RotateCcw, Save, Star } from 'lucide-react';
import type { DemoDetail } from './demosApi.ts';

export type SaveState = 'saved' | 'saving' | 'unsaved' | 'conflict' | 'error';
type Props = {
  detail: DemoDetail; saveState: SaveState; saveError: string;
  onSaveVersion: (note: string) => Promise<void>; onPublish: (n: number) => Promise<string>; onRevoke: (pid: string) => Promise<void>;
  onRestore: (n: number) => Promise<void>; onFork: (n: number) => Promise<void>; onMakePrimary: () => Promise<void>; onReloadLatest: () => Promise<void>;
};

const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export function VersionsPanel(p: Props) {
  const { demo, versions, publications, role } = p.detail;
  const [note, setNote] = useState(''), [busy, setBusy] = useState(''), [error, setError] = useState(''), [links, setLinks] = useState<Record<number, string>>({}), [copied, setCopied] = useState(0);
  const canEdit = role !== 'viewer';
  const act = async (key: string, fn: () => Promise<unknown>) => { setBusy(key); setError(''); try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(''); } };
  const live = (n: number) => publications.filter(x => x.version === n && !x.revoked);
  const status = { saved: 'All changes saved', saving: 'Saving…', unsaved: 'Unsaved changes', conflict: 'Changed elsewhere', error: 'Not saved' }[p.saveState];
  return <section className="versions" data-testid="versions" aria-label="Saved demo">
    <div className="versions-head">
      <span className={'save-state ' + p.saveState} data-testid="save-state">{status}</span>
      {demo.isPrimary ? <span className="badge-primary" title="Primary baseline for this application type"><Star size={12} />Primary</span>
        : canEdit ? <button type="button" className="link-btn" onClick={() => act('primary', p.onMakePrimary)} disabled={!!busy}>Make primary</button> : null}
    </div>
    {p.saveState === 'conflict' ? <div className="versions-conflict" role="alert">
      <p>This demo was changed in another window. Your latest edits were not saved.</p>
      <button type="button" className="account-btn" onClick={() => act('reload', p.onReloadLatest)}>Load the latest version of the draft</button>
    </div> : null}
    {p.saveState === 'error' && p.saveError ? <p className="studio-error" role="alert">{p.saveError}</p> : null}
    {canEdit ? <form className="versions-save" onSubmit={e => { e.preventDefault(); void act('save', async () => { await p.onSaveVersion(note.trim()); setNote(''); }); }}>
      <input aria-label="Version note" placeholder="What changed? (optional)" value={note} maxLength={500} onChange={e => setNote(e.target.value)} />
      <button type="submit" className="account-btn primary" disabled={!!busy || p.saveState === 'saving' || p.saveState === 'conflict'}><Save size={13} />Save version</button>
    </form> : null}
    {error ? <p className="studio-error" role="alert">{error}</p> : null}
    {versions.length ? <ol className="version-list" aria-label="Versions">{versions.map(v => {
      const pubs = live(v.number), errors = v.metadata.validation?.errors ?? 0;
      return <li key={v.id} data-version={v.number}>
        <div className="version-title"><strong>v{v.number}</strong>{v.note ? <span>{v.note}</span> : <span className="muted">No note</span>}</div>
        <div className="version-meta">{when(v.createdAt)}{errors ? <span className="warn-text"> · {errors} error{errors > 1 ? 's' : ''}</span> : null}{pubs.length ? <span className="pub-badge"> · Published</span> : null}</div>
        <div className="version-actions">
          {canEdit && !errors ? <button type="button" title="Create a read-only link to this version" onClick={() => act('pub' + v.number, async () => { const url = await p.onPublish(v.number); setLinks(l => ({ ...l, [v.number]: url })); })} disabled={!!busy}><Link2 size={12} />Publish</button> : null}
          {canEdit ? <button type="button" title="Replace the draft with this version" onClick={() => act('restore' + v.number, () => p.onRestore(v.number))} disabled={!!busy}><RotateCcw size={12} />Restore</button> : null}
          {canEdit ? <button type="button" title="Start an independent demo from this version" onClick={() => act('fork' + v.number, () => p.onFork(v.number))} disabled={!!busy}><GitFork size={12} />Fork</button> : null}
        </div>
        {links[v.number] ? <div className="pub-link"><input readOnly value={links[v.number]} aria-label={'Published link for version ' + v.number} onFocus={e => e.target.select()} />
          <button type="button" onClick={() => { void navigator.clipboard?.writeText(links[v.number]).catch(() => {}); setCopied(v.number); setTimeout(() => setCopied(0), 1500); }}>{copied === v.number ? <Check size={12} /> : <Copy size={12} />}{copied === v.number ? 'Copied' : 'Copy'}</button>
          <p className="muted small">Anyone with this link can view version {v.number}. Copy it now: for security it is shown only once.</p></div> : null}
        {canEdit && pubs.length ? <div className="pub-list">{pubs.map(x => <span key={x.id}>Link created {when(x.createdAt)} <button type="button" className="link-btn" onClick={() => act('rev' + x.id, () => p.onRevoke(x.id))} disabled={!!busy}>Revoke</button></span>)}</div> : null}
      </li>;
    })}</ol> : <p className="muted small">No versions yet. Save a version to keep a fixed snapshot you can publish or come back to.</p>}
  </section>;
}
