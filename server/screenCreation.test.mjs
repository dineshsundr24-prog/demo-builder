import test from 'node:test';
import assert from 'node:assert/strict';
import {screenCreationIntent,requestedScreenTitle,compileNewScreen,requestScreenBlueprint} from './screenCreation.mjs';
import {validateStrictDemo} from './refine.mjs';
import {verifyEditScope} from '../src/editScope.mjs';

const base={
 schemaVersion:1,id:'customer-onboarding',name:'Mobile Onboarding',description:'Fictional mobile demo',
 channel:'mobile',theme:'teal',screens:[
  {id:'welcome',title:'Welcome',subtitle:'Get started',elements:[
   {id:'start',kind:'actions',buttons:[{id:'start-btn',label:'Get Started',nextScreen:'details'}]}
  ]},
  {id:'details',title:'Personal Details',subtitle:'Your details',elements:[
   {id:'profile',kind:'form',title:'Personal Details',fields:[{id:'name',label:'Customer Name',type:'text',required:true}],actionLabel:'Continue',nextScreen:'complete'}
  ]},
  {id:'complete',title:'Completed',subtitle:'Confirmation',elements:[
   {id:'success',kind:'notice',tone:'success',title:'Done',body:'Simulated onboarding done.'}
  ]}
 ]};
const blueprint={title:'Document Upload',subtitle:'Provide your documents',kind:'form',description:'Fictional documents only',actionLabel:'Continue',fields:[
 {label:'Document type',type:'select',required:true,options:['Identity','Address']},
 {label:'Document reference',type:'text',required:true,options:[]}
],columns:[]};

test('Generic new screen intent recognizes mobile and portal naming variations',()=>{
 for(const s of ['Add a new Document Upload screen after Personal Details','Create a new screen called Audit History','Generate a page named Identity Details with fields','Build a new onboarding step called Verification'])assert.equal(screenCreationIntent(s),true,s);
 assert.equal(screenCreationIntent('Change the Send OTP button color to orange'),false);
 assert.equal(requestedScreenTitle('Add a new Document Upload screen after Personal Details'),'Document Upload');
 assert.equal(requestedScreenTitle('Create a new screen called Audit History, showing user and status'),'Audit History');
});

test('New mobile screen is inserted in existing journey while preserving the successor and other screens',()=>{
 const request='Add a new Document Upload screen after Personal Details, with document type and reference';
 const out=compileNewScreen(base,{level:'screen',screenId:'details'},request,blueprint);
 assert.equal(out.status,'resolved');
 assert.equal(out.definition.screens.length,4);
 assert.equal(out.definition.screens[2].title,'Document Upload');
 assert.equal(out.definition.screens[1].elements[0].nextScreen,out.createdScreenId);
 assert.equal(out.definition.screens[2].elements[0].nextScreen,'complete');
 assert.deepEqual(out.definition.screens[0],base.screens[0]);
 assert.deepEqual(out.definition.screens[3],base.screens[2]);
 assert.deepEqual(base.screens[1].elements[0].nextScreen,'complete');
 assert.equal(out.definition.screens[2].elements[0].fields.length,2);
 assert.equal(validateStrictDemo(out.definition,'mobile'),true);
 assert.equal(verifyEditScope(base,out.definition,{level:'screen',screenId:'details'},'screen',out.operations),true);
});

test('Mobile screen creates a safe navigation entry if anchor has no outbound action',()=>{
 const info={...blueprint,title:'Review Summary',kind:'information'};
 const out=compileNewScreen(base,{level:'screen',screenId:'complete'},'Create a new screen called Review Summary',info);
 assert.equal(out.definition.screens.length,4);
 const anchor=out.definition.screens.find(s=>s.id==='complete');
 assert.equal(anchor.elements.at(-1).kind,'actions');
 assert.equal(anchor.elements.at(-1).buttons[0].nextScreen,out.createdScreenId);
 assert.deepEqual(out.definition.screens[0],base.screens[0]);
 assert.deepEqual(out.definition.screens[1],base.screens[1]);
});

test('New portal report screen uses the same compiler and remains reachable',()=>{
 const portal=structuredClone(base);portal.channel='portal';portal.theme='navy';
 const spec={...blueprint,kind:'table',title:'Account History',columns:['Customer Name','Status','Date']};
 const out=compileNewScreen(portal,{level:'screen',screenId:'complete'},'Add a new Account History screen',spec);
 assert.equal(out.definition.channel,'portal');
 assert.equal(out.definition.screens.length,4);
 assert.equal(out.definition.screens[3].elements[0].kind,'table');
 assert.equal(out.definition.screens[3].elements[0].rows.length,3);
 assert.equal(out.definition.screens[2].elements.at(-1).buttons[0].nextScreen,out.createdScreenId);
 assert.equal(validateStrictDemo(out.definition,'portal'),true);
});

test('Ambiguous/mismatched anchor and duplicate screen do not change source',()=>{
 const request='Add a new Document Upload screen after Personal Details';
 const out=compileNewScreen(base,{level:'screen',screenId:'welcome'},request,blueprint);
 assert.equal(out.status,'clarify');
 assert.deepEqual(base.screens[0].elements[0].buttons[0].nextScreen,'details');
 assert.throws(()=>compileNewScreen(base,{level:'screen',screenId:'details'},'Create a new screen called Completed',blueprint),/already exists/);
 const long=structuredClone(base);
 while(long.screens.length<12)long.screens.push({id:'x'+long.screens.length,title:'Screen '+long.screens.length,subtitle:'Example',elements:[{id:'m',kind:'notice',tone:'info',title:'Test',body:'Example'}]});
 assert.throws(()=>compileNewScreen(long,{level:'screen',screenId:'details'},'Create a new screen called Other',blueprint),/Maximum 12/);
});

test('Semantic model returns only a screen blueprint, not unrestricted code',async()=>{
 const fetchImpl=async(_url,params)=>{
  const request=JSON.parse(params.body);
  assert.equal(request.text.format.type,'json_schema');
  return {ok:true,json:async()=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(blueprint)}]}]})};
 };
 const out=await requestScreenBlueprint({instruction:'Add a Document Upload screen',project:{name:'Bank Demo',company:'Bank',channel:'mobile'},model:'test-model',apiKey:'test',fetchImpl});
 assert.deepEqual(out,blueprint);
});
