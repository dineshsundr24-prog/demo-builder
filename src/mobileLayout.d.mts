import type {DemoDefinition,Element,Screen} from './demo';
export type MobileSlot='header-left'|'header-right'|'body'|'bottom';
export const mobileSlots:MobileSlot[];
export function effectiveMobilePlacement(element:Element):MobileSlot;
export function validMobilePlacement(element:Element):boolean;
export function layoutMobileScreen(screen:Screen):Record<MobileSlot,Element[]>;
export function placeMobileElement(definition:DemoDefinition,screenId:string,elementId:string,slot:MobileSlot):DemoDefinition;
