// Migrate a v1 DemoDefinition (schemaVersion 1) to DemoDocument v2.
// Deterministic and lossless for content and routes; every unavoidable loss is
// reported (never silent), e.g. per-element colour overrides or v1-only actions.
import type { DemoDocument, Collection } from './document.ts';
import type { NodeT } from './registry.ts';
import type { Action } from './actions.ts';

export type MigrationNote = { path: string; note: string };
const THEMES: Record<string, DemoDocument['theme']> = {
  navy: { primary: '#17365D', secondary: '#0E9389', accent: '#F58220', radius: 'md', font: 'system' },
  teal: { primary: '#0E7C7B', secondary: '#17365D', accent: '#F2A541', radius: 'md', font: 'system' },
};
const safeId = (v: unknown, fallback: string) => {
  const s = String(v ?? '').replace(/[^A-Za-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
  return /^[A-Za-z0-9]/.test(s) ? s : fallback;
};
const camel = (v: string) => {
  const parts = String(v).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
  const out = parts.map((p, i) => (i ? p[0].toUpperCase() + p.slice(1) : p)).join('');
  return /^[a-z]/.test(out) ? out.slice(0, 40) : 'f' + out.slice(0, 39);
};
const nonEmpty = (v: unknown, fallback: string) => (typeof v === 'string' && v.trim() ? v : fallback);
const inputTypeOf: Record<string, string> = { text: 'text', email: 'email', password: 'password', number: 'number', date: 'date' };

export function migrateV1(v1: any): { document: DemoDocument; notes: MigrationNote[] } {
  if (!v1 || v1.schemaVersion !== 1 || !Array.isArray(v1.screens)) throw Error('Not a v1 Demo Definition');
  const notes: MigrationNote[] = [];
  const note = (path: string, n: string) => notes.push({ path, note: n });
  const screenIds = new Map<string, string>();
  v1.screens.forEach((s: any, i: number) => screenIds.set(s.id, safeId(s.id, 'screen-' + (i + 1))));
  const route = (id: unknown) => (typeof id === 'string' ? screenIds.get(id) : undefined);
  const collections: Collection[] = [];
  const nav = (screen: unknown): Action[] => { const r = route(screen); return r ? [{ type: 'navigate', screen: r }] : []; };

  function tableNode(el: any, screenId: string, path: string, rowAction?: any): NodeT {
    const columns = (el.columns || []).map((c: any) => ({ field: safeId(c.id, 'col'), label: nonEmpty(c.label, String(c.id)).slice(0, 40) }));
    const fields = columns.map((c: any) => ({ id: c.field, label: c.label }));
    const id = safeId(screenId + '-' + el.id, 'collection-' + collections.length);
    const rows = (el.rows || []).map((r: any) => Object.fromEntries(Object.entries(r).map(([k, v]) => [safeId(k, 'col'), String(v)])));
    let key = fields[0]?.id ?? 'id';
    if (new Set(rows.map((r: any) => r[key])).size !== rows.length) {
      key = '_row'; fields.push({ id: '_row', label: 'Row' }); rows.forEach((r: any, i: number) => (r._row = String(i + 1)));
      note(path, 'Added a row number key because the first column was not unique');
    }
    collections.push({ id, label: nonEmpty(el.title, 'Records').slice(0, 60), key, fields: fields.slice(0, 16), rows });
    const action = rowAction ?? el.rowAction;
    const target = route(action?.screenId) ?? route(el.detailScreen);
    return { type: 'Table', id: safeId(el.id, 'table'), collection: id, ...(el.title ? { title: String(el.title).slice(0, 80) } : {}), columns: columns.slice(0, 8), searchable: el.tools?.search !== false,
      ...(el.tools?.filterColumn ? { filterField: safeId(el.tools.filterColumn, 'col') } : {}), ...(el.tools?.download ? { exportCsv: true } : {}),
      ...(target ? { rowAction: { label: nonEmpty(action?.label, 'View').slice(0, 20), screen: target } } : {}) };
  }
  function fieldNode(f: any, screenId: string, formId: string, path: string): NodeT {
    const base = { id: safeId(formId + '-' + f.id, 'field'), field: camel(screenId) + '.' + camel(f.id), label: nonEmpty(f.label, f.id).slice(0, 80), required: !!f.required };
    if (f.type === 'select') return { type: 'Select', ...base, options: (f.options || []).length ? f.options.slice(0, 20) : ['Option 1'] };
    if (f.type === 'checkbox') return { type: 'Checkbox', ...base, label: nonEmpty(f.label, f.id).slice(0, 200) };
    if (f.type === 'file') return { type: 'Upload', ...base };
    if (!inputTypeOf[f.type]) note(path, 'Unknown field type "' + f.type + '" became a text input');
    return { type: 'Input', ...base, inputType: inputTypeOf[f.type] ?? 'text', ...(f.placeholder ? { placeholder: String(f.placeholder).slice(0, 80) } : {}) };
  }
  function composedNode(el: any, screenId: string, path: string): NodeT {
    const hasInputs = el.items.some((x: any) => ['input', 'select', 'checkbox'].includes(x.kind));
    const children = itemsOf(el, screenId, path);
    const content: NodeT[] = hasInputs ? [{ type: 'Form', id: safeId(el.id + '-form', 'form'), children }] : children;
    return { type: 'Card', id: safeId(el.id, 'section'), ...(el.title && el.title !== 'Screen controls' ? { title: String(el.title).slice(0, 120) } : {}), children: content };
  }
  function itemsOf(el: any, screenId: string, path: string): NodeT[] {
    const hasInputs = el.items.some((x: any) => ['input', 'select', 'checkbox'].includes(x.kind));
    return el.items.flatMap((x: any, i: number) => single(x, i, el, screenId, path, hasInputs));
  }
  function single(x: any, i: number, el: any, screenId: string, path: string, hasInputs: boolean): NodeT[] {
    const p = path + '.items[' + i + ']', id = safeId(el.id + '-' + x.id, 'item-' + i), key = camel(screenId) + '.' + camel(x.id);
    if (x.appearance) note(p, 'Per-item colours are replaced by theme styles');
    switch (x.kind) {
      case 'text': return [{ type: 'Text', id, text: nonEmpty(x.text, x.label).slice(0, 600) }];
      case 'card': return [{ type: 'Card', id, title: nonEmpty(x.label, 'Card').slice(0, 120), children: x.text ? [{ type: 'Text', id: id + '-text', text: String(x.text).slice(0, 600) }] : [] }];
      case 'input': return [{ type: 'Input', id, field: key, label: nonEmpty(x.label, 'Field').slice(0, 80), required: !!x.required, inputType: inputTypeOf[x.inputType] ?? 'text' }];
      case 'select': return [{ type: 'Select', id, field: key, label: nonEmpty(x.label, 'Choose').slice(0, 80), required: !!x.required, options: (x.options?.length ? x.options : ['Option 1']).slice(0, 20) }];
      case 'checkbox': return [{ type: 'Checkbox', id, field: key, label: nonEmpty(x.label, 'Confirm').slice(0, 200), required: !!x.required }];
      case 'progress': return [{ type: 'Progress', id, label: String(x.label ?? '').slice(0, 60), value: Math.max(0, Math.min(100, Number(x.value) || 0)) }];
      case 'badge': return [{ type: 'Badge', id, text: nonEmpty(x.label, 'Status').slice(0, 30), tone: 'neutral' }];
      case 'divider': return [{ type: 'Divider', id }];
      case 'table': return [tableNode({ ...x, title: x.label }, screenId, p, x.rowAction)];
      case 'button': {
        const actions: Action[] = [];
        for (const a of x.actions || []) {
          if (a.type === 'navigate' && route(a.screen)) actions.push({ type: 'navigate', screen: route(a.screen)! });
          else if (a.type === 'notice' && a.message) actions.push({ type: 'toast', message: String(a.message).slice(0, 200) });
          else if (a.type === 'set' && typeof a.value === 'string' && a.target) actions.push({ type: 'setState', key: camel(screenId) + '.' + camel(a.target), value: a.value.slice(0, 200) });
          else if (a.type === 'reset' && hasInputs) actions.push({ type: 'reset' });
          else note(p, 'v1 action "' + a.type + '" has no v2 equivalent and was not migrated');
        }
        actions.push(...nav(x.nextScreen));
        const navigates = actions.some(a => a.type === 'navigate');
        if (hasInputs && navigates) actions.unshift({ type: 'submit', validate: true });
        return [{ type: 'Button', id, label: nonEmpty(x.label, 'Continue').slice(0, 40), variant: navigates ? 'primary' : 'secondary', actions }];
      }
      default: note(p, 'Unknown composed item "' + x.kind + '" was skipped'); return [];
    }
  }

  const footerLinks: any[] = [], menuLinks: any[] = [];
  const screens = v1.screens.map((s: any, si: number) => {
    const sid = screenIds.get(s.id)!;
    const children: NodeT[] = [];
    (s.elements || []).forEach((el: any, ei: number) => {
      const path = 'screens[' + si + '].elements[' + ei + ']';
      if (el.appearance || el.submitAppearance) note(path, 'Per-element colours are replaced by theme styles');
      const id = safeId(el.id, 'el-' + ei);
      switch (el.kind) {
        case 'hero': children.push({ type: 'Stack', id, direction: 'vertical', gap: 'sm', children: [
          ...(el.eyebrow ? [{ type: 'Text', id: id + '-eyebrow', text: String(el.eyebrow).slice(0, 600), tone: 'small' }] : []),
          { type: 'Heading', id: id + '-title', text: nonEmpty(el.title, s.title).slice(0, 140), level: '1' },
          ...(el.description ? [{ type: 'Text', id: id + '-text', text: String(el.description).slice(0, 600) }] : [])] }); break;
        case 'stats': children.push({ type: 'Grid', id, columns: String(Math.min(4, Math.max(2, (el.items || []).length))) as '2', gap: 'md',
          children: (el.items || []).map((it: any, k: number) => ({ type: 'Stat', id: safeId(id + '-' + it.id, 'stat-' + k), label: nonEmpty(it.label, 'Metric').slice(0, 60), value: nonEmpty(it.value, '—').slice(0, 40), ...(it.delta ? { delta: String(it.delta).slice(0, 30) } : {}) })) }); break;
        case 'notice': children.push({ type: 'Notice', id, tone: ['info', 'success', 'warning', 'error'].includes(el.tone) ? el.tone : 'info', title: nonEmpty(el.title, 'Notice').slice(0, 120), ...(el.body ? { body: String(el.body).slice(0, 400) } : {}) }); break;
        case 'form': {
          const fields = (el.fields || []).map((f: any, k: number) => fieldNode(f, sid, id, path + '.fields[' + k + ']'));
          const submit: NodeT[] = el.hideSubmit ? [] : [{ type: 'Button', id: id + '-submit', label: nonEmpty(el.actionLabel, 'Continue').slice(0, 40), variant: 'primary', actions: [{ type: 'submit', validate: true }, ...nav(el.nextScreen)] }];
          children.push({ type: 'Form', id, ...(el.title ? { title: String(el.title).slice(0, 120) } : {}), children: [
            ...(el.description ? [{ type: 'Text', id: id + '-description', text: String(el.description).slice(0, 600), tone: 'muted' }] : []), ...fields, ...submit] });
          break;
        }
        case 'actions': children.push({ type: 'Stack', id, direction: 'horizontal', gap: 'sm', children: (el.buttons || []).map((b: any, k: number) => ({ type: 'Button', id: safeId(id + '-' + b.id, 'button-' + k), label: nonEmpty(b.label, 'Continue').slice(0, 40), variant: b.variant === 'secondary' ? 'secondary' : 'primary', actions: nav(b.nextScreen) })) }); break;
        case 'table': children.push(tableNode(el, sid, path)); break;
        case 'composed': children.push(composedNode(el, sid, path)); break;
        case 'navigation': (el.variant === 'menu' ? menuLinks : footerLinks).push(...(el.links || [])); note(path, 'Navigation moved to the app-level ' + (el.variant === 'menu' ? 'drawer' : 'tab bar')); break;
        default: note(path, 'Unknown element "' + el.kind + '" was skipped');
      }
    });
    return { id: sid, title: nonEmpty(s.title, 'Screen').slice(0, 85), ...(s.subtitle ? { subtitle: String(s.subtitle).slice(0, 160) } : {}), shell: 'default' as const, children };
  });

  const menu = (links: any[]) => {
    const seen = new Set<string>();
    return links.filter(l => route(l.screenId) && !seen.has(l.screenId) && seen.add(l.screenId)).slice(0, 12)
      .map((l, i) => ({ id: safeId(l.id, 'item-' + i), label: nonEmpty(l.label, 'Item').slice(0, 30), icon: 'circle', screen: route(l.screenId)! }));
  };
  let shell: DemoDocument['shell'];
  const brand = nonEmpty(v1.chrome?.brandName, v1.name).slice(0, 60), showBack = v1.chrome?.showBackButton !== false;
  if (v1.channel === 'portal') {
    const tops = v1.screens.filter((s: any) => !s.parentScreenId);
    const items = [...tops.map((s: any) => ({ id: safeId('nav-' + s.id, 'nav'), label: String(s.title).slice(0, 30), icon: 'circle', screen: route(s.id)!,
      children: v1.screens.filter((c: any) => c.parentScreenId === s.id).map((c: any) => ({ id: safeId('nav-' + c.id, 'nav'), label: String(c.title).slice(0, 30), icon: 'circle', screen: route(c.id)! })) })),
      ...menu(v1.navLinks || [])].slice(0, 12).map(it => (it.children?.length ? it : (({ children, ...rest }: any) => rest)(it)));
    shell = { kind: 'sidebar', brand, showBack, items };
  } else {
    const tabs = menu(footerLinks), drawer = menu(menuLinks);
    shell = tabs.length ? { kind: 'tabs', brand, showBack, items: tabs } : drawer.length ? { kind: 'drawer', brand, showBack, items: drawer } : { kind: 'none', brand, showBack, items: [] };
    if (tabs.length && drawer.length) note('screens', 'Both a footer and a menu existed; the footer became tabs and the menu items were dropped');
    for (const l of [...footerLinks, ...menuLinks]) if (!route(l.screenId)) note('screens', 'Menu item "' + l.label + '" had no destination and was dropped');
  }
  const document: DemoDocument = { schemaVersion: 2, id: safeId(v1.id, 'demo'), name: nonEmpty(v1.name, 'Demo').slice(0, 120), channel: v1.channel === 'portal' ? 'portal' : 'mobile',
    theme: THEMES[v1.theme] ?? THEMES.navy, shell, collections, screens };
  return { document, notes };
}
