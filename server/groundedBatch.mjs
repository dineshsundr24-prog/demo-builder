// Common grounded multi-change plan. Language understanding belongs to AI;
// only stable registry addresses, permissions, types and verification belong to code.
import {buildRegistry,compactRegistry,resolveChangeSet} from './registry.mjs';
import {applyOperations,locateNode} from './operations.mjs';
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export function numberedRequirements(instruction){
 const lines=String(instruction||'').split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
 const clauses=lines.map(line=>/^(\d+)[.)]\s+(.+)$/.exec(line)).filter(Boolean)
  .map(match=>({id:Number(match[1]),text:match[2].trim()}));
 if(clauses.length<2)return null;
 if(clauses.length>12||clauses.some((c,i)=>c.id!==i+1))return null;
 return clauses;
}
const nonmutating=/^(keep|preserve|retain|leave|maintain|do not change|don't change|without changing)\b/i;
function activeRequirements(items){return items.filter(x=>!nonmutating.test(x.text));}
export function validateGroundedBatch(demo,selection,requirements,plan){
 if(!plan||plan.status!=='resolved'||!Array.isArray(plan.changes)||!Array.isArray(plan.satisfied))
  throw Error('AI did not return a complete, resolved edit plan.');
 const requested=activeRequirements(requirements);
 const allowed=new Set(requested.map(x=>x.id));
 const counts=new Map(requested.map(x=>[x.id,0]));
 const registry=buildRegistry(demo,selection);
 const edits=[];
 for(const change of plan.changes){
  const index=change.requirementId;
  if(!allowed.has(index))throw Error('Plan changes an unrequested or preservation-only instruction.');
  counts.set(index,counts.get(index)+1);
  if(!Number.isInteger(index)||!change.targetId||typeof change.action!=='string')
   throw Error('Edit is missing its source requirement or stable component ID.');
  edits.push(change);
 }
 for(const entry of plan.satisfied){
  if(!allowed.has(entry.requirementId))throw Error('Plan marks an unrequested requirement satisfied.');
  counts.set(entry.requirementId,counts.get(entry.requirementId)+1);
  const component=registry.find(e=>e.id===entry.targetId);
  if(!component)throw Error('Already-satisfied claim has no valid target.');
  const node=locateNode(demo,component.target).node;
  const observed=entry.property==='backgroundColor'||entry.property==='textColor'||
   entry.property==='alignment'||entry.property==='padding'||entry.property==='borderRadius'||entry.property==='textAlign'?
    node.appearance?.[entry.property]:node[entry.property];
  if(!same(observed,entry.value))throw Error('Already-satisfied claim is not true for '+component.label+'.');
 }
 for(const requirement of requested)if(!counts.get(requirement.id))
  throw Error('AI omitted requirement '+requirement.id+': '+requirement.text);
 if(!edits.length)throw Error('Every requested change is already satisfied; nothing new to apply.');
 if(edits.length>8)throw Error('More than eight operations requested. No partial changes applied.');
 const operations=resolveChangeSet(registry,selection,edits);
 const result=applyOperations(demo,selection,operations,demo.channel);
 return {operations,definition:result.definition,checks:[
  ...result.checks,'Every requested change accounted for','All edits applied atomically',
  'Already-satisfied requirements verified against actual properties'
 ],preservedScreens:result.preservedScreens,requirements:requested.length,edits:edits.length};
}
export async function planGroundedBatch({demo,selection,instruction,model,apiKey,fetchImpl=fetch}){
 const requirements=numberedRequirements(instruction);
 if(!requirements)return null;
 const active=activeRequirements(requirements);
 if(!active.length)return {status:'blocked',reason:'No new changes requested.'};
 if(!apiKey)return{status:'blocked',reason:'AI planner is not configured.'};
 const registry=buildRegistry(demo,selection);
 const candidates=compactRegistry(registry,selection);
 const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),60000);
 try{
  const prompt=[
   'You are a semantic editor. Convert the user requirements into a complete, atomic change plan against the supplied exact component inventory.',
   'Respond ONLY as a JSON object with status "resolved" and changes and satisfied arrays, or status "blocked" with reason and requirementId.',
   'Never ask generic questions. If a target truly matches multiple inventory entries, return status "blocked" identifying that requirement and the candidate IDs.',
   'You MUST account for every numbered MUTATING requirement once or more in changes or exactly once in satisfied. Do not generate changes for keep/preserve/do-not-change constraints.',
   'Interpret different natural phrasings semantically; do not change the named target or silently skip a requirement.',
   'Each changes entry has requirementId (1-based), action ("set","set-style","set-item","add-field","remove-field","move-field","remove-element" or "add-component"), targetId (EXACT registry ID), and supported operation parameters.',
   'For set and set-style and set-item add property and value. For field updates use "set" on the actual field target ID; for buttons inside forms use the button target ID ending __submit__.',
   'For colors use six-digit hex. backgroundColor means button/card background; textColor means text. Do not assign arbitrary CSS.',
   'A renamed field keeps its original target ID for later requirements. If a property is already correct, return one satisfied record with requirementId,targetId,property,value, not a duplicate edit.',
   'For add-field supply field:{label,type,required,options?}; other actions follow registry capabilities. Never invent IDs.',
   'Only permitted properties: field label,required,type,placeholder,options; button label,variant,nextScreen; visual backgroundColor,textColor,textAlign,alignment,padding,borderRadius; relevant screen/element properties.',
   'If the user requires an unsupported or truly ambiguous capability, return status blocked and name the exact numbered requirement. Do not suggest replacement components.',
   'Use the project screen and all immutable registry IDs. Return every change together. Do not provide markdown or explanations outside JSON.'
  ].join(' ');
  const response=await fetchImpl('https://api.openai.com/v1/responses',{
   method:'POST',signal:controller.signal,headers:{Authorization:'Bearer '+apiKey,'Content-Type':'application/json'},
   body:JSON.stringify({model,store:false,instructions:prompt,
    input:JSON.stringify({requirements,selection,candidates,screenTitle:demo.screens.find(x=>x.id===selection.screenId)?.title,
     userInstruction:instruction}),
    text:{format:{type:'json_object'}},max_output_tokens:2600})
  });
  if(!response.ok)throw Error('AI planning service returned HTTP '+response.status+'.');
  const data=await response.json();
  if(data?.status!=='completed'||data?.incomplete_details)throw Error('AI planning returned incomplete output.');
  const raw=(data.output||[]).filter(x=>x.type==='message').flatMap(x=>x.content||[])
   .filter(x=>x.type==='output_text').map(x=>x.text).join('');
  let plan;
  try{plan=JSON.parse(raw);}catch{throw Error('AI planning output is not valid JSON.');}
  if(plan?.status==='blocked')return{status:'blocked',reason:'Requirement '+String(plan.requirementId||'?')+': '+String(plan.reason||'Cannot resolve request.').slice(0,240)};
  try{return{status:'resolved',...validateGroundedBatch(demo,selection,requirements,plan)};}
  catch(err){return{status:'blocked',reason:String(err.message||'Invalid AI plan')}};
 }catch(err){
  return{status:'blocked',reason:String(err.message||'Could not prepare safe edit')};
 }finally{clearTimeout(timeout);}
}
