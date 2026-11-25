// Enforced standard-UX rules (both the archetype and the free composition path).
import type { Issue, Screen, NodeT } from '@demo/schema';

export const NAV_LABEL = /^(go to |back to |return to )?(home|menu|dashboard|main menu|back|home screen|go back)$/i;
const META = /\b(for clarity|sample (data|text|content)|example (text|content)|(is|are) displayed (here|below)|this screen (shows|displays)|lorem ipsum|john doe)\b/i;

function walk(nodes: NodeT[], fn: (n: NodeT, path: string) => void, path = 'screen.children') {
  nodes.forEach((n, i) => { fn(n, path + '[' + i + ']'); if (Array.isArray(n.children)) walk(n.children as NodeT[], fn, path + '[' + i + '].children'); });
}
const strings = (v: unknown, out: string[] = []): string[] => { if (typeof v === 'string') out.push(v); else if (Array.isArray(v)) v.forEach(x => strings(x, out)); else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) if (!['children', 'actions', 'alt', 'placeholder'].includes(k)) strings(x, out); return out; };

export function uxIssues(screen: Screen, channel: 'mobile' | 'portal'): Issue[] {
  const issues: Issue[] = [];
  const add = (path: string, code: string, message: string, severity: Issue['severity'] = 'error') => issues.push({ path, code, severity, message, screenId: screen.id } as Issue);
  let primaries = 0, actionBars = 0, hasForm = false, successNotice = '';
  const labels = new Map<string, number>();
  // An outcome screen ends the journey, so "Back to home" is its expected exit.
  let outcome = false;
  walk(screen.children as NodeT[], n => { if ((n.type === 'Hero' && n.illustration === 'success') || (n.type === 'Notice' && n.tone === 'success')) outcome = true; });
  walk(screen.children as NodeT[], (n, path) => {
    if (n.type === 'Form') hasForm = true;
    if (n.type === 'ActionBar') { actionBars++; primaries++; }
    if (n.type === 'Button' && n.variant === 'primary') primaries++;
    const label = (n.type === 'Button' ? n.label : n.type === 'ActionBar' ? (n as any).primary?.label : undefined) as string | undefined;
    const sec = n.type === 'ActionBar' ? (n as any).secondary?.label as string | undefined : undefined;
    for (const l of [label, sec]) if (l) {
      if (NAV_LABEL.test(l.trim())) add(path, 'ux.nav-button', '"' + l + '" duplicates the tab bar or back arrow', screen.shell === 'hidden' || outcome ? 'warning' : 'error');
      const k = l.trim().toLowerCase(); labels.set(k, (labels.get(k) ?? 0) + 1);
    }
    if (n.type === 'Notice' && n.tone === 'success') successNotice = path;
    for (const s of strings(n)) if (META.test(s)) { add(path, 'ux.meta-text', 'Meta/placeholder text: "' + s.slice(0, 60) + '"'); break; }
    if ((n.type === 'Section' || n.type === 'Card') && Array.isArray(n.children) && !n.children.length) add(path, 'ux.empty-section', 'Empty ' + n.type);
  });
  if (actionBars > 1) add('screen', 'ux.many-action-bars', 'More than one action bar');
  if (channel === 'mobile' && primaries > 2) add('screen', 'ux.many-primary', primaries + ' primary actions; a mobile screen has one', 'warning');
  if (hasForm && successNotice) add(successNotice, 'ux.success-on-form', 'Success message on a form screen (belongs on the outcome screen)');
  for (const [l, n] of labels) if (n > 1) add('screen', 'ux.duplicate-action', '"' + l + '" appears ' + n + ' times', 'warning');
  if (!screen.title?.trim()) add('screen', 'ux.no-title', 'Screen has no title');
  return issues;
}
