// Ed25519 signatures between Demo Builder and MEYON: each side keeps its private key and publishes its public key at
// a well-known HTTPS address; the other side fetches it from the address it is configured with (trust = TLS to that
// configured host, the same trust as the API calls themselves). No shared secret ever has to be handed over.
//   header: t=<unix seconds>,ed25519=<base64url signature of "<t>.<raw body>">   (plus a key id header)
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify, type KeyObject } from 'node:crypto';

export const loadPrivateKey = (base64Pkcs8: string) => createPrivateKey({ key: Buffer.from(base64Pkcs8, 'base64'), format: 'der', type: 'pkcs8' });
export const publicKeyB64 = (k: KeyObject) => (k.type === 'private' ? createPublicKey(k) : k).export({ format: 'der', type: 'spki' }).toString('base64');
export const keyIdOf = (publicB64: string) => createHash('sha256').update(publicB64).digest('hex').slice(0, 16);
export const loadPublicKey = (base64Spki: string) => createPublicKey({ key: Buffer.from(base64Spki, 'base64'), format: 'der', type: 'spki' });
export function newKeyPair() {
  const { privateKey } = generateKeyPairSync('ed25519');
  return { privateKey: privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'), publicKey: publicKeyB64(privateKey) };
}
export function signBody(privateKey: KeyObject, body: string, nowSec = Math.floor(Date.now() / 1000)) {
  return 't=' + nowSec + ',ed25519=' + sign(null, Buffer.from(nowSec + '.' + body), privateKey).toString('base64url');
}
export function verifyBody(keys: KeyObject[], header: string | undefined, body: string, nowSec = Math.floor(Date.now() / 1000), windowSec = 300) {
  const m = /^t=(\d+),ed25519=([A-Za-z0-9_-]{60,120})$/.exec(header ?? '');
  if (!m || Math.abs(nowSec - Number(m[1])) > windowSec) return false;
  const sig = Buffer.from(m[2], 'base64url'), data = Buffer.from(m[1] + '.' + body);
  return keys.some(k => { try { return verify(null, data, k, sig); } catch { return false; } });
}
/** Public keys published by the other side, cached for 10 minutes; `refresh` forces a re-fetch (key rotation). */
export function remoteKeys(url: string, fetcher: typeof fetch = fetch) {
  let cache: { keys: KeyObject[]; at: number } | null = null;
  return async (refresh = false): Promise<KeyObject[]> => {
    if (!refresh && cache && Date.now() - cache.at < 600_000) return cache.keys;
    try {
      const r = await fetcher(url, { signal: AbortSignal.timeout(10_000) });
      if (!r.ok) return cache?.keys ?? [];
      const body = await r.json() as { keys?: { publicKey?: string }[] };
      const keys = (body.keys ?? []).flatMap(k => { try { return k.publicKey ? [loadPublicKey(k.publicKey)] : []; } catch { return []; } });
      cache = { keys, at: Date.now() };
      return keys;
    } catch { return cache?.keys ?? []; }
  };
}
/** Verify with cached keys, then once more with freshly fetched keys (the other side may have rotated). */
export async function verifyRemote(get: ReturnType<typeof remoteKeys>, header: string | undefined, body: string) {
  return verifyBody(await get(), header, body) || verifyBody(await get(true), header, body);
}
