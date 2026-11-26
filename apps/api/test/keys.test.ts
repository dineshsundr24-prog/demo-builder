// Ed25519 integration signatures: no shared secret between Demo Builder and MEYON.
import test from 'node:test';
import assert from 'node:assert/strict';
import { FakeProvider, Generator, MemoryStore, defaultConfig } from '@demo/generator';
import { buildServer } from '../src/server.ts';
import { MemoryDemoStore } from '../src/demos/store.ts';
import { Sync } from '../src/sync/events.ts';
import { keyIdOf, loadPrivateKey, loadPublicKey, newKeyPair, remoteKeys, signBody, verifyBody, verifyRemote } from '../src/sync/keys.ts';

test('signatures verify with the published key only, within the window, and detect tampering; rotation is picked up', async () => {
  const a = newKeyPair(), b = newKeyPair();
  const body = JSON.stringify({ code: 'x'.repeat(43) }), h = signBody(loadPrivateKey(a.privateKey), body);
  assert.ok(verifyBody([loadPublicKey(a.publicKey)], h, body));
  assert.ok(!verifyBody([loadPublicKey(b.publicKey)], h, body), 'another key');
  assert.ok(!verifyBody([loadPublicKey(a.publicKey)], h, body.replace('x', 'y')), 'tampered');
  assert.ok(!verifyBody([loadPublicKey(a.publicKey)], signBody(loadPrivateKey(a.privateKey), body, Math.floor(Date.now() / 1000) - 600), body), 'too old');
  let published = b.publicKey;
  const get = remoteKeys('https://meyon.example/keys', (async () => new Response(JSON.stringify({ keys: [{ publicKey: published }] }))) as typeof fetch);
  assert.equal(await verifyRemote(get, h, body), false);
  published = a.publicKey; // the other side rotated to key a
  assert.equal(await verifyRemote(get, h, body), true, 'a failed check re-fetches the published keys once');
  assert.match(keyIdOf(a.publicKey), /^[0-9a-f]{16}$/);
});

test('with a signing key, Demo Builder publishes its public key, signs events, and accepts MEYON requests signed with MEYON\'s published key', async () => {
  const builder = newKeyPair(), meyon = newKeyPair();
  const signingKey = loadPrivateKey(builder.privateKey);
  const fetcher = (async (url: string) => (String(url).endsWith('/public-key') ? new Response(JSON.stringify({ keys: [{ publicKey: meyon.publicKey }] })) : new Response('{}'))) as typeof fetch;
  const provider = new FakeProvider(req => { const i = JSON.parse(req.input); return { journey: 'a -> b', gaps: [], screens: [{ title: 'Home', purpose: 'Entry.', details: ['Alpha item', 'Beta item'], criteria: [] }, { title: 'Apply', purpose: 'Apply.', details: ['Alpha item', 'Beta item'], criteria: [i.acceptanceCriteria[0].id] }] }; });
  const store = new MemoryDemoStore();
  (globalThis as any).__origFetch = globalThis.fetch; globalThis.fetch = fetcher as any; // MEYON's key endpoint (fake)
  const app = await buildServer({ generator: new Generator(new MemoryStore(), provider, defaultConfig), accessToken: 'x', origins: [], model: 'fake', demoStore: store, signingKey, meyonKeysUrl: 'https://meyon.example/v1/demo-builder/v1/public-key' });
  try {
    const pk = JSON.parse((await app.inject({ method: 'GET', url: '/api/v2/integration/public-key' })).body);
    assert.equal(pk.keys[0].publicKey, builder.publicKey);
    const body = { tenantId: 't1', channel: 'mobile', project: { name: 'P' }, story: { id: 'R:US-001', title: 'Apply' }, criteria: [{ id: 'R:US-001:AC-1', text: 'Choose amount' }] };
    const raw = JSON.stringify(body);
    const ok = await app.inject({ method: 'POST', url: '/api/v2/integration/suggest-screens', headers: { 'content-type': 'application/json', 'x-meyon-signature': signBody(loadPrivateKey(meyon.privateKey), raw) }, payload: raw });
    assert.equal(ok.statusCode, 200, ok.body);
    const forged = await app.inject({ method: 'POST', url: '/api/v2/integration/suggest-screens', headers: { 'content-type': 'application/json', 'x-meyon-signature': signBody(loadPrivateKey(newKeyPair().privateKey), raw) }, payload: raw });
    assert.equal(forged.statusCode, 401);
  } finally { globalThis.fetch = (globalThis as any).__origFetch; }
  // Events are signed with Demo Builder's key.
  const sent: Record<string, string>[] = [];
  const sync = new Sync(store, { url: 'https://meyon.example/v1/demo-builder/v1/events', signingKey, intervalMs: 0, fetcher: (async (_u: string, init: RequestInit) => { sent.push({ ...(init.headers as Record<string, string>), body: String(init.body) }); return new Response('{}'); }) as typeof fetch });
  const ws = await store.ensureWorkspace({ kind: 'meyon', name: 'M', external_ref: 't1' });
  await sync.emit('launch.cancelled', ws.id, { launch: { id: 'l1' } });
  await sync.deliverDue();
  assert.ok(verifyBody([loadPublicKey(builder.publicKey)], sent[0]['x-demo-builder-signature'], sent[0].body));
  assert.equal(sent[0]['x-demo-builder-key'], keyIdOf(builder.publicKey));
});
