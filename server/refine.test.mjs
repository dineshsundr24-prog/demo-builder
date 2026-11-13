import test from 'node:test';
import assert from 'node:assert/strict';
import {locateScreen,applyScreenPatch,validateStrictDemo} from './refine.mjs';
const original={schemaVersion:1,id:'kapiko',name:'Kapiko onboarding',description:'Mobile journey',channel:'mobile',theme:'teal',screens:[
 {id:'welcome',title:'Welcome',subtitle:'Start',elements:[{id:'h',kind:'hero',title:'Hello',description:'Welcome to Kapiko'},{id:'a',kind:'actions',buttons:[{id:'go',label:'Start',nextScreen:'registration'}]}]},
 {id:'registration',title:'Registration',subtitle:'Details',elements:[{id:'f',kind:'form',title:'Registration form',fields:[{id:'phone',label:'Phone',type:'text',required:true}],actionLabel:'Continue',nextScreen:'done'}]},
 {id:'done',title:'Done',subtitle:'Complete',elements:[{id:'n',kind:'notice',tone:'success',title:'Done',body:'Complete'}]}
]};
test('Locate exact selected screen',()=>{assert.equal(locateScreen(original,'registration').id,'registration');});
test('Scoped patch changes only selected screen',()=>{
 const updated=structuredClone(original.screens[1]);updated.elements[0].fields.push({id:'confirm',label:'Confirm phone',type:'text',required:true});
 const merged=applyScreenPatch(original,'registration',updated,validateStrictDemo);
 assert.equal(merged.screens[1].elements[0].fields.length,2);
 assert.deepEqual(merged.screens[0],original.screens[0]);
 assert.deepEqual(merged.screens[2],original.screens[2]);
 assert.equal(original.screens[1].elements[0].fields.length,1);
});
test('Patch rejects target screen ID change',()=>{const bad={...structuredClone(original.screens[1]),id:'wrong'};assert.throws(()=>applyScreenPatch(original,'registration',bad,validateStrictDemo),/identity/);});
test('Patch rejects navigation to nonexistent screen',()=>{const bad=structuredClone(original.screens[1]);bad.elements[0].nextScreen='missing';assert.throws(()=>applyScreenPatch(original,'registration',bad,validateStrictDemo),/validation/);});
test('Patch rejects no-op',()=>{assert.throws(()=>applyScreenPatch(original,'registration',structuredClone(original.screens[1]),validateStrictDemo),/no changes/);});
test('Patch rejects invalid field types',()=>{const bad=structuredClone(original.screens[1]);bad.elements[0].fields[0].type='script';assert.throws(()=>applyScreenPatch(original,'registration',bad,validateStrictDemo),/validation/);});
