// Structural mobile screen layout contract, shared by editor and published viewer.
// Legacy navigation elements migrate by interpretation, without mutating saved demos.
export const mobileSlots=['header-left','header-right','body','bottom'];
export function effectiveMobilePlacement(element){
 if(element?.kind!=='navigation')return 'body';
 return element.placement||(element.variant==='menu'?'header-right':'bottom');
}
export function validMobilePlacement(element){
 if(element?.kind!=='navigation')return true;
 const slot=effectiveMobilePlacement(element);
 return element.variant==='menu'?['header-left','header-right','body'].includes(slot):
 element.variant==='footer'?['bottom','body'].includes(slot):false;
}
export function layoutMobileScreen(screen){
 const result={'header-left':[],'header-right':[],body:[],bottom:[]};
 for(const el of screen.elements)result[effectiveMobilePlacement(el)].push(el);
 return result;
}
export function placeMobileElement(d,screenId,elementId,slot){
 if(d.channel!=='mobile')throw Error('Mobile slots are available only for mobile projects.');
 const next=structuredClone(d);
 const screen=next.screens.find(s=>s.id===screenId);
 if(!screen)throw Error('Screen does not exist.');
 const element=screen.elements.find(e=>e.id===elementId);
 if(!element)throw Error('Component no longer exists.');
 if(element.kind!=='navigation'&&slot!=='body')throw Error('This component belongs in the content area, not the mobile header or footer.');
 if(!mobileSlots.includes(slot))throw Error('Invalid mobile placement.');
 if(element.kind==='navigation'){
  const candidate={...element,placement:slot};
  if(!validMobilePlacement(candidate))throw Error('Choose a supported area for this navigation component.');
  if(slot!=='body'&&screen.elements.some(e=>e.id!==element.id&&effectiveMobilePlacement(e)===slot))throw Error('This layout position already contains a navigation component. Move or remove it first.');
  element.placement=slot;
 }
 return next;
}
