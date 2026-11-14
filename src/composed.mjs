// All AI-composed components use the same safe declarative runtime contract.
import {validDynamicComponent,dynamicKinds} from './componentRuntime.mjs';
export const composedKinds=dynamicKinds;
export const validComposed=validDynamicComponent;
