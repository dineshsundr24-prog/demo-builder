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
  create: (document: DemoDocument, name?: string) => call<{ demo: DemoMeta }>('/api/v2/demos', json('POST', { document, name })).then(r => r.demo),
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
