import test from 'node:test';
import assert from 'node:assert/strict';
import {inferredBrand,effectiveChrome,isGlobalRequest,classifyGlobalEdit,applyChromeEdit} from './chrome.mjs';

const demo={schemaVersion:1,id:'onboarding',name:'Kapiko Bank Mobile Customer Onboarding',description:'Prototype',channel:'mobile',theme:'teal',screens:[{id:'welcome',title:'Welcome',subtitle:'Start',elements:[]},{id:'registration',title:'Register',subtitle:'Details',elements:[]},{id:'confirmation',title:'Complete',subtitle:'Done',elements:[]}]};
test('RCA: chrome brand derives from demo/project, never hardcoded Northbank',()=>{
 assert.equal(inferredBrand(demo,'','Kapiko Bank UI'),'Kapiko Bank');
 assert.equal(effectiveChrome(demo).brandName,'Kapiko Bank');
});
test('Real user request is recognized as a global header edit',()=>{
 const instruction='remove that Northbank and icon near to it. update the header as Kopiko Bank keep Back icon. Update to all screens';
 assert.equal(isGlobalRequest(instruction),true);
 const p=classifyGlobalEdit(instruction);
 assert.equal(p.supported,true);
 assert.equal(p.brandName,'Kopiko Bank');
 assert.equal(p.removeBrandIcon,true);
 assert.equal(p.preserveBack,true);
 const result=applyChromeEdit(demo,p);
 assert.deepEqual(result.definition.screens,demo.screens);
 assert.equal(result.definition.chrome.brandName,'Kopiko Bank');
 assert.equal(result.definition.chrome.showBrandIcon,false);
 assert.equal(result.definition.chrome.showBackButton,true);
 assert.equal(demo.chrome,undefined,'previous version not mutated');
});
test('Global header change is visible on every screen through same chrome',()=>{
 const plan=classifyGlobalEdit('Remove bank logo and change the header to Kapiko Bank on all screens.');
 const {definition}=applyChromeEdit(demo,plan);
 assert.equal(definition.chrome.brandName,'Kapiko Bank');
 assert.equal(definition.chrome.showBrandIcon,false);
 assert.deepEqual(definition.screens,demo.screens);
});
test('Other screen and navigation content is preserved by global change',()=>{
 const before=structuredClone(demo);
 const plan=classifyGlobalEdit('Hide brand icon in header across all screens');
 const after=applyChromeEdit(demo,plan).definition;
 assert.deepEqual(after.screens,before.screens);
});
test('Unsupported global instruction returns explicit error rather than success',()=>{
 const request=classifyGlobalEdit('Add extra income fields on all screens.');
 assert.equal(request.supported,false);
 assert.throws(()=>applyChromeEdit(demo,request),/multi-screen/);
});
test('No-op requested chrome update is not counted as successful change',()=>{
 const request=classifyGlobalEdit('Change header to Kapiko Bank on all screens');
 assert.equal(request.supported,true);
 assert.throws(()=>applyChromeEdit(demo,request),/already active/);
});
test('Single screen instruction stays in scoped editor',()=>{
 assert.equal(isGlobalRequest('Change Registration screen required field'),false);
 assert.equal(classifyGlobalEdit('Change Registration screen required field'),null);
});
