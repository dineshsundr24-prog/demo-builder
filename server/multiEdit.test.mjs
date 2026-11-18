import test from 'node:test';
import assert from 'node:assert/strict';
import {planMultiEdit,splitEditInstructions} from './multiEdit.mjs';
import {applyOperations} from './operations.mjs';
import {validateStrictDemo} from './refine.mjs';
const demo={
 schemaVersion:1,id:'icici',name:'ICICI Bank Mobile Onboarding',description:'Demo only',channel:'mobile',theme:'teal',
 screens:[
  {id:'welcome',title:'Welcome',subtitle:'Start',elements:[{id:'hero',kind:'hero',title:'Hello',description:'Welcome'},{id:'start',kind:'actions',buttons:[{id:'begin',label:'Start',nextScreen:'address'}]}]},
  {id:'address',title:'Address Proof',subtitle:'Upload proof',elements:[
   {id:'documents',kind:'form',title:'Address Proof',description:'Sample documents',fields:[
    {id:'document-type',label:'Document Type',type:'select',required:true,options:['Identity','Address']},
    {id:'address-proof',label:'Address Proof Document',type:'file',required:true},
    {id:'document-reference',label:'Document Reference Number',type:'text',required:true}
   ],actionLabel:'Continue',nextScreen:'done'}
  ]},
  {id:'done',title:'Confirmation',subtitle:'Done',elements:[{id:'success',kind:'notice',tone:'success',title:'Done',body:'Complete'}]}
 ]
};
const target={level:'screen',screenId:'address'};
const prompt='On the Address Proof screen, make the following changes:\n1. Rename Document Reference Number to Document ID.\n2. Make Document ID mandatory.\n3. Change the Continue button background colour to ICICI orange (#F58220).\n4. Keep the Document Type dropdown and Address Proof upload unchanged.\n5. Preserve all existing screens and navigation.';
test('Exact ICICI Test 2 request resolves all mutations in one atomic plan',()=>{
 assert.equal(validateStrictDemo(demo,'mobile'),true);
 assert.equal(splitEditInstructions(prompt).length,5);
 const plan=planMultiEdit(demo,target,prompt);
 assert.equal(plan?.status,'resolved',JSON.stringify(plan));
 assert.equal(plan.operations.length,3);
 const next=applyOperations(demo,target,plan.operations,'mobile').definition;
 const form=next.screens[1].elements[0],prior=demo.screens[1].elements[0];
 assert.equal(form.fields[2].label,'Document ID');
 assert.equal(form.fields[2].required,true);
 assert.equal(form.submitAppearance.backgroundColor,'#F58220');
 assert.deepEqual(form.fields.slice(0,2),prior.fields.slice(0,2));
 assert.equal(form.nextScreen,prior.nextScreen);
 assert.deepEqual(next.screens[0],demo.screens[0]);
 assert.deepEqual(next.screens[2],demo.screens[2]);
 assert.equal(prior.fields[2].label,'Document Reference Number');
});
test('Rename alias resolves a follow-up mandatory change to the original field ID',()=>{
 const copy=structuredClone(demo);copy.screens[1].elements[0].fields[2].required=false;
 const plan=planMultiEdit(copy,target,prompt);
 assert.equal(plan?.status,'resolved');
 const next=applyOperations(copy,target,plan.operations,'mobile').definition;
 assert.equal(next.screens[1].elements[0].fields[2].label,'Document ID');
 assert.equal(next.screens[1].elements[0].fields[2].required,true);
});
test('Unsupported fourth mutation fails the entire plan, rather than silently skipping',()=>{
 const ask=prompt.replace('4. Keep the Document Type dropdown and Address Proof upload unchanged.','4. Add a live production banking API integration.');
 const plan=planMultiEdit(demo,target,ask);
 assert.equal(plan?.status,'unresolved');
 assert.match(plan.clause,/banking API integration/);
 assert.equal(demo.screens[1].elements[0].fields[2].label,'Document Reference Number');
});
test('Same planner works with generic control captions and field types',()=>{
 const copy=structuredClone(demo),form=copy.screens[1].elements[0];
 form.actionLabel='Submit Application';form.fields[2].label='Application Reference';
 const ask='On the Address Proof screen, make the following changes:\n1. Rename Application Reference to Application ID.\n2. Make Application ID optional.\n3. Change the Submit Application button background color to blue.\n4. Keep all navigation unchanged.';
 const plan=planMultiEdit(copy,target,ask);
 assert.equal(plan?.status,'resolved',JSON.stringify(plan));
 const next=applyOperations(copy,target,plan.operations,'mobile').definition;
 const f=next.screens[1].elements[0];
 assert.equal(f.fields[2].label,'Application ID');
 assert.equal(f.fields[2].required,false);
 assert.equal(f.submitAppearance.backgroundColor,'#1565C0');
});
