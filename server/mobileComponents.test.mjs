import test from 'node:test';
import assert from 'node:assert/strict';
import {mobileTemplateLabels,validMobileNavigation,editNavigationItem} from '../src/mobileComponents.mjs';
import {addVisualComponent,connectVisualFlow,visualFlowActions,visualFlowEdges} from '../src/visualEditor.mjs';
import {validateStrictDemo} from './refine.mjs';
const demo={schemaVersion:1,id:'test-mobile',name:'Sample Bank',description:'Demo',channel:'mobile',theme:'teal',screens:[
 {id:'welcome',title:'Welcome',subtitle:'Start here',elements:[{id:'welcome-banner',kind:'hero',title:'Welcome',description:'Start your journey'}]},
 {id:'profile',title:'Profile',subtitle:'Details',elements:[{id:'details',kind:'notice',tone:'info',title:'Details',body:'Your profile'}]}
]};
test('Every listed mobile template compiles to a valid and independently editable demo component',()=>{
 for(const kind of Object.keys(mobileTemplateLabels)){
  const result=addVisualComponent(demo,'welcome',kind);
  assert.equal(validateStrictDemo(result.definition,'mobile'),true,kind);
  assert.equal(result.definition.screens[0].elements.at(-1).id,result.elementId,kind);
  assert.equal(demo.screens[0].elements.length,1);
 }
});
test('Bottom footer and menu have first-class editable real navigation destinations',()=>{
 for(const kind of ['bottom-nav','mobile-menu']){
  const result=addVisualComponent(demo,'welcome',kind);
  const element=result.definition.screens[0].elements.at(-1);
  assert.equal(element.kind,'navigation');
  assert.equal(validMobileNavigation(element,['welcome','profile']),true);
  const action=visualFlowActions(result.definition,'welcome').find(e=>e.id.startsWith('nav:'));
  assert.ok(action);
  const linked=connectVisualFlow(result.definition,'welcome',action.id,'profile');
  assert.equal(visualFlowEdges(linked).find(e=>e.actionId===action.id).to,'profile');
  assert.equal(validateStrictDemo(linked,'mobile'),true);
  const renamed=editNavigationItem(linked,'welcome',element.id,element.links[0].id,{label:'My Profile'});
  assert.equal(renamed.screens[0].elements.at(-1).links[0].label,'My Profile');
  assert.deepEqual(demo.screens[0].elements[0],linked.screens[0].elements[0]);
  assert.throws(()=>editNavigationItem(linked,'welcome',element.id,element.links[0].id,{screenId:'missing'}),/does not exist/);
 }
});
test('Identity verification examples simulate local responses rather than claim live authentication',()=>{
 for(const kind of ['uaepass-login','uaepass-ekyc','face-verification']){
  const component=addVisualComponent(demo,'welcome',kind).definition.screens[0].elements.at(-1);
  assert.equal(component.kind,'composed');
  const text=JSON.stringify(component);
  assert.match(text,/demo|simulat/i);
  assert.equal(component.items.filter(x=>x.kind==='button').length,1);
  assert.equal(component.items.some(x=>x.kind==='button'&&x.actions.every(a=>a.type==='notice')),true);
  assert.equal(!text.includes('https://'),true);
  assert.equal(!text.includes('live biometric verification successful'),true);
 }
});
test('Portal project cannot accidentally receive first-class mobile navigation',()=>{
 const portal=structuredClone(demo);portal.channel='portal';
 assert.throws(()=>addVisualComponent(portal,'welcome','bottom-nav'),/only for mobile/);
});
