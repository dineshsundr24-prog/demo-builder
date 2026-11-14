// Typed recovery pipeline. Business clarification is not a substitute for fixing invalid AI JSON.
import {validComposed} from '../src/composed.mjs';

const slug=value=>String(value||'').toLowerCase().replace(/[^a-z0-9_-]+/g,'-').replace(/^-|-$/g,'').slice(0,48);
export function normalizeComponent(candidate){
 if(!candidate||typeof candidate!=='object'||Array.isArray(candidate))return null;
 const original=candidate.component&&typeof candidate.component==='object'?candidate.component:candidate;
 const result=structuredClone(original);
 result.kind='composed';
 if(!result.id&&typeof result.title==='string')result.id=slug(result.title);
 if(!Array.isArray(result.items))return result;
 for(const [i,item] of result.items.entries()){
  if(!item||typeof item!=='object'||Array.isArray(item))continue;
  if(!item.id)item.id=slug(item.label||item.title||item.kind||'item')||'item-'+i;
  if(typeof item.label!=='string'&&typeof item.title==='string')item.label=item.title;
  if(typeof item.label!=='string'&&typeof item.text==='string')item.label=item.text.slice(0,100);
 }
 return result;
}
// Diagnostic paths identify invalid structure without logging customer-facing text or row values.
export function componentValidationIssues(candidate,screenIds=[]){
 const x=normalizeComponent(candidate),issues=[];
 const add=(path,problem)=>{if(issues.length<12)issues.push(path+': '+problem);};
 const id=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,60}$/.test(v);
 if(!x)return['component: missing object'];
 if(!id(x.id))add('component.id','invalid ID');
 if(typeof x.title!=='string'||!x.title.trim())add('component.title','missing title');
 if(!Array.isArray(x.items)||!x.items.length||x.items.length>24)return[...issues,'component.items: expected 1–24 items'];
 const kinds=new Set(['text','card','input','checkbox','select','button','progress','table','badge','divider']);
 const ids=new Set(x.items.map(z=>z?.id));
 const seen=new Set();
 x.items.forEach((item,i)=>{
  const p='items['+i+']';
  if(!item||typeof item!=='object'){add(p,'missing item');return;}
  if(!id(item.id)||seen.has(item.id))add(p+'.id','missing, duplicate or invalid ID');
  seen.add(item.id);
  if(!kinds.has(item.kind))add(p+'.kind','unsupported kind');
  if(typeof item.label!=='string')add(p+'.label','missing label');
  if(item.kind==='select'&&(!Array.isArray(item.options)||!item.options.length||item.options.some(v=>typeof v!=='string')))add(p+'.options','expected nonempty string options');
  if(item.kind==='progress'&&(!Number.isFinite(item.value)||item.value<0||item.value>100))add(p+'.value','expected percentage 0–100');
  if(item.kind==='table'){
   if(!Array.isArray(item.columns)||!item.columns.length)add(p+'.columns','missing table columns');
   if(!Array.isArray(item.rows))add(p+'.rows','missing table rows');
   if(Array.isArray(item.rows)&&item.rows.some(r=>!r||typeof r!=='object'||Object.values(r).some(v=>typeof v!=='string')))add(p+'.rows','table cells must be strings');
   if(item.filterField&&!ids.has(item.filterField))add(p+'.filterField','unknown filter field');
   if(item.filterColumn&&Array.isArray(item.columns)&&!item.columns.some(c=>c.id===item.filterColumn))add(p+'.filterColumn','unknown table column');
  }
  if(item.visibleWhen&&!ids.has(item.visibleWhen.field))add(p+'.visibleWhen','unknown visibility field');
  if(item.kind==='input'&&item.inputType&&!['text','email','number','date','password'].includes(item.inputType))add(p+'.inputType','unsupported input type');
  if(item.kind==='button'){
   if(item.nextScreen&&!screenIds.includes(item.nextScreen))add(p+'.nextScreen','unknown screen');
   if(item.actions!==undefined&&!Array.isArray(item.actions))add(p+'.actions','not an array');
   for(const [j,a] of (Array.isArray(item.actions)?item.actions:[]).entries()){
    const ap=p+'.actions['+j+']';
    if(!a||!['navigate','set','toggle','increment','reset','show','hide','download-csv','notice'].includes(a.type)){add(ap+'.type','unsupported action');continue;}
    if(a.type==='navigate'&&!screenIds.includes(a.screen))add(ap+'.screen','unknown screen');
    if(['set','toggle','increment','show','hide'].includes(a.type)&&!ids.has(a.target))add(ap+'.target','unknown component item');
    if(a.type==='download-csv'&&!x.items.some(z=>z.id===a.target&&z.kind==='table'))add(ap+'.target','download target must be table');
    if(a.type==='set'&&typeof a.value!=='string')add(ap+'.value','expected string');
    if(a.type==='notice'&&typeof a.message!=='string')add(ap+'.message','expected string');
   }
  }else if(item.actions||item.nextScreen)add(p+'.actions','only buttons can have actions');
 });
 if(!issues.length&&!validComposed(x,screenIds))issues.push('component: other schema constraint failed');
 return issues;
}

export function componentNeedsSynthesis(change,screenIds){
 if(change?.action!=='add-component')return false;
 const component=normalizeComponent(change.component);
 return !component||!validComposed(component,screenIds);
}
export async function completeComponents(changes,screenIds,generate){
 if(!Array.isArray(changes))throw new Error('Invalid planned changes');
 const resolved=[];
 for(const change of changes){
  if(!change||typeof change!=='object')throw new Error('Invalid change definition');
  if(change.action!=='add-component'){resolved.push(change);continue;}
  let component=normalizeComponent(change.component);
  if(!component||!validComposed(component,screenIds)){
   const output=await generate(change,component);
   component=normalizeComponent(output);
  }
  if(!component||!validComposed(component,screenIds)){
   const issues=componentValidationIssues(component,screenIds);
   const error=new Error('Component schema invalid after synthesis');
   error.validationIssues=issues;
   throw error;
  }
  resolved.push({...change,component});
 }
 return resolved;
}
export function issueCategory(issue){
 const m=String(issue||'').toLowerCase();
 if(/target|registry|screen selection|different screen|another screen/.test(m))return 'INVALID_TARGET';
 if(/component|item|field|required|action/.test(m))return 'INVALID_COMPONENT';
 if(/navigation|destination|screen id/.test(m))return 'INVALID_NAVIGATION';
 if(/schema|validation/.test(m))return 'SCHEMA_VALIDATION';
 if(/json|truncat|response|parse|model/.test(m))return 'MODEL_OUTPUT';
 if(/preserv|scope|unrelated/.test(m))return 'SCOPE_PRESERVATION';
 return 'PLAN_EXECUTION';
}
export function technicalFailure(issue,phase='plan'){
 const code=issueCategory(issue);
 const messages={
  INVALID_TARGET:'The AI edit referenced a component or screen that is not available in this selection.',
  INVALID_COMPONENT:'The AI could not create a valid interactive component definition, even after repair.',
  INVALID_NAVIGATION:'The proposed interaction referenced a screen that does not exist in this demo.',
  SCHEMA_VALIDATION:'The generated demo change did not pass component validation.',
  MODEL_OUTPUT:'The AI response could not be interpreted as a complete executable demo change.',
  SCOPE_PRESERVATION:'The proposed change would have affected unrelated screens and was blocked.',
  PLAN_EXECUTION:'The AI edit could not be safely completed.'
 };
 return{planningFailed:true,errorCode:code,phase,reason:messages[code],summary:'Your original demo remains unchanged. This is a generation or validation failure, not a business clarification.',canRetry:true};
}
export function repeatsClarification(question,history=[]){
 const normalized=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
 return history.some(x=>normalized(x.question)===normalized(question));
}
