import {validComposed} from '../src/composed.mjs';
import {normalizeGeneratedDemo,explainGeneratedDemo,generationClarification} from './generationContract.mjs';
import http from 'node:http';
import {timingSafeEqual} from 'node:crypto';
import {locateScreen,applyScreenPatch,validateStrictDemo} from './refine.mjs';
import {isGlobalRequest,classifyGlobalEdit,applyChromeEdit} from './chrome.mjs';
import {classifyScreenChromeEdit,applyScreenChromeEdit} from './screenChrome.mjs';
import {applyOperations,locateNode,targetLabel} from './operations.mjs';
import {buildRegistry,compactRegistry,resolveChangeSet,resolveSimpleFieldReorder} from './registry.mjs';
import {planPortalSubsection} from './portalNavigation.mjs';
import {reportToolsIntent} from './reportTools.mjs';
import {clarificationResponse} from './refinementAssistance.mjs';
import {canonicalPlan,plannerContext} from './plannerContract.mjs';
import {completeComponents,technicalFailure,issueCategory,repeatsClarification} from './editRecovery.mjs';

const port=Number(process.env.PORT||10000);
const frontendOrigin=process.env.FRONTEND_ORIGIN||'https://demo-builder-nonprod.onrender.com';
const model=process.env.OPENAI_MODEL||'gpt-4.1-mini';
const usage=new Map();
const buckets=new Map();

function respond(res,status,body,origin=''){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Access-Control-Allow-Origin':origin||frontendOrigin,'Vary':'Origin'});res.end(JSON.stringify(body));}
function authorized(given,expected){if(!expected||typeof given!=='string')return false;const a=Buffer.from(given);const b=Buffer.from(expected);return a.length===b.length&&timingSafeEqual(a,b);}
function rateLimited(key){const now=Date.now();const hit=buckets.get(key)||{time:now,count:0};if(now-hit.time>60000){hit.time=now;hit.count=0;}hit.count++;buckets.set(key,hit);if(buckets.size>2000){for(const [k,v] of buckets){if(now-v.time>120000)buckets.delete(k);}}return hit.count>6;}
async function readBody(req){let text='';for await(const chunk of req){text+=chunk.toString();if(text.length>60000)throw new Error('Request too large.');}return JSON.parse(text);}
const kindSet=new Set(['hero','stats','form','table','notice','actions','composed']);
const fieldTypes=new Set(['text','email','password','number','select','date','checkbox']);
const str=(v,max=140)=>typeof v==='string'&&v.length>0&&v.length<=max;
function validDemo(d,channel){
 if(!d||d.schemaVersion!==1||!str(d.id)||!str(d.name)||!str(d.description,500)||d.channel!==channel||!['navy','teal'].includes(d.theme)||!Array.isArray(d.screens)||d.screens.length<2||d.screens.length>9)return false;
 const screenIds=new Set();let total=0;
 for(const s of d.screens){
  if(!str(s.id)||!str(s.title)||!str(s.subtitle,500)||screenIds.has(s.id)||!Array.isArray(s.elements)||s.elements.length<1||s.elements.length>8)return false;
  screenIds.add(s.id);const elementIds=new Set();
  for(const e of s.elements){total++;
   if(!str(e.id)||elementIds.has(e.id)||!kindSet.has(e.kind))return false;elementIds.add(e.id);
   switch(e.kind){
    case 'composed':if(!validComposed(e,d.screens.map(s=>s.id)))return false;break;
    case 'hero':if(!str(e.title)||!str(e.description,600))return false;break;
    case 'stats':if(!Array.isArray(e.items)||e.items.length<1||e.items.length>6||e.items.some(x=>!str(x.id)||!str(x.label)||!str(x.value)))return false;break;
    case 'notice':if(!['info','success'].includes(e.tone)||!str(e.title)||!str(e.body,600))return false;break;
    case 'form':if(!str(e.title)||!str(e.actionLabel)||!Array.isArray(e.fields)||e.fields.length<1||e.fields.length>16||e.fields.some(f=>!str(f.id)||!str(f.label)||!fieldTypes.has(f.type)||f.options&&(!Array.isArray(f.options)||f.options.some(o=>!str(o)))))return false;break;
    case 'actions':if(!Array.isArray(e.buttons)||e.buttons.length<1||e.buttons.length>5||e.buttons.some(b=>!str(b.id)||!str(b.label)))return false;break;
    case 'table':if(!str(e.title)||!Array.isArray(e.columns)||e.columns.length<1||e.columns.length>10||e.columns.some(c=>!str(c.id)||!str(c.label))||!Array.isArray(e.rows)||e.rows.length>30||e.rows.some(row=>!row||typeof row!=='object'||Object.values(row).some(v=>typeof v!=='string')))return false;break;
   }
  }
 }
 if(total>45)return false;
 for(const s of d.screens)for(const e of s.elements){
  if(e.kind==='form'&&e.nextScreen&&!screenIds.has(e.nextScreen))return false;
  if(e.kind==='table'&&e.detailScreen&&!screenIds.has(e.detailScreen))return false;
  if(e.kind==='actions'&&e.buttons.some(b=>b.nextScreen&&!screenIds.has(b.nextScreen)))return false;
 }
 return true;
}

const system=`You are the Demo Builder requirement interpreter. Generate a COMPLETE, polished, realistic, interactive business application demo in STRICT JSON only, based on user story and project context. Never write markdown, commentary or code. Do not claim live external integrations. Supply coherent realistic sample data, clear visual hierarchy, properly linked nextScreen, and unambiguous required form fields. Match the company and guidelines and cover all key steps. Output EXACTLY the following contract with schemaVersion:1,id,name,description,channel ('mobile' or 'portal'),theme ('navy' or 'teal'),screens array containing 3-7 screens (2-9 allowed). Each screen {id,title,subtitle,elements:[...]}. Unique stable ASCII IDs. Elements may be:
{kind:'composed',id,title,items:[{id,kind:'text'|'card'|'input'|'checkbox'|'select'|'button'|'progress',label,text?,required?,options?,nextScreen?,inputType?,value?}]} (use to assemble missing UI patterns with clickable controls; max 16 items)
{kind:'hero',id,eyebrow,title,description}
{kind:'stats',id,items:[{id,label,value,delta?}]}
{kind:'form',id,title,description?,fields:[{id,label,type:'text'|'email'|'password'|'number'|'select'|'date'|'checkbox',placeholder?,required?,options?}],actionLabel,nextScreen?}
{kind:'table',id,title,subtitle?,columns:[{id,label}],rows:[{columnId:'value'}],detailScreen?}
{kind:'notice',id,tone:'info'|'success',title,body}
{kind:'actions',id,buttons:[{id,label,variant:'primary'|'secondary',nextScreen?}]}
Choose screen patterns intelligently: mobile flows (welcome, registration, verification, consent, confirmation); portals (dashboard, list, review, decision). The first screen must offer a way to navigate forward; at least one screen must contain a form or table. Last screen should provide a completion notice or useful summary. Do not mention features unsupported by this component schema in generated screen text. STRICT OUTPUT RULES: Every screen MUST have a nonempty string subtitle and 1–6 elements; total elements across all screens <=35. Generate 3–6 screens unless explicitly requested more. Every table row value MUST be a string (even numbers, dates, booleans and AED amounts). Every stats item value MUST be a string. Every table column ID MUST match a corresponding row key. Every form must include a nonempty title, actionLabel and 1–16 valid typed fields. Each action's nextScreen and each table's detailScreen MUST exactly match an id in the screens array. Every element has a unique nonempty id per screen. Never include an unsupported element kind (no chart, badge, grid or sidebar element); use only the listed kinds. Never add empty description or subtitle; screen subtitle is required. Avoid 'composed' unless necessary, and follow its item constraints exactly. Restrict text lengths and rows (max 8 rows). Include sensible UAE locality and AED amounts where relevant. Do not generate executable JS, HTML, or CSS.`;

async function repairGeneratedDefinition(candidate,issues,channel){
 const instructions='Repair the candidate Demo Definition JSON while preserving all requested screens, sample data, and valid navigation. Fix these validation errors: '+issues.slice(0,8).join('; ')+'. Return ONLY the complete valid JSON object, with allowed element kinds hero,stats,form,table,notice,actions,composed. Forms require title, actionLabel and fields with id,label,type. Allowed types text,email,password,number,select,date,checkbox. Every screen requires subtitle. All table row and KPI values must be strings. All nextScreen and detailScreen IDs must exist. Use existing screens rather than inventing routes.';
 const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),70000);
 try{
  const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',signal:controller.signal,headers:{Authorization:'Bearer '+process.env.OPENAI_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({model,instructions,input:'Correct this '+channel+' Demo Definition JSON object: '+JSON.stringify(candidate),text:{format:{type:'json_object'}},max_output_tokens:8500,store:false})});
  if(!response.ok){console.warn('Generated draft repair unavailable',{status:response.status});return null;}
  const raw=await response.json();const output=(raw.output||[]).filter(x=>x.type==='message').flatMap(x=>x.content||[]).filter(x=>x.type==='output_text').map(x=>x.text).join('');
  return{definition:normalizeGeneratedDemo(JSON.parse(output)),usage:{inputTokens:raw.usage?.input_tokens||0,outputTokens:raw.usage?.output_tokens||0}};
 }catch(e){console.warn('Generated draft repair could not complete');return null;}
 finally{clearTimeout(timeout);}
}
async function generate(body){
 const project=body?.project||{};
 const channel=project.channel;
 if(!['portal','mobile'].includes(channel)||typeof body.requirement!=='string'||body.requirement.trim().length<15||body.requirement.length>12000)throw Object.assign(new Error('A requirement of 15–12,000 characters and a valid channel are required.'),{status:400});
 const context=JSON.stringify({projectName:String(project.name||'New application').slice(0,120),company:String(project.company||'').slice(0,120),designGuidelines:String(project.guidelines||'').slice(0,1600),channel,requirement:body.requirement.slice(0,12000)});
 const ctrl=new AbortController();const timeout=setTimeout(()=>ctrl.abort(),90000);
 let raw;
 try{
  const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',signal:ctrl.signal,headers:{'Authorization':`Bearer ${process.env.OPENAI_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({model,instructions:system,input:'Generate a valid JSON Demo Definition object that follows the schema and requirements. Project context JSON:\n'+context,text:{format:{type:'json_object'}},max_output_tokens:7500,store:false})});
  raw=await response.json();
  if(!response.ok){
   const code=String(raw?.error?.code||'unknown');
   const type=String(raw?.error?.type||'unknown');
   const param=String(raw?.error?.param||'none');
   const detail=String(raw?.error?.message||'').replace(/sk-[A-Za-z0-9_-]+/g,'[redacted]').slice(0,400);
   console.error('OpenAI API rejected generation',{httpStatus:response.status,type,code,param,message:detail});
   const isModel=code==='model_not_found'||/model.*(not exist|access|available|unsupported)/i.test(detail);
   const isQuota=code==='insufficient_quota'||response.status===429;
   const isKey=response.status===401||code==='invalid_api_key';
   const message=isModel?'The configured AI model is unavailable to this API project. Contact the administrator.':isQuota?'OpenAI API quota or rate limit reached. Check project billing and limits.':isKey?'The OpenAI API key is invalid or lacks access. Check the Render OPENAI_API_KEY setting.':response.status===400?'OpenAI rejected a request setting ('+param+'). The server log contains the exact reason.':'OpenAI request failed (HTTP '+response.status+').';
   throw Object.assign(new Error(message),{status:502});
  }
 }finally{clearTimeout(timeout);}
 const output=Array.isArray(raw?.output)?raw.output.filter(x=>x.type==='message').flatMap(x=>x.content||[]).filter(x=>x.type==='output_text').map(x=>x.text).join(''):'';
 let parsed;
 try{parsed=JSON.parse(output);}catch{throw Object.assign(new Error('AI returned an incomplete or invalid definition. Please retry.'),{status:502});}
 let normalized=normalizeGeneratedDemo(parsed);
 let repaired=false,extra={inputTokens:0,outputTokens:0};
 if(!validDemo(normalized,channel)){
  const reasons=explainGeneratedDemo(normalized,channel);
  console.warn('Generated draft needs structural repair',{channel,problems:reasons.slice(0,7)});
  const result=await repairGeneratedDefinition(normalized,reasons,channel);
  if(result&&validDemo(result.definition,channel)){normalized=result.definition;extra=result.usage;repaired=true;}
  else{
   const unresolved=result?explainGeneratedDemo(result.definition,channel):reasons;
   const clarification=generationClarification(unresolved.length?unresolved:reasons,channel);
   return{needsClarification:true,question:clarification.question,suggestions:clarification.suggestions,reason:clarification.reason,summary:'Your brief is saved. Please clarify this one choice to continue.',usage:{model:raw.model||model,inputTokens:(raw.usage?.input_tokens||0)+(result?.usage?.inputTokens||0),outputTokens:(raw.usage?.output_tokens||0)+(result?.usage?.outputTokens||0)}};
  }
 }
 return{definition:normalized,summary:`Generated ${normalized.screens.length} interactive screens for ${normalized.name}.${repaired?' MEYON repaired the draft automatically.':''}`,usage:{model:raw.model||model,inputTokens:(raw.usage?.input_tokens||0)+extra.inputTokens,outputTokens:(raw.usage?.output_tokens||0)+extra.outputTokens}};
}


const refineInstructions=`You are a constrained UI screen refinement engine. You will receive JSON with an existing screen, all screen IDs and titles, project style and an edit request. Output ONLY a valid JSON object for THE ONE target screen, in the exact schema of the provided screen. Keep its "id" EXACTLY unchanged. Preserve every element, field, label, action, link and behavior that the user did not explicitly ask you to modify. Apply the requested change precisely and minimally. Use ONLY these supported element kinds: hero, stats, notice, actions, form, table. Do not invent CSS, HTML, custom components or backends. Supported fields for a form: id,label,type (text,email,password,number,select),placeholder,required,options. A form's nextScreen must point to one of the allowed screen IDs. An actions element's buttons have id,label,variant,nextScreen. Avoid changing nextScreen unless requested. Return a screen object with id,title,subtitle,elements. The word JSON is required. Never output instructions or explanatory text. This is a simulated interactive demo, not real banking software.`;
async function refine(body){
 const demo=body?.definition;
 if(!validateStrictDemo(demo,body?.project?.channel))throw Object.assign(new Error('Saved demo definition failed validation. Export a backup or generate again.'),{status:400});
 const instruction=String(body?.instruction||'').trim();
 if(instruction.length<8||instruction.length>5000)throw Object.assign(new Error('Enter an edit instruction between 8 and 5,000 characters.'),{status:400});
 // Global header edits update shared app chrome, never a selected screen.
 if(isGlobalRequest(instruction)){
  const plan=classifyGlobalEdit(instruction);
  if(!plan?.supported)throw Object.assign(new Error(plan?.reason||'Unsupported global refinement.'),{status:422});
  let result;
  try{result=applyChromeEdit(demo,plan,body?.project?.company,body?.project?.name);}catch(err){throw Object.assign(new Error(err.message),{status:422});}
  if(!validateStrictDemo(result.definition,demo.channel))throw Object.assign(new Error('Global header patch failed schema validation. Original demo unchanged.'),{status:422});
  const summary='Updated application-wide header on all '+demo.screens.length+' screens. Verified screen content and navigation unchanged.';
  console.log('Global header change applied',{screenCount:demo.screens.length,brandChanged:Boolean(plan.brandName),iconRemoved:plan.removeBrandIcon});
  return{definition:result.definition,scope:'global',changedScreenId:null,changedScreenTitle:'Application header',preservedScreens:demo.screens.length,summary,usage:{model:'deterministic',inputTokens:0,outputTokens:0}};
 }
 const target=locateScreen(demo,body.screenId,instruction);
 const screenChromePlan=classifyScreenChromeEdit(instruction);
 if(screenChromePlan){
  if(!screenChromePlan.supported)throw Object.assign(new Error(screenChromePlan.reason),{status:422});
  let patch;
  try{patch=applyScreenChromeEdit(demo,target.id,screenChromePlan,body?.project?.company,body?.project?.name);}catch(err){throw Object.assign(new Error(err.message),{status:422});}
  if(!validateStrictDemo(patch.definition,demo.channel))throw Object.assign(new Error('Targeted header change failed schema validation. Original demo preserved.'),{status:422});
  console.log('Scoped header change verified',{screenId:target.id,preservedScreens:patch.preservedScreens});
  return{...patch,scope:'screen-chrome',summary:'Updated header icon on '+target.title+' only. Verified '+patch.preservedScreens+' other screens and their headers unchanged.',usage:{model:'deterministic',inputTokens:0,outputTokens:0}};
 }
 const prompt=JSON.stringify({instruction,selectedScreenId:target.id,originalScreen:target,availableScreens:demo.screens.map(s=>({id:s.id,title:s.title})),project:{name:String(body.project?.name||'').slice(0,100),company:String(body.project?.company||'').slice(0,100),guidelines:String(body.project?.guidelines||'').slice(0,1000)},responseFormat:'JSON screen object only'});
 const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),90000);
 let raw;
 try{
  const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',signal:controller.signal,headers:{'Authorization':`Bearer ${process.env.OPENAI_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({model,instructions:refineInstructions,input:'Return ONLY JSON for the selected screen. Context: '+prompt,text:{format:{type:'json_object'}},max_output_tokens:5000,store:false})});
  raw=await response.json();
  if(!response.ok){
   const detail=String(raw?.error?.message||'').replace(/sk-[A-Za-z0-9_-]+/g,'[redacted]').slice(0,250);
   console.error('Refinement OpenAI error',{status:response.status,type:raw?.error?.type,param:raw?.error?.param,message:detail});
   throw Object.assign(new Error('AI refinement request failed (HTTP '+response.status+'). Check the server logs.'),{status:502});
  }
 }finally{clearTimeout(timeout);}
 const output=Array.isArray(raw?.output)?raw.output.filter(x=>x.type==='message').flatMap(x=>x.content||[]).filter(x=>x.type==='output_text').map(x=>x.text).join(''):'';
 let edited;
 try{edited=JSON.parse(output);}catch{throw Object.assign(new Error('AI returned invalid JSON. Original screen was preserved.'),{status:422});}
 let merged;
 try{merged=applyScreenPatch(demo,target.id,edited,validateStrictDemo);}catch(err){throw Object.assign(new Error(err.message+' Original demo was preserved.'),{status:422});}
 return{definition:merged,scope:'screen',changedScreenId:target.id,changedScreenTitle:target.title,preservedScreens:demo.screens.length-1,summary:'Updated '+target.title+' only. Verified '+(demo.screens.length-1)+' other screens unchanged.',usage:{model:raw.model||model,inputTokens:raw.usage?.input_tokens||0,outputTokens:raw.usage?.output_tokens||0}};
}


// New staged plan endpoint. It NEVER writes to a workspace and never returns a success
// if a candidate fails operation, scope, schema, or preservation verification.
// Component-specific AI synthesis: produce a COMPLETE declarative component, not a new ungrounded edit plan.
async function synthesizeInteractiveComponent(change,partial,scope){
 const instructions=[
  'You are a component-definition generator for a safe banking prototype. Output one JSON object containing a complete component: {id,title,items:[...]}. Do not output operations, status, explanations, HTML, React, or code.',
  'Each item must have a unique ASCII id, a kind, and a string label. Allowed kinds: text,card,input,checkbox,select,button,progress,table,badge,divider. Maximum 24 items.',
  'Input supports inputType=text|email|number|date|password. Select requires options array of strings. Progress needs value 0..100. Table requires columns [{id,label}] and rows with ONLY string-valued cells, at most 50 rows.',
  'Button actions: {type:navigate,screen:an EXISTING screen id}; {type:set,target:an item id,value:a string}; {type:toggle,target:item id}; {type:increment,target:item id,amount:integer}; {type:reset}; {type:show|hide,target:item id}; {type:notice,message:short string}; {type:download-csv,target:table item id}. Use action references that exist in this component.',
  'Conditional visibility: visibleWhen:{field:existing item id,equals:string}. Table search: filterField=existing input item id, optional filterColumn=existing column id.',
  'Use fictional example data only. Include actual working simulated interactions requested by the user. When the user has already clarified behavior, implement that choice rather than asking again.',
  'Never include executable scripts, external requests, real payment or messaging claims.'
 ].join(' ');
 const ctrl=new AbortController(),timeout=setTimeout(()=>ctrl.abort(),65000);
 try{
  const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',signal:ctrl.signal,headers:{Authorization:'Bearer '+process.env.OPENAI_API_KEY,'Content-Type':'application/json'},
   body:JSON.stringify({model,instructions,input:JSON.stringify({request:scope.instruction,clarifications:scope.clarifications,selectedScreen:scope.selectedScreen,existingScreenIds:scope.screenIds,partialComponent:partial,changeType:change.action}),
    text:{format:{type:'json_object'}},max_output_tokens:4500,store:false})});
  if(!response.ok)throw Error('Component synthesis model request failed');
  const raw=await response.json();
  if(raw?.status!=='completed'||raw?.incomplete_details)throw Error('Component synthesis incomplete');
  const output=(raw.output||[]).filter(x=>x.type==='message').flatMap(x=>x.content||[]).filter(x=>x.type==='output_text').map(x=>x.text).join('');
  return JSON.parse(output);
 }finally{clearTimeout(timeout);}
}

async function planEdit(body){
 const demo=body?.definition;
 const project=body?.project||{};
 if(!validateStrictDemo(demo,project.channel))throw Object.assign(new Error('Saved demo definition failed validation.'),{status:400});
 const instruction=String(body?.instruction||'').trim();
 if(instruction.length<5||instruction.length>5000)throw Object.assign(new Error('Enter a change instruction between 5 and 5,000 characters.'),{status:400});
 const target=body?.target;
 try{locateNode(demo,target);}catch(e){throw Object.assign(new Error(e.message),{status:422});}
 const reportTools=reportToolsIntent(instruction);
 if(reportTools&&project.channel==='portal'&&['screen','element'].includes(target.level)){
  const picked=target.level==='element'&&demo.screens.find(x=>x.id===target.screenId)?.elements.find(e=>e.id===target.elementId)?.kind!=='table'?{level:'screen',screenId:target.screenId}:target;
  const operations=[{op:'configure-report',target:picked,tools:reportTools}];
  let result;
  try{result=applyOperations(demo,picked,operations,project.channel);}
  catch(e){throw Object.assign(new Error('Could not configure report controls: '+e.message+'. Original demo unchanged.'),{status:422});}
  return{scope:'planned',target:picked,label:targetLabel(demo,picked),definition:result.definition,operations,
   checks:result.checks, preservedScreens:result.preservedScreens,
   summary:'Added the requested report controls. Search, filtering and CSV download work on sample records. Review before applying.',
   usage:{model:'deterministic',inputTokens:0,outputTokens:0}};
 }
  const subsection=planPortalSubsection(demo,instruction);
 if(subsection){
  const menuTarget={level:'screen',screenId:subsection.parentScreenId};
  const operations=[{op:'add-subsection',target:menuTarget,title:subsection.title}];
  let result;
  try{result=applyOperations(demo,menuTarget,operations,project.channel);}
  catch(e){throw Object.assign(new Error('Could not add portal subsection: '+e.message+'. Existing demo unchanged.'),{status:422});}
  const created=result.changed.find(x=>x.operation==='add-subsection')?.screenId;
  return{scope:'planned',target:menuTarget,label:subsection.title+' · Under '+demo.screens.find(s=>s.id===subsection.parentScreenId)?.title,
   definition:result.definition,operations,checks:result.checks,createdScreenId:created,
   preservedScreens:demo.screens.length,summary:'Added '+subsection.title+' as a clickable submenu under the requested portal navigation item. Review and Apply.',
   usage:{model:'deterministic',inputTokens:0,outputTokens:0}};
 }
  if(isGlobalRequest(instruction)){
  const change=classifyGlobalEdit(instruction);
  if(!change?.supported)throw Object.assign(new Error(change?.reason||'Unsupported multi-screen request.'),{status:422});
  let out;
  try{out=applyChromeEdit(demo,change,project.company,project.name);}catch(e){throw Object.assign(new Error(e.message),{status:422});}
  if(!validateStrictDemo(out.definition,project.channel))throw Object.assign(new Error('Global header proposal failed schema validation.'),{status:422});
  return{scope:'global',target,label:'Application header · all '+demo.screens.length+' screens',
   definition:out.definition,operations:[{op:'set-global-header',brandName:change.brandName,removeBrandIcon:change.removeBrandIcon,preserveBack:change.preserveBack,hideBack:change.hideBack}],
   checks:['Application-wide header settings verified','All screen content and navigation preserved','No other definition properties changed'],
   preservedScreens:demo.screens.length,
   summary:'Proposed a shared header update across '+demo.screens.length+' screens. Review before applying.',
   usage:{model:'deterministic',inputTokens:0,outputTokens:0}};
 }
 // One grounded model call: target IDs may only come from this registry.
 const registry=buildRegistry(demo,target);
 // Deterministic single-field reorder bypasses AI-generated position IDs.
 const fastReorder=resolveSimpleFieldReorder(registry,target,instruction);
 if(fastReorder){
  let result;
  try{result=applyOperations(demo,target,fastReorder,project.channel);}
  catch(e){throw Object.assign(new Error('Reorder blocked: '+e.message+'. Original demo remains unchanged.'),{status:422});}
  return{scope:'planned',target,label:targetLabel(demo,target),operations:fastReorder,definition:result.definition,checks:result.checks,
   preservedScreens:result.preservedScreens,summary:'Proposed scoped field reordering. Review before applying.',
   usage:{model:'deterministic',inputTokens:0,outputTokens:0}};
 }
 const candidates=compactRegistry(registry,target);
 const selected=registry.find(e=>e.exactSelection);
 const priorClarifications=Array.isArray(body?.clarifications)?body.clarifications.slice(0,5):[];
 const scopeContext={...plannerContext(instruction,priorClarifications),selection:selected?.id||null,
  selectedScreen:demo.screens.find(x=>x.id===target.screenId)?.title,
  candidates,project:{name:String(project.name||'').slice(0,100),guidelines:String(project.guidelines||'').slice(0,600)}};
 const instructions=[
  'Treat clarifications in the context as explicit resolved decisions from the user. DO NOT ask those same questions again. Produce a valid resolved change plan after the user has chosen a workable alternative. Ask only for genuinely new missing requirements, not JSON schema details or action implementation.',
  'You are the grounded intent interpreter for a structured interactive application demo.',
  'Return one JSON object: {"status":"resolved","changes":[{"action":"set|add-field|remove-field|remove-element|move-field|add-component|configure-report","targetId":"one id from candidates","property":"for set","value":"for set","field":{"label":"for add-field","type":"text|email|password|number|select|date|checkbox","required":true},"afterFieldId":"existing field id for insertion/move; __start__ for first"}]} OR {"status":"ambiguous","candidateIds":["real ID",...],"question":"one short clarifying question"} OR {"status":"clarify","question":"one specific question about the requested behavior","options":["choice 1","choice 2"]}.',
  'Make one change per user intent, maximum eight. Never silently skip a requested change. Use only candidate registry IDs, which include real type, parent and allowed capabilities. Never fabricate target IDs, invent fields to remove or refer to other screens.',
  'Remove a field with remove-field targeting its field registry ID, never remove-element. Add fields by targeting the parent form element. Dates such as expiry use type date. A mandatory consent checkbox is one existing field changed using two set actions: type=checkbox and required=true. When adding new fields, do not invent an id; the engine assigns it. Use afterFieldId only for an explicit placement.',
  'Only plan capabilities explicitly advertised for a registry object. For missing visual components, ALWAYS use add-component and supply the full component definition with its state actions. If required behavior is genuinely ambiguous, return clarify with one precise question and two working alternatives. Do not invent API access or external transactions. When a name matches multiple targets return ambiguous.',
  'An exact visual selection takes precedence unless the instruction explicitly names a different object. Avoid editing fields in unrelated forms. Screen selection only scopes the search; it does not imply removal of the whole screen.',
  'For set: allowed properties are screen title/subtitle; header brandName/showBrandIcon/showBackButton; hero title/description/eyebrow; notice title/body/tone; form title/description/actionLabel/nextScreen; table title/subtitle/detailScreen; field label/placeholder/required/type/options; button label/variant/nextScreen.',
  'For move-field, use beforeFieldId or afterFieldId. Use a real field ID, full field registry ID, or unique existing field label from the same form. For above/before use beforeFieldId, for below/after use afterFieldId. Use afterFieldId=__start__ for first position. For add-field, an absent anchor means append. If an action cannot be safely completed, return unsupported for the whole request.',
  'For missing UI use add-component with targetId=screen:<selected screen id>, and a COMPLETE component:{id,title,items:[...]}. Every item requires id,kind,label. Supported kinds: text,card,input,checkbox,select,button,progress,table,badge,divider (maximum 24). Table items require columns:[{id,label}] and rows:[{columnId:stringValue}], with optional filterField (ID of an input or select) and filterColumn (existing column ID). Button items may have actions:[{type:"navigate",screen:"existing screen id"},{type:"set",target:"existing item id",value:"string"},{type:"toggle",target:"id"},{type:"increment",target:"id",amount:1},{type:"show|hide",target:"id"},{type:"reset"},{type:"notice",message:"text"},{type:"download-csv",target:"table item id"}]. Items can have visibleWhen:{field:"existing item id",equals:"string"}. Form controls use required, options, inputType. Every action target MUST be one of the component item IDs, except navigate uses a real existing screen ID. Always create working locally simulated demo behavior using these actions; no executable code. Supply entire component, never only targetId.',
  'For add-component do not reject simply because the request names a widget absent from the current catalogue: approximate it using the available item kinds. Only return unsupported when a faithful useful clickable approximation cannot be made. User-specified business logic is not required unless explicitly requested.',
  'Portal report tools are a built-in capability: use configure-report targeting the selected screen or existing table with tools:{search:true,filter:true,download:true,filterColumn?:a real table column ID}. Do not create composed buttons for search, filtering or export. The engine will render and operate these native controls. For a new report screen with no table, use the screen target and the engine creates a sample table.',
  'When choosing status, output EXACTLY one of resolved, clarify, ambiguous, unsupported. Resolved requires a nonempty changes array, each change with a registry targetId and valid action. Explicit user clarifications override vague assumptions. Never return alternative status words.',
  'Do not emit executable code, CSS, markdown, commentary or arbitrary JSON paths.'
 ].join(' ');
 const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),90000);
 let raw;
 try{
  const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',signal:controller.signal,
   headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`,'Content-Type':'application/json'},
   body:JSON.stringify({model,instructions,input:'Return a valid JSON object only. '+JSON.stringify(scopeContext),
    text:{format:{type:'json_object'}},max_output_tokens:3000,store:false})});
  raw=await response.json();
  if(!response.ok){
   const code=String(raw?.error?.code||'unknown');const type=String(raw?.error?.type||'unknown');
   const detail=String(raw?.error?.message||'').replace(/sk-[A-Za-z0-9_-]+/g,'[redacted]').slice(0,500);
   console.error('Grounded planner model error',{httpStatus:response.status,type,code,detail});
   const reason=response.status===429?'AI request limit or quota reached. Try again after checking API limits.':response.status===401?'Backend OpenAI credentials are invalid.':code==='model_not_found'?'Configured model is not available.':'AI planning request failed (HTTP '+response.status+').';
   throw Object.assign(new Error(reason+' Original demo remains unchanged.'),{status:502});
  }
 }finally{clearTimeout(timeout);}
 if(raw?.status!=='completed'||raw?.incomplete_details)throw Object.assign(new Error('AI plan was incomplete or truncated. No changes were made.'),{status:422});
 const output=Array.isArray(raw?.output)?raw.output.filter(x=>x.type==='message').flatMap(x=>x.content||[]).filter(x=>x.type==='output_text').map(x=>x.text).join(''):'';
 let plan;
 try{plan=canonicalPlan(JSON.parse(output));}catch(e){
  console.warn('AI planning failure',{phase:'parse',category:'MODEL_OUTPUT'});
  return technicalFailure('AI response was not valid JSON','parse');
 }
 if(plan.status==='invalid'){
  console.warn('AI returned unknown plan status',{returnedStatus:plan.returnedStatus||'none',hasChanges:Array.isArray(plan.changes)});
  return technicalFailure('Unrecognized model planning response','contract');
 }
 if(plan?.status==='unsupported'){
  if(priorClarifications.length)return technicalFailure('The AI could not implement the chosen interaction with available components','capability');
  return clarificationResponse(instruction,plan,'Capability or behavior requires clarification.');
 }
 if(plan?.status==='clarify'){
  if(repeatsClarification(plan.question,priorClarifications))return technicalFailure('Repeated question after explicit clarification','clarification');
  if(priorClarifications.length>=3)return technicalFailure('Clarification limit reached','clarification');
  return clarificationResponse(instruction,plan,'A new business decision is needed.');
 }
 if(plan?.status==='ambiguous'){
  const valid=Array.isArray(plan.candidateIds)?plan.candidateIds.filter(id=>candidates.some(e=>e.id===id)).slice(0,6):[];
  if(valid.length<2)return clarificationResponse(instruction,plan,'Target is unclear.');
  const choices=valid.map(id=>{const item=registry.find(e=>e.id===id);return {id,label:item.label,screen:item.screenTitle,type:item.type,target:item.target};});
  throw Object.assign(new Error(String(plan.question||'Which component do you mean?').slice(0,220)),{status:409,code:'AMBIGUOUS_TARGET',choices});
 }
 if(plan?.status!=='resolved')return technicalFailure('Planner did not produce a resolved edit','contract');
 let operations,verification;
 let issue='';
 const componentScope={instruction,clarifications:priorClarifications,selectedScreen:scopeContext.selectedScreen,screenIds:demo.screens.map(sc=>sc.id)};
 try{
  const readyChanges=await completeComponents(plan.changes,componentScope.screenIds,(change,partial)=>synthesizeInteractiveComponent(change,partial,componentScope));
  operations=resolveChangeSet(registry,target,readyChanges);
  verification=applyOperations(demo,target,operations,project.channel);
 }catch(e){
  issue=String(e?.message||'Invalid component definition');
  console.warn('AI edit validation failed',{phase:'initial',category:issueCategory(issue),selectedScreenId:target.screenId,actionCount:Array.isArray(plan.changes)?plan.changes.length:0});
 }
 if(issue){
  // Repair a structurally invalid component plan once rather than asking the BA to debug JSON.
  const repairInstructions='Repair a structured demo edit plan. Output JSON only: {"status":"resolved","changes":[...]}, or {"status":"clarify","question":"one specific question","options":["choice A","choice B"]}. Preserve intent and target IDs from the supplied registry. Fix the stated validation problem. For add-component ALWAYS supply the complete safe component with id,title,items. Item kinds: text,card,input,checkbox,select,button,progress,table,badge,divider. Buttons have optional actions using navigate/set/toggle/increment/reset/show/hide/notice/download-csv. Tables have columns and string-valued rows. Refer only to existing item IDs, real screen IDs, and registry target IDs. Do not generate HTML or code.';
  const ctrl=new AbortController(),deadline=setTimeout(()=>ctrl.abort(),60000);
  try{
   const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',signal:ctrl.signal,headers:{Authorization:'Bearer '+process.env.OPENAI_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({model,instructions:repairInstructions,input:'Return valid JSON. Repair issue: '+issue+'; request context: '+JSON.stringify(scopeContext)+'; failed plan: '+JSON.stringify(plan),text:{format:{type:'json_object'}},max_output_tokens:3800,store:false})});
   if(response.ok){
    const fix=await response.json();const output=(fix.output||[]).filter(x=>x.type==='message').flatMap(x=>x.content||[]).filter(x=>x.type==='output_text').map(x=>x.text).join('');
    const repaired=canonicalPlan(JSON.parse(output));
    if(repaired?.status==='clarify'){
     if(priorClarifications.length&&repeatsClarification(repaired.question,priorClarifications))return technicalFailure('Repeated clarification after recovery','repair');
     return clarificationResponse(instruction,repaired,issue);
    }
    if(repaired?.status==='resolved'){
     const ready=await completeComponents(repaired.changes,componentScope.screenIds,(change,partial)=>synthesizeInteractiveComponent(change,partial,componentScope));
     operations=resolveChangeSet(registry,target,ready);
     verification=applyOperations(demo,target,operations,project.channel);
     issue='';
    }
   }
  }catch(e){
   const cause=String(e?.message||'Unknown repair failure');
   issue=cause;
   console.warn('AI edit auto-repair failed',{phase:'repair',category:issueCategory(cause),selectedScreenId:target.screenId});
  }
  finally{clearTimeout(deadline);}
 }
 if(issue||!verification)return technicalFailure(issue||'No valid changes after recovery','repair');
 return{scope:'planned',target,label:targetLabel(demo,target),operations,definition:verification.definition,checks:verification.checks,
   preservedScreens:verification.preservedScreens,summary:'Proposed '+operations.length+' scoped operation(s) for '+targetLabel(demo,target)+'. Review before applying.',
   usage:{model:raw?.model||model,inputTokens:raw?.usage?.input_tokens||0,outputTokens:raw?.usage?.output_tokens||0}};
}

const server=http.createServer(async(req,res)=>{
 const origin=req.headers.origin||'';
 if(origin&&origin!==frontendOrigin){respond(res,403,{error:'Origin not allowed.'},frontendOrigin);return;}
 if(req.method==='OPTIONS'){res.writeHead(204,{'Access-Control-Allow-Origin':frontendOrigin,'Access-Control-Allow-Headers':'content-type,x-builder-access','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Vary':'Origin'});res.end();return;}
 if(req.url==='/health'&&req.method==='GET'){respond(res,200,{status:'ok'});return;}
 if(req.url==='/api/status'&&req.method==='GET'){respond(res,200,{ready:Boolean(process.env.OPENAI_API_KEY&&process.env.DEMO_ACCESS_TOKEN),model,requiresAccessToken:true});return;}
 if(!['/api/generate','/api/refine','/api/plan'].includes(req.url)||req.method!=='POST'){respond(res,404,{error:'Not found.'});return;}
 if(!process.env.OPENAI_API_KEY||!process.env.DEMO_ACCESS_TOKEN){respond(res,503,{error:'AI backend is not configured. Set OPENAI_API_KEY and DEMO_ACCESS_TOKEN in the Render service environment.'});return;}
 if(!authorized(req.headers['x-builder-access'],process.env.DEMO_ACCESS_TOKEN)){respond(res,401,{error:'Invalid Demo Builder access token.'});return;}
 const client=req.socket.remoteAddress||'unknown';if(rateLimited(client)){respond(res,429,{error:'Generation limit reached (6 requests/minute).'});return;}
 try{const body=await readBody(req);const result=req.url==='/api/plan'?await planEdit(body):req.url==='/api/refine'?await refine(body):await generate(body);respond(res,200,result);}
 catch(err){console.error('Generation error:',err?.message||'unknown');respond(res,err?.status||500,{error:err?.status?err.message:'Unable to generate the demo. Please try again.',...(err?.code==='AMBIGUOUS_TARGET'?{code:err.code,choices:err.choices}: {})});}
});
server.listen(port,'0.0.0.0',()=>console.log(`Demo Builder API listening on ${port}`));
