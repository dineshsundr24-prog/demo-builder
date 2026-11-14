// Model returns semantic intent, never renderer executable JSON.
// The deterministic compiler owns IDs, actions, data and validity.
import {compileSemanticComponent,semanticSpecFromRequirement,semanticSpecSchema} from './semanticCompiler.mjs';

export function readSemanticResponse(raw){
 if(raw?.status!=='completed'||raw?.incomplete_details)return null;
 const output=Array.isArray(raw.output)?raw.output.filter(x=>x.type==='message').flatMap(x=>x.content||[]).filter(x=>x.type==='output_text').map(x=>x.text).join(''):'';
 if(!output)return null;
 try{
  const decoded=JSON.parse(output);
  return decoded&&typeof decoded==='object'&&!Array.isArray(decoded)?decoded:null;
 }catch{return null;}
}
export async function generateCompiledComponent({instruction,scope,model,apiKey,fetchImpl=fetch}){
 const fallback=semanticSpecFromRequirement(instruction);
 let modelSpec=null,reason='none';
 const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),50000);
 try{
  const response=await fetchImpl('https://api.openai.com/v1/responses',{
   method:'POST',signal:controller.signal,
   headers:{Authorization:'Bearer '+apiKey,'Content-Type':'application/json'},
   body:JSON.stringify({
    model,
    instructions:'Describe the requested demo component semantically. Choose type table for dashboards, reports, activity and data listings; counter for numeric counters; form for data entry. Set title, fields as display labels and search/download flags. Preserve every explicitly named metric. Use fictional sample data only; do not claim real integration. Do not generate UI JSON, element IDs or executable actions. The server compiler will create all UI behavior.',
    input:JSON.stringify({requirement:instruction,dataSourceMode:scope.dataSourceMode,selectedScreen:scope.selectedScreen,clarifications:scope.clarifications}),
    text:{format:{type:'json_schema',name:'demo_semantic_component',strict:true,schema:semanticSpecSchema}},
    max_output_tokens:1100,store:false
   })
  });
  if(!response.ok){
   const err=new Error('Semantic model request failed');
   err.statusCode=response.status;throw err;
  }
  const raw=await response.json();
  modelSpec=readSemanticResponse(raw);
  if(!modelSpec)reason=raw?.incomplete_details?'incomplete':'invalid-output';
 }catch(e){
  if(e?.statusCode===401||e?.statusCode===403||e?.statusCode===429)throw e;
  reason='model-unavailable';
 }finally{clearTimeout(timeout);}
 let component;
 try{component=compileSemanticComponent(modelSpec||fallback,instruction,scope.screenIds||[],scope.dataSourceMode||'demo');}
 catch(e){
  reason='model-schema-compiler-failed';
  component=compileSemanticComponent(fallback,instruction,scope.screenIds||[],scope.dataSourceMode||'demo');
 }
 console.info('Semantic component compilation',{source:modelSpec&&reason==='none'?'model':'deterministic-fallback',fallbackReason:reason,type:component.items.some(i=>i.kind==='table')?'table':component.items.some(i=>i.id==='counter-value')?'counter':'form',itemCount:component.items.length});
 return component;
}
