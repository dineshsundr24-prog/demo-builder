// Builder API client for saved demos, versions and publications.
import type { DemoDocument } from '@demo/schema';
import { API, call } from '../GeneratePanel.tsx';

export type DemoMeta = { id: string; workspaceId: string; name: string; channel: 'mobile' | 'portal'; projectRef: string; isPrimary: boolean; forkedFromVersionId: string | null;
  latestVersion: number; draftRevision: number; draftBaseVersion: number; draftUpdatedAt: string; createdAt: string; archived: boolean };
export type VersionInfo = { id: string; number: number; note: string; createdAt: string; contentHash: string; metadata: { validation?: { errors: number; warnings: number }; screens?: number } };
export type PublicationInfo = { id: string; versionId: string; version: number | null; createdAt: string; revoked: boolean };
export type DemoDetail = { demo: DemoMeta; document: DemoDocument; role: 'owner' | 'editor' | 'viewer'; versions: VersionInfo[]; publications: PublicationInfo[] };
export type Me = { principal: { id: string; provider: string; name: string; email: string | null }; via: 'supabase' | 'session' | 'uat'; defaultWorkspaceId: string; workspaces: { id: string; name: string; kind: string; role: string }[] };

const json = (method: string, body?: unknown): RequestInit => ({ method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
export const demosApi = {
  me: () => call<Me>('/api/v2/me'),
  list: () => call<{ demos: DemoMeta[] }>('/api/v2/demos').then(r => r.demos),
  create: (document: DemoDocument, name?: string, launchId?: string) => call<{ demo: DemoMeta }>('/api/v2/demos', json('POST', { document, name, ...(launchId ? { launchId } : {}) })).then(r => r.demo),
  get: (id: string) => call<DemoDetail>('/api/v2/demos/' + id),
  rename: (id: string, name: string) => call<{ demo: DemoMeta }>('/api/v2/demos/' + id, json('PATCH', { name })).then(r => r.demo),
  archive: (id: string) => call<{ demo: DemoMeta }>('/api/v2/demos/' + id, json('PATCH', { archived: true })).then(r => r.demo),
  saveDraft: (id: string, expectedRevision: number, document: DemoDocument) => call<{ demo: DemoMeta }>('/api/v2/demos/' + id + '/draft', json('PUT', { expectedRevision, document })).then(r => r.demo),
  saveVersion: (id: string, expectedRevision: number, note: string) => call<{ version: VersionInfo }>('/api/v2/demos/' + id + '/versions', json('POST', { expectedRevision, note })).then(r => r.version),
  version: (id: string, n: number) => call<{ version: VersionInfo; document: DemoDocument }>('/api/v2/demos/' + id + '/versions/' + n),
  makePrimary: (id: string) => call<{ demo: DemoMeta }>('/api/v2/demos/' + id + '/primary', json('POST', {})).then(r => r.demo),
  fork: (id: string, version: number, name?: string) => call<{ demo: DemoMeta; document: DemoDocument }>('/api/v2/demos/' + id + '/fork', json('POST', { version, name })),
  publish: (id: string, n: number) => call<{ publication: { id: string; version: number }; token: string; url: string }>('/api/v2/demos/' + id + '/versions/' + n + '/publish', json('POST', {})),
  revoke: (id: string, pid: string) => call('/api/v2/demos/' + id + '/publications/' + pid + '/revoke', json('POST', {})),
  /** Public, no sign-in. */
  published: async (token: string) => {
    const r = await fetch(API + '/api/v2/public/' + encodeURIComponent(token));
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw Error((body as any).error ?? 'This demo link is not available');
    return body as { name: string; channel: string; version: number; publishedAt: string; document: DemoDocument };
  },
};
/** Studio address of a published demo (the API also returns it; this covers older publications). */
export const publicUrl = (token: string) => location.origin + location.pathname + '?p=' + token;

// ---------- Launches from MEYON ----------
export type Criterion = { id: string; text: string };
export type BaseCheck = { ok: true; demoId: string; name: string; version: number; latestVersion: number; newerExists: boolean } | { ok: false; problem: string };
export type LaunchView = {
  id: string; status: 'pending' | 'confirming' | 'confirmed' | 'cancelled'; mode: 'create' | 'extend'; channel: 'mobile' | 'portal'; createdAt: string; demoId: string | null; jobId: string | null; packageHash: string;
  tenant: { id: string; name: string }; actor: { ref: string; name: string; verified: boolean };
  project: { id: string; name: string; goal: string; personas: string[] }; story: { id: string; title: string; artifactVersion: number; contentHash: string };
  feature: { id: string; name: string } | null; prompt: { revision: number; text: string; reviewedAt: string };
  approved: { acceptanceCriteria: Criterion[]; businessRules: Criterion[]; actors: string[]; integrations: string[] }; suggestions: string[];
  branding: { company: string }; sources: { kind: string; ref: string; version: string; hash: string }[];
  base: { demoId: string; version: number; url: string; check: BaseCheck | null } | null;
};
export type ConfirmResult = { mode: 'create' | 'extend'; jobId?: string | null; demoId?: string | null; version?: number; newerExists?: boolean; already?: boolean };
export type SimScenario = { storyId: string; title: string; version: number; channel: 'mobile' | 'portal'; feature: string; criteria: number; prompt: string };
export type SimBaseline = { demoId: string; name: string; channel: 'mobile' | 'portal'; isPrimary: boolean; latestVersion: number };
export const launchApi = {
  /** No credentials: the opaque code is the only proof, and it works once. */
  exchange: async (code: string) => {
    const r = await fetch(API + '/api/v2/launch/exchange', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code }) });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(Error((body as any).error ?? 'This launch could not be opened (' + r.status + ')'), { status: r.status });
    return body as { session: string; expiresAt: string; launchId: string };
  },
  get: (id: string) => call<{ launch: LaunchView }>('/api/v2/launches/' + id).then(r => r.launch),
  confirm: (id: string) => call<ConfirmResult>('/api/v2/launches/' + id + '/confirm', json('POST', {})),
  cancel: (id: string) => call<{ status: string }>('/api/v2/launches/' + id + '/cancel', json('POST', {})),
  // Simulated MEYON (UAT/testing only)
  scenarios: () => call<{ project: { id: string; name: string }; tenant: { id: string; name: string }; scenarios: SimScenario[] }>('/sim/meyon/scenarios'),
  baselines: () => call<{ baselines: SimBaseline[] }>('/sim/meyon/baselines').then(r => r.baselines),
  events: () => call<{ events: { id: string; type: string; receivedAt: string; verified: boolean; story: string | null; demo: { id: string; name: string; channel: string; isPrimary: boolean } | null; version: number | null; coverage: Record<string, number> | null; journeyPassed: boolean | null }[] }>('/sim/meyon/events').then(r => r.events),
  suggest: (body: { storyId: string; baseDemoId?: string }) => call<{ text: string; screens: number; gaps: string[]; costUsd: number }>('/sim/meyon/suggest-screens', json('POST', body)),
  grant: (body: { storyId: string; mode: 'create' | 'extend'; baseDemoId?: string; baseVersion?: number; prompt?: string }) => call<{ code: string; expiresAt: string }>('/sim/meyon/grants', json('POST', body)),
};

// ---------- EXTEND (A3) ----------
export type ChangeItem =
  | { key: string; kind: 'add'; title: string; purpose: string; details: string[]; criteria: string[]; openFrom: string | null; addToMenu: boolean }
  | { key: string; kind: 'modify'; screenId: string; title: string; change: string; criteria: string[]; sharedWith: string[] }
  | { key: string; kind: 'remove'; screenId: string; title: string; reason: string; sharedWith: string[] };
export type ChangePlan = { story: { id: string; title: string; version?: number }; summary: string; items: ChangeItem[]; unchanged: { screenId: string; title: string }[]; navigation: string[]; gaps: string[]; uncovered: string[] };
export type PlanResponse = { planId: string; plan: ChangePlan; base: { demoId: string; name: string; version: number; latestVersion: number; changedSince: boolean }; costUsd: number };
export type JourneyCheck = { passed: boolean; reachableBefore: number; reachableAfter: number; lostScreens: string[]; unreachableNew: string[]; newErrors: string[] };
export type ExtendTask = { status: 'running' | 'done' | 'failed'; done: number; total: number; label: string; error: string | null;
  result: { demoId: string; version: number | null; forked: boolean; journey: JourneyCheck; applied: { key: string; summary: string[] }[]; costUsd: number } | null };
export const extendApi = {
  plan: (launchId: string, base?: 'latest') => call<PlanResponse>('/api/v2/launches/' + launchId + '/extend/plan', json('POST', base ? { base } : {})),
  apply: (launchId: string, planId: string, approved: string[], mode?: 'fork') => call<{ taskId: string }>('/api/v2/launches/' + launchId + '/extend/apply', json('POST', { planId, approved, ...(mode ? { mode } : {}) })),
  task: (taskId: string) => call<ExtendTask>('/api/v2/extend-tasks/' + taskId),
};
