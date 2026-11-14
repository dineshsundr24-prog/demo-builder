import {validComposed} from '../src/composed.mjs';
import {makeExampleReportTable,validReportTools} from './reportTools.mjs';
import {verifyEditScope} from '../src/editScope.mjs';
// Constrained operation-based Demo Definition edits.
// Only existing stable screen/element/field/button IDs are used as targets.
// No executable code, CSS or arbitrary object path operations.
import {validateStrictDemo} from './refine.mjs';
import {resolveScreenChrome} from '../src/screenChrome.mjs';

const fail=(reason)=>{throw new Error(reason)};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const allowedScreen=new Set(['title','subtitle']);
const allowedElement={
 hero:new Set(['title','description','eyebrow']),
 notice:new Set(['title','body','tone']),
 form:new Set(['title','description','actionLabel','nextScreen']),
 table:new Set(['title','subtitle','detailScreen']),
 actions:new Set([]),
 stats:new Set([])
};
const allowedField=new Set(['label','placeholder','required','type','options']);
const allowedButton=new Set(['label','variant','nextScreen']);
const allowedChrome=new Set(['brandName','showBrandIcon','showBackButton']);
const fieldTypes=new Set(['text','email','password','number','select','date','checkbox']);
const normalizeLabel=(value)=>String(value||'').normalize('NFKC').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const fieldIdFromLabel=(label)=>normalizeLabel(label).replace(/\s+/g,'-').slice(0,60);
function findNamedField(screen,label,elementId){
 const name=normalizeLabel(label);
 const forms=elementId?[chosenForm(screen,elementId)]:screen.elements.filter(e=>e.kind==='form');
 const matches=forms.flatMap(form=>form.fields.filter(field=>normalizeLabel(field.label)===name||normalizeLabel(field.id)===name).map(field=>({form,field})));
 if(matches.length!==1)return null;
 return matches[0];
}
function chosenForm(screen,elementId){
 if(elementId){
  const form=screen.elements.find(e=>e.id===elementId);
  if(form?.kind!=='form')fail('Selected target is not a form. Select a form section before adding fields.');
  return form;
 }
 const forms=screen.elements.filter(e=>e.kind==='form');
 if(forms.length!==1)fail(forms.length?'Multiple forms are present. Select the specific form section before adding fields.':'No form exists on the selected screen.');
 return forms[0];
}
export function locateNode(demo,target){
 if(!target||!['screen','element','field','button','header'].includes(target.level))fail('Unsupported selection level.');
 const screen=demo.screens.find(s=>s.id===target.screenId);
 if(!screen)fail('Selected screen does not exist.');
 if(target.level==='screen')return {screen,node:screen,level:'screen'};
 if(target.level==='header')return {screen,node:screen.chrome||{},level:'header'};
 const element=screen.elements.find(e=>e.id===target.elementId);
 if(!element)fail('Selected component does not exist.');
 if(target.level==='element')return {screen,element,node:element,level:'element'};
 if(target.level==='field'){
  if(element.kind!=='form')fail('Selected component is not a form.');
  const node=element.fields.find(f=>f.id===target.childId);
  if(!node)fail('Selected form field does not exist.');
  return {screen,element,node,level:'field'};
 }
 if(element.kind!=='actions')fail('Selected component is not a button group.');
 const node=element.buttons.find(b=>b.id===target.childId);
 if(!node)fail('Selected button does not exist.');
 return {screen,element,node,level:'button'};
}
export function targetLabel(demo,target){
 const n=locateNode(demo,target);
 if(target.level==='screen')return n.screen.title+' (entire screen)';
 if(target.level==='header')return 'Header · '+n.screen.title;
 if(target.level==='field')return n.node.label+' · '+n.screen.title;
 if(target.level==='button')return n.node.label+' · '+n.screen.title;
 return (n.node.title||n.node.kind)+' · '+n.screen.title;
}
function propertySet(demo,target,property,value){
 const n=locateNode(demo,target);
 let permitted;
 if(target.level==='header')permitted=allowedChrome;
 else if(target.level==='screen')permitted=allowedScreen;
 else if(target.level==='field')permitted=allowedField;
 else if(target.level==='button')permitted=allowedButton;
 else permitted=allowedElement[n.node.kind];
 if(!permitted?.has(property))fail('Property '+property+' is not supported on the selected target.');
 const node=target.level==='header'?(n.screen.chrome||(n.screen.chrome={})):n.node;
 if(property==='showBrandIcon'||property==='showBackButton'||property==='required'){if(typeof value!=='boolean')fail(property+' must be boolean.');}
 else if(property==='options'){if(!Array.isArray(value)||value.length>20||value.some(x=>typeof x!=='string'))fail('Options must be strings.');}
 else if(property==='type'){if(!fieldTypes.has(value))fail('Invalid field type.');}
 else if(property==='tone'){if(!['info','success'].includes(value))fail('Invalid notice tone.');}
 else if(property==='variant'){if(!['primary','secondary'].includes(value))fail('Invalid button variant.');}
 else if(typeof value!=='string'||value.length>350)fail('Text property must be a string of 350 characters or fewer.');
 if((property==='nextScreen'||property==='detailScreen')&&value&&!demo.screens.some(s=>s.id===value))fail('Navigation destination does not exist.');
 if(['title','brandName','label','actionLabel'].includes(property)&&!String(value).trim())fail('Required title or label cannot be blank.');
 node[property]=value;
}
// Accept a small, explicit set of model path aliases but never arbitrary JSON paths.
// The editor's implicit screen scope can select descendants of that screen.
export function normalizeOperations(selection,operations){
 if(!Array.isArray(operations))return operations;
 return operations.map(op=>{
  if(!op||op.op!=='set'||typeof op.property!=='string')return op;
  const match=/^header\.(brandName|showBrandIcon|showBackButton)$/.exec(op.property);
  if(!match)return op;
  const supplied=op.target||selection;
  if(!supplied||!['screen','header'].includes(supplied.level)||supplied.screenId!==selection.screenId)return op;
  if(!['screen','header'].includes(selection.level))return op;
  return {...op,property:match[1],target:{level:'header',screenId:selection.screenId}};
 });
}

export function applyOperations(original,target,operations,channel){
 if(!validateStrictDemo(original,channel))fail('Original demo is invalid.');
 locateNode(original,target);
 operations=normalizeOperations(target,operations);
 if(!Array.isArray(operations)||!operations.length||operations.length>8)fail('Provide one to eight change operations.');
 const candidate=structuredClone(original);
 const before=JSON.stringify(original);
 const changed=[];
 for(const op of operations){
  if(!op||typeof op!=='object'||!['set','remove-element','add-field','remove-field','move-field','add-component','add-subsection','configure-report'].includes(op.op))fail('Unsupported change operation.');
  // Every operation is bound to the user-selected target. Screen-level selection may edit descendants
  // but element/field/button/header selection may not escape its own subtree.
  const at=op.target||target;
  if(at.screenId!==target.screenId)fail('Operation attempted to change another screen.');
  if(target.level!=='screen'){
   const same=at.level===target.level&&at.elementId===target.elementId&&at.childId===target.childId;
   const formChild=target.level==='element'&&at.level==='field'&&at.elementId===target.elementId;
   if(!same&&!formChild)fail('Operation escaped the selected component.');
  }
  if(op.op==='configure-report'){
   if(channel!=='portal'||!['screen','element'].includes(at.level))fail('Report controls require a portal screen or table selection.');
   const sc=candidate.screens.find(x=>x.id===at.screenId);
   const tables=at.level==='element'?sc.elements.filter(x=>x.id===at.elementId&&x.kind==='table'):sc.elements.filter(x=>x.kind==='table');
   if(at.level==='element'&&!tables.length)fail('Selected component is not a table; select the entire report screen.');
   let table=tables.find(x=>/report|user/i.test(x.title))||tables[0];
   if(!table){
    if(sc.elements.length>=15)fail('Report screen is full.');
    table=makeExampleReportTable(sc);
    if(sc.elements.some(x=>x.id===table.id))fail('Report table ID already exists.');
    sc.elements.push(table);
   }
   const next={...(table.tools||{}),...op.tools};
   if(!validReportTools(next,table.columns)||!Object.values(next).some(Boolean))fail('Invalid report controls.');
   table.tools=next;
   changed.push({target:at,operation:'configure-report',elementId:table.id});
  }else if(op.op==='add-subsection'){
   if(channel!=='portal'||at.level!=='screen')fail('Subsections can only be added under an existing portal screen.');
   const parent=candidate.screens.find(sc=>sc.id===at.screenId);
   if(!parent||parent.parentScreenId)fail('Nested subsections are not supported.');
   if(candidate.screens.length>=12)fail('The portal already contains the maximum 12 screens.');
   const title=String(op.title||'').trim();
   if(!title||title.length>85)fail('Give the subsection a name of 1–85 characters.');
   if(candidate.screens.some(sc=>sc.parentScreenId===parent.id&&normalizeLabel(sc.title)===normalizeLabel(title)))fail('This subsection already exists under '+parent.title+'.');
   const base=(normalizeLabel(title).replace(/\s+/g,'-').slice(0,38)||'subsection');
   let id=parent.id+'-'+base;let suffix=2;
   while(candidate.screens.some(sc=>sc.id===id)){id=parent.id+'-'+base+'-'+suffix++;if(suffix>50)fail('Unable to assign subsection ID.');}
   const subsection={id,title,subtitle:String(op.subtitle||'View '+title).slice(0,200),parentScreenId:parent.id,
    elements:[{id:id+'-intro',kind:'notice',tone:'info',title,body:'This is the '+title+' demo section. Use Ask Meyon to add its fields, tables and actions.'}]};
   const siblings=candidate.screens.filter(sc=>sc.id===parent.id||sc.parentScreenId===parent.id);
   const lastIndex=candidate.screens.findIndex(sc=>sc.id===siblings.at(-1).id);
   candidate.screens.splice(lastIndex+1,0,subsection);
   changed.push({target:at,operation:'add-subsection',screenId:id,parentScreenId:parent.id});
  }else if(op.op==='set'){
   if(typeof op.property!=='string')fail('Missing property.');
   propertySet(candidate,at,op.property,op.value);
   changed.push({target:at,operation:'set',property:op.property});
  }else if(op.op==='remove-element'){
   if(at.level!=='element'&&at.level!=='screen')fail('Remove-element requires element or screen selection.');
   const sc=candidate.screens.find(s=>s.id===at.screenId);
   const id=at.elementId||op.elementId;
   const idx=sc.elements.findIndex(e=>e.id===id);
   if(idx<0)fail('Element to remove does not exist.');
   sc.elements.splice(idx,1);
   changed.push({target:{...at,elementId:id},operation:'remove-element'});
  }else if(op.op==='move-field'){
   if(at.level!=='field')fail('Move-field requires a specific existing field.');
   const sc=candidate.screens.find(x=>x.id===at.screenId);
   const form=chosenForm(sc,at.elementId);
   const index=form.fields.findIndex(f=>f.id===at.childId);
   if(index<0)fail('Field to move does not exist.');
   const anchor=op.afterFieldId;
   if(anchor!=='__start__'&&!form.fields.some(f=>f.id===anchor))fail('Move-field anchor is not an existing field in this form.');
   if(anchor===at.childId)fail('Cannot position field after itself.');
   const [field]=form.fields.splice(index,1);
   const after=anchor==='__start__'?-1:form.fields.findIndex(f=>f.id===anchor);
   form.fields.splice(after+1,0,field);
   changed.push({target:at,operation:'move-field'});
  }else if(op.op==='remove-field'){
   if(!['screen','element','field'].includes(at.level))fail('Remove-field requires a screen, form, or field selection.');
   const sc=candidate.screens.find(x=>x.id===at.screenId);
   const form=chosenForm(sc,at.elementId||op.elementId);
   const id=at.childId||op.fieldId;
   const label=op.fieldLabel;
   if(!id&&!label)fail('Remove-field requires an existing field ID or exact field label.');
   const matches=form.fields.map((field,index)=>({field,index})).filter(x=>
     (id&&x.field.id===id)||(label&&normalizeLabel(x.field.label)===normalizeLabel(label)));
   if(matches.length!==1)fail('Field to remove was not found uniquely in the selected form.');
   if(form.fields.length<=1)fail('Cannot remove the only field from a form. Redesign the form instead.');
   const removed=matches[0].field;
   form.fields.splice(matches[0].index,1);
   changed.push({target:{level:'field',screenId:at.screenId,elementId:form.id,childId:removed.id},operation:'remove-field'});
  }else if(op.op==='add-component'){
   if(at.level!=='screen')fail('Adding a composed component requires screen selection.');
   const screen=candidate.screens.find(x=>x.id===at.screenId);
   const component=structuredClone(op.component);
   if(!component||typeof component!=='object'||Array.isArray(component))fail('AI component definition missing.');
   const safeId=String(component.id||component.title||'component').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,48);
   component.id=safeId;
   component.kind='composed';
   if(screen.elements.some(e=>e.id===component.id))fail('Component ID already exists on this screen.');
   if(screen.elements.length>=15)fail('Screen contains too many components.');
   if(!validComposed(component,candidate.screens.map(x=>x.id)))fail('AI component did not pass the clickable-demo component schema.');
   screen.elements.push(component);
   changed.push({target:at,operation:'add-component',componentId:component.id});
  }else if(op.op==='add-field'){
   if(at.level!=='element'&&at.level!=='screen')fail('Add-field requires form or screen selection.');
   const sc=candidate.screens.find(s=>s.id===at.screenId);
   const el=chosenForm(sc,at.elementId||op.elementId);
   const f=op.field;
   if(!f||typeof f!=='object'||typeof f.label!=='string'||!f.label.trim())fail('New form field must have a non-empty label.');
   if(typeof f.type!=='string'||!fieldTypes.has(f.type))fail('Unsupported form field type "'+String(f.type)+'". Allowed: '+[...fieldTypes].join(', ')+'.');
   const label=f.label.trim().slice(0,100);
   const id=f.id===undefined||f.id===null||f.id===''?fieldIdFromLabel(label):f.id;
   if(typeof id!=='string'||!/^[a-zA-Z0-9_-]{1,60}$/.test(id))fail('New field ID must contain 1–60 letters, numbers, underscores or hyphens.');
   if(el.fields.some(x=>x.id===id))fail('A field with ID "'+id+'" already exists in this form.');
   if(el.fields.some(x=>normalizeLabel(x.label)===normalizeLabel(label)))fail('A field labeled "'+label+'" already exists in this form.');
   if(el.fields.length>=20)fail('This form already contains the maximum 20 fields.');
   const field={id,label,type:f.type,required:f.required===true};
   if(f.placeholder)field.placeholder=String(f.placeholder).slice(0,160);
   if(f.type==='select'){if(!Array.isArray(f.options)||f.options.some(x=>typeof x!=='string'))fail('Select field requires options.');field.options=f.options.slice(0,20);}
   const after=el.fields.findIndex(x=>x.id===op.afterFieldId);
   el.fields.splice(after>=0?after+1:el.fields.length,0,field);
   changed.push({target:{...at,elementId:el.id,childId:field.id},operation:'add-field'});
  }
 }
 if(same(before,JSON.stringify(candidate)))fail('Proposed operations did not produce a change.');
 if(!validateStrictDemo(candidate,channel))fail('Result failed complete schema and navigation validation.');
 verifyEditScope(original,candidate,target,'screen',operations);
 const oldIndex=original.screens.findIndex(s=>s.id===target.screenId);
 // Explicitly check requested mutations against resulting data.
 for(const op of operations){
  if(op.op==='configure-report'){
   const sc=candidate.screens.find(x=>x.id===(op.target||target).screenId);
   const tables=sc.elements.filter(x=>x.kind==='table');
   if(!tables.some(table=>Object.entries(op.tools||{}).every(([k,v])=>table.tools?.[k]===v)))fail('Report toolbar outcome verification failed.');
  }else if(op.op==='add-subsection'){
   const sub=candidate.screens.find(sc=>sc.parentScreenId===(op.target||target).screenId&&normalizeLabel(sc.title)===normalizeLabel(op.title));
   if(!sub)fail('Subsection was not added under the requested menu.');
  }else if(op.op==='set'){
   const at=op.target||target;
   const n=locateNode(candidate,at);
   const v=at.level==='header'?n.screen.chrome?.[op.property]:n.node[op.property];
   if(!same(v,op.value))fail('Outcome verification failed for '+op.property);
  }else if(op.op==='remove-element'){
   const at=op.target||target;
   const sc=candidate.screens.find(s=>s.id===at.screenId);
   if(sc.elements.some(e=>e.id===(at.elementId||op.elementId)))fail('Outcome verification failed: element remains.');
  }else if(op.op==='move-field'){
   const at=op.target||target;
   const sc=candidate.screens.find(x=>x.id===at.screenId);
   const fields=chosenForm(sc,at.elementId).fields;
   const atIndex=fields.findIndex(f=>f.id===at.childId);
   if(atIndex<0)fail('Outcome verification failed: moved field missing.');
   if(op.afterFieldId==='__start__'&&atIndex!==0)fail('Outcome verification failed: field not first.');
   if(op.afterFieldId!=='__start__'&&fields[atIndex-1]?.id!==op.afterFieldId)fail('Outcome verification failed: field not after requested anchor.');
  }else if(op.op==='remove-field'){
   const at=op.target||target;const sc=candidate.screens.find(s=>s.id===at.screenId);
   const form=chosenForm(sc,at.elementId||op.elementId);
   const id=at.childId||op.fieldId;
   if(form.fields.some(f=>id?f.id===id:normalizeLabel(f.label)===normalizeLabel(op.fieldLabel)))fail('Outcome verification failed: removed field remains.');
  }else if(op.op==='add-component'){
   const at=op.target||target;const screen=candidate.screens.find(x=>x.id===at.screenId);
   const id=String(op.component.id||op.component.title||'component').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,48);
   if(!screen.elements.some(e=>e.id===id&&e.kind==='composed'))fail('Outcome verification failed: created component missing.');
  }else if(op.op==='add-field'){
   const at=op.target||target;const sc=candidate.screens.find(s=>s.id===at.screenId);
   const form=sc.elements.find(e=>e.id===(at.elementId||op.elementId));
   const expectedId=op.field.id||fieldIdFromLabel(op.field.label);
   if(!form.fields.some(f=>f.id===expectedId))fail('Outcome verification failed: field missing.');
  }
 }
 const checks=['Valid Demo Definition and navigation','All operations stayed inside selected scope','Requested property/structure changes present','Unselected screens and global chrome preserved'];
 if(operations.some(op=>op.op==='set'&&(op.target||target).level==='header')){
  const previous=resolveScreenChrome(original,original.screens[oldIndex]);
  const resulting=resolveScreenChrome(candidate,candidate.screens[oldIndex]);
  if(same(previous,resulting))fail('Rendered header state did not change.');
  for(const op of operations){
   if(op.op==='set'&&(op.target||target).level==='header'&&!same(resulting[op.property],op.value))fail('Effective rendered header did not match the requested setting.');
  }
  checks.push('Effective screen header configuration changed');
 }
 return {definition:candidate,changed,checks,preservedScreens:original.screens.length-1};
}
export function deriveFastOperations(demo,target,instruction){
 const text=String(instruction||'');
 // Header controls live in the renderer, not screen content. Resolve explicitly
 // named wallet/brand-icon requests to the header within the chosen screen.
 const brandIcon=/\b(?:wallet\s*(?:icon|symbol)?|(?:brand|bank|branding|header)\s*(?:icon|logo))\b/i.test(text);
 const remove=/\b(remove|hide|delete)\b/i.test(text);
 const restore=/\b(show|restore|display)\b/i.test(text);
 const mentionsOtherChange=/\b(?:also|and)\s+(?:add|create|rename|change|update|remove|hide|delete|move)\b/i.test(text);
 if(['screen','header'].includes(target.level)&&brandIcon&&!mentionsOtherChange&&remove!==restore){
  return [{op:'set',target:{level:'header',screenId:target.screenId},property:'showBrandIcon',value:restore}];
 }
 // Exact single-field removal: deterministic field ownership; never remove the
 // entire form for a request about one field. No model call is needed.
 const fieldRemoval=text.match(/^\s*(?:please\s+)?(?:remove|delete)\s+(?:the\s+)?(.+?)\s*(?:field|input(?:\s+box)?)?\s*[.!]?\s*$/i);
 if(fieldRemoval&&['screen','element','field'].includes(target.level)){
  const screen=demo.screens.find(s=>s.id===target.screenId);
  const phrase=fieldRemoval[1].replace(/\s+(?:field|input(?:\s+box)?)$/i,'').trim();
  if(target.level==='field'){
   const chosen=locateNode(demo,target);
   if(normalizeLabel(phrase)===normalizeLabel(chosen.node.label)||normalizeLabel(phrase)===normalizeLabel(chosen.node.id)){
    return [{op:'remove-field',target,fieldId:chosen.node.id}];
   }
   return null;
  }
  const located=findNamedField(screen,phrase,target.level==='element'?target.elementId:undefined);
  if(located)return [{op:'remove-field',target:{level:'element',screenId:target.screenId,elementId:located.form.id},fieldId:located.field.id}];
 }
 // Common banking form edits can be compiled deterministically rather than
 // asking the model to invent field IDs or unsupported input types.
 const adding=/\b(add|insert|create|include)\b/i.test(text);
 const emiratesId=/\b(?:emirates\s*id|eid)\b/i.test(text);
 const expiry=/\b(?:expiry|expiration|expiration date|expiry date)\b/i.test(text);
 if(adding&&emiratesId&&['screen','element'].includes(target.level)){
  const screen=demo.screens.find(x=>x.id===target.screenId);
  const form=screen&&target.level==='element'?screen.elements.find(x=>x.id===target.elementId):screen?.elements.filter(x=>x.kind==='form')[0];
  const forms=screen?.elements.filter(x=>x.kind==='form')||[];
  // Ambiguous form targeting must not silently select the wrong form.
  if(target.level==='element'&&form?.kind!=='form')return null;
  if(target.level==='screen'&&forms.length!==1)return null;
  const desired=[{id:'emirates-id',label:'Emirates ID',type:'text'},...(expiry?[{id:'eid-expiry',label:'EID Expiry',type:'date'}]:[])];
  const missing=desired.filter(f=>!form.fields.some(existing=>existing.id===f.id||normalizeLabel(existing.label)===normalizeLabel(f.label)));
  if(!missing.length)return null;
  return missing.map(f=>({op:'add-field',target:{level:'element',screenId:target.screenId,elementId:form.id},field:f}));
 }
 const match=text.match(/\b(?:rename|change)\b.*?\b(?:to|as)\s+['\"“]?([^'\"”.,\n]{2,80})/i);
 if(match){
  const property=target.level==='screen'?'title':target.level==='field'||target.level==='button'?'label':target.level==='header'?'brandName':null;
  if(property)return [{op:'set',target,property,value:match[1].trim()}];
 }
 return null;
}
