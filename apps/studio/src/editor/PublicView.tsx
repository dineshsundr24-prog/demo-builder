// Read-only viewer for a published demo link (?p=<token>): the exact published version, no editing.
import React, { useEffect, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { DemoRuntime } from '@demo/runtime';
import type { DemoDocument } from '@demo/schema';
import { demosApi } from './demosApi.ts';

export function PublicView({ token }: { token: string }) {
  const [state, setState] = useState<{ doc?: DemoDocument; name?: string; version?: number; error?: string }>({});
  const [run, setRun] = useState(0);
  useEffect(() => {
    demosApi.published(token).then(r => { setState({ doc: r.document, name: r.name, version: r.version }); document.title = r.name + ' · demo'; },
      e => setState({ error: e instanceof Error ? e.message : String(e) }));
  }, [token]);
  if (state.error) return <div className="present-empty"><p>{state.error}</p></div>;
  if (!state.doc) return <div className="present-empty"><p>Loading demo…</p></div>;
  return <div className={'present present-' + state.doc.channel} data-testid="public-demo">
    <button type="button" className="present-restart" onClick={() => setRun(r => r + 1)} title="Restart demo"><RotateCcw size={14} />Restart</button>
    <div className={'present-frame' + (state.doc.channel === 'mobile' ? ' device device-mobile' : '')}>
      <DemoRuntime key={run} doc={state.doc} />
    </div>
  </div>;
}
