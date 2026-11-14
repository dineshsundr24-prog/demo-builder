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
  if(!component||!validComposed(component,screenIds))throw new Error('Component schema invalid after synthesis');
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
