import {resolveScreenChrome,validScreenChrome} from '../src/screenChrome.mjs';

// Deterministic screen-header operations run before AI content refinement.
// Crucially, a request about renderer-owned chrome must not be passed to a
// model that can edit only content elements.
export function classifyScreenChromeEdit(instruction){
 const text=String(instruction||'');
 const mentionsIcon=/\b(?:wallet\s+icon|bank\s+icon|brand\s+icon|branding\s+icon|header\s+icon|bank\s+logo|brand\s+logo)\b/i.test(text);
 if(!mentionsIcon)return null;
 const remove=/\b(?:remove|hide|delete|take\s+away)\b/i.test(text);
 const show=/\b(?:show|display|restore|add\s+back)\b/i.test(text);
 if(remove&&show)return {supported:false,reason:'Conflicting instructions to show and remove the same header icon.'};
 if(!remove&&!show)return null;
 // Reject mixed edits rather than falsely reporting partial success.
 if(/\b(?:also|and)\s+(?:change|rename|update|add|remove|delete|hide|modify|create)\b/i.test(text.replace(/\b(?:remove|hide|delete|take\s+away)\s+(?:the\s+)?(?:wallet\s+icon|bank\s+icon|brand\s+icon|branding\s+icon|header\s+icon|bank\s+logo|brand\s+logo)\b/ig,''))){
  return {supported:false,reason:'This request mixes a header-icon change with other edits. Send the header change and content edits separately.'};
 }
 return {supported:true,showBrandIcon:show};
}
export function applyScreenChromeEdit(demo,targetId,plan,company='',projectName=''){
 if(!plan?.supported)throw Error(plan?.reason||'Unsupported screen-header change.');
 if(!demo||!Array.isArray(demo.screens))throw Error('Valid demo required.');
 const index=demo.screens.findIndex(s=>s.id===targetId);
 if(index<0)throw Error('Target screen not found.');
 const original=demo.screens[index];
 const before=resolveScreenChrome(demo,original,company,projectName);
 if(before.showBrandIcon===plan.showBrandIcon)throw Error('The header icon is already '+(plan.showBrandIcon?'visible':'hidden')+' on '+original.title+'. No changes required.');
 const result=structuredClone(demo);
 const edited=result.screens[index];
 edited.chrome={...(edited.chrome||{}),showBrandIcon:plan.showBrandIcon};
 if(!validScreenChrome(edited.chrome))throw Error('Screen header override did not pass validation.');
 const after=resolveScreenChrome(result,edited,company,projectName);
 if(after.showBrandIcon!==plan.showBrandIcon)throw Error('Header icon change is not reflected in the renderer.');
 if(JSON.stringify(result.chrome)!==JSON.stringify(demo.chrome))throw Error('Application-level branding changed unexpectedly.');
 for(let i=0;i<demo.screens.length;i++)if(i!==index&&JSON.stringify(result.screens[i])!==JSON.stringify(demo.screens[i]))throw Error('Another screen changed unexpectedly.');
 if(JSON.stringify(result.screens[index].elements)!==JSON.stringify(original.elements))throw Error('Screen content changed unexpectedly.');
 for(let i=0;i<demo.screens.length;i++)if(i!==index&&JSON.stringify(resolveScreenChrome(result,result.screens[i],company,projectName))!==JSON.stringify(resolveScreenChrome(demo,demo.screens[i],company,projectName)))throw Error('Another screen header changed unexpectedly.');
 return {definition:result,changedScreenId:targetId,changedScreenTitle:original.title,preservedScreens:demo.screens.length-1};
}
