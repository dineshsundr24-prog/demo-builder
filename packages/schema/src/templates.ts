// Deterministic, parameterised journey templates (Decision D6). They expand to
// ordinary registry nodes, so editor, validator and renderer treat them like
// any other content. Every external step is explicitly labelled as simulated.
import type { NodeT } from './registry.ts';
import type { Action } from './actions.ts';

// trigger: the template is offered to the AI only when the brief mentions the concept
// (so a "standard sign in" never becomes UAE PASS). Generic templates have no trigger.
export type TemplateDef = { id: string; label: string; channels: ('mobile' | 'portal')[]; description: string; trigger?: RegExp; expand: (p: { id: string; next?: string; alt?: string }) => NodeT[] };
const go = (next?: string): Action[] => (next ? [{ type: 'navigate', screen: next }] : []);

export const templates: TemplateDef[] = [
  { id: 'sign-in', label: 'Sign in (email or mobile + password)', channels: ['mobile', 'portal'], description: 'Standard sign-in form: email or mobile, password with show/hide, remember me, forgot password, link to sign up (alt).',
    expand: ({ id, next, alt }) => [
      { type: 'Form', id: id + '-form', children: [
        { type: 'Input', id: id + '-user', field: 'signIn.username', label: 'Email or mobile number', inputType: 'text', required: true, placeholder: 'name@example.com or +971 50 000 0000' },
        { type: 'Input', id: id + '-password', field: 'signIn.password', label: 'Password', inputType: 'password', required: true },
        { type: 'Checkbox', id: id + '-remember', field: 'signIn.remember', label: 'Remember me on this device', required: false },
        { type: 'Button', id: id + '-submit', label: 'Sign in', variant: 'primary', actions: [{ type: 'submit', validate: true }, { type: 'simulate', label: 'Signing in', durationMs: 700, outcome: 'success' }, ...go(next)] },
        { type: 'Button', id: id + '-forgot', label: 'Forgot password?', variant: 'link', actions: [{ type: 'toast', message: 'A reset link would be sent (demo).' }] },
      ] },
      ...(alt ? [{ type: 'Stack', id: id + '-alt', direction: 'horizontal', gap: 'sm', align: 'center', children: [
        { type: 'Text', id: id + '-alt-text', text: 'New customer?', tone: 'muted' },
        { type: 'Button', id: id + '-alt-go', label: 'Create an account', variant: 'link', actions: [{ type: 'navigate', screen: alt }] }] }] : []),
    ] as NodeT[] },
  { id: 'sign-up', label: 'Sign up (registration form)', channels: ['mobile', 'portal'], description: 'Standard registration: full name, email, mobile, password and confirmation, terms consent, link to sign in (alt).',
    expand: ({ id, next, alt }) => [
      { type: 'Form', id: id + '-form', children: [
        { type: 'Input', id: id + '-name', field: 'signUp.fullName', label: 'Full name', inputType: 'text', required: true },
        { type: 'Input', id: id + '-email', field: 'signUp.email', label: 'Email address', inputType: 'email', required: true },
        { type: 'Input', id: id + '-mobile', field: 'signUp.mobile', label: 'Mobile number', inputType: 'phone', required: true, placeholder: '+971 50 000 0000' },
        { type: 'Input', id: id + '-password', field: 'signUp.password', label: 'Create password', inputType: 'password', required: true },
        { type: 'Input', id: id + '-confirm', field: 'signUp.confirmPassword', label: 'Confirm password', inputType: 'password', required: true },
        { type: 'Checkbox', id: id + '-terms', field: 'signUp.terms', label: 'I agree to the terms and conditions and privacy policy', required: true },
        { type: 'Button', id: id + '-submit', label: 'Create account', variant: 'primary', actions: [{ type: 'submit', validate: true }, { type: 'simulate', label: 'Creating your account', durationMs: 900, outcome: 'success' }, ...go(next)] },
      ] },
      ...(alt ? [{ type: 'Stack', id: id + '-alt', direction: 'horizontal', gap: 'sm', align: 'center', children: [
        { type: 'Text', id: id + '-alt-text', text: 'Already have an account?', tone: 'muted' },
        { type: 'Button', id: id + '-alt-go', label: 'Sign in', variant: 'link', actions: [{ type: 'navigate', screen: alt }] }] }] : []),
    ] as NodeT[] },
  { id: 'uaepass-login', trigger: /uae\s*pass/i, label: 'UAE PASS sign-in (simulated)', channels: ['mobile', 'portal'], description: 'Sign in button that simulates UAE PASS authentication.',
    expand: ({ id, next }) => [{ type: 'Card', id: id + '-card', tone: 'muted', children: [
      { type: 'Image', id: id + '-logo', kind: 'logo', alt: 'UAE PASS (demo placeholder)' },
      { type: 'Text', id: id + '-note', text: 'Demo only: no UAE PASS request is sent.', tone: 'small' },
      { type: 'Button', id: id + '-go', label: 'Sign in with UAE PASS', variant: 'secondary', actions: [{ type: 'simulate', label: 'Authenticating with UAE PASS (simulated)', durationMs: 1200, outcome: 'success' }, ...go(next)] },
    ] }] },
  { id: 'otp-entry', trigger: /\botp\b|one[- ]time (?:pass|code)|verification code|sms code/i, label: 'OTP verification', channels: ['mobile', 'portal'], description: 'Six-digit code with simulated resend.',
    expand: ({ id, next }) => [{ type: 'Form', id: id + '-form', children: [
      { type: 'Input', id: id + '-code', field: 'otp.code', label: 'Verification code', inputType: 'otp', required: true, placeholder: '6-digit code' },
      { type: 'Text', id: id + '-timer', text: 'Code expires in 01:00. Demo only: no SMS is sent.', tone: 'small' },
      { type: 'Button', id: id + '-verify', label: 'Verify', variant: 'primary', actions: [{ type: 'submit', validate: true }, { type: 'simulate', label: 'Verifying code (simulated)', durationMs: 800, outcome: 'success' }, ...go(next)] },
      { type: 'Button', id: id + '-resend', label: 'Resend code', variant: 'link', actions: [{ type: 'toast', message: 'A new code would be sent (simulated).' }] },
    ] }] },
  { id: 'uaepass-ekyc', trigger: /e-?kyc|digital vault|know your customer/i, label: 'eKYC via UAE PASS Digital Vault (simulated)', channels: ['mobile', 'portal'], description: 'Consent, simulated Digital Vault retrieval and identity review.',
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
  { id: 'face-verification', trigger: /face|biometric|liveness|selfie/i, label: 'Face verification (simulated)', channels: ['mobile'], description: 'Camera frame placeholder and simulated liveness check; no camera access.',
    expand: ({ id, next }) => [
      { type: 'Image', id: id + '-frame', kind: 'camera-frame', alt: 'Face frame placeholder (camera is not used)' },
      { type: 'Text', id: id + '-tips', text: 'Find good lighting, remove glasses and keep your face inside the frame.' },
      { type: 'Notice', id: id + '-sim', tone: 'info', title: 'Simulation', body: 'No camera or biometric data is captured in this demo.' },
      { type: 'Button', id: id + '-start', label: 'Start face scan', variant: 'primary', actions: [{ type: 'simulate', label: 'Checking liveness (simulated)', durationMs: 2000, outcome: 'success' }, { type: 'toast', message: 'Face verified (simulated).' }, ...go(next)] },
    ] },
  { id: 'document-upload', trigger: /upload|document|attachment|certificate/i, label: 'Document upload', channels: ['mobile', 'portal'], description: 'Simulated upload with required document.',
    expand: ({ id, next }) => [{ type: 'Form', id: id + '-form', children: [
      { type: 'Upload', id: id + '-file', field: 'documents.file', label: 'Upload document', required: true },
      { type: 'Text', id: id + '-note', text: 'Files stay in your browser and are not uploaded.', tone: 'small' },
      { type: 'Button', id: id + '-submit', label: 'Upload and continue', variant: 'primary', actions: [{ type: 'submit', validate: true }, { type: 'simulate', label: 'Uploading (simulated)', durationMs: 900, outcome: 'success' }, ...go(next)] },
    ] }] },
  { id: 'maker-review', trigger: /maker|checker|four[- ]eyes|review queue/i, label: 'Maker review (portal)', channels: ['portal'], description: 'Maker records a recommendation; record status becomes "Pending checker".',
    expand: ({ id, next }) => [{ type: 'Form', id: id + '-form', title: 'Maker review', children: [
      { type: 'Select', id: id + '-decision', field: 'review.makerDecision', label: 'Recommendation', required: true, options: ['Recommend approval', 'Request more information', 'Recommend rejection'] },
      { type: 'Input', id: id + '-comment', field: 'review.makerComment', label: 'Comments', inputType: 'text', required: true },
      { type: 'Button', id: id + '-submit', label: 'Submit to checker', variant: 'primary', actions: [{ type: 'submit', validate: true }, { type: 'updateRecord', field: 'status', value: 'Pending checker' }, { type: 'toast', message: 'Sent to checker.' }, ...go(next)] },
    ] }] },
  { id: 'checker-approval', trigger: /maker|checker|four[- ]eyes|approv/i, label: 'Checker approval (portal)', channels: ['portal'], description: 'Checker approves or returns; record status updates accordingly.',
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
/** Templates the AI may use for this brief and channel (journey templates need a mention in the brief). */
export function allowedTemplates(channel: 'mobile' | 'portal', brief: string) {
  return templates.filter(t => t.channels.includes(channel) && (!t.trigger || t.trigger.test(brief))).map(t => t.id);
}
export function expandTemplate(node: NodeT): NodeT[] {
  const t = templateById.get(String(node.template));
  if (!t) return [{ type: 'Notice', id: node.id + '-missing', tone: 'error', title: 'Unknown template "' + String(node.template) + '"' }];
  return t.expand({ id: node.id, next: typeof node.next === 'string' ? node.next : undefined, alt: typeof node.alt === 'string' ? node.alt : undefined });
}
