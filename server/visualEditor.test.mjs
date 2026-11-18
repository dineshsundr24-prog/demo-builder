import test from 'node:test';
import assert from 'node:assert/strict';
import {validateStrictDemo} from './refine.mjs';
import {addVisualScreen,addVisualComponent,moveVisualComponent,editVisualComponent,setVisualAppearance,addVisualField,editVisualField,moveVisualField,connectVisualFlow,visualFlowActions,visualFlowEdges,removeVisualComponent} from '../src/visualEditor.mjs';
const demo={schemaVersion:1,id:'bank',name:'Bank Mobile',description:'Demo',channel:'mobile',theme:'teal',screens:[
 {id:'start',title:'Welcome',subtitle:'Start here',elements:[{id:'actions',kind:'actions',buttons:[{id:'begin',label:'Get Started',nextScreen:'details'}]}]},
 {id:'details',title:'Customer Details',subtitle:'Enter information',elements:[{id:'form',kind:'form',title:'Details',fields:[{id:'name',label:'Name',type:'text',required:true}],actionLabel:'Continue',nextScreen:'done'}]},
 {id:'done',title:'Finished',subtitle:'Complete',elements:[{id:'notice',kind:'notice',tone:'success',title:'Done',body:'Success'}]}
]};
test('Visual screen creation preserves all old screens and creates a valid new page',()=>{
 const x=addVisualScreen(demo,'Address Proof','details');
 assert.equal(x.definition.screens.length,4);
 assert.equal(x.definition.screens[2].title,'Address Proof');
 assert.equal(validateStrictDemo(x.definition,'mobile'),true);
 assert.deepEqual(x.definition.screens[0],demo.screens[0]);
 assert.deepEqual(x.definition.screens[1],demo.screens[1]);
 assert.deepEqual(x.definition.screens[3],demo.screens[2]);
});
test('Drag reorder and add library components preserve underlying element identity and navigation',()=>{
 let x=addVisualComponent(demo,'details','hero');
 assert.equal(validateStrictDemo(x.definition,'mobile'),true);
 const id=x.elementId;
 x.definition=moveVisualComponent(x.definition,'details',id,0);
 assert.equal(x.definition.screens[1].elements[0].id,id);
 assert.equal(x.definition.screens[1].elements[1].nextScreen,'done');
 x.definition=editVisualComponent(x.definition,'details',id,{title:'New hero'});
 x.definition=setVisualAppearance(x.definition,'details',id,{backgroundColor:'#F58220'});
 assert.equal(x.definition.screens[1].elements[0].appearance.backgroundColor,'#F58220');
 assert.equal(validateStrictDemo(x.definition,'mobile'),true);
 assert.deepEqual(demo.screens[1].elements[0].fields[0].label,'Name');
});
test('Form fields can be added, changed and reordered without AI, including file selection',()=>{
 const x=addVisualField(demo,'details','form','file');
 const fieldId=x.fieldId;
 let next=editVisualField(x.definition,'details','form',fieldId,{label:'Address Proof',required:true});
 next=moveVisualField(next,'details','form',fieldId,0);
 assert.equal(next.screens[1].elements[0].fields[0].label,'Address Proof');
 assert.equal(next.screens[1].elements[0].fields[0].type,'file');
 assert.equal(next.screens[1].elements[0].nextScreen,'done');
 assert.equal(validateStrictDemo(next,'mobile'),true);
});
test('Flow connections modify actual preview navigation rather than separate graph data',()=>{
 assert.equal(visualFlowActions(demo,'details')[0].screenId,'done');
 let next=connectVisualFlow(demo,'start','button:actions:begin','done');
 assert.equal(next.screens[0].elements[0].buttons[0].nextScreen,'done');
 next=connectVisualFlow(next,'details','form:form','start');
 assert.equal(next.screens[1].elements[0].nextScreen,'start');
 assert.equal(visualFlowEdges(next).find(e=>e.from==='details').to,'start');
 assert.equal(validateStrictDemo(next,'mobile'),true);
 assert.equal(demo.screens[1].elements[0].nextScreen,'done');
});
test('Invalid destinations, bad colors and unsupported components fail closed',()=>{
 assert.throws(()=>connectVisualFlow(demo,'start','button:actions:begin','invented'),/does not exist/);
 assert.throws(()=>setVisualAppearance(demo,'details','form',{backgroundColor:'url(javascript:alert(1))'}),/Invalid color/);
 assert.throws(()=>addVisualComponent(demo,'details','unknown'),/Unsupported component/);
 const modified=removeVisualComponent(demo,'start','actions');
 assert.equal(validateStrictDemo(modified,'mobile'),true);
 assert.deepEqual(demo.screens[0].elements[0].id,'actions');
});
test('The same visual engine works for portal project definitions',()=>{
 const portal=structuredClone(demo);portal.channel='portal';portal.theme='navy';
 const added=addVisualScreen(portal,'Operations Report','details');
 const built=addVisualComponent(added.definition,added.screenId,'table');
 assert.equal(validateStrictDemo(built.definition,'portal'),true);
});


test('Direct canvas drop inserts library components before a hovered section',async()=>{
 const {insertVisualComponent,moveVisualComponentBefore}=await import('../src/visualEditor.mjs');
 const inserted=insertVisualComponent(demo,'details','hero','form');
 const ids=inserted.definition.screens[1].elements.map(e=>e.id);
 assert.equal(ids[0],inserted.elementId);
 assert.equal(ids[1],'form');
 const another=insertVisualComponent(inserted.definition,'details','notice');
 const reordered=moveVisualComponentBefore(another.definition,'details',another.elementId,'form');
 assert.deepEqual(reordered.screens[1].elements.map(e=>e.id),[inserted.elementId,another.elementId,'form']);
 assert.equal(validateStrictDemo(reordered,'mobile'),true);
 assert.equal(demo.screens[1].elements[0].id,'form');
});
test('Direct canvas removal of a button or form submit updates actual render state safely',async()=>{
 const {removeVisualButton,setVisualSubmitVisibility,visualFlowActions}=await import('../src/visualEditor.mjs');
 const removed=removeVisualButton(demo,'start','actions','begin');
 assert.equal(removed.screens[0].elements.length,0);
 assert.equal(validateStrictDemo(removed,'mobile'),true);
 const hidden=setVisualSubmitVisibility(demo,'details','form',false);
 assert.equal(hidden.screens[1].elements[0].hideSubmit,true);
 assert.equal(visualFlowActions(hidden,'details').length,0);
 assert.equal(validateStrictDemo(hidden,'mobile'),true);
 const restored=setVisualSubmitVisibility(hidden,'details','form',true);
 assert.equal(visualFlowActions(restored,'details').length,1);
 assert.equal(demo.screens[1].elements[0].hideSubmit,undefined);
});
test('Direct drag move and remove of a nested form field affect only the selected form',async()=>{
 const {addVisualField,moveVisualField,removeVisualField}=await import('../src/visualEditor.mjs');
 const added=addVisualField(demo,'details','form','email');
 const before=added.definition.screens[1].elements[0];
 const moved=moveVisualField(added.definition,'details','form',added.fieldId,0);
 assert.equal(moved.screens[1].elements[0].fields[0].id,added.fieldId);
 const reduced=removeVisualField(moved,'details','form','name');
 assert.equal(reduced.screens[1].elements[0].fields.length,1);
 assert.equal(validateStrictDemo(reduced,'mobile'),true);
 assert.equal(before.fields.length,2);
 assert.equal(demo.screens[1].elements[0].fields.length,1);
});
