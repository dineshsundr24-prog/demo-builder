// Deterministic normalization/diagnostics for AI-generated demo definitions.
// Do not invent screens, component kinds, interactions, routes or field identities.
import {validComposed} from '../src/composed.mjs';

const kinds=new Set(['hero','stats','form','table','notice','actions','composed']);
const fields=new Set(['text','email','password','number','select','date','checkbox']);
function text(v,max=180){return typeof v==='string'&&v.trim().length>0&&v.length<=max;}
function object(v){return v!==null&&typeof v==='object'&&!Array.isArray(v);}
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
  for(const e of s.elements){
   if(!object(e))continue;
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
 const bad=(path,reason)=>{if(errors.length<12)errors.push(path+': '+reason);};
 if(!object(d))return ['root: expected a JSON object'];
 if(d.schemaVersion!==1)bad('schemaVersion','must be 1');
 for(const key of ['id','name'])if(!text(d[key]))bad(key,'must be a nonempty string');
 if(typeof d.description!=='string'||d.description.length>500)bad('description','must be a string of at most 500 characters');
 if(d.channel!==channel)bad('channel','does not match project');
 if(!['navy','teal'].includes(d.theme))bad('theme','must be navy or teal');
 if(!Array.isArray(d.screens)||d.screens.length<2||d.screens.length>9)return [...errors,'screens: require 2–9 screens'];
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
     if(!text(e.title)||!text(e.actionLabel)||!Array.isArray(e.fields)||!e.fields.length||e.fields.length>16||e.fields.some(f=>!object(f)||!text(f.id)||!text(f.label)||!fields.has(f.type)||f.options!==undefined&&(!Array.isArray(f.options)||f.options.some(o=>!text(o)))))bad(p,'invalid form title, action or fields');
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
 if(total>45)bad('screens','more than 45 total elements');
 for(const [path,target] of allLinks)if(!screenIds.has(target))bad(path,'unknown destination '+target);
 return errors;
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
