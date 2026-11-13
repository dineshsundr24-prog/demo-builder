import test from 'node:test';
import assert from 'node:assert/strict';
import {applyOperations,deriveFastOperations,locateNode,targetLabel} from './operations.mjs';
const baseline={schemaVersion:1,id:'kapiko',name:'Kapiko Bank Mobile Onboarding',description:'Functional sample',channel:'mobile',theme:'teal',chrome:{brandName:'Kapiko Bank',showBrandIcon:true,showBackButton:true},screens:[
 {id:'welcome',title:'Welcome',subtitle:'Start',elements:[{id:'hero',kind:'hero',title:'Welcome',description:'Welcome to Kapiko Bank'},{id:'action',kind:'actions',buttons:[{id:'start',label:'Get Started',nextScreen:'register'}]}]},
 {id:'register',title:'Registration',subtitle:'Personal details',elements:[{id:'form',kind:'form',title:'Register',fields:[{id:'mobile',label:'Mobile Number',type:'text',required:true}],actionLabel:'Continue',nextScreen:'done'}]},
 {id:'done',title:'Complete',subtitle:'Finished',elements:[{id:'notice',kind:'notice',tone:'success',title:'Completed',body:'All done'}]}
]};
const t=(level,screenId,elementId,childId)=>({level,screenId,elementId,childId});
test('Stable IDs locate complete screen, element, field and buttons',()=>{
 assert.equal(locateNode(baseline,t('screen','register')).node.title,'Registration');
 assert.equal(locateNode(baseline,t('field','register','form','mobile')).node.label,'Mobile Number');
 assert.equal(locateNode(baseline,t('button','welcome','action','start')).node.label,'Get Started');
 assert.match(targetLabel(baseline,t('header','welcome')),/Header/);
});
test('Screen-wide user selection can rename selected screen without collateral changes',()=>{
 const target=t('screen','welcome');
 const r=applyOperations(baseline,target,[{op:'set',target,property:'title',value:'Welcome to Kapiko'}],'mobile');
 assert.equal(r.definition.screens[0].title,'Welcome to Kapiko');
 assert.deepEqual(r.definition.screens[1],baseline.screens[1]);
 assert.equal(r.checks.length>=4,true);
});
test('Field selected: change required and preserve all unrelated fields/screens',()=>{
 const target=t('field','register','form','mobile');
 const r=applyOperations(baseline,target,[{op:'set',target,property:'required',value:false}],'mobile');
 assert.equal(r.definition.screens[1].elements[0].fields[0].required,false);
 assert.deepEqual(baseline.screens[1].elements[0].fields[0].required,true);
 assert.deepEqual(r.definition.screens[0],baseline.screens[0]);
});
test('Header icon hidden only in selected screen; effective renderer resolution verified',()=>{
 const target=t('header','welcome');
 const operations=deriveFastOperations(baseline,target,'Remove wallet icon on this screen');
 const r=applyOperations(baseline,target,operations,'mobile');
 assert.equal(r.definition.screens[0].chrome.showBrandIcon,false);
 assert.equal(r.definition.screens[1].chrome,undefined);
 assert.equal(r.definition.chrome.showBrandIcon,true);
 assert.ok(r.checks.some(x=>/Effective screen header/.test(x)));
});
test('Adding a field is an atomic, validated operation',()=>{
 const target=t('element','register','form');
 const r=applyOperations(baseline,target,[{op:'add-field',target,field:{id:'confirm-mobile',label:'Confirm Mobile Number',type:'text',required:true},afterFieldId:'mobile'}],'mobile');
 assert.deepEqual(r.definition.screens[1].elements[0].fields.map(x=>x.id),['mobile','confirm-mobile']);
 assert.equal(r.definition.screens[1].elements[0].fields[1].required,true);
});
test('Remove selected screen component only',()=>{
 const target=t('element','welcome','hero');
 const r=applyOperations(baseline,target,[{op:'remove-element',target}],'mobile');
 assert.equal(r.definition.screens[0].elements.length,1);
 assert.deepEqual(r.definition.screens[1],baseline.screens[1]);
});
test('Refuse cross-screen edits and element scope escape',()=>{
 const target=t('field','register','form','mobile');
 assert.throws(()=>applyOperations(baseline,target,[{op:'set',target:t('field','done','notice','mobile'),property:'label',value:'Wrong'}],'mobile'),/another screen/);
 assert.throws(()=>applyOperations(baseline,target,[{op:'set',target:t('screen','register'),property:'title',value:'Wrong'}],'mobile'),/escaped/);
});
test('Reject arbitrary style/code properties and unsupported operations',()=>{
 const target=t('element','welcome','hero');
 assert.throws(()=>applyOperations(baseline,target,[{op:'set',target,property:'onClick',value:'alert(1)'}],'mobile'),/not supported/);
 assert.throws(()=>applyOperations(baseline,target,[{op:'run-javascript',target,code:'alert(1)'}],'mobile'),/Unsupported/);
});
test('Reject wrong data types, bad routes and duplicate fields',()=>{
 const header=t('header','welcome');
 assert.throws(()=>applyOperations(baseline,header,[{op:'set',target:header,property:'showBrandIcon',value:'false'}],'mobile'),/boolean/);
 const target=t('button','welcome','action','start');
 assert.throws(()=>applyOperations(baseline,target,[{op:'set',target,property:'nextScreen',value:'missing'}],'mobile'),/does not exist/);
 const form=t('element','register','form');
 assert.throws(()=>applyOperations(baseline,form,[{op:'add-field',target:form,field:{id:'mobile',label:'Duplicate',type:'text'}}],'mobile'),/duplicate/);
});
test('No-ops are refused; original draft is unchanged',()=>{
 const target=t('screen','welcome');
 assert.throws(()=>applyOperations(baseline,target,[{op:'set',target,property:'title',value:'Welcome'}],'mobile'),/did not produce a change/);
 assert.equal(baseline.screens[0].title,'Welcome');
});
