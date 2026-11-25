// Who is calling, and what may they do?
//
// Identity sources (each becomes a principal; SSO later is one more source, not a new model):
//   * Supabase Auth (standalone users): "Authorization: Bearer <supabase access token>", verified with
//     the Supabase Auth server and cached briefly.
//   * Builder session (MEYON launches, Phase A2): "Authorization: Bearer bds.<payload>.<sig>", an
//     HMAC-signed, short-lived session scoped to one workspace, one project and a list of operations.
//   * Shared UAT token (current UAT only): "x-builder-access". Kept so the deployed UAT keeps working; it is
//     NOT an individual identity: every holder is the same 'uat' principal in one 'UAT' workspace.
//
// Authorization = workspace role (owner/editor/viewer) ∩ session scope (when the caller is a session).
import { createHash, createHmac, createPublicKey, randomBytes, timingSafeEqual, verify as verifySig, type KeyObject } from 'node:crypto';
import type { DemoRow, DemoStore, Principal, Role } from './store.ts';

export type Op = 'read' | 'edit' | 'version' | 'publish' | 'fork' | 'primary' | 'create' | 'archive';
export const OPS: readonly Op[] = ['read', 'edit', 'version', 'publish', 'fork', 'primary', 'create', 'archive'];
const ROLE_OPS: Record<Role, readonly Op[]> = {
  viewer: ['read'],
  editor: ['read', 'edit', 'version', 'publish', 'fork', 'primary', 'create'],
  owner: OPS,
};
export type SessionScope = { workspaceId: string; projectRef: string; ops: Op[]; /** The MEYON launch this session came from. */ launchId?: string };
export type Caller = { principal: Principal; via: 'supabase' | 'session' | 'uat'; scope?: SessionScope; defaultWorkspaceId: string };

const safeEqual = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };
export const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');
export const newToken = (bytes = 24) => randomBytes(bytes).toString('base64url');

// ---------- Builder sessions ----------
type SessionClaims = { sub: string; ws: string; prj: string; ops: Op[]; exp: number; iat: number; lid?: string };
/** Issue a session for a MEYON principal (its stable subject from the launch grant). */
export function issueSession(secret: string, c: { subject: string; scope: SessionScope; ttlSeconds?: number }): string {
  if (secret.length < 32) throw Error('BUILDER_SESSION_SECRET must be at least 32 characters');
  const iat = Math.floor(Date.now() / 1000);
  const claims: SessionClaims = { sub: c.subject, ws: c.scope.workspaceId, prj: c.scope.projectRef, ops: c.scope.ops, iat, exp: iat + Math.min(c.ttlSeconds ?? 8 * 3600, 12 * 3600), ...(c.scope.launchId ? { lid: c.scope.launchId } : {}) };
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return 'bds.' + payload + '.' + createHmac('sha256', secret).update(payload).digest('base64url');
}
export function verifySession(secret: string, token: string): SessionClaims | null {
  const [prefix, payload, sig] = token.split('.');
  if (prefix !== 'bds' || !payload || !sig || secret.length < 32) return null;
  if (!safeEqual(sig, createHmac('sha256', secret).update(payload).digest('base64url'))) return null;
  try {
    const c = JSON.parse(Buffer.from(payload, 'base64url').toString()) as SessionClaims;
    if (typeof c.exp !== 'number' || c.exp < Date.now() / 1000) return null;
    if (!Array.isArray(c.ops) || !c.ops.every(o => OPS.includes(o))) return null;
    return c;
  } catch { return null; }
}

// ---------- Supabase Auth ----------
export type SupabaseUser = { id: string; email?: string | null; user_metadata?: Record<string, unknown> };
export type VerifyUser = (accessToken: string) => Promise<SupabaseUser | null>;
/** Verifies an access token with the project's Auth server (no JWT secret needed); cached for 60 s by token hash. */
export function supabaseVerifier(url: string, apikey: string): VerifyUser {
  const cache = new Map<string, { user: SupabaseUser | null; until: number }>();
  return async token => {
    const key = sha256(token), hit = cache.get(key);
    if (hit && hit.until > Date.now()) return hit.user;
    const res = await fetch(url + '/auth/v1/user', { headers: { apikey, Authorization: 'Bearer ' + token } });
    const user = res.ok ? (await res.json()) as SupabaseUser : null;
    if (res.status >= 500) throw Error('Supabase Auth is unavailable');
    cache.set(key, { user, until: Date.now() + 60_000 });
    if (cache.size > 2000) for (const [k, v] of cache) if (v.until < Date.now()) cache.delete(k);
    return user;
  };
}

/**
 * Verifies Supabase access tokens locally against the project's published signing keys (JWKS, ES256/RS256):
 * signature, issuer, audience, expiry and role. No per-request call to the Auth server. Unknown key ids
 * trigger one JWKS refresh (key rotation). Tokens signed with the legacy shared secret (HS256) fall back
 * to `fallback` (remote check). Revocation takes effect at token expiry (1 hour by default).
 */
export function jwksVerifier(url: string, fallback?: VerifyUser, fetcher: typeof fetch = fetch): VerifyUser {
  let keys = new Map<string, { key: KeyObject; alg: string }>(), loadedAt = 0;
  const load = async () => {
    const res = await fetcher(url + '/auth/v1/.well-known/jwks.json');
    if (!res.ok) throw Error('Supabase signing keys unavailable (' + res.status + ')');
    const body = await res.json() as { keys?: (JsonWebKey & { kid?: string; alg?: string })[] };
    keys = new Map((body.keys ?? []).filter(k => k.kid).map(k => [k.kid!, { key: createPublicKey({ key: k as unknown as import('node:crypto').JsonWebKey, format: 'jwk' }), alg: k.alg ?? (k.kty === 'EC' ? 'ES256' : 'RS256') }]));
    loadedAt = Date.now();
  };
  const b64 = (v: string) => Buffer.from(v, 'base64url');
  return async token => {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    let header: { alg?: string; kid?: string }, claims: Record<string, any>;
    try { header = JSON.parse(b64(parts[0]).toString()); claims = JSON.parse(b64(parts[1]).toString()); } catch { return null; }
    if (header.alg === 'HS256') return fallback ? fallback(token) : null;
    if (!header.kid || !['ES256', 'RS256'].includes(String(header.alg))) return null;
    if (!keys.has(header.kid) || Date.now() - loadedAt > 10 * 60_000) await load();
    const k = keys.get(header.kid);
    if (!k || k.alg !== header.alg) return null;
    const signed = Buffer.from(parts[0] + '.' + parts[1]);
    const good = header.alg === 'ES256'
      ? verifySig('sha256', signed, { key: k.key, dsaEncoding: 'ieee-p1363' }, b64(parts[2]))
      : verifySig('sha256', signed, k.key, b64(parts[2]));
    if (!good) return null;
    const now = Math.floor(Date.now() / 1000);
    const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (claims.iss !== url + '/auth/v1' || !aud.includes('authenticated') || claims.role !== 'authenticated') return null;
    if (typeof claims.exp !== 'number' || claims.exp <= now || typeof claims.sub !== 'string' || !claims.sub) return null;
    return { id: claims.sub, email: claims.email ?? null, user_metadata: claims.user_metadata ?? {} };
  };
}

export type AuthConfig = { store: DemoStore; uatToken?: string; sessionSecret?: string; verifyUser?: VerifyUser };
export class AuthError extends Error { status: number; constructor(m: string, status = 401) { super(m); this.status = status; } }

/** Resolve the caller from request headers; throws AuthError(401) when nothing valid is presented. */
export async function resolveCaller(cfg: AuthConfig, headers: Record<string, string | string[] | undefined>): Promise<Caller> {
  const h = (n: string) => { const v = headers[n]; return Array.isArray(v) ? v[0] : v; };
  const bearer = /^Bearer\s+(.+)$/i.exec(h('authorization') ?? '')?.[1]?.trim();
  if (bearer?.startsWith('bds.')) {
    const c = cfg.sessionSecret ? verifySession(cfg.sessionSecret, bearer) : null;
    if (!c) throw new AuthError('Your Demo Builder session has expired. Open it again from MEYON.');
    const principal = await cfg.store.upsertPrincipal({ provider: 'meyon', subject: c.sub });
    return { principal, via: 'session', scope: { workspaceId: c.ws, projectRef: c.prj, ops: c.ops, ...(c.lid ? { launchId: c.lid } : {}) }, defaultWorkspaceId: c.ws };
  }
  if (bearer) {
    if (!cfg.verifyUser) throw new AuthError('Sign-in is not configured on this server');
    const user = await cfg.verifyUser(bearer);
    if (!user?.id) throw new AuthError('Your sign-in has expired. Please sign in again.');
    const name = String(user.user_metadata?.full_name ?? user.user_metadata?.name ?? user.email ?? 'Demo Builder user').slice(0, 120);
    const principal = await cfg.store.upsertPrincipal({ provider: 'supabase', subject: user.id, display_name: name, email: user.email ?? null });
    const ws = await cfg.store.personalWorkspace(principal.id, (name.split('@')[0] || 'My') + "'s demos");
    return { principal, via: 'supabase', defaultWorkspaceId: ws.id };
  }
  const uat = h('x-builder-access');
  if (uat && cfg.uatToken && safeEqual(uat, cfg.uatToken)) {
    const principal = await cfg.store.upsertPrincipal({ provider: 'uat', subject: 'shared', display_name: 'UAT access token' });
    const ws = await cfg.store.ensureWorkspace({ kind: 'uat', name: 'UAT', external_ref: 'uat', owner: principal.id });
    return { principal, via: 'uat', defaultWorkspaceId: ws.id };
  }
  if (uat) throw new AuthError('Missing or invalid Demo Builder access token');
  throw new AuthError('Sign in or provide a Demo Builder access token');
}

/** May the caller perform `op` in `workspaceId` (optionally on `demo`)? Throws AuthError(403/404). */
export async function authorize(store: DemoStore, caller: Caller, op: Op, workspaceId: string, demo?: Pick<DemoRow, 'project_ref'> | null): Promise<void> {
  if (caller.scope) {
    // A session can never reach outside its workspace and project, whatever the role.
    if (caller.scope.workspaceId !== workspaceId || (demo && demo.project_ref !== caller.scope.projectRef)) throw new AuthError('Not found', 404);
    if (!caller.scope.ops.includes(op)) throw new AuthError('This session does not allow that action', 403);
  }
  const role = await store.role(workspaceId, caller.principal.id);
  if (!role) throw new AuthError('Not found', 404); // do not reveal that the demo exists
  if (!ROLE_OPS[role].includes(op)) throw new AuthError('Your role (' + role + ') does not allow that action', 403);
}
