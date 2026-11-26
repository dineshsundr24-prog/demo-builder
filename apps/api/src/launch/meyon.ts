// Server-to-server client for MEYON. The browser never sees the integration key: it carries only the opaque
// launch code, which the Builder API exchanges here. MEYON consumes the grant atomically (single use).
export type ConsumeResult = { ok: true; package: unknown } | { ok: false; reason: 'unknown_or_used' | 'unavailable' };
export interface MeyonClient { consumeGrant(code: string): Promise<ConsumeResult> }

import type { KeyObject } from 'node:crypto';
import { signBody } from '../sync/keys.ts';

/** `credential`: the shared integration key (simulator, tests) or Demo Builder's Ed25519 signing key (real MEYON). */
export function httpMeyonClient(baseUrl: string, credential: string | KeyObject, fetcher: typeof fetch = fetch): MeyonClient {
  const url = baseUrl.replace(/\/$/, '') + '/demo-builder/v1/launch-grants/consume';
  return {
    async consumeGrant(code) {
      try {
        const body = JSON.stringify({ code });
        const auth: Record<string, string> = typeof credential === 'string' ? { authorization: 'Bearer ' + credential } : { 'x-demo-builder-signature': signBody(credential, body) };
        const res = await fetcher(url, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body, signal: AbortSignal.timeout(10_000) });
        if (res.status === 404 || res.status === 410) return { ok: false, reason: 'unknown_or_used' };
        if (!res.ok) return { ok: false, reason: 'unavailable' };
        return { ok: true, package: await res.json() };
      } catch { return { ok: false, reason: 'unavailable' }; }
    },
  };
}
