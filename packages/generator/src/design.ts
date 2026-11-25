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
  // 5. Single-brace references like {record.name} are meant as bindings: make them {{record.name}}.
  // Unknown formatters ({{state.x | shout}}) are dropped rather than failing the screen.
  const known = ['aed', 'date', 'upper', 'lower', 'title', 'mask'];
  const rebrace = (s: string) => s.replace(/\{\{\s*((?:state|record|params)\.[A-Za-z0-9_.]+)\s*\|\s*([a-z]+)\s*\}\}/g, (m, ref, f) => (known.includes(f) ? m : (changes.push('Dropped unknown formatter | ' + f), '{{' + ref + '}}'))).replace(/(^|[^{])\{\s*((?:state|record|params)\.[A-Za-z0-9_.]+)\s*\}(?!\})/g, (_m, pre, ref) => { changes.push('Fixed binding {' + ref + '}'); return pre + '{{' + ref + '}}'; });
  const visitStrings = (v: any): any => typeof v === 'string' ? rebrace(v) : Array.isArray(v) ? v.map(visitStrings) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, k === 'type' || k === 'id' ? x : visitStrings(x)])) : v;
  screen.children = visitStrings(screen.children);
  // 6. A submit that names a form that does not exist: use the screen's only form (e.g. a template's form).
  const forms: string[] = [];
  walk(screen.children as NodeT[], '', n => { if (n.type === 'Form') forms.push(n.id); });
  walk(screen.children as NodeT[], '', n => {
    const fixForm = (actions: any[] | undefined) => actions?.forEach(a => { if ((a?.type === 'submit' || a?.type === 'reset') && a.form && !forms.includes(a.form) && forms.length === 1) { changes.push('Submit form "' + a.form + '" → "' + forms[0] + '"'); a.form = forms[0]; } });
    fixForm(n.actions as any[]);
    for (const key of ['primary', 'secondary', 'cta', 'viewAll'] as const) fixForm((n[key] as any)?.actions);
    for (const it of (n.items as any[]) ?? []) fixForm(it?.actions);
  });
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

const STOP = new Set(['the', 'and', 'for', 'with', 'from', 'your', 'their', 'option', 'options', 'screen', 'page', 'customer', 'user', 'users', 'details', 'detail', 'information', 'info', 'show', 'shows', 'view', 'allow', 'allows', 'button', 'buttons', 'input', 'inputs', 'display', 'displayed', 'editable', 'field', 'fields', 'link', 'text', 'section']);
const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(w => w.length >= 3 && !STOP.has(w));
// What each component means to a reader, so "quick actions" or "recent transactions" match
// a QuickActions / TransactionList pattern even when it has no visible title.
const MEANING: Record<string, string> = {
  QuickActions: 'quick actions shortcuts', TransactionList: 'recent transactions activity history payments list', BalanceCard: 'balance account summary masked account number',
  Upload: 'upload document attachment', ActionBar: 'submit save continue confirm action button', Button: 'button action', Table: 'table tables list records search filter export csv download',
  List: 'list items', MenuList: 'settings menu options', ProfileHeader: 'profile avatar name', StatusTimeline: 'status timeline progress tracking',
  Steps: 'steps progress', Checkbox: 'consent agree terms', Promo: 'offer promotion banner', Hero: 'welcome brand logo value proposition tagline', FeatureList: 'highlights features benefits value proposition', Chart: 'chart charts graph trend analytics', Grid: 'kpi summary', Stat: 'kpi metric figure',
  Select: 'choose select dropdown', Radio: 'choose option', Form: 'form fields', Notice: 'notice alert message', Template: 'template',
};
/** All text a user would see on the screen, including expanded templates. */
export function screenText(screen: Screen) {
  const parts: string[] = [screen.title, screen.subtitle ?? ''];
  const collect = (v: unknown) => { if (typeof v === 'string') parts.push(v); else if (Array.isArray(v)) v.forEach(collect); else if (v && typeof v === 'object') Object.entries(v).forEach(([k, x]) => { if (k !== 'children' && k !== 'id' && k !== 'type') collect(x); }); };
  if (screen.shell !== 'hidden') parts.push('navigation tabs bottom footer top menu bar'); // the app shell provides navigation
  walk(screen.children as NodeT[], '', n => {
    collect(n); parts.push(MEANING[n.type] ?? '');
    if (n.type === 'Input' && n.inputType === 'otp') parts.push('otp code');
    if (n.type === 'Input' && n.inputType === 'password') parts.push('show hide password');
    if ((n.type === 'Heading' || n.type === 'ProfileHeader') && /\b(good (morning|afternoon|evening)|welcome|hello|hi)\b/i.test(String(n.text ?? n.name ?? ''))) parts.push('greeting');
  });
  walk(screen.children as NodeT[], '', n => { if (n.type === 'Template') walk(expandTemplate(n), '', m => { collect(m); parts.push(MEANING[m.type] ?? ''); }); });
  const text = parts.join(' ').toLowerCase();
  return text + (/expires in|resend/.test(text) ? ' countdown timer' : '') + (/[*•x]{3,}/.test(text) ? ' masked' : '');
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
