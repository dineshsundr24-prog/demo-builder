import test from 'node:test';
import assert from 'node:assert/strict';
import {configureTableRowAction,effectiveTableAction,selectedRowContext,validTableRowAction} from '../src/tableRowActions.mjs';
import {visualFlowActions,connectVisualFlow,visualFlowEdges} from '../src/visualEditor.mjs';
import {validateStrictDemo} from './refine.mjs';
const definition={schemaVersion:1,id:'kapiko-portal',name:'Kapiko Portal',description:'Test',channel:'portal',theme:'navy',screens:[
 {id:'applications',title:'Customer Applications',subtitle:'Applications',elements:[
  {id:'applications-table',kind:'table',title:'All Applications',columns:[{id:'reference',label:'Application Number'},{id:'customer',label:'Customer Name'},{id:'status',label:'Status'},{id:'action',label:'Action'}],rows:[
   {reference:'APP001',customer:'Ahmed Al Hammadi',status:'Approved',action:'View'},
   {reference:'APP002',customer:'Mariam Saeed',status:'Pending',action:'View'}
  ]}
 ]},
 {id:'view-application',title:'View Application',subtitle:'Detail page',elements:[{id:'instructions',kind:'notice',tone:'info',title:'View Application',body:'Demo page'}]},
 {id:'approval',title:'Approval Queue',subtitle:'Review',elements:[{id:'notice',kind:'notice',tone:'info',title:'Queue',body:'Demo'}]}
]};
test('BA can link View column to an existing page with selected row data',()=>{
 const next=configureTableRowAction(definition,'applications','applications-table','view-application',{label:'View',passRow:true});
 assert.equal(validateStrictDemo(next,'portal'),true);
 const table=next.screens[0].elements[0];
 assert.equal(table.rowAction.screenId,'view-application');
 assert.equal(table.detailScreen,'view-application');
 const first=selectedRowContext('view-application',table,table.rows[0],'applications');
 const second=selectedRowContext('view-application',table,table.rows[1],'applications');
 assert.equal(first.row.customer,'Ahmed Al Hammadi');
 assert.equal(second.row.customer,'Mariam Saeed');
 assert.equal(first.row.action,undefined);
 assert.deepEqual(definition.screens[0].elements[0].rowAction,undefined);
});
test('Flow Designer exposes and updates table actions',()=>{
 const actions=visualFlowActions(definition,'applications');
 assert.equal(actions[0].id,'table:applications-table');
 const linked=connectVisualFlow(definition,'applications',actions[0].id,'view-application');
 assert.equal(visualFlowEdges(linked)[0].to,'view-application');
 assert.equal(validateStrictDemo(linked,'portal'),true);
});
test('Unlink and invalid destination changes fail without modifying existing pages',()=>{
 const linked=configureTableRowAction(definition,'applications','applications-table','view-application');
 assert.throws(()=>configureTableRowAction(linked,'applications','applications-table','missing'),/existing destination/);
 assert.throws(()=>configureTableRowAction(linked,'applications','applications-table','applications'),/different/);
 const cleared=configureTableRowAction(linked,'applications','applications-table','');
 assert.equal(effectiveTableAction(cleared.screens[0].elements[0]),null);
 assert.equal(validateStrictDemo(cleared,'portal'),true);
 assert.equal(linked.screens[0].elements[0].rowAction.screenId,'view-application');
});
test('Generated table supports the same row action contract',()=>{
 const withComposed=structuredClone(definition);
 withComposed.screens[0].elements.push({id:'generated',kind:'composed',title:'Generated report',items:[{id:'results',kind:'table',label:'Records',columns:[{id:'reference',label:'Reference'}],rows:[{reference:'A001'}]}]});
 const linked=configureTableRowAction(withComposed,'applications','generated','view-application',{itemId:'results',label:'Details'});
 assert.equal(validateStrictDemo(linked,'portal'),true);
 const item=linked.screens[0].elements[1].items[0];
 assert.equal(item.rowAction.screenId,'view-application');
 assert.equal(selectedRowContext('view-application',item,item.rows[0],'applications').row.reference,'A001');
 const actions=visualFlowActions(linked,'applications');
 assert.ok(actions.some(a=>a.id==='composed-table:generated:results'));
});
test('Invalid table actions, unknown targets and bogus row types are rejected',()=>{
 const linked=configureTableRowAction(definition,'applications','applications-table','view-application');
 assert.equal(validTableRowAction({...linked.screens[0].elements[0].rowAction,screenId:'bogus'},['view-application']),false);
 assert.throws(()=>configureTableRowAction(definition,'applications','not-table','view-application'),/no longer exists/);
 const noData=configureTableRowAction(definition,'applications','applications-table','view-application',{passRow:false});
 assert.equal(selectedRowContext('view-application',noData.screens[0].elements[0],noData.screens[0].elements[0].rows[0],'applications'),null);
});
