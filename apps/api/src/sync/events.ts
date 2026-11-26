// Sync events to MEYON (Phase A4): an outbox in the database, delivered server-to-server with retries.
//
// Contract (MEYON side): POST {MEYON_BASE_URL}/demo-builder/v1/events with the JSON event as the body and
//   x-demo-builder-event:     the event id (idempotency key: MEYON processes each id once)
//   x-demo-builder-signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, t + "." + body)>
//   x-demo-builder-key:       first 8 hex characters of SHA-256(secret), naming the signing secret
// MEYON accepts the event when the signature matches one of its active secrets (two may be active during a
// rotation) and t is within 5 minutes. Any 2xx (or 409 "already processed") marks the event delivered; anything
// else is retried with backoff (15 s doubling, at most 1 hour) until it succeeds.
// Events carry ids, numbers, statuses and coverage only: never document content or published-link tokens.
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';
import type { Caller } from '../demos/auth.ts';
import type { DemoRow, DemoStore, EventRow, EventType, Workspace } from '../demos/store.ts';
import { keyIdOf, publicKeyB64, signBody } from './keys.ts';
import type { KeyObject } from 'node:crypto';

declare module 'fastify' { interface FastifyInstance { sync: Sync } }

export const keyId = (secret: string) => createHash('sha256').update(secret).digest('hex').slice(0, 8);
export function signEvent(secret: string, body: string, nowSec = Math.floor(Date.now() / 1000)) {
  return { 'x-demo-builder-signature': 't=' + nowSec + ',v1=' + createHmac('sha256', secret).update(nowSec + '.' + body).digest('hex'), 'x-demo-builder-key': keyId(secret) };
}
/** MEYON-side check (used by the simulator and documented for MEYON): any active secret, 5-minute window. */
export function verifyEvent(secrets: string[], header: string | undefined, body: string, nowSec = Math.floor(Date.now() / 1000), windowSec = 300): boolean {
  const m = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(header ?? '');
  if (!m || Math.abs(nowSec - Number(m[1])) > windowSec) return false;
  const given = Buffer.from(m[2], 'hex');
  return secrets.some(s => { const want = createHmac('sha256', s).update(m[1] + '.' + body).digest(); return want.length === given.length && timingSafeEqual(want, given); });
}

/** Sign with `signingKey` (Ed25519, preferred: MEYON verifies with Demo Builder's published public key) or HMAC `secrets`. */
export type SyncOptions = { url: string; secrets?: string[]; signingKey?: KeyObject; intervalMs?: number; fetcher?: typeof fetch };
const backoffMs = (attempts: number) => Math.min(3600_000, 15_000 * 2 ** Math.max(0, attempts - 1));

export class Sync {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private workspaces = new Map<string, Workspace>();
  private store: DemoStore; private opts: SyncOptions | undefined; private log?: FastifyBaseLogger;
  constructor(store: DemoStore, opts: SyncOptions | undefined, log?: FastifyBaseLogger) {
    this.store = store; this.opts = opts; this.log = log;
    if (opts && !opts.signingKey && (!opts.secrets?.length || opts.secrets.some(s => s.length < 32))) throw Error('Sync needs a signing key or event secrets of at least 32 characters');
  }
  get configured() { return !!this.opts; }

  private async workspace(id: string) {
    let w = this.workspaces.get(id);
    if (!w) { w = (await this.store.getWorkspace(id)) ?? undefined; if (w) this.workspaces.set(id, w); }
    return w;
  }
  /**
   * Record an event for a MEYON tenant's demo. Standalone (personal) demos never produce events. Recording never
   * fails the user's action; a failure is logged.
   */
  async emit(type: EventType, workspaceId: string, body: Record<string, unknown>, caller?: Caller): Promise<EventRow | null> {
    try {
      const w = await this.workspace(workspaceId);
      if (!w || w.kind !== 'meyon') return null;
      const launch = caller?.scope?.launchId ? await this.store.getLaunch(caller.scope.launchId) : null;
      const payload = { type, occurredAt: new Date().toISOString(), tenant: { id: w.external_ref }, ...body,
        ...(launch && !('launch' in body) ? { launch: { id: launch.id, grantId: launch.grant_id, mode: launch.mode, story: launch.story_ref, storyVersion: launch.story_version } } : {}),
        actor: caller ? { via: caller.via, principal: caller.principal.id } : null };
      return await this.store.enqueueEvent({ workspace_id: workspaceId, type, payload });
    } catch (e) { this.log?.error({ type, detail: e instanceof Error ? e.message : String(e) }, 'sync event could not be recorded'); return null; }
  }
  static demo(d: Pick<DemoRow, 'id' | 'name' | 'channel' | 'project_ref' | 'is_primary' | 'forked_from_version_id' | 'latest_version'>) {
    return { id: d.id, name: d.name, channel: d.channel, projectRef: d.project_ref, isPrimary: d.is_primary, forkedFromVersionId: d.forked_from_version_id, latestVersion: d.latest_version };
  }

  /** Deliver due events once (claimed with a lease, so concurrent instances never double-send). */
  async deliverDue(limit = 20): Promise<{ delivered: number; failed: number }> {
    if (!this.opts || this.running) return { delivered: 0, failed: 0 };
    this.running = true;
    let delivered = 0, failed = 0;
    try {
      for (const e of await this.store.claimDueEvents(limit, 60_000)) {
        const body = JSON.stringify({ id: e.id, ...e.payload });
        let error = '';
        try {
          const res = await (this.opts.fetcher ?? fetch)(this.opts.url, { method: 'POST', body, signal: AbortSignal.timeout(10_000),
            headers: { 'content-type': 'application/json', 'x-demo-builder-event': e.id, ...(this.opts.signingKey
              ? { 'x-demo-builder-signature': signBody(this.opts.signingKey, body), 'x-demo-builder-key': keyIdOf(publicKeyB64(this.opts.signingKey)) }
              : signEvent(this.opts.secrets![0], body)) } });
          if (res.ok || res.status === 409) { await this.store.markEventDelivered(e.id); delivered++; continue; }
          error = 'HTTP ' + res.status + ' ' + (await res.text().catch(() => '')).slice(0, 200);
        } catch (err) { error = err instanceof Error ? err.message : String(err); }
        failed++;
        await this.store.markEventFailed(e.id, e.attempts + 1, new Date(Date.now() + backoffMs(e.attempts + 1)).toISOString(), error);
        this.log?.warn({ event: e.id, type: e.type, attempts: e.attempts + 1, error }, 'sync event not delivered; will retry');
      }
    } catch (err) { this.log?.error({ detail: err instanceof Error ? err.message : String(err) }, 'sync delivery round failed'); }
    finally { this.running = false; }
    return { delivered, failed };
  }
  start() {
    const ms = this.opts?.intervalMs ?? 10_000;
    if (!this.opts || ms <= 0 || this.timer) return;
    this.timer = setInterval(() => { void this.deliverDue(); }, ms);
    this.timer.unref?.();
  }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }
}
