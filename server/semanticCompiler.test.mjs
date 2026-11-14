import test from 'node:test';
import assert from 'node:assert/strict';
import {semanticSpecFromRequirement,compileSemanticComponent,extractRequestedFields} from './semanticCompiler.mjs';
import {generateCompiledComponent} from './semanticGenerator.mjs';
import {createInteractiveSection} from './interactiveCreation.mjs';
import {validComposed} from '../src/composed.mjs';
import {dynamicRows,dynamicCsv,executeDynamicActions} from '../src/componentRuntime.mjs';
import {validateStrictDemo} from './refine.mjs';

const instruction='Create a User Activity Dashboard showing login history, last activity, and failed login attempts. The information should come from our existing banking system. Build this as an interactive demo.';
const scope={selectedScreen:'Kapiko Bank – Operations Overview',dataSourceMode:'demo',screenIds:['screen_dashboard','other-screen'],clarifications:[{question:'What data source?',answer:'Use fictional local demo data and simulated interactions'}]};
const target={level:'screen',screenId:'screen_dashboard'};
const demo={schemaVersion:1,id:'kapiko',name:'Kapiko Portal',description:'Test demo',channel:'portal',theme:'navy',screens:[
 {id:'screen_dashboard',title:'Kapiko Bank – Operations Overview',subtitle:'Existing KPI overview',elements:[{id:'stats',kind:'stats',items:[{id:'applications',label:'Applications',value:'1248'}]}]},
 {id:'other-screen',title:'Approvals',subtitle:'Approval queue',elements:[{id:'notice',kind:'notice',tone:'info',title:'Existing',body:'Preserve me'}]}
]};
const validModel={title:'User Activity Dashboard',type:'table',fields:['Login History','Last Activity','Failed Login Attempts'],search:true,download:true,filter:false,showSummary:true};
function mockResponse(payload,status=200){
 return async(url,request)=>{
  assert.match(url,/api.openai.com\/v1\/responses/);
  const parsed=JSON.parse(request.body);
  assert.equal(parsed.text.format.type,'json_schema');
  assert.equal(parsed.text.format.strict,true);
  assert.equal(parsed.text.format.name,'demo_semantic_component');
  return{ok:status===200,status,json:async()=>payload};
 };
}
const completed=spec=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(spec)}]}]});

test('Exact Kapiko request extracts ALL three named report attributes',()=>{
 const fields=extractRequestedFields(instruction);
 assert.deepEqual(fields,['Login History','Last Activity','Failed Login Attempts']);
 assert.equal(semanticSpecFromRequirement(instruction).type,'table');
});

test('Live-shaped semantic response produces valid runtime controls and preserves every requested metric',async()=>{
 const component=await generateCompiledComponent({instruction,scope,model:'gpt-4.1-mini',apiKey:'test-key',fetchImpl:mockResponse(completed(validModel))});
 assert.equal(validComposed(component,scope.screenIds),true);
 const table=component.items.find(x=>x.kind==='table');
 assert.ok(table);
 assert.ok(['Login History','Last Activity','Failed Login Attempts'].every(label=>table.columns.some(c=>c.label===label)));
 assert.ok(component.items.some(x=>x.kind==='input'&&x.id===table.filterField));
 assert.ok(component.items.some(x=>x.kind==='button'&&x.actions?.some(a=>a.type==='download-csv'&&a.target===table.id)));
 assert.ok(table.rows.length>=3);
 const users=dynamicRows(table,{search:'USR-1001'});
 assert.equal(users.length,1);
 const csv=dynamicCsv(table,{search:'USR-1001'});
 assert.ok(csv.includes('Failed Login Attempts'));
 assert.equal(csv.split('\r\n').length,2);
 const download=component.items.find(x=>x.id==='download');
 assert.deepEqual(executeDynamicActions(component,download,{search:'USR-1001'}).events,[{type:'download-csv',target:'data-table'}]);
});

test('Atomic screen creation with live-shaped semantic response retains original screens and schema',async()=>{
 const result=await createInteractiveSection({demo,target,instruction,scope,
  generate:async()=>generateCompiledComponent({instruction,scope,model:'gpt-4.1-mini',apiKey:'test-key',fetchImpl:mockResponse(completed(validModel))})});
 assert.equal(result.operations.length,1);
 assert.equal(result.operations[0].op,'add-component');
 assert.equal(validateStrictDemo(result.definition,'portal'),true);
 assert.equal(result.definition.screens[0].elements.length,2);
 assert.deepEqual(result.definition.screens[1],demo.screens[1]);
 assert.deepEqual(demo.screens[0].elements,[{id:'stats',kind:'stats',items:[{id:'applications',label:'Applications',value:'1248'}]}]);
});

test('Under-specified model schema still retains all user-stated columns',async()=>{
 const minimal={...validModel,fields:['Last Activity']};
 const component=await generateCompiledComponent({instruction,scope,model:'gpt-4.1-mini',apiKey:'test-key',fetchImpl:mockResponse(completed(minimal))});
 const labels=component.items.find(x=>x.kind==='table').columns.map(c=>c.label);
 assert.ok(labels.includes('Login History'));
 assert.ok(labels.includes('Failed Login Attempts'));
});

test('Incomplete output safely falls back to valid deterministic compilation',async()=>{
 const component=await generateCompiledComponent({instruction,scope,model:'gpt-4.1-mini',apiKey:'test-key',fetchImpl:mockResponse({status:'incomplete',incomplete_details:{reason:'max_output_tokens'},output:[]})});
 assert.equal(validComposed(component,scope.screenIds),true);
 assert.equal(component.items.find(x=>x.kind==='table').columns.some(c=>c.label==='Failed Login Attempts'),true);
});

test('Server output format mismatch cannot force invalid-component rejection',async()=>{
 const component=await generateCompiledComponent({instruction,scope,model:'gpt-4.1-mini',apiKey:'test-key',fetchImpl:mockResponse({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'{"unexpected":"shape"}'}]}]})});
 assert.equal(validComposed(component,scope.screenIds),true);
 assert.ok(component.items.some(x=>x.kind==='table'));
});

test('Counter request compiles to executable increment and reset buttons',()=>{
 const component=compileSemanticComponent({title:'Review Queue Counter',type:'counter',fields:['Counter'],search:false,download:false,filter:false,showSummary:false},'Create a Review Queue Counter component',scope.screenIds);
 assert.equal(validComposed(component,scope.screenIds),true);
 const increase=component.items.find(x=>x.id==='counter-increase'),reset=component.items.find(x=>x.id==='counter-reset');
 const next=executeDynamicActions(component,increase,{'counter-value':'3'});
 assert.equal(next.values['counter-value'],'4');
 const result=executeDynamicActions(component,reset,next.values);
 assert.equal(result.values['counter-value'],'0');
 assert.equal(result.events[0].type,'notice');
});

test('Disconnected placeholder is clearly labeled and never pretends to retrieve banking data',()=>{
 const component=compileSemanticComponent(validModel,instruction,scope.screenIds,'placeholder');
 const notice=component.items.find(x=>x.id==='integration-notice');
 assert.match(notice.text,/not been configured/);
 assert.equal(validComposed(component,scope.screenIds),true);
});

test('Explicit requirement fields outrank unrelated AI suggestions at the column limit',()=>{
 const excessive={...validModel,fields:['Department','Region','Country','Zone','Office','Role','Team','Manager','Last Activity']};
 const component=compileSemanticComponent(excessive,instruction,scope.screenIds);
 const columns=component.items.find(x=>x.kind==='table').columns.map(c=>c.label);
 assert.ok(['Login History','Last Activity','Failed Login Attempts'].every(f=>columns.includes(f)));
 assert.ok(columns.length<=10);
});
