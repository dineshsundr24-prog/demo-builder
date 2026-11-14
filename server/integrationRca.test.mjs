import test from 'node:test';
import assert from 'node:assert/strict';
import {externalDataDecision,externalDataGuard} from './integrationPreflight.mjs';
import {componentValidationIssues,normalizeComponent,completeComponents} from './editRecovery.mjs';
import {validComposed} from '../src/composed.mjs';
const prompt='Create a User Activity Dashboard showing login history, last activity, and failed login attempts. The information should come from our existing banking system. Build this as an interactive demo.';
test('Real incident: external banking source requires business clarification before planning',()=>{
 const decision=externalDataDecision(prompt);
 assert.equal(decision.mode,'clarify');
 assert.match(decision.question,/existing banking system/);
 const response=externalDataGuard(prompt);
 assert.equal(response.needsClarification,true);
 assert.equal(response.options.length,2);
});
test('Real incident: answering with mock data resumes the original request without another question',()=>{
 const answered=[{question:'This demo does not have a connection to your existing banking system. Which data behavior should I use?',answer:'Use fictional local demo data and simulated interactions'}];
 assert.equal(externalDataGuard(prompt,answered),null);
 assert.equal(externalDataDecision(prompt,answered).mode,'demo');
});
test('Real incident: integration placeholder stays clearly disconnected',()=>{
 const answered=[{question:'Which data?',answer:'Create an integration placeholder without connecting to a live system'}];
 assert.equal(externalDataGuard(prompt,answered),null);
 assert.equal(externalDataDecision(prompt,answered).mode,'placeholder');
});
test('Existing demo-only requirement without data-source request does not trigger preflight',()=>{
 assert.equal(externalDataGuard('Add a searchable user table with sample login history'),null);
});
test('Component validation returns exact paths and not sensitive cell data',()=>{
 const candidate={id:'activity',title:'User Activity',items:[
  {id:'history',kind:'table',label:'Login History',columns:[{id:'login',label:'Login'}],rows:[{login:12345}],filterColumn:'missing'},
  {id:'download',kind:'button',label:'Download CSV',actions:[{type:'download-csv',target:'missing-table'}]}
 ]};
 const errors=componentValidationIssues(candidate,['dashboard']);
 assert.ok(errors.some(e=>e.startsWith('items[0].filterColumn:')));
 assert.ok(errors.some(e=>e.startsWith('items[1].actions[0].target:')));
 assert.equal(JSON.stringify(errors).includes('12345'),false);
});
test('Validator-guided retry can recover a generated data dashboard',async()=>{
 const incomplete={id:'activity',title:'User Activity',items:[{id:'table',kind:'table',label:'Login History',columns:[{id:'name',label:'Name'}],rows:[{name:123}],filterField:'unknown-input'}]};
 const good={id:'activity',title:'User Activity',items:[
 {id:'search',kind:'input',label:'Search login history'},
 {id:'table',kind:'table',label:'Login History',columns:[{id:'user',label:'User'},{id:'lastActivity',label:'Last Activity'},{id:'failedAttempts',label:'Failed Attempts'}],rows:[{user:'USR-1',lastActivity:'2026-11-14 10:20',failedAttempts:'2'}],filterField:'search'}
 ]};
 let count=0;
 const changes=await completeComponents([{action:'add-component',targetId:'screen:dashboard',component:incomplete}],['dashboard'],async()=>{
  count++;return good;
 });
 assert.equal(count,1);
 assert.equal(validComposed(changes[0].component,['dashboard']),true);
 assert.equal(changes[0].component.items[1].rows[0].failedAttempts,'2');
});

test('Dashboard counts and numeric action values are normalized without changing actions or screen targets',()=>{
 const input={id:'activity',title:'User Activity',items:[
  {id:'history',kind:'table',label:'Login History',columns:[{id:'user',label:'User'},{id:'failed',label:'Failed Attempts'}],rows:[{user:'TEST-1',failed:3}]},
  {id:'counter',kind:'input',label:'Counter'},
  {id:'reset',kind:'button',label:'Reset',actions:[{type:'set',target:'counter',value:0}]}
 ]};
 const output=normalizeComponent(input);
 assert.equal(output.items[0].rows[0].failed,'3');
 assert.equal(output.items[2].actions[0].value,'0');
 assert.equal(output.items[2].actions[0].target,'counter');
 assert.equal(input.items[0].rows[0].failed,3);
 assert.equal(validComposed(output,['dashboard']),true);
});
