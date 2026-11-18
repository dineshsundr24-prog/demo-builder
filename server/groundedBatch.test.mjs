import test from 'node:test';
import assert from 'node:assert/strict';
import {numberedRequirements,validateGroundedBatch,planGroundedBatch} from './groundedBatch.mjs';
import {validateStrictDemo} from './refine.mjs';
const definition={
 schemaVersion:1,id:'sample-app',name:'Example Mobile Bank',description:'Demo',channel:'mobile',theme:'teal',screens:[
  {id:'start',title:'Welcome',subtitle:'Start',elements:[{id:'start-actions',kind:'actions',buttons:[{id:'go',label:'Start',nextScreen:'address'}]}]},
  {id:'address',title:'Address Proof',subtitle:'Documents',elements:[{id:'form',kind:'form',title:'Address Proof',description:'Test only',fields:[
   {id:'type',label:'Document Type',type:'select',required:true,options:['Address','Other']},
   {id:'file',label:'Address Proof Document',type:'file',required:true},
   {id:'reference',label:'Document Reference Number',type:'text',required:true}
  ],actionLabel:'Continue',nextScreen:'done'}]},
  {id:'done',title:'Finished',subtitle:'Success',elements:[{id:'message',kind:'notice',tone:'success',title:'Done',body:'Complete'}]}
 ]};
const selection={level:'screen',screenId:'address'};
const prompt='On the Address Proof screen, make the following changes:\n1. Rename Document Reference Number to Document ID.\n2. Make Document ID mandatory.\n3. Change the Continue button background colour to ICICI orange (#F58220).\n4. Keep Document Type and Address Proof upload unchanged.\n5. Preserve all existing screens and navigation.';
const plan={
 status:'resolved',
 changes:[
  {requirementId:1,action:'set',targetId:'field:address:form:reference',property:'label',value:'Document ID'},
  {requirementId:3,action:'set-style',targetId:'button:address:form:__submit__',property:'backgroundColor',value:'#F58220'}
 ],
 satisfied:[{requirementId:2,targetId:'field:address:form:reference',property:'required',value:true}]
};
test('Grounded semantic batch counts every actionable requirement, preserves unaffected controls',()=>{
 assert.equal(validateStrictDemo(definition,'mobile'),true);
 const r=validateGroundedBatch(definition,selection,numberedRequirements(prompt),plan);
 const next=r.definition,s=next.screens[1].elements[0],old=definition.screens[1].elements[0];
 assert.equal(r.edits,2);assert.equal(r.requirements,3);
 assert.equal(s.fields[2].label,'Document ID');
 assert.equal(s.fields[2].required,true);
 assert.equal(s.submitAppearance.backgroundColor,'#F58220');
 assert.deepEqual(s.fields.slice(0,2),old.fields.slice(0,2));
 assert.deepEqual(s.nextScreen,old.nextScreen);
 assert.deepEqual(next.screens[0],definition.screens[0]);
 assert.deepEqual(next.screens[2],definition.screens[2]);
 assert.equal(old.fields[2].label,'Document Reference Number');
});
test('Different wording is accepted by same grounded semantic contract, no phrase-specific parser',()=>{
 const alt='Please adjust this screen:\n1. Call Document Reference Number "Document ID".\n2. Ensure Document ID is compulsory.\n3. Paint Continue with #F58220.\n4. Leave other fields untouched.';
 const result=validateGroundedBatch(definition,selection,numberedRequirements(alt),plan);
 assert.equal(result.definition.screens[1].elements[0].fields[2].label,'Document ID');
});
test('Model cannot quietly omit a requested change or mutate preservation-only clauses',()=>{
 const req=numberedRequirements(prompt);
 assert.throws(()=>validateGroundedBatch(definition,selection,req,{...plan,changes:plan.changes.slice(0,1)}),/omitted requirement 3/);
 const invalid={...plan,changes:[...plan.changes,{requirementId:4,action:'set',targetId:'field:address:form:type',property:'label',value:'Changed'}]};
 assert.throws(()=>validateGroundedBatch(definition,selection,req,invalid),/preservation-only/);
 assert.deepEqual(definition.screens[1].elements[0].fields[2].label,'Document Reference Number');
});
test('Untrue already-satisfied claim fails safely rather than claiming success',()=>{
 const req=numberedRequirements(prompt);
 const invalid={...plan,satisfied:[{requirementId:2,targetId:'field:address:form:reference',property:'required',value:false}]};
 assert.throws(()=>validateGroundedBatch(definition,selection,req,invalid),/not true/);
});
test('Incorrect ID and unsupported property are rejected without mutating the draft',()=>{
 const req=numberedRequirements(prompt);
 assert.throws(()=>validateGroundedBatch(definition,selection,req,{...plan,changes:[{...plan.changes[0],targetId:'field:address:form:invented'},plan.changes[1]]}),/registry/);
 assert.throws(()=>validateGroundedBatch(definition,selection,req,{...plan,changes:[{...plan.changes[0],property:'secretProperty'},plan.changes[1]]}),/not supported/);
});
test('Semantic batch planner executes model-produced changes through same inventory',async()=>{
 const fetchImpl=async(_url,params)=>{
  const input=JSON.parse(params.body);
  assert.equal(input.text.format.type,'json_object');
  const context=JSON.parse(input.input);
  assert.equal(context.requirements.length,5);
  assert.ok(context.candidates.some(e=>e.id==='field:address:form:reference'));
  assert.ok(context.candidates.some(e=>e.id==='button:address:form:__submit__'));
  return{ok:true,json:async()=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(plan)}]}]})};
 };
 const result=await planGroundedBatch({demo:definition,selection,instruction:prompt,model:'test',apiKey:'test',fetchImpl});
 assert.equal(result.status,'resolved',JSON.stringify(result));
 assert.equal(result.definition.screens[1].elements[0].submitAppearance.backgroundColor,'#F58220');
});
test('Semantic planner blocks unsupported or incomplete responses, never asks to replace a component',async()=>{
 const fetchImpl=async()=>({ok:true,json:async()=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({status:'blocked',reason:'Unsupported live banking integration',requirementId:3})}]}]})});
 const result=await planGroundedBatch({demo:definition,selection,instruction:prompt,model:'test',apiKey:'test',fetchImpl});
 assert.equal(result.status,'blocked');
 assert.match(result.reason,/Requirement 3/);
 assert.doesNotMatch(result.reason,/replace.*component/i);
});
