// Spike: single-source component registry for DemoDocument v2.
// Every component is declared once. Validation, the AI output schema, editor
// inspector metadata and (later) TypeScript types are all derived from here.
import { z } from 'zod';

export const ID = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/); // accepts editor-generated IDs (e.g. Button-<uuid>)
// Reference markers. aiSchema() replaces these with enums of real IDs so the
// model cannot emit an unknown destination, collection or template.
export const ScreenRef = z.string().meta({ ref: 'screen' });
export const CollectionRef = z.string().meta({ ref: 'collection' });
export const StateKey = z.string().regex(/^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*){0,2}$/);
// Text may contain {{state.x}}, {{record.field}} or {{params.x}} bindings.
export const BoundText = (max = 240) => z.string().min(1).max(max);

export const Action = z.discriminatedUnion('type', [
  z.object({ type: z.literal('navigate'), screen: ScreenRef, passRecord: z.boolean().optional() }),
  z.object({ type: z.literal('back') }),
  z.object({ type: z.literal('submit'), validate: z.boolean() }),
  z.object({ type: z.literal('setState'), key: StateKey, value: z.string().max(200) }),
  z.object({ type: z.literal('updateRecord'), field: z.string().max(40), value: z.string().max(120) }),
  z.object({ type: z.literal('simulate'), label: z.string().min(1).max(120), durationMs: z.number().int().min(0).max(5000), outcome: z.enum(['success', 'failure']) }),
  z.object({ type: z.literal('toast'), message: z.string().min(1).max(200) }),
]);
export type Action = z.infer<typeof Action>;
const Actions = z.array(Action).max(6);

type Def = { type: string; container: boolean; props: z.ZodObject<any>; ai: string; category: string };
export const components: Def[] = [];
function define(type: string, category: string, ai: string, props: z.ZodRawShape, container = false) {
  components.push({ type, category, ai, container, props: z.object(props) });
}

// ---- Layout & containers -------------------------------------------------
define('Stack', 'layout', 'Vertical or horizontal group of children.', {
  direction: z.enum(['vertical', 'horizontal']), gap: z.enum(['none', 'sm', 'md', 'lg']) }, true);
define('Card', 'layout', 'Surface with optional title grouping children.', {
  title: BoundText(120).optional(), tone: z.enum(['default', 'brand', 'muted']).optional() }, true);
define('Form', 'input', 'Groups inputs; the submit button validates required inputs then runs actions.', {
  submitLabel: z.string().min(1).max(40), onSubmit: Actions }, true);
// ---- Content -------------------------------------------------------------
define('Heading', 'content', 'Title text.', { text: BoundText(140), level: z.enum(['1', '2', '3']) });
define('Text', 'content', 'Paragraph or caption.', { text: BoundText(600), tone: z.enum(['default', 'muted', 'small']).optional() });
define('Notice', 'content', 'Callout banner.', { tone: z.enum(['info', 'success', 'warning', 'error']), title: BoundText(120), body: BoundText(400).optional() });
define('Stat', 'content', 'KPI or balance figure.', { label: BoundText(60), value: BoundText(40), delta: z.string().max(30).optional() });
define('Image', 'content', 'Illustrative placeholder; never a real photo.', { kind: z.enum(['logo', 'illustration', 'camera-frame', 'avatar', 'document']), alt: z.string().min(1).max(120) });
define('Progress', 'content', 'Step or percentage indicator.', { label: z.string().max(60), value: z.number().min(0).max(100) });
define('Badge', 'content', 'Short status label.', { text: BoundText(30), tone: z.enum(['neutral', 'success', 'warning', 'error', 'info']) });
// ---- Actions & inputs ----------------------------------------------------
define('Button', 'action', 'Clickable control running declarative actions.', {
  label: BoundText(40), variant: z.enum(['primary', 'secondary', 'link']), actions: Actions });
define('Input', 'input', 'Text-like input bound to state.', {
  field: StateKey, label: z.string().min(1).max(80), inputType: z.enum(['text', 'email', 'phone', 'number', 'password', 'date', 'otp', 'currency']),
  required: z.boolean(), placeholder: z.string().max(80).optional() });
define('Select', 'input', 'Dropdown bound to state.', {
  field: StateKey, label: z.string().min(1).max(80), options: z.array(z.string().min(1).max(60)).min(1).max(20), required: z.boolean() });
define('Checkbox', 'input', 'Consent or boolean bound to state.', { field: StateKey, label: z.string().min(1).max(200), required: z.boolean() });
define('Upload', 'input', 'Simulated document upload (no file leaves the browser).', { field: StateKey, label: z.string().min(1).max(80), required: z.boolean() });
// ---- Data ----------------------------------------------------------------
define('Table', 'data', 'Rows from a sample data collection with optional row action.', {
  collection: CollectionRef, title: z.string().max(80).optional(),
  columns: z.array(z.object({ field: z.string().min(1).max(40), label: z.string().min(1).max(40) })).min(1).max(8),
  searchable: z.boolean(), rowAction: z.object({ label: z.string().min(1).max(20), screen: ScreenRef }).optional() });
define('RecordFields', 'data', 'Label/value list showing the selected record or state.', {
  items: z.array(z.object({ label: z.string().min(1).max(60), value: BoundText(120) })).min(1).max(16) });
// ---- Templates -----------------------------------------------------------
define('Template', 'template', 'Prebuilt simulated banking block, expanded deterministically.', {
  template: z.string().meta({ ref: 'template' }), next: ScreenRef.optional() });

// ---- Node union -------------------------------------------------------------
// Recursive union built from the registry. Zod 4 emits $defs/$ref for recursion.
export const Node: z.ZodType<any> = z.lazy(() => z.discriminatedUnion('type',
  components.map(c => c.container
    ? c.props.extend({ type: z.literal(c.type), id: ID, children: z.array(Node).min(1).max(20) })
    : c.props.extend({ type: z.literal(c.type), id: ID })) as any));

export const Screen = z.object({
  id: ID, title: z.string().min(1).max(85), subtitle: z.string().max(160).optional(),
  shell: z.enum(['default', 'hidden']), children: z.array(Node).min(1).max(30),
});
export const Collection = z.object({
  id: ID, label: z.string().min(1).max(60),
  fields: z.array(z.object({ id: z.string().min(1).max(40), label: z.string().min(1).max(40) })).min(1).max(12),
  rows: z.array(z.record(z.string(), z.string().max(200))).max(200),
});
export const Shell = z.object({
  kind: z.enum(['tabs', 'drawer', 'sidebar', 'none']),
  items: z.array(z.object({ id: ID, label: z.string().min(1).max(30), icon: z.string().max(30), screen: ScreenRef })).max(12),
});
export const Document = z.object({
  schemaVersion: z.literal(2), id: ID, name: z.string().min(1).max(120), channel: z.enum(['mobile', 'portal']),
  theme: z.object({ primary: z.string().regex(/^#[0-9a-fA-F]{6}$/), secondary: z.string().regex(/^#[0-9a-fA-F]{6}$/), accent: z.string().regex(/^#[0-9a-fA-F]{6}$/) }),
  shell: Shell, collections: z.array(Collection).max(20), screens: z.array(Screen).min(1),
});
export type DemoDocument = z.infer<typeof Document>;
