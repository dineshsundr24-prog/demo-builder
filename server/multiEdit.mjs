// Atomic, grounded multi-edit planning for existing controls.
// Interpret each independently stated instruction, resolve only real stable targets,
// and reject the entire batch when any requested change cannot be grounded.
import {buildRegistry,normalizeName,resolveChangeSet} from './registry.mjs';
import {resolveVisualTarget} from './visualTarget.mjs';

export function splitEditInstructions(instruction){
 const raw=String(instruction||'').trim();
 const lines=raw.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
 const numbered=lines.filter(x=>/^\d+[.)]\s+/.test(x));
 if(numbered.length)return numbered.map(x=>x.replace(/^\d+[.)]\s+/,'').replace(/\s+$/,''));
 return raw.split(/;\s*|\.\s+(?=(?:rename|make|mark|set|change|update|keep|preserve|leave)\b)/i)
  .map(x=>x.replace(/[.]\s*$/,'').trim()).filter(Boolean);
}
const nonMutation=/^(?:keep|preserve|leave|don't change|do not change|maintain|retain)\b/i;
const fieldEntries=(registry)=>registry.filter(e=>e.target.level==='field');
function matching(entries,label,aliases){
 const key=normalizeName(label);
 return entries.filter(e=>normalizeName(e.label)===key||normalizeName(e.target.childId)===key||aliases.get(key)===e.id);
}
export function planMultiEdit(demo,selection,instruction){
 const clauses=splitEditInstructions(instruction);
 if(clauses.length<2||clauses.length>12)return null;
 const actionable=clauses.filter(x=>!nonMutation.test(x)&&!/^on the .+ screen[:,]?\s*make the following changes:?$/i.test(x));
 if(actionable.length<2)return null;
 const registry=buildRegistry(demo,selection);
 const aliases=new Map();
 const changes=[];
 for(const clause of actionable){
  let m=/^(?:please\s+)?(?:rename|change\s+(?:the\s+)?(?:label|name)\s+of)\s+(?:the\s+)?(.+?)\s+to\s+["“']?(.+?)["”']?[.]?$/i.exec(clause);
  if(m){
   const source=m[1].replace(/\s+(?:field|input)$/i,'').trim();
   const label=m[2].replace(/[."”']+$/,'').trim();
   const hits=matching(fieldEntries(registry),source,aliases);
   if(hits.length!==1||!label||label.length>100)return{status:'unresolved',clause,reason:'Field name could not be matched uniquely.'};
   changes.push({action:'set',targetId:hits[0].id,property:'label',value:label});
   aliases.set(normalizeName(label),hits[0].id);
   continue;
  }
  m=/^(?:please\s+)?(?:make|mark|set)\s+(?:the\s+)?(.+?)\s+(mandatory|required|optional|not required)[.]?$/i.exec(clause);
  if(m){
   const source=m[1].replace(/\s+(?:field|input)$/i,'').trim();
   const hits=matching(fieldEntries(registry),source,aliases);
   if(hits.length!==1)return{status:'unresolved',clause,reason:'Required field could not be matched uniquely.'};
   changes.push({action:'set',targetId:hits[0].id,property:'required',value:/^(?:mandatory|required)$/i.test(m[2])});
   continue;
  }
  // A single styling clause is resolved against the SAME grounded visual inventory
  // used by one-at-a-time edits, rather than a second set of per-component rules.
  const style=resolveVisualTarget(demo,selection,clause);
  if(style?.status==='resolved'){
   for(const op of style.operations)changes.push({action:op.op==='set-style'?'set-style':op.op,
    targetId:registry.find(e=>e.target.level===op.target.level&&e.target.screenId===op.target.screenId&&e.target.elementId===op.target.elementId&&e.target.childId===op.target.childId)?.id,
    property:op.property,value:op.value});
   continue;
  }
  return{status:'unresolved',clause,reason:style?.status==='ambiguous'?'More than one matching visible control.':'Requested change is not supported by the grounded multi-edit contract.'};
 }
 if(changes.length>8)return{status:'unresolved',reason:'This edit has more than eight changes; split it into smaller batches.'};
 try{
  return{status:'resolved',operations:resolveChangeSet(registry,selection,changes),changeCount:changes.length};
 }catch(e){return{status:'unresolved',reason:String(e.message||'Invalid edit operation')}};
}
