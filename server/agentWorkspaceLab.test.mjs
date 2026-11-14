import test from 'node:test';
import assert from 'node:assert/strict';
import {workspaceFromDemo,moveMenuBefore,addActivitySection,requestApproval,answerApproval,executeApproval,routeLabInstruction} from '../src/agentWorkspaceEngine.mjs';
import {validateStrictDemo} from './refine.mjs';
import {dynamicRows,dynamicCsv,executeDynamicActions} from '../src/componentRuntime.mjs';
const demo={schemaVersion:1,id:'kapiko-poc',name:'Kapiko Portal',description:'Fictional sample',channel:'portal',theme:'navy',
 navLinks:[{id:'nav-service',label:'Service Request',screenId:'apps'}],
 screens:[
 {id:'overview',title:'Kapiko Bank – Operations Overview',subtitle:'Dashboard',elements:[{kind:'stats',id:'kpis',items:[{id:'total',label:'Total Applications',value:'1,248'}]}]},
 {id:'apps',title:'Customer Applications',subtitle:'Applications',elements:[{kind:'notice',id:'n',tone:'info',title:'Current',body:'Keep original'}]},
 {id:'reports',title:'Reports',subtitle:'Reports',elements:[{kind:'notice',id:'r',tone:'info',title:'Report',body:'Preserve'}]}
 ]};
test('POC isolation: original project definition never mutated',()=>{
 const initial=structuredClone(demo);
 const workspace=workspaceFromDemo(demo);
 const after=routeLabInstruction(workspace,'Move Service Request immediately above Reports in the left menu.');
 assert.deepEqual(demo,initial);
 assert.notEqual(after.demo,demo);
 assert.equal(after.lastResult.status,'passed');
});
test('POC navigation reorder: Service Request is immediately above Reports and no other items change',()=>{
 const initial=workspaceFromDemo(demo);
 const updated=moveMenuBefore(initial,'service request','reports');
 const index=updated.menu.findIndex(x=>x.label==='Service Request');
 assert.equal(updated.menu[index+1].label,'Reports');
 assert.equal(updated.menu.length,initial.menu.length);
 assert.deepEqual(updated.menu.map(x=>x.id).sort(),initial.menu.map(x=>x.id).sort());
 assert.deepEqual(updated.demo.screens,initial.demo.screens);
 assert.ok(updated.trace.some(x=>x.tool==='verifyNavigationOrder'));
});
test('POC navigation missing target asks for a specific target, rather than inventing one',()=>{
 const without=structuredClone(demo);without.navLinks=[];
 const result=moveMenuBefore(workspaceFromDemo(without),'service request','reports');
 assert.equal(result.awaiting.kind,'target');
 assert.equal(result.lastResult.status,'clarification');
 assert.deepEqual(result.demo,without);
});
test('POC interactive creation: generated dashboard has exact metrics, search and CSV that actually execute',()=>{
 const initial=workspaceFromDemo(demo);
 const next=addActivitySection(initial);
 const newComponent=next.demo.screens[0].elements.find(e=>e.kind==='composed');
 assert.ok(newComponent);
 const table=newComponent.items.find(i=>i.kind==='table');
 assert.ok(['Login History','Last Activity','Failed Login Attempts'].every(x=>table.columns.some(c=>c.label===x)));
 const matching=dynamicRows(table,{search:'USR-1001'});
 assert.equal(matching.length,1);
 const csv=dynamicCsv(table,{search:'USR-1001'});
 assert.equal(csv.split('\r\n').length,2);
 const button=newComponent.items.find(i=>i.kind==='button');
 assert.deepEqual(executeDynamicActions(newComponent,button,{search:'USR-1001'}).events,[{type:'download-csv',target:table.id}]);
 assert.equal(validateStrictDemo(next.demo,'portal'),true);
 assert.deepEqual(next.demo.screens[1],initial.demo.screens[1]);
 assert.equal(initial.demo.screens[0].elements.length,1);
});
test('POC clarification: exact approval choice is retained, not silently guessed',()=>{
 const initial=workspaceFromDemo(demo);
 const awaiting=requestApproval(initial);
 assert.equal(awaiting.awaiting.kind,'approval');
 assert.equal(awaiting.approval,null);
 const options=awaiting.awaiting.options;
 assert.ok(options.length>=3);
 const resolved=answerApproval(awaiting,options[0]);
 assert.equal(resolved.approval.mode,options[0]);
 assert.equal(resolved.approval.status,'Pending');
 const needsConfirm=executeApproval(resolved,false);
 assert.equal(needsConfirm.approval.status,'Pending');
 assert.equal(needsConfirm.approval.lastAction,'confirmation-required');
 const approved=executeApproval(resolved,true);
 assert.equal(approved.approval.status,'Approved');
 assert.deepEqual(approved.demo,initial.demo);
});
test('POC unsupported prompt safely returns no change and explains scope',()=>{
 const initial=workspaceFromDemo(demo);
 const result=routeLabInstruction(initial,'Transfer AED 1000 to an actual beneficiary.');
 assert.equal(result.lastResult.status,'unsupported');
 assert.deepEqual(result.demo,initial.demo);
});
test('POC no duplicate activity component on repeated execution',()=>{
 const initial=addActivitySection(workspaceFromDemo(demo));
 const again=addActivitySection(initial);
 assert.equal(again.demo.screens[0].elements.filter(e=>e.kind==='composed').length,1);
});
