// Deterministic normalization/diagnostics for AI-generated demo definitions.
// Do not invent screens, component kinds, interactions, routes or field identities.
import {validComposed} from '../src/composed.mjs';

export const MAX_GENERATED_SCREENS=12;
export const MAX_GENERATED_ELEMENTS=48;
const kinds=new Set(['hero','stats','form','table','notice','actions','composed']);
const fields=new Set(['text','email','password','number','select','date','checkbox','file']);
function text(v,max=180){return typeof v==='string'&&v.trim().length>0&&v.length<=max;}
function object(v){return v!==null&&typeof v==='object'&&!Array.isArray(v);}
// Compile harmless model representation drift into existing, fully supported
// components. Never fabricate a navigation target, screen, consent or decision.
const fieldAliases={tel:'text',phone:'text',mobile:'text',textarea:'text',string:'text',integer:'number',decimal:'number',dropdown:'select',combobox:'select',upload:'file',fileUpload:'file',boolean:'checkbox'};
const safeScalar=v=>typeof v==='string'?v:typeof v==='number'&&Number.isFinite(v)||typeof v==='boolean'?String(v):undefined;
function normalizeForm(e){
 if(typeof e.title!=='string'&&typeof e.label==='string')e.title=e.label;
 if(e.actionLabel===undefined&&typeof e.buttonLabel==='string')e.actionLabel=e.buttonLabel;
 if(Array.isArray(e.fields))for(const f of e.fields){
  if(!object(f))continue;
  if(fieldAliases[f.type])f.type=fieldAliases[f.type];
  if(f.type==='select'&&Array.isArray(f.options))f.options=f.options.map(o=>typeof o==='string'?o:object(o)&&typeof o.label==='string'?o.label:o);
 }
}
function normalizeComposed(e){
 if(!Array.isArray(e.items))return;
 for(const x of e.items){
  if(!object(x))continue;
  if(x.kind==='progress'&&typeof x.value==='string'&&x.value.trim()!==''&&Number.isFinite(Number(x.value)))x.value=Number(x.value);
  if(x.kind==='input'&&fieldAliases[x.inputType])x.inputType=fieldAliases[x.inputType];
  if(x.kind==='select'&&Array.isArray(x.options))x.options=x.options.map(o=>typeof o==='string'?o:object(o)&&typeof o.label==='string'?o.label:o);
  if(x.kind==='table'&&Array.isArray(x.rows))for(const row of x.rows)if(object(row))for(const [k,v] of Object.entries(row)){const scalar=safeScalar(v);if(scalar!==undefined)row[k]=scalar;}
 }
}
function normalizeCard(e){
 const label=typeof e.title==='string'?e.title:typeof e.label==='string'?e.label:typeof e.heading==='string'?e.heading:'';
 const body=typeof e.description==='string'?e.description:typeof e.body==='string'?e.body:typeof e.text==='string'?e.text:'';
 if(!label.trim())return e; // Let validation report a missing title; do not invent it.
 return {id:e.id,kind:'composed',title:label,appearance:e.appearance,
  items:[{id:'card-content',kind:'card',label,text:body}]};
}
// Canonicalize the model's ordinary UI control vocabulary into the supported
// top-level screen representation, without discarding labels or routes.
const nestedKinds=new Set(['text','card','input','checkbox','select','button','progress','badge','divider']);
const safeId=(v,fallback)=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,60}$/.test(v)?v:fallback;
function normalizeNestedItem(value,index){
 const x=structuredClone(value);
 x.id=safeId(x.id,'item-'+index);
 if(typeof x.label!=='string')x.label=typeof x.title==='string'?x.title:typeof x.text==='string'?x.text:typeof x.description==='string'?x.description:x.kind;
 if(x.kind==='button'&&x.text===undefined&&typeof x.description==='string')x.text=x.description;
 if(x.kind==='progress'&&x.value===undefined&&typeof x.progress==='number')x.value=x.progress;
 if(x.kind==='progress'&&x.value===undefined&&typeof x.percentage==='number')x.value=x.percentage;
 if(x.kind==='progress'&&x.value===undefined)x.value=0; // presentational default, not workflow decision
 if(x.kind==='input'&&!x.inputType&&x.type)x.inputType=x.type;
 normalizeComposed({items:[x]});
 return x;
}
function normalizeActions(e){
 if(typeof e.title==='string'&&!Array.isArray(e.buttons)&&Array.isArray(e.actions))e.buttons=e.actions;
 if(!Array.isArray(e.buttons))return;
 e.buttons=e.buttons.map((b,i)=>{
  if(typeof b==='string')return{id:'action-'+i,label:b};
  if(!object(b))return b;
  const x={...b};
  x.id=safeId(x.id,'action-'+i);
  if(typeof x.label!=='string'&&typeof x.text==='string')x.label=x.text;
  if(typeof x.label!=='string'&&typeof x.title==='string')x.label=x.title;
  if(typeof x.nextScreen!=='string'&&typeof x.screenId==='string')x.nextScreen=x.screenId;
  return x;
 });
}
function normalizeHero(e,screen){
 if(typeof e.title!=='string'&&typeof e.heading==='string')e.title=e.heading;
 if(typeof e.title!=='string'&&typeof e.label==='string')e.title=e.label;
 if(typeof e.description!=='string'&&typeof e.subtitle==='string')e.description=e.subtitle;
 if(typeof e.description!=='string'&&typeof e.text==='string')e.description=e.text;
 if(typeof e.description!=='string'&&typeof e.body==='string')e.description=e.body;
 if(typeof e.title!=='string'||!e.title.trim())e.title=String(screen?.title||'Welcome');
 if(typeof e.description!=='string'||!e.description.trim())e.description=String(screen?.subtitle||screen?.title||'Continue your journey');
}
function normalizeStandaloneItems(screen){
 const original=screen.elements;
 const result=[];let pending=[];
 const flush=()=>{
  if(!pending.length)return;
  const first=pending[0],raw='composed-'+String(first.id||'section');
  const used=new Set(result.map(x=>x.id).concat(original.map(x=>x?.id)));
  let id=safeId(raw,'composed-controls'),suffix=2;while(used.has(id))id=safeId(raw+'-'+suffix++,'composed-'+suffix);
  result.push({id,kind:'composed',title:'Screen controls',items:pending});
  pending=[];
 };
 for(let i=0;i<original.length;i++){
  const e=original[i];
  if(object(e)&&nestedKinds.has(e.kind)){
   // Preserve original IDs and interaction destinations; group only adjacent
   // supported controls so their relative order remains intact.
   pending.push(normalizeNestedItem(e,i));continue;
  }
  flush();result.push(e);
 }
 flush();screen.elements=result;
}
export function normalizeGeneratedDemo(input){
 if(!object(input))return input;
 const d=structuredClone(input);
 if(!Array.isArray(d.screens))return d;
 // Missing presentational descriptions and scalar values are harmless JSON drift.
 if(d.description===undefined||d.description==='')d.description='Interactive demo of '+String(d.name||'application').slice(0,100);
 for(const s of d.screens){
  if(!object(s))continue;
  if(s.subtitle===undefined||s.subtitle==='')s.subtitle='Explore '+String(s.title||'this screen').slice(0,100);
  if(!Array.isArray(s.elements))continue;
  normalizeStandaloneItems(s);
  for(let index=0;index<s.elements.length;index++){
   let e=s.elements[index];
   if(!object(e))continue;
   if(e.kind==='card'){s.elements[index]=normalizeCard(e);e=s.elements[index];}
   if(e.kind==='hero')normalizeHero(e,s);
   if(e.kind==='actions')normalizeActions(e);
   if(e.kind==='form')normalizeForm(e);
   if(e.kind==='composed')normalizeComposed(e);
   if(e.kind==='table'&&Array.isArray(e.rows)){
    for(const row of e.rows){
     if(!object(row))continue;
     for(const [key,value] of Object.entries(row)){
      if(typeof value==='number'&&Number.isFinite(value)||typeof value==='boolean')row[key]=String(value);
     }
    }
   }
   if(e.kind==='stats'&&Array.isArray(e.items)){
    for(const item of e.items){
     if(!object(item))continue;
     if(typeof item.value==='number'&&Number.isFinite(item.value))item.value=String(item.value);
     if(typeof item.delta==='number'&&Number.isFinite(item.delta))item.delta=String(item.delta);
    }
   }
  }
 }
 return d;
}
export function explainGeneratedDemo(d,channel){
 const errors=[];
 const bad=(path,reason)=>{if(errors.length<120)errors.push(path+': '+reason);};
 if(!object(d))return ['root: expected a JSON object'];
 if(d.schemaVersion!==1)bad('schemaVersion','must be 1');
 for(const key of ['id','name'])if(!text(d[key]))bad(key,'must be a nonempty string');
 if(typeof d.description!=='string'||d.description.length>500)bad('description','must be a string of at most 500 characters');
 if(d.channel!==channel)bad('channel','does not match project');
 if(!['navy','teal'].includes(d.theme))bad('theme','must be navy or teal');
 if(!Array.isArray(d.screens)||d.screens.length<2||d.screens.length>MAX_GENERATED_SCREENS)return [...errors,'screens: require 2–'+MAX_GENERATED_SCREENS+' screens'];
 const screenIds=new Set(),allLinks=[],allScreenIds=d.screens.filter(object).map(s=>s.id);
 let total=0;
 d.screens.forEach((s,i)=>{
  const path='screens['+i+']';
  if(!object(s)){bad(path,'expected screen object');return;}
  if(!text(s.id))bad(path+'.id','missing/invalid');
  else if(screenIds.has(s.id))bad(path+'.id','duplicate screen ID');
  screenIds.add(s.id);
  if(!text(s.title))bad(path+'.title','missing/invalid');
  if(typeof s.subtitle!=='string'||s.subtitle.length>500)bad(path+'.subtitle','must be string <=500');
  if(!Array.isArray(s.elements)||!s.elements.length||s.elements.length>8){bad(path+'.elements','require 1–8 elements');return;}
  const elements=new Set();
  s.elements.forEach((e,j)=>{
   const p=path+'.elements['+j+']';total++;
   if(!object(e)){bad(p,'expected element object');return;}
   if(!text(e.id))bad(p+'.id','missing/invalid');
   else if(elements.has(e.id))bad(p+'.id','duplicate element ID');
   elements.add(e.id);
   if(!kinds.has(e.kind)){bad(p+'.kind','unsupported component '+String(e.kind));return;}
   switch(e.kind){
    case 'hero':if(!text(e.title)||!text(e.description,600))bad(p,'hero needs title and description');break;
    case 'notice':if(!['info','success'].includes(e.tone)||!text(e.title)||!text(e.body,600))bad(p,'invalid notice');break;
    case 'stats':
     if(!Array.isArray(e.items)||!e.items.length||e.items.length>6||e.items.some(it=>!object(it)||!text(it.id)||!text(it.label)||!text(it.value)))bad(p+'.items','require 1–6 stats with string id,label,value');
     break;
    case 'form':
     if(!text(e.title))bad(p+'.title','form title is required');
     if(!text(e.actionLabel))bad(p+'.actionLabel','form action label is required');
     if(!Array.isArray(e.fields)||!e.fields.length||e.fields.length>16)bad(p+'.fields','require 1–16 fields');
     else e.fields.forEach((f,k)=>{if(!object(f)||!text(f.id)||!text(f.label)||!fields.has(f.type)||f.options!==undefined&&(!Array.isArray(f.options)||f.options.some(o=>!text(o))))bad(p+'.fields['+k+']','invalid field id, label, type or options');});
     if(typeof e.nextScreen==='string')allLinks.push([p+'.nextScreen',e.nextScreen]);
     break;
    case 'actions':
     if(!Array.isArray(e.buttons)||!e.buttons.length||e.buttons.length>5||e.buttons.some(b=>!object(b)||!text(b.id)||!text(b.label)))bad(p,'invalid action buttons');
     else for(const b of e.buttons)if(typeof b.nextScreen==='string')allLinks.push([p+'.buttons.'+b.id+'.nextScreen',b.nextScreen]);
     break;
    case 'table':
     if(!text(e.title)||!Array.isArray(e.columns)||!e.columns.length||e.columns.length>10||e.columns.some(c=>!object(c)||!text(c.id)||!text(c.label))||!Array.isArray(e.rows)||e.rows.length>30||e.rows.some(row=>!object(row)||Object.values(row).some(v=>typeof v!=='string')))bad(p,'invalid table columns, rows or types');
     if(typeof e.detailScreen==='string')allLinks.push([p+'.detailScreen',e.detailScreen]);
     break;
    case 'composed':if(!validComposed(e,allScreenIds))bad(p,'composed items, IDs, or navigation are invalid');break;
   }
  });
 });
 if(total>MAX_GENERATED_ELEMENTS)bad('screens','more than '+MAX_GENERATED_ELEMENTS+' total elements');
 for(const [path,target] of allLinks)if(!screenIds.has(target))bad(path,'unknown destination '+target);
 return errors;
}

// Technical schema failures are not user preferences. Never turn them into repeated
// generic clarification questions after the generator and repairer have failed.
export function generationFailure(issues){
 const list=Array.isArray(issues)?issues:[String(issues||'Generation validation failed')];
 const limit=list.find(x=>/^screens: require /.test(x));
 if(limit)return{code:'SCREEN_COUNT',message:'Generation produced an unsupported number of screens. The current limit is '+MAX_GENERATED_SCREENS+'. The original requirements are preserved.',details:list.slice(0,5)};
 return{code:'INVALID_GENERATED_DEFINITION',message:'AI generated an invalid application structure and automated repair did not resolve it. No screens were saved. Please retry generation or generate a smaller first journey.',details:list.slice(0,5)};
}
/** Business-facing clarification; never expose internal schema paths to BAs. */
export function generationClarification(issues,channel){
 const first=Array.isArray(issues)?issues[0]||'':String(issues||'');
 if(/form|fields|action/i.test(first))return{
  question:'For the application review screen, should MEYON use a standard staff review form with customer details, a decision dropdown, and review comments?',
  suggestions:['Yes, use the standard review form','Use a read-only details screen with review buttons instead'],
  reason:'MEYON needs one choice to complete the form layout without inventing your workflow.'
 };
 if(/table|columns|rows/i.test(first))return{
  question:'Should the portal use a standard searchable applications table with sample records and a link to the application details screen?',
  suggestions:['Yes, use the standard applications table','Use summary cards with a View Applications button'],
  reason:'MEYON needs to choose an alternative presentation for the application list.'
 };
 if(/destination|nextScreen|detailScreen|navigation/i.test(first))return{
  question:'Which screen should the main action open after the user completes the current step?',
  suggestions:['Open the next screen in the journey','Return to the Dashboard'],
  reason:'The destination could not be confirmed from the generated flow.'
 };
 return{
  question:channel==='portal'?'Can MEYON use standard banking-portal components for any unsupported visual patterns while retaining your requested screens and workflow?':'Can MEYON use standard mobile components where the requested visual pattern is unavailable?',
  suggestions:['Yes, use the closest supported components','Keep the screens simple and prioritize clickable navigation'],
  reason:'MEYON needs your preference before choosing an alternative.'
 };
}
