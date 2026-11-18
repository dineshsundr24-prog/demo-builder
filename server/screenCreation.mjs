// Generalized screen-creation contract shared by mobile and portal demos.
// AI supplies a small semantic blueprint. This deterministic compiler controls
// application IDs, navigation, layout and preservation of existing screens.
import {validateStrictDemo} from './refine.mjs';
import {verifyEditScope} from '../src/editScope.mjs';
const norm=v=>String(v||'').normalize('NFKC').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const slug=v=>norm(v).replace(/\s+/g,'-').slice(0,42)||'new-screen';
const validFieldTypes=new Set(['text','email','password','number','select','date','checkbox','file']);
const clean=(v,max=100)=>String(v||'').trim().replace(/\s+/g,' ').slice(0,max);
const titleCase=v=>clean(v).replace(/\b\w/g,c=>c.toUpperCase());
export const screenBlueprintSchema={
 type:'object',additionalProperties:false,required:['title','subtitle','kind','description','fields','actionLabel','columns'],
 properties:{
  title:{type:'string'},subtitle:{type:'string'},
  kind:{type:'string',enum:['form','table','information','confirmation']},
  description:{type:'string'},actionLabel:{type:'string'},
  fields:{type:'array',items:{type:'object',additionalProperties:false,required:['label','type','required','options'],properties:{
   label:{type:'string'},type:{type:'string',enum:['text','email','password','number','select','date','checkbox','file']},
   required:{type:'boolean'},options:{type:'array',items:{type:'string'}}
  }}},
  columns:{type:'array',items:{type:'string'}}
 }
};
export function screenCreationIntent(instruction){
 const text=String(instruction||'').trim();
 return /\b(?:add|create|build|design|generate|insert|include)\b[\s\S]{0,110}\b(?:new\s+)?(?:screen|page|onboarding\s+step|journey\s+step)\b/i.test(text)
  ||/\b(?:add|create|build|design|generate|insert|include)\s+(?:a\s+|an\s+|the\s+)?(?:new\s+)?[\w -]{2,70}\s+(?:screen|page)\b/i.test(text);
}
export function requestedScreenTitle(instruction){
 const text=String(instruction||'');
 const patterns=[
  /\b(?:screen|page|step)\s+(?:called|named|titled)\s+["“']?(.+?)(?=["”']|[.,;]|\s+(?:after|before|with|containing|including|showing|that|where)\b|$)/i,
  /\b(?:add|create|build|design|generate|insert|include)\s+(?:a\s+|an\s+|the\s+)?(?:new\s+)?(.+?)\s+(?:screen|page)\b/i
 ];
 for(const re of patterns){
  const match=re.exec(text);
  if(match){const label=clean(match[1].replace(/^(?:new|mobile|web|portal)\s+/i,''),85);
   if(label.length>=2&&label.length<=85)return titleCase(label);
  }
 }
 return null;
}
function requestedAnchor(demo,selectedScreenId,instruction){
 const explicit=/\b(?:after|following)\s+(?:the\s+)?(.+?)(?:\s+(?:screen|page|step))?(?=[,.]|\s+(?:with|containing|including|showing|and\s+include)\b|$)/i.exec(instruction);
 if(!explicit)return {status:'resolved',screenId:selectedScreenId};
 const phrase=norm(explicit[1].replace(/\s+(?:screen|page|step)$/i,''));
 const matches=demo.screens.filter(s=>norm(s.title)===phrase||norm(s.id)===phrase);
 if(matches.length!==1)return{status:'clarify',question:'Which existing screen should the new screen follow?',options:demo.screens.map(s=>s.title).slice(0,6)};
 return{status:'resolved',screenId:matches[0].id};
}
function fieldsFromBlueprint(blueprint,requestedTitle){
 const input=Array.isArray(blueprint?.fields)?blueprint.fields:[];
 const names=new Set(),fields=[];
 for(const field of input){
  if(fields.length>=12)break;
  const label=clean(field?.label,90),key=norm(label),type=validFieldTypes.has(field?.type)?field.type:'text';
  if(!label||!key||names.has(key))continue;
  names.add(key);
  const idBase=slug(label);let id=idBase,n=2;
  while(fields.some(f=>f.id===id))id=idBase+'-'+n++;
  fields.push({id,label,type,required:field.required===true,...(type==='select'?{options:(Array.isArray(field.options)?field.options:[]).filter(x=>typeof x==='string'&&x.trim()).slice(0,15)}:{})});
  if(type==='select'&&!fields.at(-1).options.length)fields.at(-1).options=['Option 1','Option 2'];
 }
 return fields.length?fields:[{id:'reference',label:requestedTitle+' Reference',type:'text',required:true}];
}
function sampleRowValue(label,index){
 const s=norm(label);
 if(/status/.test(s))return['Pending','Approved','In review'][index%3];
 if(/date|time/.test(s))return['2026-11-18','2026-11-17','2026-11-16'][index%3];
 if(/name|customer|applicant/.test(s))return['Sample Customer A','Sample Customer B','Sample Customer C'][index%3];
 if(/amount|balance/.test(s))return ['10000','25000','5000'][index%3];
 if(/number|reference|id/.test(s))return 'DEMO-'+String(1001+index);
 return ['Sample A','Sample B','Sample C'][index%3];
}
export function compileNewScreen(demo,selection,instruction,blueprint){
 if(!validateStrictDemo(demo,demo.channel))throw Error('Existing demo definition is invalid.');
 if(demo.screens.length>=12)throw Error('Maximum 12 screens reached. Remove an unused screen before adding another.');
 if(!screenCreationIntent(instruction))throw Error('Instruction does not request a new screen.');
 const userTitle=requestedScreenTitle(instruction);
 const title=clean(userTitle||blueprint?.title,85);
 if(!title||title.length<2)throw Error('New screen needs a recognizable name.');
 if(demo.screens.some(s=>norm(s.title)===norm(title)))throw Error('A screen named '+title+' already exists; select it to refine instead.');
 const anchor=requestedAnchor(demo,selection.screenId,instruction);
 if(anchor.status!=='resolved')return anchor;
 if(anchor.screenId!==selection.screenId)return{status:'clarify',question:'Select the '+demo.screens.find(s=>s.id===anchor.screenId)?.title+' screen before inserting a new screen after it.',options:[]};
 const screenIdBase='screen-'+slug(title);let screenId=screenIdBase,n=2;
 while(demo.screens.some(s=>s.id===screenId))screenId=screenIdBase+'-'+n++;
 const kind=['form','table','information','confirmation'].includes(blueprint?.kind)?blueprint.kind:'form';
 const subtitle=clean(blueprint?.subtitle,180)||'Continue your application journey';
 const description=clean(blueprint?.description,500)||'Complete this step using fictional demonstration data.';
 const actionLabel=clean(blueprint?.actionLabel,65)||'Continue';
 const source=demo.screens.find(s=>s.id===selection.screenId);
 const next=structuredClone(demo);
 const current=next.screens.find(s=>s.id===source.id);
 // Preserve the selected screen's existing successor by inserting the new step in the chain.
 let oldDestination=null,linked=false;
 for(const element of current.elements){
  if(element.kind==='form'&&element.nextScreen){oldDestination=element.nextScreen;element.nextScreen=screenId;linked=true;break;}
  if(element.kind==='actions'){
   const button=element.buttons.find(b=>b.nextScreen);
   if(button){oldDestination=button.nextScreen;button.nextScreen=screenId;linked=true;break;}
  }
 }
 const elements=[];
 if(kind==='form'){
  elements.push({id:screenId+'-form',kind:'form',title,description,fields:fieldsFromBlueprint(blueprint,title),actionLabel,...(oldDestination?{nextScreen:oldDestination}:{})});
 }else if(kind==='table'){
  const names=[...new Set((Array.isArray(blueprint?.columns)?blueprint.columns:[]).map(x=>clean(x,65)).filter(Boolean))].slice(0,8);
  if(!names.length)names.push('Reference','Status','Date');
  const columns=names.map((label,i)=>({id:'column-'+i,label}));
  const rows=Array.from({length:3},(_,i)=>Object.fromEntries(columns.map(col=>[col.id,sampleRowValue(col.label,i)])));
  elements.push({id:screenId+'-records',kind:'table',title,subtitle:description,columns,rows,tools:{search:true}});
 }else{
  elements.push({id:screenId+'-message',kind:'notice',tone:kind==='confirmation'?'success':'info',title,body:description});
 }
 if(kind!=='form'||!oldDestination){
  const destination=oldDestination||null;
  if(destination)elements.push({id:screenId+'-next',kind:'actions',buttons:[{id:'continue',label:actionLabel,nextScreen:destination}]});
 }
 // If the anchor has no existing outbound transition, introduce one visible navigation control.
 if(!linked){
  if(current.elements.length>=15)throw Error('Selected screen is full; choose a screen with room for a navigation control.');
  current.elements.push({id:screenId+'-entry',kind:'actions',buttons:[{id:'open',label:'Continue to '+title,nextScreen:screenId}]});
 }
 const screen={id:screenId,title,subtitle,elements};
 const anchorIndex=next.screens.findIndex(s=>s.id===selection.screenId);
 next.screens.splice(anchorIndex+1,0,screen);
 const operations=[{op:'add-screen',screenId,title,anchorScreenId:selection.screenId,previousDestination:oldDestination}];
 if(!validateStrictDemo(next,demo.channel))throw Error('Generated screen or connected navigation failed application validation.');
 verifyEditScope(demo,next,{level:'screen',screenId:selection.screenId},'screen',operations);
 for(const previous of demo.screens.filter(s=>s.id!==selection.screenId)){
  if(JSON.stringify(next.screens.find(s=>s.id===previous.id))!==JSON.stringify(previous))throw Error('Unrelated existing screen changed.');
 }
 if(linked&&!current.elements.some(e=>e.kind==='form'&&e.nextScreen===screenId||e.kind==='actions'&&e.buttons.some(b=>b.nextScreen===screenId)))throw Error('New screen is not reachable from the selected screen.');
 if(!linked&&!current.elements.some(e=>e.kind==='actions'&&e.buttons.some(b=>b.nextScreen===screenId)))throw Error('New screen is not reachable.');
 return{status:'resolved',definition:next,operations,createdScreenId:screenId,anchorScreenId:selection.screenId,
  checks:['New screen passes application schema','Existing journey can open new screen','Unrelated screens unchanged','Existing onward navigation preserved when present']};
}
export async function requestScreenBlueprint({instruction,project,model,apiKey,fetchImpl=fetch}){
 const fallbackTitle=requestedScreenTitle(instruction)||'New Step';
 const fallback={title:fallbackTitle,subtitle:'Continue your application journey',kind:'form',
  description:'Enter details for '+fallbackTitle+'. Fictional data only.',fields:[],columns:[],actionLabel:'Continue'};
 if(!apiKey)return fallback;
 const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),45000);
 try{
  const response=await fetchImpl('https://api.openai.com/v1/responses',{method:'POST',signal:controller.signal,headers:{'Authorization':'Bearer '+apiKey,'Content-Type':'application/json'},
   body:JSON.stringify({model,store:false,instructions:'Return a SEMANTIC description of exactly ONE additional mobile or portal application screen. Do not return application JSON or code. Choose kind form for data entry, table for data lists, information for informational content, confirmation for completion. Only use field types text,email,password,number,select,date,checkbox,file. File inputs only simulate a local file selection, never a real upload to a backend or banking system. Preserve explicitly requested document and field labels. Preserve explicitly requested field labels. Keep output short and directly responsive.',input:JSON.stringify({request:instruction,project:{name:project.name,company:project.company,channel:project.channel,guidelines:project.guidelines}}),text:{format:{type:'json_schema',name:'new_demo_screen',strict:true,schema:screenBlueprintSchema}},max_output_tokens:1300})});
  if(!response.ok)throw Error('Model service status '+response.status);
  const raw=await response.json();
  if(raw?.status!=='completed'||raw?.incomplete_details)throw Error('Incomplete screen plan');
  const output=(raw.output||[]).filter(x=>x.type==='message').flatMap(x=>x.content||[]).filter(x=>x.type==='output_text').map(x=>x.text).join('');
  const plan=JSON.parse(output);
  if(!plan||!['form','table','information','confirmation'].includes(plan.kind))throw Error('Unsupported screen blueprint');
  return plan;
 }catch(err){
  if(err?.name==='AbortError')throw new Error('Screen generation timed out; no changes applied.');
  throw new Error('Unable to generate the requested screen specification: '+String(err.message||'model unavailable'));
 }finally{clearTimeout(timeout);}
}
