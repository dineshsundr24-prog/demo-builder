// Server-to-server client for MEYON. The browser never sees the integration key: it carries only the opaque
// launch code, which the Builder API exchanges here. MEYON consumes the grant atomically (single use).
export type ConsumeResult = { ok: true; package: unknown } | { ok: false; reason: 'unknown_or_used' | 'unavailable' };
export interface MeyonClient { consumeGrant(code: string): Promise<ConsumeResult> }

export function httpMeyonClient(baseUrl: string, integrationKey: string, fetcher: typeof fetch = fetch): MeyonClient {
  const url = baseUrl.replace(/\/$/, '') + '/demo-builder/v1/launch-grants/consume';
  return {
    async consumeGrant(code) {
      try {
        const res = await fetcher(url, { method: 'POST', headers: { authorization: 'Bearer ' + integrationKey, 'content-type': 'application/json' }, body: JSON.stringify({ code }), signal: AbortSignal.timeout(10_000) });
        if (res.status === 404 || res.status === 410) return { ok: false, reason: 'unknown_or_used' };
        if (!res.ok) return { ok: false, reason: 'unavailable' };
        return { ok: true, package: await res.json() };
      } catch { return { ok: false, reason: 'unavailable' }; }
    },
  };
}
