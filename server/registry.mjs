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
  add('screen',screen,null,screen,null,['set','add-component']);
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
// Resolve field placement using the canonical registry, not AI-invented IDs.
// Accept canonical registry ID, actual field ID, or an unambiguous label.
function resolveFieldReference(registry,moving,reference){
 if(reference==='__start__')return '__start__';
 if(typeof reference!=='string'||!reference.trim())throw new Error('Field position reference is missing.');
 const siblings=registry.filter(e=>e.target.level==='field'&&e.target.screenId===moving.target.screenId&&e.target.elementId===moving.target.elementId);
 const normalized=normalizeName(reference);
 const matches=siblings.filter(e=>e.id===reference||e.target.childId===reference||normalizeName(e.label)===normalized||normalizeName(e.target.childId)===normalized);
 if(matches.length!==1)throw new Error('Field position "'+reference+'" does not match a unique existing field in the same form.');
 return matches[0].target.childId;
}
function moveAnchor(registry,moving,change){
 const siblings=registry.filter(e=>e.target.level==='field'&&e.target.screenId===moving.target.screenId&&e.target.elementId===moving.target.elementId);
 if(change.beforeFieldId!==undefined){
  const reference=resolveFieldReference(registry,moving,change.beforeFieldId);
  if(reference==='__start__')throw new Error('Use afterFieldId="__start__" to move to the first position.');
  if(reference===moving.target.childId)throw new Error('Cannot position field relative to itself.');
  const withoutMoving=siblings.filter(e=>e.target.childId!==moving.target.childId);
  const index=withoutMoving.findIndex(e=>e.target.childId===reference);
  if(index<0)throw new Error('Before-field anchor missing.');
  return index===0?'__start__':withoutMoving[index-1].target.childId;
 }
 if(change.afterFieldId!==undefined)return resolveFieldReference(registry,moving,change.afterFieldId);
 throw new Error('Move field requires beforeFieldId or afterFieldId.');
}
// Strict fast path for a *single* reorder instruction with two existing, uniquely named fields.
// Multi-change requests continue through the AI planner.
export function resolveSimpleFieldReorder(registry,selection,instruction){
 const text=String(instruction||'').trim();
 const command=/\b(?:move|place|position|reorder)\b/i.exec(text);\n if(!command)return null;\n const moveText=text.slice(command.index);
 if(/\b(?:also|and then|add|remove|delete|rename|change|update|create)\b/i.test(text))return null;
 const direction=/\b(above|before|below|after)\b/i.exec(moveText);
 if(!direction)return null;
 const fields=registry.filter(e=>e.target.level==='field'&&e.target.screenId===selection.screenId);
 const first=moveText.slice(0,direction.index);
 const second=moveText.slice(direction.index+direction[0].length).replace(/\b(?:without changing|without modifying|without affecting|and keep|keep|please keep)\b[\s\S]*$/i,'').trim();
 const normalizePhrase=v=>normalizeName(String(v).replace(/^(?:please\s+)?(?:move|place|position|reorder)\s+(?:the\s+)?/i,'').replace(/\s+(?:field|input|control)\s*$/i,'').replace(/[.!?]+$/,''));
 const source=normalizePhrase(first),destination=normalizePhrase(second);
 const find=(phrase)=>fields.filter(e=>normalizeName(e.label)===phrase||normalizeName(e.target.childId)===phrase);
 const from=find(source),to=find(destination);
 if(from.length!==1||to.length!==1||from[0].id===to[0].id)return null;
 if(from[0].target.elementId!==to[0].target.elementId)return null;
 const chosen=chooseRegistryTarget(registry,from[0].id,selection);
 const change={action:'move-field',targetId:chosen.id};
 if(['above','before'].includes(direction[1].toLowerCase()))change.beforeFieldId=to[0].id;
 else change.afterFieldId=to[0].id;
 return resolveChangeSet(registry,selection,[change]);
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
  if(kind==='add-component'){
   if(!change.component||typeof change.component!=='object')throw new Error('AI must supply a composed component definition.');
   return {op:'add-component',target,component:change.component};
  }
  if(kind==='move-field'){
   return {op:'move-field',target,afterFieldId:moveAnchor(registry,entry,change)};
  }
  throw new Error('Unsupported operation '+String(kind));
 });
}
export function compactRegistry(registry,selection){
 return registry.filter(e=>e.target.screenId===selection.screenId).map(({id,label,type,parentId,capabilities,exactSelection,target})=>({id,label,type,parentId,capabilities,exactSelection,...(type==='field'?{fieldId:target.childId}: {})}));
}
