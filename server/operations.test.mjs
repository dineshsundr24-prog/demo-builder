import test from 'node:test';
import assert from 'node:assert/strict';
import {applyOperations,deriveFastOperations,locateNode,targetLabel} from './operations.mjs';
const baseline={schemaVersion:1,id:'kapiko',name:'Kapiko Bank Mobile Onboarding',description:'Functional sample',channel:'mobile',theme:'teal',chrome:{brandName:'Kapiko Bank',showBrandIcon:true,showBackButton:true},screens:[
 {id:'welcome',title:'Welcome',subtitle:'Start',elements:[{id:'hero',kind:'hero',title:'Welcome',description:'Welcome to Kapiko Bank'},{id:'action',kind:'actions',buttons:[{id:'start',label:'Get Started',nextScreen:'register'}]}]},
 {id:'register',title:'Registration',subtitle:'Personal details',elements:[{id:'form',kind:'form',title:'Register',fields:[{id:'mobile',label:'Mobile Number',type:'text',required:true}],actionLabel:'Continue',nextScreen:'done'}]},
 {id:'done',title:'Complete',subtitle:'Finished',elements:[{id:'notice',kind:'notice',tone:'success',title:'Completed',body:'All done'}]}
]};
const t=(level,screenId,elementId,childId)=>({level,screenId,elementId,childId});
test('Stable IDs locate complete screen, element, field and buttons',()=>{
 assert.equal(locateNode(baseline,t('screen','register')).node.title,'Registration');
 assert.equal(locateNode(baseline,t('field','register','form','mobile')).node.label,'Mobile Number');
 assert.equal(locateNode(baseline,t('button','welcome','action','start')).node.label,'Get Started');
 assert.match(targetLabel(baseline,t('header','welcome')),/Header/);
});
test('Screen-wide user selection can rename selected screen without collateral changes',()=>{
 const target=t('screen','welcome');
 const r=applyOperations(baseline,target,[{op:'set',target,property:'title',value:'Welcome to Kapiko'}],'mobile');
 assert.equal(r.definition.screens[0].title,'Welcome to Kapiko');
 assert.deepEqual(r.definition.screens[1],baseline.screens[1]);
 assert.equal(r.checks.length>=4,true);
});
test('Field selected: change required and preserve all unrelated fields/screens',()=>{
 const target=t('field','register','form','mobile');
 const r=applyOperations(baseline,target,[{op:'set',target,property:'required',value:false}],'mobile');
 assert.equal(r.definition.screens[1].elements[0].fields[0].required,false);
 assert.deepEqual(baseline.screens[1].elements[0].fields[0].required,true);
 assert.deepEqual(r.definition.screens[0],baseline.screens[0]);
});
test('Header icon hidden only in selected screen; effective renderer resolution verified',()=>{
 const target=t('header','welcome');
 const operations=deriveFastOperations(baseline,target,'Remove wallet icon on this screen');
 const r=applyOperations(baseline,target,operations,'mobile');
 assert.equal(r.definition.screens[0].chrome.showBrandIcon,false);
 assert.equal(r.definition.screens[1].chrome,undefined);
 assert.equal(r.definition.chrome.showBrandIcon,true);
 assert.ok(r.checks.some(x=>/Effective screen header/.test(x)));
});
test('Adding a field is an atomic, validated operation',()=>{
 const target=t('element','register','form');
 const r=applyOperations(baseline,target,[{op:'add-field',target,field:{id:'confirm-mobile',label:'Confirm Mobile Number',type:'text',required:true},afterFieldId:'mobile'}],'mobile');
 assert.deepEqual(r.definition.screens[1].elements[0].fields.map(x=>x.id),['mobile','confirm-mobile']);
 assert.equal(r.definition.screens[1].elements[0].fields[1].required,true);
});
test('Remove selected screen component only',()=>{
 const target=t('element','welcome','hero');
 const r=applyOperations(baseline,target,[{op:'remove-element',target}],'mobile');
 assert.equal(r.definition.screens[0].elements.length,1);
 assert.deepEqual(r.definition.screens[1],baseline.screens[1]);
});
test('Refuse cross-screen edits and element scope escape',()=>{
 const target=t('field','register','form','mobile');
 assert.throws(()=>applyOperations(baseline,target,[{op:'set',target:t('field','done','notice','mobile'),property:'label',value:'Wrong'}],'mobile'),/another screen/);
 assert.throws(()=>applyOperations(baseline,target,[{op:'set',target:t('screen','register'),property:'title',value:'Wrong'}],'mobile'),/escaped/);
});
test('Reject arbitrary style/code properties and unsupported operations',()=>{
 const target=t('element','welcome','hero');
 assert.throws(()=>applyOperations(baseline,target,[{op:'set',target,property:'onClick',value:'alert(1)'}],'mobile'),/not supported/);
 assert.throws(()=>applyOperations(baseline,target,[{op:'run-javascript',target,code:'alert(1)'}],'mobile'),/Unsupported/);
});
test('Reject wrong data types, bad routes and duplicate fields',()=>{
 const header=t('header','welcome');
 assert.throws(()=>applyOperations(baseline,header,[{op:'set',target:header,property:'showBrandIcon',value:'false'}],'mobile'),/boolean/);
 const target=t('button','welcome','action','start');
 assert.throws(()=>applyOperations(baseline,target,[{op:'set',target,property:'nextScreen',value:'missing'}],'mobile'),/does not exist/);
 const form=t('element','register','form');
 assert.throws(()=>applyOperations(baseline,form,[{op:'add-field',target:form,field:{id:'mobile',label:'Duplicate',type:'text'}}],'mobile'),/already exists/);
});
test('No-ops are refused; original draft is unchanged',()=>{
 const target=t('screen','welcome');
 assert.throws(()=>applyOperations(baseline,target,[{op:'set',target,property:'title',value:'Welcome'}],'mobile'),/did not produce a change/);
 assert.equal(baseline.screens[0].title,'Welcome');
});

test('Screenshot RCA: default screen scope routes Remove wallet icon from header without AI path mismatch',()=>{
 const target=t('screen','welcome');
 const operations=deriveFastOperations(baseline,target,'Remove the wallet icon from the header');
 assert.deepEqual(operations,[{op:'set',target:{level:'header',screenId:'welcome'},property:'showBrandIcon',value:false}]);
 const r=applyOperations(baseline,target,operations,'mobile');
 assert.equal(r.definition.screens[0].chrome.showBrandIcon,false);
 assert.equal(r.definition.chrome.showBrandIcon,true);
 assert.equal(r.definition.screens[1].chrome,undefined);
 assert.ok(r.checks.includes('Effective screen header configuration changed'));
});
test('Screen-scoped AI path header.showBrandIcon normalizes to existing renderer metadata safely',()=>{
 const target=t('screen','welcome');
 const operations=[{op:'set',target,property:'header.showBrandIcon',value:false}];
 const r=applyOperations(baseline,target,operations,'mobile');
 assert.equal(r.definition.screens[0].chrome.showBrandIcon,false);
 assert.deepEqual(r.definition.screens[1],baseline.screens[1]);
});
test('Header path normalization respects selection boundaries and refuses other screen edits',()=>{
 const target=t('screen','welcome');
 assert.throws(()=>applyOperations(baseline,target,[{op:'set',target:{level:'screen',screenId:'register'},property:'header.showBrandIcon',value:false}],'mobile'),/another screen|not supported/);
 assert.throws(()=>applyOperations(baseline,t('element','welcome','hero'),[{op:'set',target:t('element','welcome','hero'),property:'header.showBrandIcon',value:false}],'mobile'),/not supported/);
});
test('Header request on selected form field does not escape selected field scope',()=>{
 const target=t('field','register','form','mobile');
 assert.equal(deriveFastOperations(baseline,target,'Remove wallet icon from the header'),null);
});
test('No change after wallet already removed returns a no-op rather than success',()=>{
 const target=t('screen','welcome');
 const once=applyOperations(baseline,target,deriveFastOperations(baseline,target,'Remove the wallet icon from the header'),'mobile').definition;
 assert.throws(()=>applyOperations(once,target,deriveFastOperations(once,target,'Remove the wallet icon from the header'),'mobile'),/did not produce a change/);
});

test('RCA: Emirates ID and EID Expiry request creates two correctly typed fields',()=>{
 const before=structuredClone(baseline);
 before.screens[1].title='Personal & Income Details';
 before.screens[1].elements[0].fields.unshift({id:'passport',label:'Passport Number',type:'text',required:true});
 const target=t('screen','register');
 const ops=deriveFastOperations(before,target,'ADD EMIRATES ID & EID EXPIRY INPUT BOX');
 assert.equal(ops.length,2);
 const result=applyOperations(before,target,ops,'mobile');
 const fields=result.definition.screens[1].elements[0].fields;
 assert.deepEqual(fields.slice(-2).map(f=>({id:f.id,label:f.label,type:f.type})),[
  {id:'emirates-id',label:'Emirates ID',type:'text'},
  {id:'eid-expiry',label:'EID Expiry',type:'date'}
 ]);
 assert.equal(fields[0].id,'passport');
 assert.deepEqual(result.definition.screens[0],baseline.screens[0]);
 assert.deepEqual(result.definition.screens[2],baseline.screens[2]);
 assert.equal(before.screens[1].elements[0].fields.length,2);
});
test('AI missing field IDs gets stable deterministic IDs from its labels',()=>{
 const target=t('screen','register');
 const result=applyOperations(baseline,target,[
 {op:'add-field',target:{level:'element',screenId:'register',elementId:'form'},field:{label:'Emirates ID',type:'text'}},
 {op:'add-field',target:{level:'element',screenId:'register',elementId:'form'},field:{label:'EID Expiry',type:'date'}}
 ],'mobile');
 assert.deepEqual(result.definition.screens[1].elements[0].fields.slice(-2).map(f=>f.id),['emirates-id','eid-expiry']);
});
test('Semantic duplicate form labels are refused with an actionable error',()=>{
 const target=t('screen','register');
 assert.throws(()=>applyOperations(baseline,target,[{op:'add-field',target:{level:'element',screenId:'register',elementId:'form'},field:{label:' Mobile Number ',type:'text'}}],'mobile'),/already exists in this form/);
});
test('Duplicate stable ID is distinguished from invalid field type',()=>{
 const target=t('screen','register');
 assert.throws(()=>applyOperations(baseline,target,[{op:'add-field',target:{level:'element',screenId:'register',elementId:'form'},field:{id:'mobile',label:'EID',type:'text'}}],'mobile'),/ID "mobile" already exists/);
 assert.throws(()=>applyOperations(baseline,target,[{op:'add-field',target:{level:'element',screenId:'register',elementId:'form'},field:{id:'expiry',label:'EID Expiry',type:'calendar'}}],'mobile'),/Unsupported form field type "calendar"/);
});
test('Already existing Emirates ID field is preserved and only missing EID Expiry is added',()=>{
 const d=structuredClone(baseline);
 d.screens[1].elements[0].fields.push({id:'existing-eid',label:'Emirates ID',type:'text',required:true});
 const target=t('screen','register');
 const operations=deriveFastOperations(d,target,'Add Emirates ID & EID Expiry input boxes');
 assert.equal(operations.length,1);
 assert.equal(operations[0].field.id,'eid-expiry');
 const after=applyOperations(d,target,operations,'mobile').definition;
 assert.equal(after.screens[1].elements[0].fields.find(f=>f.id==='existing-eid').required,true);
});
test('Ambiguous screen containing multiple forms cannot silently add identity fields to a guessed form',()=>{
 const d=structuredClone(baseline);
 d.screens[1].elements.push({id:'second-form',kind:'form',title:'Additional Data',fields:[{id:'a',label:'Another',type:'text'}],actionLabel:'Continue'});
 const target=t('screen','register');
 assert.equal(deriveFastOperations(d,target,'Add Emirates ID & EID Expiry input boxes'),null);
 assert.throws(()=>applyOperations(d,target,[{op:'add-field',target,field:{label:'Emirates ID',type:'text'}}],'mobile'),/Multiple forms are present/);
});


test('Canonical registry: field, form, and header have stable distinct IDs',async()=>{
 const {buildRegistry,compactRegistry}=await import('./registry.mjs');
 const entries=buildRegistry(baseline,t('screen','register'));
 assert.equal(entries.find(e=>e.id==='field:register:form:mobile').label,'Mobile Number');
 assert.deepEqual(entries.find(e=>e.id==='field:register:form:mobile').capabilities,['set','remove-field','move-field']);
 assert.ok(entries.some(e=>e.id==='header:register'));
 assert.ok(entries.some(e=>e.id==='element:register:form'&&e.capabilities.includes('add-field')));
 assert.ok(compactRegistry(entries,t('screen','register')).every(e=>!e.id.includes('welcome')));
});
test('Grounded full change set removes a field and inserts two fields atomically',async()=>{
 const {buildRegistry,resolveChangeSet}=await import('./registry.mjs');
 const d=structuredClone(baseline);
 const form=d.screens[1].elements[0];
 form.fields.push({id:'passport',label:'Passport Number',type:'text'});
 const selected=t('screen','register');
 const registry=buildRegistry(d,selected);
 const changes=[
  {action:'remove-field',targetId:'field:register:form:passport'},
  {action:'add-field',targetId:'element:register:form',field:{label:'Emirates ID',type:'text',required:true}},
  {action:'add-field',targetId:'element:register:form',field:{label:'EID Expiry',type:'date'}}
 ];
 const operations=resolveChangeSet(registry,selected,changes);
 const result=applyOperations(d,selected,operations,'mobile');
 assert.deepEqual(result.definition.screens[1].elements[0].fields.map(f=>f.label),['Mobile Number','Emirates ID','EID Expiry']);
 assert.deepEqual(d.screens[1].elements[0].fields.map(f=>f.label),['Mobile Number','Passport Number']);
 assert.deepEqual(result.definition.screens[0],d.screens[0]);
});
test('Grounded operation rejects invented IDs, capabilities and unrelated screens',async()=>{
 const {buildRegistry,resolveChangeSet}=await import('./registry.mjs');
 const selected=t('screen','register'),r=buildRegistry(baseline,selected);
 assert.throws(()=>resolveChangeSet(r,selected,[{action:'remove-field',targetId:'field:register:form:unknown'}]),/not found/);
 assert.throws(()=>resolveChangeSet(r,selected,[{action:'remove-element',targetId:'field:register:form:mobile'}]),/unsupported/);
 assert.throws(()=>resolveChangeSet(r,selected,[{action:'set',targetId:'screen:welcome',property:'title',value:'Hacked'}]),/another screen/);
});
test('Move field supports anchor and verifies resulting order',async()=>{
 const {buildRegistry,resolveChangeSet}=await import('./registry.mjs');
 const d=structuredClone(baseline),selected=t('screen','register');
 d.screens[1].elements[0].fields.push({id:'passport',label:'Passport Number',type:'text'},{id:'eid',label:'Emirates ID',type:'text'});
 const registry=buildRegistry(d,selected);
 const operations=resolveChangeSet(registry,selected,[{action:'move-field',targetId:'field:register:form:eid',afterFieldId:'__start__'}]);
 const result=applyOperations(d,selected,operations,'mobile');
 assert.equal(result.definition.screens[1].elements[0].fields[0].id,'eid');
 assert.deepEqual(result.definition.screens[0],d.screens[0]);
});
test('Multi-change atomic rollback: one bad action leaves original unchanged',async()=>{
 const {buildRegistry,resolveChangeSet}=await import('./registry.mjs');
 const d=structuredClone(baseline),selected=t('screen','register');
 const r=buildRegistry(d,selected);
 assert.throws(()=>resolveChangeSet(r,selected,[
  {action:'add-field',targetId:'element:register:form',field:{label:'Emirates ID',type:'text'}},
  {action:'remove-field',targetId:'field:register:form:invented'}
 ]),/not found/);
 assert.deepEqual(d,baseline);
});
test('Form selection allows editing its descendant field but forbids escaping its form',async()=>{
 const {buildRegistry,resolveChangeSet}=await import('./registry.mjs');
 const selected=t('element','register','form'),r=buildRegistry(baseline,selected);
 const operations=resolveChangeSet(r,selected,[{action:'set',targetId:'field:register:form:mobile',property:'label',value:'Phone'}]);
 assert.equal(applyOperations(baseline,selected,operations,'mobile').definition.screens[1].elements[0].fields[0].label,'Phone');
 assert.throws(()=>resolveChangeSet(r,selected,[{action:'set',targetId:'screen:register',property:'title',value:'Unsafe'}]),/outside the selected component/);
});


test('AI can add a safe clickable composed component atomically to a selected screen',async()=>{
 const {buildRegistry,resolveChangeSet}=await import('./registry.mjs');
 const {validComposed}=await import('../src/composed.mjs');
 const selected=t('screen','register'),r=buildRegistry(baseline,selected);
 const component={title:'Consent and status',items:[
  {id:'agreement',kind:'checkbox',label:'I agree to the terms',required:true},
  {id:'progress',kind:'progress',label:'Progress',value:50},
  {id:'continue',kind:'button',label:'Continue',nextScreen:'done'}
 ]};
 const operations=resolveChangeSet(r,selected,[{action:'add-component',targetId:'screen:register',component}]);
 const result=applyOperations(baseline,selected,operations,'mobile');
 const newElement=result.definition.screens[1].elements.at(-1);
 assert.equal(newElement.kind,'composed');
 assert.ok(validComposed(newElement,result.definition.screens.map(x=>x.id)));
 assert.deepEqual(result.definition.screens[0],baseline.screens[0]);
 assert.deepEqual(result.definition.screens[2],baseline.screens[2]);
 assert.deepEqual(baseline.screens[1].elements.some(e=>e.kind==='composed'),false);
});
test('AI composed component validation rejects unsafe kinds, invalid links and duplicate IDs',async()=>{
 const {validComposed}=await import('../src/composed.mjs');
 const base={kind:'composed',id:'offer',title:'Offers',items:[{id:'ok',kind:'button',label:'Continue',nextScreen:'done'}]};
 assert.equal(validComposed(base,['done']),true);
 assert.equal(validComposed({...base,items:[{id:'ok',kind:'script',label:'Unsafe'}]},['done']),false);
 assert.equal(validComposed({...base,items:[{id:'ok',kind:'button',label:'Continue',nextScreen:'invented'}]},['done']),false);
 assert.equal(validComposed({...base,items:[base.items[0],base.items[0]]},['done']),false);
});

test('Reorder: move Mobile Number above Email Address using real IDs and preserve other screens',async()=>{
 const {buildRegistry,resolveSimpleFieldReorder}=await import('./registry.mjs');
 const d=structuredClone(baseline);
 d.screens[1].elements[0].fields=[
 {id:'full',label:'Full Name',type:'text'},
 {id:'email',label:'Email Address',type:'email'},
 {id:'mobile',label:'Mobile Number',type:'text'}
 ];
 const selected=t('screen','register'),r=buildRegistry(d,selected);
 const ops=resolveSimpleFieldReorder(r,selected,'On the Registration screen, move the Mobile Number field above Email Address without changing the other fields.');
 assert.equal(ops?.length,1);
 assert.equal(ops[0].afterFieldId,'full');
 const out=applyOperations(d,selected,ops,'mobile').definition;
 assert.deepEqual(out.screens[1].elements[0].fields.map(f=>f.id),['full','mobile','email']);
 assert.deepEqual(out.screens[0],d.screens[0]);
 assert.deepEqual(out.screens[2],d.screens[2]);
});
test('Reorder: AI field anchor label or registry ID is translated into exact sibling field ID',async()=>{
 const {buildRegistry,resolveChangeSet}=await import('./registry.mjs');
 const d=structuredClone(baseline);
 d.screens[1].elements[0].fields=[
 {id:'full',label:'Full Name',type:'text'},
 {id:'email',label:'Email Address',type:'email'},
 {id:'mobile',label:'Mobile Number',type:'text'}
 ];
 const target=t('screen','register'),r=buildRegistry(d,target);
 const edit={action:'move-field',targetId:'field:register:form:mobile',beforeFieldId:'Email Address'};
 const ops=resolveChangeSet(r,target,[edit]);
 assert.equal(ops[0].afterFieldId,'full');
 assert.deepEqual(applyOperations(d,target,ops,'mobile').definition.screens[1].elements[0].fields.map(f=>f.id),['full','mobile','email']);
 const ops2=resolveChangeSet(r,target,[{action:'move-field',targetId:'field:register:form:mobile',afterFieldId:'field:register:form:email'}]);
 assert.equal(ops2[0].afterFieldId,'email');
 assert.throws(()=>resolveChangeSet(r,target,[{action:'move-field',targetId:'field:register:form:mobile',afterFieldId:'Invented ID'}]),/does not match/);
});
