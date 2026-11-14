// Semantic-to-runtime compiler. AI describes WHAT a demo needs; this compiler owns
// component IDs, runtime actions, data types and validation-safe UI structure.
import {validComposed} from '../src/composed.mjs';

const clean=v=>String(v||'').trim().replace(/\s+/g,' ').slice(0,110);
const slug=v=>clean(v).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,42)||'field';
const titleCase=v=>clean(v).replace(/\b\w/g,c=>c.toUpperCase());
const meaningful=v=>/^[a-z0-9][a-z0-9\s/_-]{1,90}$/i.test(v)&&!/^(the|a|and|or|system|this)$/i.test(v.trim());

export function extractRequestedFields(instruction){
 const s=String(instruction||'');
 const match=/\b(?:showing|displaying|including|containing|with)\s+([^.!?\n]{5,240})/i.exec(s);
 if(!match)return[];
 const parts=match[1].replace(/\b(?:from|using|via|through)\s+(?:our|the|an?|existing|current|a\s+live)\b.*$/i,'')
  .replace(/\b(?:build|create|make)\s+this\b.*$/i,'')
  .split(/,|\s+and\s+|\s*&\s*/i).map(clean).map(v=>v.replace(/^(?:and|the|a|an)\s+/i,'').trim()).filter(meaningful);
 return [...new Set(parts.map(v=>v.toLowerCase()))].slice(0,7).map(titleCase);
}
export function semanticSpecFromRequirement(instruction){
 const text=String(instruction||'');
 const type=/\b(counter|increment|decrement)\b/i.test(text)?'counter':
  /\b(form|registration|onboard|survey|questionnaire)\b/i.test(text)?'form':
  /\b(dashboard|history|activity|report|list|table|monitor|tracker|overview)\b/i.test(text)?'table':'form';
 const direct=/\b(?:create|build|add|design|generate|make)\s+(?:a|an|the)?\s*([^.!?]{5,95}?)(?:\s+(?:showing|with|including|displaying)|\.|$)/i.exec(text);
 return {title:clean(direct?.[1]||'Interactive Demo Section'),type,fields:extractRequestedFields(text),search:type==='table',download:type==='table',filter:false,showSummary:type==='table'};
}
function safeFields(candidate,instruction){
 const proposed=Array.isArray(candidate?.fields)?candidate.fields:[];
 const fields=proposed.map(f=>typeof f==='string'?f:f&&typeof f==='object'?f.label||f.name||f.title:'').map(clean).filter(meaningful).slice(0,8);
 // Explicitly listed user requirements cannot be silently dropped by a model summary.
 for(const label of extractRequestedFields(instruction))if(!fields.some(f=>slug(f)===slug(label)))fields.push(label);
 return [...new Map(fields.map(f=>[slug(f),titleCase(f)])).values()].slice(0,9);
}
function valueFor(label,row){
 const key=String(label).toLowerCase();
 if(/failed|attempt|reject|decline|error|count|number of/.test(key))return String([0,2,1,3,0][row%5]);
 if(/status|state/.test(key))return ['Active','Active','Locked','Active','Inactive'][row%5];
 if(/user|customer|account|employee|person/.test(key))return 'USR-'+String(1001+row);
 if(/login|activity|date|time|history|access|session/.test(key)){
  const d=new Date(Date.UTC(2026,10,14,10,20,0)-row*31*60*60*1000);
  return d.toISOString().slice(0,16).replace('T',' ');
 }
 if(/ip address/.test(key))return '192.0.2.'+(10+row);
 if(/type|method/.test(key))return ['Password','UAE PASS','Password','SSO','UAE PASS'][row%5];
 return ['Sample A','Sample B','Sample C','Sample D','Sample E'][row%5];
}
function normalizeSemanticSpec(candidate,instruction){
 const fallback=semanticSpecFromRequirement(instruction);
 const value=candidate&&typeof candidate==='object'&&!Array.isArray(candidate)?candidate.spec||candidate.componentSpec||candidate:candidate;
 const type=['table','counter','form'].includes(value?.type)?value.type:fallback.type;
 const title=clean(value?.title||fallback.title)||fallback.title;
 const fields=safeFields(value,instruction);
 return {title,type,fields:fields.length?fields:fallback.fields.length?fallback.fields:['User ID','Status','Last Activity'],
  search:value?.search!==false,download:value?.download!==false,filter:!!value?.filter,showSummary:value?.showSummary!==false};
}
export function compileSemanticComponent(candidate,instruction,screenIds=[],sourceMode='demo'){
 const spec=normalizeSemanticSpec(candidate,instruction);
 const items=[],id='generated-'+slug(spec.title).slice(0,35);
 if(sourceMode==='placeholder'){
  items.push({id:'integration-notice',kind:'card',label:'Integration not connected',text:'This preview uses fictional records. A live banking-system integration has not been configured.'});
 }else{
  items.push({id:'sample-data-note',kind:'text',label:'Fictional sample data only',text:'Illustrative records and simulated interactions — no live banking connection.'});
 }
 if(spec.type==='counter'){
  items.push({id:'counter-value',kind:'input',label:spec.fields[0]||'Count',inputType:'number'});
  items.push({id:'counter-increase',kind:'button',label:'Increase',actions:[{type:'increment',target:'counter-value',amount:1}]});
  items.push({id:'counter-reset',kind:'button',label:'Reset',actions:[{type:'set',target:'counter-value',value:'0'},{type:'notice',message:'Counter reset for this demo'}]});
 }else if(spec.type==='form'){
  const names=spec.fields.slice(0,10);
  for(let i=0;i<names.length;i++){
   const name=names[i];items.push({id:'input-'+i,kind:'input',label:name,inputType:/date|expiry/i.test(name)?'date':/email/i.test(name)?'email':'text'});
  }
  items.push({id:'submit-action',kind:'button',label:'Submit Demo',actions:[{type:'notice',message:'Demo submission recorded locally (not sent to a bank).'}]});
 }else{
  const fieldNames=spec.fields.slice(0,9);
  if(!fieldNames.some(f=>/user|customer|employee|account|name|id/i.test(f)))fieldNames.unshift('User ID');
  const columns=fieldNames.slice(0,10).map((f,i)=>({id:'col'+i,label:f}));
  const rows=Array.from({length:5},(_,i)=>Object.fromEntries(columns.map(c=>[c.id,valueFor(c.label,i)])));
  if(spec.showSummary)items.push({id:'summary',kind:'badge',label:'5 sample records'});
  if(spec.search)items.push({id:'search',kind:'input',label:'Search records',inputType:'text'});
  const table={id:'data-table',kind:'table',label:spec.title,columns,rows};
  if(spec.search)table.filterField='search';
  items.push(table);
  if(spec.download)items.push({id:'download',kind:'button',label:'Download CSV',actions:[{type:'download-csv',target:'data-table'}]});
 }
 const component={id,title:spec.title,kind:'composed',items};
 if(!validComposed(component,screenIds))throw Error('Semantic compiler produced invalid component');
 return component;
}
export const semanticSpecSchema={
 type:'object',additionalProperties:false,properties:{
  title:{type:'string'},type:{type:'string',enum:['table','counter','form']},
  fields:{type:'array',items:{type:'string'}},
  search:{type:'boolean'},download:{type:'boolean'},filter:{type:'boolean'},showSummary:{type:'boolean'}
 },required:['title','type','fields','search','download','filter','showSummary']
};
