import test from 'node:test';
import assert from 'node:assert/strict';
import {canonicalPlan,plannerContext} from './plannerContract.mjs';
test('Planner recognizes equivalents of user clarification status',()=>{
 for(const status of ['needs_clarification','needs clarification','needs-user-input','clarification_required','ask_user','requires_clarification']){
  const result=canonicalPlan({status,question:'Should this use local mock data?',options:['Yes','No']});
  assert.equal(result.status,'clarify',status);
  assert.equal(result.question,'Should this use local mock data?');
 }
});
test('Planner accepts common nested resolved edit plan shapes',()=>{
 const change={action:'add-component',targetId:'screen:dashboard',component:{id:'a',title:'A',items:[]}};
 for(const response of [{status:'success',changes:[change]},{result:{status:'completed',operations:[change]}},{plan:{status:'resolved',changes:[change]}},{changes:[change]}]){
  const planned=canonicalPlan(response);
  assert.equal(planned.status,'resolved');
  assert.deepEqual(planned.changes,[change]);
 }
});
test('Planner never silently treats unrecognized status as a valid patch',()=>{
 assert.equal(canonicalPlan({status:'forgot_to_implement',changes:[]}).status,'invalid');
 assert.equal(canonicalPlan('bad data').status,'invalid');
});
test('Clarification context remains explicit and is bounded',()=>{
 assert.deepEqual(plannerContext('Add approval',{length:0}),{instruction:'Add approval',clarifications:[]});
 const context=plannerContext('Add approval',[{question:'Choose interaction',answer:'Navigation and simple input only'}]);
 assert.deepEqual(context.clarifications,[{question:'Choose interaction',answer:'Navigation and simple input only'}]);
});
