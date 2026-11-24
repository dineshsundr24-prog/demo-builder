import { z } from 'zod';
import { ID, ScreenRef, StateKey } from './primitives.ts';
// Declarative, safe actions. No code, URLs or network calls are ever expressible.
export const Action = z.discriminatedUnion('type', [
  z.object({ type: z.literal('navigate'), screen: ScreenRef, passRecord: z.boolean().optional() }).describe('Go to a screen; passRecord carries the current record (e.g. the clicked table row).'),
  z.object({ type: z.literal('back') }).describe('Return to the previous screen.'),
  z.object({ type: z.literal('submit'), form: ID.optional(), validate: z.boolean() }).describe('Validate a form (the enclosing one, or the form with this id). Stops the action chain if invalid.'),
  z.object({ type: z.literal('reset'), form: ID.optional() }).describe('Clear a form.'),
  z.object({ type: z.literal('setState'), key: StateKey, value: z.string().max(200) }),
  z.object({ type: z.literal('updateRecord'), field: z.string().min(1).max(40), value: z.string().max(120) }).describe('Change a field of the current record, e.g. status for maker/checker.'),
  z.object({ type: z.literal('simulate'), label: z.string().min(1).max(120), durationMs: z.number().int().min(0).max(5000), outcome: z.enum(['success', 'failure']) }).describe('Show a simulated external step. Never contacts a real service.'),
  z.object({ type: z.literal('toast'), message: z.string().min(1).max(200) }),
]);
export type Action = z.infer<typeof Action>;
export const Actions = z.array(Action).max(8);
export const actionTypes = Action.options.map(o => o.shape.type.value);
