import { z } from 'zod';
// IDs accept editor-generated forms such as "Button-<uuid>" (Decision D3).
export const ID = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/, 'IDs use letters, digits and hyphens (max 64)');
// Reference markers: aiSchema() turns these into enums of the real IDs.
export const ScreenRef = z.string().min(1).meta({ ref: 'screen' });
export const CollectionRef = z.string().min(1).meta({ ref: 'collection' });
export const TemplateRef = z.string().min(1).meta({ ref: 'template' });
export const StateKey = z.string().regex(/^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*){0,3}$/, 'State keys look like "income.salary"');
// Text that may contain {{state.x}}, {{record.field}} or {{params.x}} bindings.
export const Bound = (max = 240) => z.string().min(1).max(max);
export const Color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
