import test from 'node:test';
import assert from 'node:assert/strict';
import {planPortalMenuLink,validNavigationLinks,navigationMenuLinks} from '../src/portalMenuLinks.mjs';
import {applyOperations} from './operations.mjs';
import {validateStrictDemo} from './refine.mjs';
import {verifyEditScope} from '../src/editScope.mjs';
const demo={schemaVersion:1,id:'kapiko',name:'Kapiko Portal',description:'Sample portal',channel:'portal',theme:'navy',screens:[
 {id:'screen_dashboard',title:'Kapiko Bank – Operations Overview',subtitle:'Operations',elements:[{id:'stats',kind:'stats',items:[{id:'count',label:'Total Applications',value:'1248'}]}]},
 {id:'applications',title:'Customer Applications',subtitle:'Customer applications',elements:[{id:'notice',kind:'notice',tone:'info',title:'Applications',body:'Existing'}]},
 {id:'reports',title:'Reports',subtitle:'Reporting',elements:[{id:'existing',kind:'notice',tone:'info',title:'Reports',body:'Keep'}]}
]};
const target={level:'screen',screenId:'screen_dashboard'};
test('RCA: exact instruction creates navigational intent, not a screen content edit',()=>{
 assert.deepEqual(planPortalMenuLink(demo,'Add Dashboard option in the left menu',target.screenId),{label:'Dashboard',screenId:'screen_dashboard'});
 assert.deepEqual(planPortalMenuLink(demo,'Please add a Dashboard menu item to the left navigation.',target.screenId),{label:'Dashboard',screenId:'screen_dashboard'});
 assert.equal(planPortalMenuLink(demo,'Add a Dashboard component to the Overview',target.screenId),null);
});
test('A new Dashboard menu option opens existing screen without duplicating or modifying any screen',()=>{
 const operation={op:'add-menu-link',target,label:'Dashboard',screenId:target.screenId};
 const out=applyOperations(demo,target,[operation],'portal');
 assert.equal(out.changed[0].operation,'add-menu-link');
 assert.equal(out.definition.screens.length,demo.screens.length);
 for(const original of demo.screens)assert.deepEqual(out.definition.screens.find(sc=>sc.id===original.id),original);
 assert.deepEqual(navigationMenuLinks(out.definition),[{id:'nav-dashboard',label:'Dashboard',screenId:'screen_dashboard'}]);
 assert.ok(validateStrictDemo(out.definition,'portal'));
 assert.equal(verifyEditScope(demo,out.definition,target,'screen',[operation]),true);
 assert.ok(out.checks.includes('Requested property/structure changes present'));
});
test('Duplicate navigation requests are rejected; no false success',()=>{
 const op={op:'add-menu-link',target,label:'Dashboard',screenId:target.screenId};
 const withLink=applyOperations(demo,target,[op],'portal').definition;
 assert.deepEqual(planPortalMenuLink(withLink,'Add Dashboard option in the left menu',target.screenId),{label:'Dashboard',screenId:target.screenId});
 assert.throws(()=>applyOperations(withLink,target,[op],'portal'),/already exists/);
 assert.throws(()=>verifyEditScope(demo,demo,target,'screen',[op]),/not added/);
});
test('Menu links reject unknown destinations, duplicate labels and mobile app leakage',()=>{
 const op={op:'add-menu-link',target,label:'Dashboard',screenId:target.screenId};
 const invalid=structuredClone(demo);invalid.navLinks=[{id:'nav-dashboard',label:'Dashboard',screenId:'unknown'}];
 assert.equal(validNavigationLinks(invalid),false);
 invalid.navLinks=[{id:'nav-dashboard',label:'Customer Applications',screenId:'screen_dashboard'}];
 assert.equal(validNavigationLinks(invalid),false);
 const mobile=structuredClone(demo);mobile.channel='mobile';
 assert.throws(()=>applyOperations(mobile,target,[op],'mobile'),/portal/);
 assert.throws(()=>applyOperations(demo,target,[{...op,screenId:'applications'}],'portal'),/selected screen/);
});
test('Existing menu links cannot be modified during unrelated field or component edits',()=>{
 const op={op:'add-menu-link',target,label:'Dashboard',screenId:target.screenId};
 const existing=applyOperations(demo,target,[op],'portal').definition;
 const changed=structuredClone(existing);changed.navLinks[0].label='Something else';
 assert.throws(()=>verifyEditScope(existing,changed,target,'screen',[]),/unrelated navigation/);
});
test('Already visible Dashboard root item is not duplicated',()=>{
 const another=structuredClone(demo);another.screens[0].title='Dashboard';
 assert.deepEqual(planPortalMenuLink(another,'Add Dashboard option in the left menu','screen_dashboard'),{alreadyExists:true,label:'Dashboard',screenId:'screen_dashboard'});
});
