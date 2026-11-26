// Safe text bindings: {{scope.path}} with optional formatter and fallback text, e.g.
// {{state.income.salary | aed}} or {{state.loan.employer ?? GulfTech Solutions}} (shown when nothing was entered).
// Path lookups and a fixed formatter list only. No eval, no function calls.
export const BINDING = /\{\{\s*(state|record|params)\.([A-Za-z0-9_.]+)\s*(?:\|\s*([a-z]+)\s*)?(?:\?\?\s*([^}]*?)\s*)?\}\}/g;
export const ANY_BINDING = /\{\{([^}]*)\}\}/g;
export const formatters: Record<string, (v: string) => string> = {
  aed: v => { const n = Number(String(v).replace(/[^0-9.-]/g, '')); return Number.isFinite(n) && String(v).trim() !== '' ? 'AED ' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : v; },
  date: v => { const d = new Date(v); return isNaN(+d) ? v : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); },
  /** Card freeze state ('true' / 'false') as a status word. */ frozen: v => (String(v) === 'true' ? 'Frozen' : 'Active'),
  upper: v => String(v).toUpperCase(),
  lower: v => String(v).toLowerCase(),
  title: v => String(v).toLowerCase().replace(/\b\w/g, c => c.toUpperCase()),
  mask: v => String(v).replace(/.(?=.{3})/g, '•'),
};
export type Scope = { state: Record<string, unknown>; record?: Record<string, string> | null; params?: Record<string, unknown> };
function lookup(root: unknown, path: string): unknown {
  return path.split('.').reduce<any>((v, k) => (v && typeof v === 'object' ? v[k] : undefined), root);
}
export function resolveText(text: string, scope: Scope): string {
  return text.replace(BINDING, (_m, s: string, path: string, fmt?: string, fallback?: string) => {
    const root = s === 'state' ? scope.state : s === 'record' ? scope.record : scope.params;
    const value = lookup(root, path);
    if ((value === undefined || value === null || value === '') && fallback) return fallback;
    const str = value === undefined || value === null || value === '' ? '—' : String(value);
    return fmt && formatters[fmt] && str !== '—' ? formatters[fmt](str) : str;
  });
}
/** Every binding in a string, including malformed ones (for validation). */
export function bindingsIn(text: string) {
  const out: { raw: string; scope?: string; path?: string; formatter?: string; valid: boolean }[] = [];
  for (const m of text.matchAll(ANY_BINDING)) {
    BINDING.lastIndex = 0;
    const good = new RegExp(BINDING.source).exec(m[0]);
    out.push(good ? { raw: m[0], scope: good[1], path: good[2], formatter: good[3], valid: !good[3] || good[3] in formatters } : { raw: m[0], valid: false });
  }
  return out;
}
