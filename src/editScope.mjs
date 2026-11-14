// Shared edit-scope contract between proposal client and backend.
// A scoped edit may modify its selected screen, never any unrelated screen.
const identical=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export function verifyEditScope(before,next,target,scope,operations=[]){
 if(!before||!next||!Array.isArray(before.screens)||!Array.isArray(next.screens))throw Error('Invalid before/after demo.');
 if(before.id!==next.id||before.channel!==next.channel||before.screens.length<1)throw Error('Project identity or channel was changed.');
 const additions=Array.isArray(operations)?operations.filter(op=>op.op==='add-subsection'):[];
 const expected=before.screens.length+additions.length;
 if(next.screens.length!==expected)throw Error('Unexpected screen count changed.');
 const originalIds=new Set(before.screens.map(sc=>sc.id));
 for(const previous of before.screens){
  const current=next.screens.find(sc=>sc.id===previous.id);
  if(!current)throw Error('An existing screen was removed.');
  if(scope==='global'||previous.id!==target?.screenId){
   if(!identical(current,previous))throw Error('An unrelated screen changed unexpectedly: '+previous.id);
  }
 }
 const created=next.screens.filter(sc=>!originalIds.has(sc.id));
 if(created.length!==additions.length)throw Error('Unexpected screen was created.');
 const menuOps=operations.filter(op=>op.op==='add-menu-link');
 const previousLinks=before.navLinks||[],nextLinks=next.navLinks||[];
 if(menuOps.length){
  if(nextLinks.length!==previousLinks.length+menuOps.length)throw Error('Requested navigation entry was not added.');
  for(const prior of previousLinks)if(!nextLinks.some(link=>identical(link,prior)))throw Error('An existing navigation link was modified.');
  for(const op of menuOps)if(!nextLinks.some(link=>link.label===op.label&&link.screenId===op.screenId&&!previousLinks.some(p=>p.id===link.id)))throw Error('Navigation link destination or label did not match requested edit.');
 }else if(!identical(previousLinks,nextLinks))throw Error('An unrelated navigation item was changed.');

 for(const child of created){
  if(!additions.some(op=>(op.target||target)?.screenId===child.parentScreenId))throw Error('A child screen has an unexpected parent.');
 }
 if(scope==='global'){
  if(additions.length||identical(before.chrome,next.chrome))throw Error('Global header change was not applied correctly.');
 }else if(!identical(before.chrome,next.chrome))throw Error('Application-wide header changed unexpectedly.');
 if(identical(before,next))throw Error('No actual changes were proposed.');
 return true;
}
