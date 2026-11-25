// Studio sign-in (Supabase Auth, standalone users) and the credentials every API call carries.
// Small REST client instead of the full SDK: email + password, email sign-in links, refresh, sign out.
// When Supabase is not configured for this Studio build, only the shared UAT access token is available.
const env = import.meta.env as Record<string, string | undefined>;
const SB_URL = (env.VITE_SUPABASE_URL ?? '').replace(/\/$/, '');
const SB_KEY = env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '';
export const authConfigured = !!(SB_URL && SB_KEY);

type Session = { access_token: string; refresh_token: string; expires_at: number; email: string };
const KEY = 'db-auth';
const listeners = new Set<() => void>();
export const onAuthChange = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
const emit = () => listeners.forEach(fn => fn());

function read(): Session | null { try { const v = localStorage.getItem(KEY); return v ? JSON.parse(v) : null; } catch { return null; } }
function write(s: Session | null) { try { if (s) localStorage.setItem(KEY, JSON.stringify(s)); else localStorage.removeItem(KEY); } catch { /* storage blocked: session lasts for this page only */ } memory = s; emit(); }
let memory: Session | null = read();

export const signedInEmail = () => memory?.email ?? null;
/** The shared UAT access token (session tab only), used when nobody is signed in. */
export const uatToken = () => { try { return sessionStorage.getItem('db-access') ?? ''; } catch { return ''; } };
export const hasCredentials = () => !!memory || !!uatToken();

async function auth(path: string, body: unknown, bearer?: string) {
  const res = await fetch(SB_URL + '/auth/v1/' + path, { method: 'POST', headers: { apikey: SB_KEY, 'content-type': 'application/json', ...(bearer ? { authorization: 'Bearer ' + bearer } : {}) }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Error(String(data.error_description ?? data.msg ?? data.message ?? 'Sign-in failed (' + res.status + ')'));
  return data;
}
const store = (d: any) => write({ access_token: d.access_token, refresh_token: d.refresh_token, expires_at: Date.now() + Number(d.expires_in ?? 3600) * 1000, email: d.user?.email ?? memory?.email ?? '' });

export async function signInWithPassword(email: string, password: string) { store(await auth('token?grant_type=password', { email, password })); }
/** Creates the account; Supabase sends a confirmation email whose link returns to this Studio. */
export async function signUp(email: string, password: string) {
  const d = await auth('signup?redirect_to=' + encodeURIComponent(location.origin + location.pathname), { email, password });
  if (d.access_token) store(d); // projects without email confirmation sign in immediately
  return !!d.access_token;
}
export async function sendSignInLink(email: string) { await auth('otp?redirect_to=' + encodeURIComponent(location.origin + location.pathname), { email, create_user: true }); }
export async function signOut() { const s = memory; write(null); if (s) await auth('logout', {}, s.access_token).catch(() => {}); }

/** After an email link, Supabase returns to the Studio with the session in the URL fragment. */
export async function completeRedirect(): Promise<string | null> {
  if (!authConfigured || !location.hash.includes('access_token=')) {
    const err = /error_description=([^&]+)/.exec(location.hash)?.[1];
    if (err) { history.replaceState(null, '', location.pathname + location.search); return decodeURIComponent(err.replace(/\+/g, ' ')); }
    return null;
  }
  const p = new URLSearchParams(location.hash.slice(1));
  history.replaceState(null, '', location.pathname + location.search); // never leave tokens in the address bar
  const access = p.get('access_token')!, refresh = p.get('refresh_token') ?? '';
  let email = '';
  try { const r = await fetch(SB_URL + '/auth/v1/user', { headers: { apikey: SB_KEY, authorization: 'Bearer ' + access } }); email = (await r.json()).email ?? ''; } catch { /* email shown later */ }
  write({ access_token: access, refresh_token: refresh, expires_at: Date.now() + Number(p.get('expires_in') ?? 3600) * 1000, email });
  return null;
}

let refreshing: Promise<void> | null = null;
async function fresh(): Promise<Session | null> {
  const s = memory;
  if (!s) return null;
  if (s.expires_at - Date.now() > 60_000) return s;
  refreshing ??= auth('token?grant_type=refresh_token', { refresh_token: s.refresh_token }).then(store, () => write(null)).finally(() => { refreshing = null; });
  await refreshing;
  return memory;
}
/** Headers for Builder API calls: the signed-in user, otherwise the shared UAT token. */
export async function authHeaders(): Promise<Record<string, string>> {
  const s = await fresh();
  if (s) return { authorization: 'Bearer ' + s.access_token };
  const t = uatToken();
  return t ? { 'x-builder-access': t } : {};
}
