import test from 'node:test';
import assert from 'node:assert/strict';
import {applyOperations} from './operations.mjs';
import {validateStrictDemo} from './refine.mjs';
import {planPortalSubsection,portalNavigationRoots,portalChildren} from './portalNavigation.mjs';
const portal={schemaVersion:1,id:'kapiko-portal',name:'Kapiko Staff Portal',description:'Staff reports',channel:'portal',theme:'navy',screens:[
{id:'overview',title:'Dashboard',subtitle:'Overview',elements:[{id:'a',kind:'notice',tone:'info',title:'Operations',body:'Summary'}]},
{id:'reports',title:'Reports',subtitle:'Reporting',elements:[{id:'b',kind:'stats',items:[{id:'total',label:'Applications',value:'100'}]}]},
{id:'other',title:'Approvals',subtitle:'Approvals',elements:[{id:'c',kind:'notice',tone:'info',title:'Approvals',body:'Review'}]}
]};
test('Report subsection instruction resolves parent and requested child label without AI tokens',()=>{
 assert.deepEqual(planPortalSubsection(portal,'On the left menu, add a User report section under Reports'),{parentScreenId:'reports',title:'User report'});
 assert.deepEqual(planPortalSubsection(portal,'add a subsection called User Reports under Reports'),{parentScreenId:'reports',title:'User Reports'});
});
test('Generic add subsection under report uses the previously identified User Reports concept',()=>{
 assert.deepEqual(planPortalSubsection(portal,'on left menu, add a subsection under report'),{parentScreenId:'reports',title:'User Reports'});
});
test('Create clickable nested navigation screen and preserve all previous screens',()=>{
 const target={level:'screen',screenId:'reports'};
 const result=applyOperations(portal,target,[{op:'add-subsection',target,title:'User Reports'}],'portal');
 const d=result.definition;
 const child=d.screens.find(s=>s.parentScreenId==='reports');
 assert.equal(child.title,'User Reports');
 assert.equal(child.elements[0].kind,'notice');
 assert.ok(d.screens.some(s=>s.id===child.id));
 assert.ok(validateStrictDemo(d,'portal'));
 for(const original of portal.screens)assert.deepEqual(d.screens.find(s=>s.id===original.id),original);
 assert.equal(portalChildren(d.screens,'reports').length,1);
 assert.equal(portalNavigationRoots(d.screens).length,3);
 assert.equal(result.preservedScreens,2);
});
test('Reject duplicate child labels and invalid or cross-channel nesting',()=>{
 const target={level:'screen',screenId:'reports'};
 const first=applyOperations(portal,target,[{op:'add-subsection',target,title:'User Reports'}],'portal').definition;
 assert.throws(()=>applyOperations(first,target,[{op:'add-subsection',target,title:'User Reports'}],'portal'),/already exists/);
 const mobile=structuredClone(portal);mobile.channel='mobile';
 assert.throws(()=>applyOperations(mobile,target,[{op:'add-subsection',target,title:'User Reports'}],'mobile'),/portal/);
 const child=first.screens.find(s=>s.parentScreenId==='reports');
 assert.throws(()=>applyOperations(first,{level:'screen',screenId:child.id},[{op:'add-subsection',target:{level:'screen',screenId:child.id},title:'Nested Again'}],'portal'),/Nested subsections/);
});
test('Reject cycles and unknown parents in nested portal schema',()=>{
 const invalid=structuredClone(portal);
 invalid.screens[1].parentScreenId='unknown';
 assert.equal(validateStrictDemo(invalid,'portal'),false);
 invalid.screens[1].parentScreenId='reports';
 assert.equal(validateStrictDemo(invalid,'portal'),false);
});
