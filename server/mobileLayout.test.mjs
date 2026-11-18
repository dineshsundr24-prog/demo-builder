import test from 'node:test';
import assert from 'node:assert/strict';
import {effectiveMobilePlacement,layoutMobileScreen,placeMobileElement,validMobilePlacement} from '../src/mobileLayout.mjs';
import {addVisualComponent,visualFlowActions,connectVisualFlow} from '../src/visualEditor.mjs';
import {validateStrictDemo} from './refine.mjs';
const demo={schemaVersion:1,id:'kapiko',name:'Kapiko Bank',description:'Demo',channel:'mobile',theme:'teal',screens:[
 {id:'welcome',title:'Welcome',subtitle:'Welcome',elements:[
  {id:'banner',kind:'hero',title:'Welcome',description:'Demo banking'},
  {id:'existing-menu',kind:'navigation',variant:'menu',title:'Menu',links:[{id:'dashboard',label:'Dashboard'},{id:'profile',label:'Profile'}]},
  {id:'form',kind:'form',title:'Application',fields:[{id:'name',type:'text',label:'Name',required:true}],actionLabel:'Continue'}
 ]},
 {id:'profile',title:'Profile',subtitle:'Profile',elements:[{id:'info',kind:'notice',tone:'info',title:'Account',body:'Demo'}]}
]};
test('Existing saved mobile menu migrates to top-right without data loss or hardcoded project changes',()=>{
 assert.equal(validateStrictDemo(demo,'mobile'),true);
 const regions=layoutMobileScreen(demo.screens[0]);
 assert.deepEqual(regions['header-left'],[]);
 assert.deepEqual(regions['header-right'].map(x=>x.id),['existing-menu']);
 assert.deepEqual(regions.body.map(x=>x.id),['banner','form']);
 assert.equal(effectiveMobilePlacement(demo.screens[0].elements[1]),'header-right');
 assert.equal(demo.screens[0].elements[1].placement,undefined);
});
test('BA can move a menu left, right or into body without changing any unrelated screen or navigation link',()=>{
 let moved=placeMobileElement(demo,'welcome','existing-menu','header-left');
 assert.deepEqual(layoutMobileScreen(moved.screens[0])['header-left'].map(x=>x.id),['existing-menu']);
 assert.deepEqual(layoutMobileScreen(moved.screens[0]).body.map(x=>x.id),['banner','form']);
 assert.deepEqual(moved.screens[1],demo.screens[1]);
 moved=placeMobileElement(moved,'welcome','existing-menu','header-right');
 assert.deepEqual(layoutMobileScreen(moved.screens[0])['header-right'].map(x=>x.id),['existing-menu']);
 moved=placeMobileElement(moved,'welcome','existing-menu','body');
 assert.deepEqual(layoutMobileScreen(moved.screens[0]).body.map(x=>x.id),['banner','existing-menu','form']);
 assert.equal(validateStrictDemo(moved,'mobile'),true);
 assert.equal(demo.screens[0].elements[1].placement,undefined);
});
test('Footer is structurally bottom navigation and cannot be dragged into mobile top header',()=>{
 const result=addVisualComponent(demo,'welcome','bottom-nav');
 const footer=result.definition.screens[0].elements.find(x=>x.id===result.elementId);
 assert.equal(effectiveMobilePlacement(footer),'bottom');
 assert.deepEqual(layoutMobileScreen(result.definition.screens[0]).bottom.map(x=>x.id),[result.elementId]);
 assert.throws(()=>placeMobileElement(result.definition,'welcome',result.elementId,'header-left'),/supported area/);
 assert.equal(validateStrictDemo(result.definition,'mobile'),true);
});
test('Invalid placement, header collisions and non-navigation header drops are rejected safely',()=>{
 assert.throws(()=>placeMobileElement(demo,'welcome','banner','header-right'),/content area/);
 assert.throws(()=>placeMobileElement(demo,'welcome','existing-menu','top'),/Invalid/);
 assert.equal(validMobilePlacement({...demo.screens[0].elements[1],placement:'bottom'}),false);
 const withSecond=addVisualComponent(demo,'welcome','mobile-menu');
 const second=withSecond.definition.screens[0].elements.find(x=>x.id===withSecond.elementId);
 assert.equal(second.placement,'body');
 assert.throws(()=>placeMobileElement(withSecond.definition,'welcome',second.id,'header-right'),/already contains/);
});
test('Published and Design use the same definition for menu routing after repositioning',()=>{
 const moved=placeMobileElement(demo,'welcome','existing-menu','header-left');
 const connected=connectVisualFlow(moved,'welcome','nav:existing-menu:dashboard','profile');
 assert.equal(connected.screens[0].elements[1].links[0].screenId,'profile');
 assert.equal(visualFlowActions(connected,'welcome').find(x=>x.id==='nav:existing-menu:dashboard').screenId,'profile');
 assert.equal(layoutMobileScreen(connected.screens[0])['header-left'][0].links[0].screenId,'profile');
 assert.equal(validateStrictDemo(connected,'mobile'),true);
});
