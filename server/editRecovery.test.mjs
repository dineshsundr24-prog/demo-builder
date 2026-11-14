import test from 'node:test';
import assert from 'node:assert/strict';
import {completeComponents,componentNeedsSynthesis,normalizeComponent,technicalFailure,repeatsClarification,issueCategory} from './editRecovery.mjs';
import {validateStrictDemo} from './refine.mjs';
import {resolveChangeSet,buildRegistry} from './registry.mjs';
import {applyOperations} from './operations.mjs';

const demo={schemaVersion:1,id:'kapiko',name:'Kapiko Bank',description:'Demo',channel:'portal',theme:'navy',screens:[
{id:'dashboard',title:'Dashboard',subtitle:'Banking activity',elements:[{id:'heading',kind:'notice',title:'Summary',body:'Keep this unchanged',tone:'info'}]},
{id:'review',title:'Review',subtitle:'Review applications',elements:[{id:'notice',kind:'notice',title:'Review',body:'Keep this unchanged',tone:'info'}]}
]};
const target={level:'screen',screenId:'dashboard'};
const complete={
 id:'review-counter',title:'Review Queue Counter',items:[
 {id:'count',kind:'input',label:'Count',inputType:'number'},
 {id:'increase',kind:'button',label:'Increase',actions:[{type:'increment',target:'count',amount:1}]},
 {id:'reset',kind:'button',label:'Reset',actions:[{type:'set',target:'count',value:'0'},{type:'notice',message:'Reset complete'}]}
 ]};

test('RCA: missing AI component is synthesized independently and applied without modifying other screens',async()=>{
 const registry=buildRegistry(demo,target);
 const plan=[{action:'add-component',targetId:'screen:dashboard'}];
 let calls=0;
 const changes=await completeComponents(plan,demo.screens.map(s=>s.id),async(change,partial)=>{
  calls++;
  assert.equal(change.action,'add-component');
  assert.equal(partial,null);
  return complete;
 });
 assert.equal(calls,1);
 assert.equal(changes[0].component.kind,'composed');
 const operations=resolveChangeSet(registry,target,changes);
 const result=applyOperations(demo,target,operations,'portal');
 assert.equal(result.definition.screens[0].elements[1].title,'Review Queue Counter');
 assert.equal(validateStrictDemo(result.definition,'portal'),true);
 assert.deepEqual(result.definition.screens[1],demo.screens[1]);
 assert.equal(demo.screens[0].elements.length,1);
});
test('RCA: valid component skips unnecessary AI synthesis',async()=>{
 const changes=await completeComponents([{action:'add-component',targetId:'screen:dashboard',component:complete}],demo.screens.map(s=>s.id),async()=>{throw Error('Should not synthesize');});
 assert.equal(changes[0].component.items.length,3);
});
test('RCA: malformed component is rejected safely even if synthesis returns invalid data',async()=>{
 const change={action:'add-component',targetId:'screen:dashboard',component:{id:'invalid',title:'Bad',items:[{id:'x',kind:'button',label:'Run',actions:[{type:'fetch',url:'https://bank.example.com'}]}]}};
 assert.equal(componentNeedsSynthesis(change,demo.screens.map(s=>s.id)),true);
 await assert.rejects(()=>completeComponents([change],demo.screens.map(s=>s.id),async()=>({component:change.component})),/schema invalid/);
});
test('RCA: technical failure is never turned into another user clarification',()=>{
 const result=technicalFailure('AI component did not pass the clickable-demo component schema.','repair');
 assert.equal(result.planningFailed,true);
 assert.equal(result.needsClarification,undefined);
 assert.equal(result.errorCode,'INVALID_COMPONENT');
 assert.equal(result.canRetry,true);
 assert.match(result.reason,/component definition/);
});
test('RCA: already-answered question is recognized regardless of casing or whitespace',()=>{
 const history=[{question:'How should the new component behave when a user interacts with it?',answer:'Use local demo data and simulated actions'}];
 assert.equal(repeatsClarification(' HOW should the new component behave when a user interacts with it ? ',history),true);
 assert.equal(repeatsClarification('Which screen should it open?',history),false);
});
test('RCA: classify validation failures without logging private component JSON',()=>{
 assert.equal(issueCategory('Target ID screen:unknown was not found'),'INVALID_TARGET');
 assert.equal(issueCategory('Component schema invalid after synthesis'),'INVALID_COMPONENT');
 assert.equal(issueCategory('Output was not valid JSON'),'MODEL_OUTPUT');
});
