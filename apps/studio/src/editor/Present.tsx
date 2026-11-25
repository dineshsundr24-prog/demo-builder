// Full-window presentation of the current demo (opened from the studio). Portals get the whole
// window; mobile apps sit in a phone frame. Edits in the studio appear here live.
import React, { useEffect, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { DemoRuntime } from '@demo/runtime';
import { DemoDocument } from '@demo/schema';
import { loadLocal, PRESENT_KEY } from './history.ts';

export function Present() {
  const [doc, setDoc] = useState<DemoDocument | null>(() => loadLocal(PRESENT_KEY));
  const [run, setRun] = useState(0);
  useEffect(() => {
    const on = (e: StorageEvent) => { if (e.key === PRESENT_KEY && e.newValue) { const p = DemoDocument.safeParse(JSON.parse(e.newValue)); if (p.success) setDoc(p.data); } };
    addEventListener('storage', on); return () => removeEventListener('storage', on);
  }, []);
  useEffect(() => { document.title = doc ? doc.name + ' · demo' : 'Demo'; }, [doc?.name]);
  if (!doc) return <div className="present-empty"><p>Nothing to present. Open a demo in the studio and choose <strong>Open in new window</strong>.</p></div>;
  return <div className={'present present-' + doc.channel} data-testid="present">
    <button type="button" className="present-restart" onClick={() => setRun(r => r + 1)} title="Restart demo"><RotateCcw size={14} />Restart</button>
    <div className={'present-frame' + (doc.channel === 'mobile' ? ' device device-mobile' : '')}>
      <DemoRuntime key={doc.id + run} doc={doc} />
    </div>
  </div>;
}
