import test from 'node:test';
import assert from 'node:assert/strict';
import {makeSnapshot,encodeSnapshot,decodeSnapshot,isViewerPath} from '../src/publish.mjs';
const original={schemaVersion:1,id:'kapiko-demo',name:'Kapiko Bank Onboarding',description:'Demo',channel:'mobile',theme:'teal',chrome:{brandName:'Kapiko Bank',showBrandIcon:false,showBackButton:true},screens:[{id:'welcome',title:'Welcome',subtitle:'Hello',elements:[{id:'welcome-hero',kind:'hero',title:'Welcome',description:'Start a bank account'}]},{id:'registration',title:'Register',subtitle:'Your details',elements:[{id:'register-form',kind:'form',title:'Registration',fields:[{id:'email',label:'Email',type:'email',required:true}],actionLabel:'Continue',nextScreen:'welcome'}]}]};
test('Publish freezes definition independent of later changes and preserves unicode',()=>{
 const demo=structuredClone(original);
 demo.screens[0].elements[0].description='مرحبا — Welcome 😊';
 const snap=makeSnapshot(demo,{version:1,publishedAt:'2026-11-13T08:00:00.000Z',projectName:'Kapiko Bank',company:'Kapiko Bank'});
 demo.screens[0].elements[0].description='Later edit';
 const link=encodeSnapshot(snap);
 const restored=decodeSnapshot(link);
 assert.equal(restored.demo.screens[0].elements[0].description,'مرحبا — Welcome 😊');
 assert.equal(restored.demo.chrome.brandName,'Kapiko Bank');
 assert.equal(restored.version,1);
 assert.equal(restored.company,'Kapiko Bank');
});
test('Portable snapshot contains no project messages, requirements, or editor secrets',()=>{
 const snap=makeSnapshot(original,{version:2,publishedAt:'2026-11-13T08:00:00.000Z',projectName:'Kapiko',company:'Kapiko'});
 const parsed=decodeSnapshot(encodeSnapshot(snap));
 assert.deepEqual(Object.keys(parsed).sort(),['company','demo','projectName','publishedAt','shareVersion','version']);
 assert.equal(JSON.stringify(parsed).includes('DEMO_ACCESS_TOKEN'),false);
});
test('Share viewer routes are unambiguous',()=>{assert.equal(isViewerPath('#/view/ABC'),true);assert.equal(isViewerPath('#/view2/ABC'),false);assert.equal(isViewerPath('#/home'),false);});
test('Invalid, oversized and tampered links fail closed',()=>{
 assert.throws(()=>decodeSnapshot('abc&'),/encoding/);
 assert.throws(()=>decodeSnapshot('a'.repeat(32001)),/oversized/);
 assert.throws(()=>decodeSnapshot(encodeSnapshot({...makeSnapshot(original,{version:1,publishedAt:'2026-11-13T08:00:00.000Z',projectName:'K',company:'K'}),shareVersion:99})),/Unsupported/);
});
test('Large demos are rejected rather than producing misleading broken links',()=>{
 const demo=structuredClone(original);
 demo.screens[0].elements[0].description='x'.repeat(25000);
 assert.throws(()=>encodeSnapshot(makeSnapshot(demo,{version:1,publishedAt:'2026-11-13T08:00:00.000Z',projectName:'K',company:'K'})),/too large/);
});

test('Malformed published definitions and broken screen links are rejected',()=>{
 const bad=structuredClone(original);
 bad.screens[1].elements[0].nextScreen='missing';
 const snap=makeSnapshot(bad,{version:3,publishedAt:'2026-11-13T08:00:00Z',projectName:'K',company:'K'});
 assert.throws(()=>decodeSnapshot(encodeSnapshot(snap)),/Unsupported/);
});
test('Malformed form fields cannot crash shared viewer',()=>{
 const bad=structuredClone(original);
 delete bad.screens[1].elements[0].fields;
 const snap=makeSnapshot(bad,{version:1,publishedAt:'2026-11-13T08:00:00Z',projectName:'K',company:'K'});
 assert.throws(()=>decodeSnapshot(encodeSnapshot(snap)),/Unsupported/);
});
