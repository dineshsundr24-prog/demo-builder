import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyEditScope} from '../src/editScope.mjs';
const original={schemaVersion:1,id:'portal',name:'Portal',channel:'portal',screens:[{id:'dashboard',title:'Dashboard',elements:[]},{id:'reports',title:'Reports',elements:[]},{id:'user-reports',parentScreenId:'reports',title:'User Reports',elements:[]}]};
const selected={level:'screen',screenId:'user-reports'};
test('Selected screen can gain report controls without false collateral-change rejection',()=>{
 const next=structuredClone(original);next.screens[2].elements.push({id:'table',kind:'table',tools:{search:true,filter:true,download:true}});
 assert.equal(verifyEditScope(original,next,selected,'screen'),true);
});
test('Unrelated screens may not change while User Reports is selected',()=>{
 const next=structuredClone(original);next.screens[0].title='Changed';next.screens[2].title='User Report Updated';
 assert.throws(()=>verifyEditScope(original,next,selected,'screen'),/unrelated screen/);
});
test('Edit operation cannot change global chrome or add an unapproved screen',()=>{
 const next=structuredClone(original);next.chrome={brandName:'Wrong'};next.screens[2].title='Updated';
 assert.throws(()=>verifyEditScope(original,next,selected,'screen'),/Application-wide header/);
 const created=structuredClone(original);created.screens.push({id:'extra',title:'Extra',parentScreenId:'reports',elements:[]});
 assert.throws(()=>verifyEditScope(original,created,selected,'screen'),/Unexpected screen count/);
});
test('Creating an approved child subsection preserves existing parent and sibling screens',()=>{
 const next=structuredClone(original);next.screens.push({id:'report-history',title:'History',parentScreenId:'reports',elements:[]});
 const parent={level:'screen',screenId:'reports'};
 assert.equal(verifyEditScope(original,next,parent,'screen',[{op:'add-subsection',target:parent,title:'History'}]),true);
 next.screens[0].title='Bad collateral change';
 assert.throws(()=>verifyEditScope(original,next,parent,'screen',[{op:'add-subsection',target:parent,title:'History'}]),/unrelated screen/);
});
test('Global chrome updates cannot change screen content',()=>{
 const next=structuredClone(original);next.chrome={brandName:'Kapiko'};
 assert.equal(verifyEditScope(original,next,selected,'global'),true);
 next.screens[2].title='Unexpected';
 assert.throws(()=>verifyEditScope(original,next,selected,'global'),/unrelated screen/);
});
