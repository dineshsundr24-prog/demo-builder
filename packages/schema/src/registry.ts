// The single source of truth for components (Decision D1).
// Each entry yields: validation, the strict AI schema, editor palette/inspector
// metadata and a factory for new instances. Add a component by adding one entry.
import { z } from 'zod';
import { ID, Bound, CollectionRef, ScreenRef, StateKey, TemplateRef } from './primitives.ts';
import { Actions } from './actions.ts';

export type Category = 'layout' | 'content' | 'input' | 'action' | 'data' | 'template';
export type Channel = 'mobile' | 'portal';
export type ComponentDef = {
  type: string;
  label: string;
  category: Category;
  ai: string;                       // one-line guidance included in AI instructions
  container: boolean;
  channels: Channel[];
  props: z.ZodObject<any>;
  create: () => Record<string, unknown>; // valid required props for palette insertion (no optional defaults: D3 rule 2)
  allowedChildren?: string[];
};

const defs: ComponentDef[] = [];
const both: Channel[] = ['mobile', 'portal'];
function define(d: Omit<ComponentDef, 'channels' | 'container'> & { channels?: Channel[]; container?: boolean }) {
  defs.push({ channels: both, container: false, ...d });
}
const Options = z.array(z.string().min(1).max(60)).min(1).max(20);

// ---------- Layout ----------
define({ type: 'Stack', label: 'Stack', category: 'layout', container: true, ai: 'Vertical or horizontal group.',
  props: z.object({ direction: z.enum(['vertical', 'horizontal']), gap: z.enum(['none', 'sm', 'md', 'lg']), align: z.enum(['start', 'center', 'end', 'stretch']).optional() }),
  create: () => ({ direction: 'vertical', gap: 'md', children: [] }) });
define({ type: 'Grid', label: 'Grid', category: 'layout', container: true, ai: 'Multi-column layout (portal dashboards, KPI rows). Collapses to one column on mobile.',
  props: z.object({ columns: z.enum(['2', '3', '4']), gap: z.enum(['sm', 'md', 'lg']) }),
  create: () => ({ columns: '2', gap: 'md', children: [] }) });
define({ type: 'Section', label: 'Section', category: 'layout', container: true, ai: 'Titled region of a page.',
  props: z.object({ title: Bound(120), description: Bound(300).optional() }),
  create: () => ({ title: 'Section', children: [] }) });
define({ type: 'Card', label: 'Card', category: 'layout', container: true, ai: 'Surface grouping related content.',
  props: z.object({ title: Bound(120).optional(), tone: z.enum(['default', 'brand', 'muted']).optional() }),
  create: () => ({ children: [] }) });
define({ type: 'Form', label: 'Form', category: 'input', container: true, ai: 'Groups inputs. Buttons with a submit action validate it; buttons may sit outside and name the form id.',
  props: z.object({ title: Bound(120).optional() }),
  create: () => ({ children: [] }) });
// ---------- Content ----------
define({ type: 'Heading', label: 'Heading', category: 'content', ai: 'Title text.',
  props: z.object({ text: Bound(140), level: z.enum(['1', '2', '3']) }), create: () => ({ text: 'Heading', level: '2' }) });
define({ type: 'Text', label: 'Text', category: 'content', ai: 'Paragraph or caption.',
  props: z.object({ text: Bound(600), tone: z.enum(['default', 'muted', 'small']).optional() }), create: () => ({ text: 'Text' }) });
define({ type: 'Notice', label: 'Notice', category: 'content', ai: 'Callout banner.',
  props: z.object({ tone: z.enum(['info', 'success', 'warning', 'error']), title: Bound(120), body: Bound(400).optional() }), create: () => ({ tone: 'info', title: 'Notice' }) });
define({ type: 'Stat', label: 'Stat / KPI', category: 'content', ai: 'KPI or balance figure.',
  props: z.object({ label: Bound(60), value: Bound(40), delta: z.string().max(30).optional() }), create: () => ({ label: 'Metric', value: '0' }) });
define({ type: 'Image', label: 'Image placeholder', category: 'content', ai: 'Illustrative placeholder; never a real photo or ID.',
  props: z.object({ kind: z.enum(['logo', 'illustration', 'camera-frame', 'avatar', 'document', 'card']), alt: z.string().min(1).max(120) }), create: () => ({ kind: 'illustration', alt: 'Illustration' }) });
define({ type: 'Progress', label: 'Progress bar', category: 'content', ai: 'Percentage indicator.',
  props: z.object({ label: z.string().max(60), value: z.number().min(0).max(100) }), create: () => ({ label: 'Progress', value: 50 }) });
define({ type: 'Steps', label: 'Step indicator', category: 'content', ai: 'Journey step indicator, e.g. 2 of 5.',
  props: z.object({ steps: z.array(z.string().min(1).max(30)).min(2).max(8), current: z.number().int().min(1).max(8) }), create: () => ({ steps: ['Details', 'Verify', 'Done'], current: 1 }) });
define({ type: 'Badge', label: 'Badge', category: 'content', ai: 'Short status label.',
  props: z.object({ text: Bound(30), tone: z.enum(['neutral', 'success', 'warning', 'error', 'info']) }), create: () => ({ text: 'Status', tone: 'neutral' }) });
define({ type: 'Divider', label: 'Divider', category: 'content', ai: 'Horizontal separator.', props: z.object({}), create: () => ({}) });
define({ type: 'RecordFields', label: 'Detail fields', category: 'data', ai: 'Label/value list; values may bind to {{record.x}} or {{state.x}}.',
  props: z.object({ items: z.array(z.object({ label: z.string().min(1).max(60), value: Bound(160) })).min(1).max(20) }),
  create: () => ({ items: [{ label: 'Label', value: 'Value' }] }) });
// ---------- Inputs ----------
const inputBase = { field: StateKey, label: z.string().min(1).max(80), required: z.boolean() };
define({ type: 'Input', label: 'Text input', category: 'input', ai: 'Text-like input bound to a state key.',
  props: z.object({ ...inputBase, inputType: z.enum(['text', 'email', 'phone', 'number', 'password', 'date', 'otp', 'currency']), placeholder: z.string().max(80).optional() }),
  create: () => ({ field: 'form.field', label: 'Field', required: false, inputType: 'text' }) });
define({ type: 'Select', label: 'Dropdown', category: 'input', ai: 'Dropdown bound to state.',
  props: z.object({ ...inputBase, options: Options }), create: () => ({ field: 'form.choice', label: 'Choose', required: false, options: ['Option 1', 'Option 2'] }) });
define({ type: 'Radio', label: 'Radio group', category: 'input', ai: 'Single choice among a few options.',
  props: z.object({ ...inputBase, options: Options }), create: () => ({ field: 'form.option', label: 'Choose one', required: false, options: ['Yes', 'No'] }) });
define({ type: 'Checkbox', label: 'Checkbox', category: 'input', ai: 'Consent or boolean.',
  props: z.object({ field: StateKey, label: z.string().min(1).max(200), required: z.boolean() }), create: () => ({ field: 'form.agree', label: 'I agree', required: false }) });
define({ type: 'Toggle', label: 'Toggle', category: 'input', ai: 'On/off setting.',
  props: z.object({ field: StateKey, label: z.string().min(1).max(80) }), create: () => ({ field: 'settings.enabled', label: 'Enabled' }) });
define({ type: 'Upload', label: 'Document upload', category: 'input', ai: 'Simulated upload; the file never leaves the browser.',
  props: z.object({ ...inputBase }), create: () => ({ field: 'form.document', label: 'Upload document', required: false }) });
// ---------- Actions ----------
define({ type: 'Button', label: 'Button', category: 'action', ai: 'Runs declarative actions in order.',
  props: z.object({ label: Bound(40), variant: z.enum(['primary', 'secondary', 'link', 'danger']), actions: Actions }),
  create: () => ({ label: 'Continue', variant: 'primary', actions: [] }) });
// ---------- Data ----------
const Column = z.object({ field: z.string().min(1).max(40), label: z.string().min(1).max(40), format: z.enum(['text', 'aed', 'date', 'status']).optional() });
define({ type: 'Table', label: 'Table', category: 'data', ai: 'Rows from a data collection with BUILT-IN search (searchable), status filter (filterField) and CSV export (exportCsv): never add separate search/filter inputs for it. Column format: aed for amounts, date for dates, status for statuses. rowAction opens a screen with the clicked record.',
  props: z.object({ collection: CollectionRef, title: z.string().max(80).optional(), columns: z.array(Column).min(1).max(8), searchable: z.boolean(),
    filterField: z.string().max(40).optional(), rowAction: z.object({ label: z.string().min(1).max(20), screen: ScreenRef }).optional(), exportCsv: z.boolean().optional() }),
  create: () => ({ collection: '', columns: [], searchable: true }) });
define({ type: 'List', label: 'List', category: 'data', ai: 'Mobile-friendly list of collection items; tapping opens a screen with the record.',
  props: z.object({ collection: CollectionRef, titleField: z.string().min(1).max(40), subtitleField: z.string().max(40).optional(), badgeField: z.string().max(40).optional(),
    itemAction: z.object({ screen: ScreenRef }).optional() }),
  create: () => ({ collection: '', titleField: '' }) });
// ---------- Templates ----------
define({ type: 'Template', label: 'Journey template', category: 'template', ai: 'Prebuilt simulated banking block (UAE PASS, eKYC, face, OTP, upload, maker/checker). Set next to the screen that follows success.',
  props: z.object({ template: TemplateRef, next: ScreenRef.optional() }), create: () => ({ template: 'otp-entry' }) });

export const components: readonly ComponentDef[] = defs;
export const componentByType = new Map(defs.map(d => [d.type, d]));
export const containerTypes = new Set(defs.filter(d => d.container).map(d => d.type));
export const inputTypes = new Set(defs.filter(d => d.category === 'input' && !d.container).map(d => d.type));

// Recursive node union derived from the registry.
// Key order matters for strict structured output: the model must emit keys in
// schema order, so the discriminator comes FIRST (then id, props, children last).
// With type last, a node starting with "type" only matched the prop-less Divider
// and gpt-4.1-mini produced screens made of Dividers (live run, Phase 2).
export const Node: z.ZodType<NodeT> = z.lazy(() => z.discriminatedUnion('type',
  defs.map(d => z.object({ type: z.literal(d.type), id: ID, ...d.props.shape, ...(d.container ? { children: z.array(Node).max(40) } : {}) })) as any)) as any;
export type NodeT = { type: string; id: string; children?: NodeT[]; [prop: string]: unknown };

let counter = 0;
export function createNode(type: string, id?: string): NodeT {
  const def = componentByType.get(type);
  if (!def) throw Error('Unknown component type ' + type);
  return { type, id: id ?? type + '-' + (++counter).toString(36) + Date.now().toString(36).slice(-4), ...structuredClone(def.create()) } as NodeT;
}
