import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyScreenChromeEdit,applyScreenChromeEdit} from './screenChrome.mjs';
import {resolveScreenChrome,validScreenChrome} from '../src/screenChrome.mjs';
import {locateScreen,validateStrictDemo} from './refine.mjs';
const original={schemaVersion:1,id:'kapiko',name:'Kapiko Bank Mobile Customer Onboarding',description:'Demo',channel:'mobile',theme:'teal',chrome:{brandName:'Kapiko Bank',showBrandIcon:true,showBackButton:true},screens:[
 {id:'welcome',title:'Welcome to Kapiko Bank',subtitle:'Start here',elements:[{id:'w',kind:'hero',title:'Welcome',description:'Start'}]},
 {id:'registration',title:'Create Your Account',subtitle:'Details',elements:[{id:'f',kind:'form',title:'Register',fields:[{id:'mobile',label:'Mobile',type:'text'}],actionLabel:'Continue',nextScreen:'verify'}]},
 {id:'verify',title:'Identity Verification',subtitle:'Verify',elements:[{id:'n',kind:'notice',tone:'info',title:'Verify',body:'Demo'}]}
]};
test('RCA: exact welcome-only wallet instruction selects chrome layer instead of AI content patch',()=>{
 const instruction='In welcome screen, Remove the wallet icon';
 const target=locateScreen(original,'registration',instruction);
 assert.equal(target.id,'welcome');
 const plan=classifyScreenChromeEdit(instruction);
 assert.equal(plan.supported,true);
 assert.equal(plan.showBrandIcon,false);
 const result=applyScreenChromeEdit(original,target.id,plan);
 assert.equal(result.definition.screens[0].chrome.showBrandIcon,false);
 assert.equal(resolveScreenChrome(result.definition,result.definition.screens[0]).showBrandIcon,false);
 assert.equal(resolveScreenChrome(result.definition,result.definition.screens[1]).showBrandIcon,true);
 assert.equal(resolveScreenChrome(result.definition,result.definition.screens[2]).showBrandIcon,true);
 assert.equal(resolveScreenChrome(result.definition,result.definition.screens[0]).showBackButton,true);
 assert.equal(validateStrictDemo(result.definition,'mobile'),true);
 assert.deepEqual(result.definition.screens[0].elements,original.screens[0].elements);
 assert.deepEqual(result.definition.screens.slice(1),original.screens.slice(1));
 assert.deepEqual(result.definition.chrome,original.chrome);
});
test('Per-screen header inherits global icon when no override present',()=>{
 assert.equal(resolveScreenChrome(original,original.screens[0]).showBrandIcon,true);
 assert.equal(resolveScreenChrome(original,original.screens[1]).brandName,'Kapiko Bank');
});
test('A repeated removal is an explicit no-op, not a false success',()=>{
 const once=applyScreenChromeEdit(original,'welcome',classifyScreenChromeEdit('Remove wallet icon')).definition;
 assert.throws(()=>applyScreenChromeEdit(once,'welcome',classifyScreenChromeEdit('Remove wallet icon')),/already hidden/);
});
test('Unrelated screen icon stays hidden when only a different screen icon is restored',()=>{
 const start=structuredClone(original);
 start.chrome.showBrandIcon=false;
 start.screens[0].chrome={showBrandIcon:true};
 const result=applyScreenChromeEdit(start,'registration',classifyScreenChromeEdit('Show wallet icon in registration screen')).definition;
 assert.equal(resolveScreenChrome(result,result.screens[0]).showBrandIcon,true);
 assert.equal(resolveScreenChrome(result,result.screens[1]).showBrandIcon,true);
 assert.equal(resolveScreenChrome(result,result.screens[2]).showBrandIcon,false);
});
test('Invalid chrome fields and types are rejected',()=>{
 assert.equal(validScreenChrome({showBrandIcon:false}),true);
 assert.equal(validScreenChrome({showBrandIcon:'false'}),false);
 assert.equal(validScreenChrome({bogus:true}),false);
 const bad=structuredClone(original);
 bad.screens[0].chrome={showBrandIcon:'false'};
 assert.equal(validateStrictDemo(bad,'mobile'),false);
});
test('Mixed screen and icon requests are rejected instead of silently applying half',()=>{
 const plan=classifyScreenChromeEdit('Remove the wallet icon and add a customer address field');
 assert.equal(plan.supported,false);
});
