// Design quality: deterministic clean-up of common AI composition mistakes, and a
// requirement-coverage check. Both run on every generated screen without AI cost.
import { walk, expandTemplate, type NodeT, type Screen, type Issue } from '@demo/schema';

const clone = <T,>(v: T): T => structuredClone(v);
const isCurrencyLabel = (v: unknown) => typeof v === 'string' && /^(?:[A-Z]{3}|balance|amount|total)$/i.test(v.trim());

/** Returns the cleaned screen and a list of human-readable changes. */
export function normalizeDesign(input: Screen): { screen: Screen; changes: string[] } {
  const screen = clone(input);
  const changes: string[] = [];
  let logoSeen = false;
  const fix = (nodes: NodeT[]): NodeT[] => nodes.flatMap((n): NodeT[] => {
    // 1. A row of one or two real buttons is the screen's action bar.
    if (n.type === 'Stack' && n.direction === 'horizontal' && Array.isArray(n.children) && n.children.length >= 1 && n.children.length <= 2
      && n.children.every(c => c.type === 'Button' && c.variant !== 'link')) {
      const buttons = n.children as NodeT[];
      const primary = buttons.find(b => b.variant === 'primary') ?? buttons[buttons.length - 1];
      const secondary = buttons.find(b => b !== primary);
      changes.push('Button row → action bar');
      return [{ type: 'ActionBar', id: n.id, primary: { label: primary.label, actions: primary.actions }, ...(secondary ? { secondary: { label: secondary.label, actions: secondary.actions } } : {}) } as NodeT];
    }
    // 2. A card that only wraps one number: use the designed balance card / KPI instead.
    if (n.type === 'Card' && Array.isArray(n.children) && n.children.length === 1 && n.children[0].type === 'Stat') {
      const stat = n.children[0];
      const label = (n.title as string | undefined) ?? (stat.label as string);
      const caption = !isCurrencyLabel(stat.label) && stat.label !== label ? stat.label : stat.delta;
      changes.push('Card with a single figure → ' + (n.tone === 'brand' ? 'balance card' : 'KPI'));
      return [n.tone === 'brand'
        ? { type: 'BalanceCard', id: n.id, label, amount: stat.value, ...(caption ? { caption } : {}) } as NodeT
        : { type: 'Stat', id: n.id, label, value: stat.value, ...(caption ? { delta: caption } : {}) } as NodeT];
    }
    // 3. One logo per screen.
    const hasLogo = (n.type === 'Image' && n.kind === 'logo') || (n.type === 'Hero' && n.showLogo) || (n.type === 'Template' && n.template === 'uaepass-login');
    if (hasLogo) {
      if (logoSeen && n.type === 'Image') { changes.push('Removed duplicate logo'); return []; }
      if (logoSeen && n.type === 'Hero') { changes.push('Removed duplicate logo'); n.showLogo = false; }
      logoSeen = true;
    }
    if (Array.isArray(n.children)) n.children = fix(n.children);
    return [n];
  });
  screen.children = fix(screen.children as NodeT[]);
  // 4. Actions that "navigate" to the current screen do nothing visible: say what they would do.
  walk(screen.children as NodeT[], '', n => {
    const relabel = (actions: any[] | undefined, label: string) => actions?.forEach((a, i) => {
      if (a?.type === 'navigate' && a.screen === screen.id) { actions[i] = { type: 'toast', message: (label + ' is simulated in this demo').slice(0, 200) }; changes.push('Self-link on "' + label + '" → demo message'); }
    });
    relabel(n.actions as any[], String(n.label ?? 'This action'));
    for (const key of ['primary', 'secondary', 'cta', 'viewAll'] as const) { const b = n[key] as any; if (b?.actions) relabel(b.actions, String(b.label ?? 'This action')); }
    for (const it of (n.items as any[]) ?? []) if (it?.actions) relabel(it.actions, String(it.label ?? 'This action'));
  });
  return { screen, changes };
}

const STOP = new Set(['the', 'and', 'for', 'with', 'from', 'your', 'their', 'option', 'options', 'screen', 'page', 'customer', 'user', 'users', 'details', 'detail', 'information', 'info', 'show', 'shows', 'view', 'allow', 'allows']);
const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(w => w.length >= 3 && !STOP.has(w));
/** All text a user would see on the screen, including expanded templates. */
export function screenText(screen: Screen) {
  const parts: string[] = [screen.title, screen.subtitle ?? ''];
  const collect = (v: unknown) => { if (typeof v === 'string') parts.push(v); else if (Array.isArray(v)) v.forEach(collect); else if (v && typeof v === 'object') Object.entries(v).forEach(([k, x]) => { if (k !== 'children' && k !== 'id' && k !== 'type') collect(x); }); };
  walk(screen.children as NodeT[], '', n => collect(n));
  for (const t of (screen.children as NodeT[]).filter(n => n.type === 'Template')) walk(expandTemplate(t), '', n => collect(n));
  return parts.join(' ').toLowerCase();
}
/** Must-include items (from the plan) that do not appear on the screen. */
export function coverageIssues(screen: Screen, mustInclude: string[] = []): Issue[] {
  const text = screenText(screen);
  const missing = mustInclude.filter(item => {
    const ws = words(item);
    if (!ws.length) return false;
    const found = ws.filter(w => text.includes(w.slice(0, Math.max(4, w.length - 2)))).length;
    return found < Math.ceil(ws.length / 2);
  });
  return missing.length ? [{ path: 'screen', code: 'coverage.missing', severity: 'error', message: 'Requirement not shown on the screen: ' + missing.join('; ') }] : [];
}
