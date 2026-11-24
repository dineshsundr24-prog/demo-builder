// Deterministic, parameterised journey templates (Decision D6). They expand to
// ordinary registry nodes, so editor, validator and renderer treat them like
// any other content. Every external step is explicitly labelled as simulated.
import type { NodeT } from './registry.ts';
import type { Action } from './actions.ts';

export type TemplateDef = { id: string; label: string; channels: ('mobile' | 'portal')[]; description: string; expand: (p: { id: string; next?: string }) => NodeT[] };
const go = (next?: string): Action[] => (next ? [{ type: 'navigate', screen: next }] : []);

export const templates: TemplateDef[] = [
  { id: 'uaepass-login', label: 'UAE PASS sign-in (simulated)', channels: ['mobile', 'portal'], description: 'Sign in button that simulates UAE PASS authentication.',
    expand: ({ id, next }) => [{ type: 'Card', id: id + '-card', tone: 'muted', children: [
      { type: 'Image', id: id + '-logo', kind: 'logo', alt: 'UAE PASS (demo placeholder)' },
      { type: 'Text', id: id + '-note', text: 'Demo only: no UAE PASS request is sent.', tone: 'small' },
      { type: 'Button', id: id + '-go', label: 'Sign in with UAE PASS', variant: 'secondary', actions: [{ type: 'simulate', label: 'Authenticating with UAE PASS (simulated)', durationMs: 1200, outcome: 'success' }, ...go(next)] },
    ] }] },
  { id: 'otp-entry', label: 'OTP verification', channels: ['mobile', 'portal'], description: 'Six-digit code with simulated resend.',
    expand: ({ id, next }) => [{ type: 'Form', id: id + '-form', children: [
      { type: 'Input', id: id + '-code', field: 'otp.code', label: 'Verification code', inputType: 'otp', required: true, placeholder: '6-digit code' },
      { type: 'Text', id: id + '-timer', text: 'Code expires in 01:00. Demo only: no SMS is sent.', tone: 'small' },
      { type: 'Button', id: id + '-verify', label: 'Verify', variant: 'primary', actions: [{ type: 'submit', validate: true }, { type: 'simulate', label: 'Verifying code (simulated)', durationMs: 800, outcome: 'success' }, ...go(next)] },
      { type: 'Button', id: id + '-resend', label: 'Resend code', variant: 'link', actions: [{ type: 'toast', message: 'A new code would be sent (simulated).' }] },
    ] }] },
  { id: 'uaepass-ekyc', label: 'eKYC via UAE PASS Digital Vault (simulated)', channels: ['mobile', 'portal'], description: 'Consent, simulated Digital Vault retrieval and identity review.',
    expand: ({ id, next }) => [
      { type: 'Steps', id: id + '-steps', steps: ['Consent', 'Retrieve', 'Review'], current: 1 },
      { type: 'Notice', id: id + '-notice', tone: 'info', title: 'Simulated Digital Vault', body: 'This demo does not contact UAE PASS or ICP. Identity data below is fictional.' },
      { type: 'RecordFields', id: id + '-identity', items: [
        { label: 'Full name', value: 'Ahmed Al Hammadi' }, { label: 'Emirates ID', value: '784-XXXX-XXXXXXX-X (fictional)' },
        { label: 'Nationality', value: 'United Arab Emirates' }, { label: 'Expiry', value: '14 Mar 2031' }] },
      { type: 'Form', id: id + '-form', children: [
        { type: 'Checkbox', id: id + '-consent', field: 'ekyc.consent', label: 'I consent to sharing my identity details for this demo', required: true },
        { type: 'Button', id: id + '-confirm', label: 'Confirm identity', variant: 'primary', actions: [{ type: 'submit', validate: true }, { type: 'simulate', label: 'Retrieving documents from Digital Vault (simulated)', durationMs: 1500, outcome: 'success' }, ...go(next)] },
      ] }] },
  { id: 'face-verification', label: 'Face verification (simulated)', channels: ['mobile'], description: 'Camera frame placeholder and simulated liveness check; no camera access.',
    expand: ({ id, next }) => [
      { type: 'Image', id: id + '-frame', kind: 'camera-frame', alt: 'Face frame placeholder (camera is not used)' },
      { type: 'Text', id: id + '-tips', text: 'Find good lighting, remove glasses and keep your face inside the frame.' },
      { type: 'Notice', id: id + '-sim', tone: 'info', title: 'Simulation', body: 'No camera or biometric data is captured in this demo.' },
      { type: 'Button', id: id + '-start', label: 'Start face scan', variant: 'primary', actions: [{ type: 'simulate', label: 'Checking liveness (simulated)', durationMs: 2000, outcome: 'success' }, { type: 'toast', message: 'Face verified (simulated).' }, ...go(next)] },
    ] },
  { id: 'document-upload', label: 'Document upload', channels: ['mobile', 'portal'], description: 'Simulated upload with required document.',
    expand: ({ id, next }) => [{ type: 'Form', id: id + '-form', children: [
      { type: 'Upload', id: id + '-file', field: 'documents.file', label: 'Upload document', required: true },
      { type: 'Text', id: id + '-note', text: 'Files stay in your browser and are not uploaded.', tone: 'small' },
      { type: 'Button', id: id + '-submit', label: 'Upload and continue', variant: 'primary', actions: [{ type: 'submit', validate: true }, { type: 'simulate', label: 'Uploading (simulated)', durationMs: 900, outcome: 'success' }, ...go(next)] },
    ] }] },
  { id: 'maker-review', label: 'Maker review (portal)', channels: ['portal'], description: 'Maker records a recommendation; record status becomes "Pending checker".',
    expand: ({ id, next }) => [{ type: 'Form', id: id + '-form', title: 'Maker review', children: [
      { type: 'Select', id: id + '-decision', field: 'review.makerDecision', label: 'Recommendation', required: true, options: ['Recommend approval', 'Request more information', 'Recommend rejection'] },
      { type: 'Input', id: id + '-comment', field: 'review.makerComment', label: 'Comments', inputType: 'text', required: true },
      { type: 'Button', id: id + '-submit', label: 'Submit to checker', variant: 'primary', actions: [{ type: 'submit', validate: true }, { type: 'updateRecord', field: 'status', value: 'Pending checker' }, { type: 'toast', message: 'Sent to checker.' }, ...go(next)] },
    ] }] },
  { id: 'checker-approval', label: 'Checker approval (portal)', channels: ['portal'], description: 'Checker approves or returns; record status updates accordingly.',
    expand: ({ id, next }) => [{ type: 'Form', id: id + '-form', title: 'Checker decision', children: [
      { type: 'Input', id: id + '-comment', field: 'review.checkerComment', label: 'Checker comments', inputType: 'text', required: false },
      { type: 'Stack', id: id + '-buttons', direction: 'horizontal', gap: 'sm', children: [
        { type: 'Button', id: id + '-approve', label: 'Approve', variant: 'primary', actions: [{ type: 'updateRecord', field: 'status', value: 'Approved' }, { type: 'toast', message: 'Application approved.' }, ...go(next)] },
        { type: 'Button', id: id + '-return', label: 'Return to maker', variant: 'secondary', actions: [{ type: 'updateRecord', field: 'status', value: 'Returned to maker' }, ...go(next)] },
        { type: 'Button', id: id + '-reject', label: 'Reject', variant: 'danger', actions: [{ type: 'updateRecord', field: 'status', value: 'Rejected' }, ...go(next)] },
      ] },
    ] }] },
];
export const templateById = new Map(templates.map(t => [t.id, t]));
export const templateIds = templates.map(t => t.id);
export function expandTemplate(node: NodeT): NodeT[] {
  const t = templateById.get(String(node.template));
  if (!t) return [{ type: 'Notice', id: node.id + '-missing', tone: 'error', title: 'Unknown template "' + String(node.template) + '"' }];
  return t.expand({ id: node.id, next: typeof node.next === 'string' ? node.next : undefined });
}
