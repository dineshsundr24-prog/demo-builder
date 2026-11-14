import test from 'node:test';
import assert from 'node:assert/strict';
import {interactiveCreationIntent,createInteractiveSection,safeCreationDiagnostic} from './interactiveCreation.mjs';
import {externalDataGuard,externalDataDecision} from './integrationPreflight.mjs';
import {validateStrictDemo} from './refine.mjs';

const instruction='Create a User Activity Dashboard showing login history, last activity, and failed login attempts. The information should come from our existing banking system. Build this as an interactive demo.';
const demo={schemaVersion:1,id:'kapiko',name:'Kapiko Bank',description:'Prototype',channel:'portal',theme:'navy',screens:[
 {id:'screen_dashboard',title:'Kapiko Bank - Operations Overview',subtitle:'Overview of recent application activity and KPIs',elements:[
 {id:'stats',kind:'stats',items:[{id:'total',label:'Total Applications',value:'1248'}]}]},
 {id:'screen_approvals',title:'Approval Queue',subtitle:'Approvals',elements:[{id:'notice',kind:'notice',tone:'info',title:'Pending Reviews',body:'Keep unchanged'}]}
]};
const target={level:'screen',screenId:'screen_dashboard'};
const question={question:'This demo does not have a connection to your existing banking system. Which data behavior should I use?',answer:'Use fictional local demo data and simulated interactions'};
const composed={id:'user-activity',title:'User Activity Dashboard',items:[
 {id:'search',kind:'input',label:'Search users',inputType:'text'},
 {id:'history',kind:'table',label:'User Login History',columns:[{id:'username',label:'User'},{id:'lastLogin',label:'Last Login'},{id:'failedAttempts',label:'Failed Attempts'}],rows:[
 {username:'U1001',lastLogin:'2026-11-14 09:02',failedAttempts:'2'},
 {username:'U1002',lastLogin:'2026-11-13 18:20',failedAttempts:'0'}],filterField:'search'},
 {id:'export',kind:'button',label:'Download CSV',actions:[{type:'download-csv',target:'history'}]}
]};
test('Exact User Activity Dashboard request asks for data source before any generation',()=>{
 assert.equal(externalDataGuard(instruction).needsClarification,true);
 assert.equal(interactiveCreationIntent(instruction,target),true);
 assert.equal(externalDataGuard(instruction,[question]),null);
 assert.equal(externalDataDecision(instruction,[question]).mode,'demo');
});
test('Corrected execution produces one valid atomic change, not five malformed edits',async()=>{
 let calls=0;
 const result=await createInteractiveSection({demo,target,instruction,scope:{instruction,clarifications:[question],selectedScreen:demo.screens[0].title,dataSourceMode:'demo',screenIds:demo.screens.map(s=>s.id)},generate:async()=>{
  calls++;return composed;
 }});
 assert.equal(calls,1);
 assert.equal(result.operations.length,1);
 assert.equal(result.operations[0].op,'add-component');
 assert.ok(validateStrictDemo(result.definition,'portal'));
 assert.equal(result.definition.screens[0].elements.length,2);
 assert.deepEqual(result.definition.screens[1],demo.screens[1]);
 assert.equal(demo.screens[0].elements.length,1);
});
test('AI generation retries structural issues with the validator feedback',async()=>{
 const invalid={id:'activity',title:'Activity',items:[{id:'history',kind:'table',label:'History',columns:[{id:'status',label:'Status'}],rows:[{status:'Active'}],filterField:'unknown'}]};
 const calls=[];
 const result=await createInteractiveSection({demo,target,instruction,scope:{instruction,clarifications:[question],dataSourceMode:'demo',screenIds:demo.screens.map(s=>s.id)},generate:async(change,partial,scope,issues)=>{
  calls.push({partial,issues});
  return calls.length===1?invalid:composed;
 }});
 assert.equal(calls.length,2);
 assert.ok(calls[1].issues.some(x=>x.includes('filterField')));
 assert.equal(result.definition.screens[0].elements.length,2);
});
test('Failed synthesis cannot change any original screen or invent backend data',async()=>{
 await assert.rejects(()=>createInteractiveSection({demo,target,instruction,scope:{instruction,clarifications:[question],dataSourceMode:'demo',screenIds:demo.screens.map(s=>s.id)},generate:async()=>({title:'Unusable',items:[]})}),/could not produce a valid/);
 assert.equal(demo.screens[0].elements.length,1);
 assert.equal(demo.screens[1].elements[0].body,'Keep unchanged');
});
test('Existing UI edits do not take the new creation route',()=>{
 assert.equal(interactiveCreationIntent('Move the login field above the email field',target),false);
 assert.equal(interactiveCreationIntent('Create a subsection under Reports',target),false);
 assert.equal(interactiveCreationIntent('Change the existing dashboard title',target),false);
 assert.equal(interactiveCreationIntent(instruction,{level:'element',screenId:'screen_dashboard',elementId:'stats'}),false);
 assert.equal(interactiveCreationIntent('Add a Review Queue Counter component',target),true);
});
test('Safe diagnostic reports structural paths only',()=>{
 const diag=safeCreationDiagnostic(Object.assign(new Error('Component creation could not produce a valid executable definition'),{validationIssues:['items[0].filterField: unknown field']}));
 assert.equal(diag.category,'INVALID_COMPONENT');
 assert.deepEqual(diag.issuePaths,['items[0].filterField']);
});
