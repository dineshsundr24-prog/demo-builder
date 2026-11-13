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
 else if(property==='type'){if(!['text','email','password','number','select'].includes(value))fail('Invalid field type.');}
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
  if(!op||typeof op!=='object'||!['set','remove-element','add-field'].includes(op.op))fail('Unsupported change operation.');
  // Every operation is bound to the user-selected target. Screen-level selection may edit descendants
  // but element/field/button/header selection may not escape its own subtree.
  const at=op.target||target;
  if(at.screenId!==target.screenId)fail('Operation attempted to change another screen.');
  if(target.level!=='screen' && (at.level!==target.level||at.elementId!==target.elementId||at.childId!==target.childId))fail('Operation escaped the selected component.');
  if(op.op==='set'){
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
  }else if(op.op==='add-field'){
   if(at.level!=='element'&&at.level!=='screen')fail('Add-field requires form or screen selection.');
   const sc=candidate.screens.find(s=>s.id===at.screenId);
   const el=sc.elements.find(e=>e.id===(at.elementId||op.elementId));
   if(el?.kind!=='form')fail('Field insertion requires an existing form.');
   const f=op.field;
   if(!f||typeof f.id!=='string'||!/^[a-zA-Z0-9_-]{1,60}$/.test(f.id)||!f.label||!['text','email','password','number','select'].includes(f.type)||el.fields.some(x=>x.id===f.id)||el.fields.length>=20)fail('Invalid or duplicate new field.');
   const field={id:f.id,label:String(f.label).slice(0,100),type:f.type,required:f.required===true};
   if(f.placeholder)field.placeholder=String(f.placeholder).slice(0,160);
   if(f.type==='select'){if(!Array.isArray(f.options)||f.options.some(x=>typeof x!=='string'))fail('Select field requires options.');field.options=f.options.slice(0,20);}
   const after=el.fields.findIndex(x=>x.id===op.afterFieldId);
   el.fields.splice(after>=0?after+1:el.fields.length,0,field);
   changed.push({target:{...at,elementId:el.id,childId:field.id},operation:'add-field'});
  }
 }
 if(same(before,JSON.stringify(candidate)))fail('Proposed operations did not produce a change.');
 if(!validateStrictDemo(candidate,channel))fail('Result failed complete schema and navigation validation.');
 const oldIndex=original.screens.findIndex(s=>s.id===target.screenId);
 for(let i=0;i<original.screens.length;i++)if(i!==oldIndex&&!same(candidate.screens[i],original.screens[i]))fail('Preservation failure: unrelated screen changed.');
 if(!same(candidate.chrome,original.chrome))fail('Preservation failure: application-wide header changed.');
 // Explicitly check requested mutations against resulting data.
 for(const op of operations){
  if(op.op==='set'){
   const at=op.target||target;
   const n=locateNode(candidate,at);
   const v=at.level==='header'?n.screen.chrome?.[op.property]:n.node[op.property];
   if(!same(v,op.value))fail('Outcome verification failed for '+op.property);
  }else if(op.op==='remove-element'){
   const at=op.target||target;
   const sc=candidate.screens.find(s=>s.id===at.screenId);
   if(sc.elements.some(e=>e.id===(at.elementId||op.elementId)))fail('Outcome verification failed: element remains.');
  }else if(op.op==='add-field'){
   const at=op.target||target;const sc=candidate.screens.find(s=>s.id===at.screenId);
   const form=sc.elements.find(e=>e.id===(at.elementId||op.elementId));
   if(!form.fields.some(f=>f.id===op.field.id))fail('Outcome verification failed: field missing.');
  }
 }
 const checks=['Valid Demo Definition and navigation','All operations stayed inside selected scope','Requested property/structure changes present','Unselected screens and global chrome preserved'];
 if(target.level==='header'){
  const a=resolveScreenChrome(original,original.screens[oldIndex]);
  const b=resolveScreenChrome(candidate,candidate.screens[oldIndex]);
  if(same(a,b))fail('Rendered header state did not change.');
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
 const match=text.match(/\b(?:rename|change)\b.*?\b(?:to|as)\s+['\"“]?([^'\"”.,\n]{2,80})/i);
 if(match){
  const property=target.level==='screen'?'title':target.level==='field'||target.level==='button'?'label':target.level==='header'?'brandName':null;
  if(property)return [{op:'set',target,property,value:match[1].trim()}];
 }
 return null;
}
