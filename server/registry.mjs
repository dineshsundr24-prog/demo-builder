// Derived, read-only registry for grounded AI planning. No arbitrary paths.
export const normalizeName=value=>String(value??'').normalize('NFKC').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const nodeId=(level,screenId,elementId,childId)=>[level,screenId,elementId,childId].filter(Boolean).join(':');
export function buildRegistry(demo,selected){
 const entries=[];
 function add(level,screen,element,node,parent,capabilities,childId){
  const target={level,screenId:screen.id};
  if(element)target.elementId=element.id;
  if(childId)target.childId=childId;
  const id=nodeId(level,screen.id,element?.id,childId);
  entries.push({id,target,label:String(node.label||node.title||node.kind||'Header'),type:level==='element'?node.kind:level,
   parentId:parent||null,screenTitle:screen.title,capabilities});
 }
 for(const screen of demo.screens){
  add('screen',screen,null,screen,null,['set']);
  add('header',screen,null,{label:'Header'},nodeId('screen',screen.id),['set']);
  for(const element of screen.elements){
   const caps=['hero','notice','form','table'].includes(element.kind)?['set','remove-element']:['remove-element'];
   if(element.kind==='form')caps.push('add-field');
   add('element',screen,element,element,nodeId('screen',screen.id),caps);
   if(element.kind==='form')for(const field of element.fields){
    add('field',screen,element,field,nodeId('element',screen.id,element.id),['set','remove-field','move-field'],field.id);
   }
   if(element.kind==='actions')for(const button of element.buttons){
    add('button',screen,element,button,nodeId('element',screen.id,element.id),['set'],button.id);
   }
  }
 }
 return entries.map(entry=>({...entry,selected:entry.target.screenId===selected?.screenId,
  exactSelection:entry.target.level===selected?.level&&entry.target.screenId===selected?.screenId&&entry.target.elementId===selected?.elementId&&entry.target.childId===selected?.childId}));
}
export function chooseRegistryTarget(registry,id,selection){
 if(typeof id!=='string')throw new Error('Target must reference an existing registry ID.');
 const entry=registry.find(e=>e.id===id);
 if(!entry)throw new Error('Target ID "'+id+'" was not found in the saved demo registry.');
 if(entry.target.screenId!==selection.screenId)throw new Error('Target belongs to another screen. Select that screen before editing it.');
 if(selection.level!=='screen'){
  const same=entry.target.level===selection.level&&entry.target.elementId===selection.elementId&&entry.target.childId===selection.childId;
  const childOfForm=selection.level==='element'&&entry.target.level==='field'&&entry.target.elementId===selection.elementId;
  if(!same&&!childOfForm)throw new Error('Target is outside the selected component.');
 }
 return entry;
}
export function resolveChangeSet(registry,selection,changes){
 if(!Array.isArray(changes)||changes.length<1||changes.length>8)throw new Error('Provide one to eight intended changes.');
 return changes.map((change,index)=>{
  if(!change||typeof change!=='object')throw new Error('Change '+(index+1)+' is not an object.');
  const kind=change.action;
  const entry=chooseRegistryTarget(registry,change.targetId,selection);
  if(!entry.capabilities.includes(kind))throw new Error('Operation '+String(kind)+' is unsupported for '+entry.type+' "'+entry.label+'".');
  const target=entry.target;
  if(kind==='set'){
   if(typeof change.property!=='string'||!Object.hasOwn(change,'value'))throw new Error('Update requires property and value.');
   return {op:'set',target,property:change.property,value:change.value};
  }
  if(kind==='remove-field')return {op:'remove-field',target,fieldId:target.childId};
  if(kind==='remove-element')return {op:'remove-element',target};
  if(kind==='add-field'){
   if(!change.field||typeof change.field!=='object')throw new Error('Add field requires a field definition.');
   return {op:'add-field',target,field:change.field,afterFieldId:change.afterFieldId};
  }
  if(kind==='move-field'){
   if(typeof change.afterFieldId!=='string')throw new Error('Move field requires an existing anchor field ID or the special value "__start__".');
   return {op:'move-field',target,afterFieldId:change.afterFieldId};
  }
  throw new Error('Unsupported operation '+String(kind));
 });
}
export function compactRegistry(registry,selection){
 return registry.filter(e=>e.target.screenId===selection.screenId).map(({id,label,type,parentId,capabilities,exactSelection})=>({id,label,type,parentId,capabilities,exactSelection}));
}
