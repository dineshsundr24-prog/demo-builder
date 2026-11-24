import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeGeneratedDemo,explainGeneratedDemo,generationClarification,generationFailure,MAX_GENERATED_SCREENS} from './generationContract.mjs';
const generated={schemaVersion:1,id:'kapiko-portal',name:'Kapiko Bank Staff Portal',description:'Banking staff workflow',channel:'portal',theme:'navy',screens:[
{id:'dashboard',title:'Dashboard',subtitle:'Operations dashboard',elements:[
{id:'stats',kind:'stats',items:[{id:'total',label:'Total Applications',value:128}]},
{id:'queue',kind:'table',title:'Recent Applications',columns:[{id:'application',label:'Application ID'},{id:'status',label:'Status'}],rows:[{application:819304,status:'Pending'}],detailScreen:'details'}]},
{id:'details',title:'Application Details',subtitle:'Customer application assessment',elements:[
{id:'review',kind:'form',title:'Review',fields:[{id:'decision',label:'Decision',type:'select',options:['Approve','Reject']}],actionLabel:'Submit Review',nextScreen:'dashboard'}]}]};
test('Portal generation normalization converts numeric cells and KPI values without losing routes',()=>{
 const before=structuredClone(generated);
 const result=normalizeGeneratedDemo(generated);
 assert.equal(result.screens[0].elements[0].items[0].value,'128');
 assert.equal(result.screens[0].elements[1].rows[0].application,'819304');
 assert.equal(result.screens[0].elements[1].detailScreen,'details');
 assert.deepEqual(generated,before);
 assert.deepEqual(explainGeneratedDemo(result,'portal'),[]);
});
test('Portal generation fills missing nonempty descriptions without modifying workflow elements',()=>{
 const incomplete=structuredClone(generated);
 delete incomplete.screens[1].subtitle;
 delete incomplete.description;
 const fixed=normalizeGeneratedDemo(incomplete);
 assert.ok(fixed.screens[1].subtitle);
 assert.ok(fixed.description);
 assert.deepEqual(explainGeneratedDemo(fixed,'portal'),[]);
});
test('Portal generation rejects invented navigation targets instead of redirecting silently',()=>{
 const broken=structuredClone(generated);
 broken.screens[1].elements[0].nextScreen='not-a-screen';
 const errors=explainGeneratedDemo(normalizeGeneratedDemo(broken),'portal');
 assert.ok(errors.some(e=>e.includes('unknown destination')));
 assert.equal(normalizeGeneratedDemo(broken).screens[1].elements[0].nextScreen,'not-a-screen');
});
test('Portal generation diagnoses unsupported element kinds and oversized structures',()=>{
 const broken=structuredClone(generated);
 broken.screens[0].elements.push({id:'graph',kind:'chart',title:'Performance'});
 assert.ok(explainGeneratedDemo(broken,'portal').some(e=>e.includes('unsupported component')));
 const large=structuredClone(generated);
 large.screens[0].elements.push(...Array.from({length:8},(_,i)=>({kind:'notice',id:'n'+i,tone:'info',title:'Info',body:'Details'})));
 assert.ok(explainGeneratedDemo(large,'portal').some(e=>e.includes('1–8 elements')));
});
test('Portal generation does not silently remove unsupported data, controls or screens',()=>{
 const broken=structuredClone(generated);
 broken.screens[1].elements[0].fields[0].type='custom-lookup';
 const fixed=normalizeGeneratedDemo(broken);
 assert.equal(fixed.screens[1].elements[0].fields[0].type,'custom-lookup');
 assert.ok(explainGeneratedDemo(fixed,'portal').some(e=>e.includes('.fields[0]')&&e.includes('invalid field')));
});

test('Unresolved review form issues become actionable business clarification rather than schema jargon',()=>{
 const help=generationClarification(['screens[1].elements[0]: invalid form title, action or fields'],'portal');
 assert.match(help.question,/review form/i);
 assert.ok(help.suggestions.some(x=>/standard review form/i.test(x)));
 assert.doesNotMatch(help.question,/screens\[|elements\[|actionLabel/);
});
test('Ambiguous routes ask which screen to open, not to restart the entire master brief',()=>{
 const help=generationClarification(['screens[2].elements[0].nextScreen: unknown destination'],'portal');
 assert.match(help.question,/which screen/i);
 assert.ok(help.suggestions.length>=2);
});
test('Unsupported component visual pattern has standard portal alternative',()=>{
 const help=generationClarification(['screens[0].elements[1].kind: unsupported component chart'],'portal');
 assert.match(help.question,/standard banking-portal components/i);
 assert.match(help.suggestions.join(' '),/supported components/i);
});

test('12 requested mobile screens are within the same shared generation and visual editor limit',()=>{
 const one={id:'banner',kind:'hero',title:'Step',description:'Demo'};
 const definition={schemaVersion:1,id:'mobile-12',name:'Kapiko Mobile',description:'Digital banking journey',channel:'mobile',theme:'teal',
  screens:Array.from({length:12},(_,i)=>({id:'s'+i,title:'Step '+i,subtitle:'Step '+i,elements:[{...one,id:'banner-'+i}]}))};
 assert.equal(MAX_GENERATED_SCREENS,12);
 assert.deepEqual(explainGeneratedDemo(definition,'mobile'),[]);
 const tooMany=structuredClone(definition);
 tooMany.screens.push({id:'s12',title:'Extra',subtitle:'Extra',elements:[{...one,id:'extra'}]});
 assert.ok(explainGeneratedDemo(tooMany,'mobile').some(x=>/2–12 screens/.test(x)));
});
test('Generation validation failures never become repeated choice questions',()=>{
 const limit=generationFailure(['screens: require 2–12 screens']);
 assert.equal(limit.code,'SCREEN_COUNT');
 assert.match(limit.message,/12/);
 assert.equal(limit.question,undefined);
 const structure=generationFailure(['screens[2].elements[0]: invalid form']);
 assert.equal(structure.code,'INVALID_GENERATED_DEFINITION');
 assert.match(structure.message,/invalid application structure/);
 assert.equal(structure.question,undefined);
});

test('Compiler converts top-level AI cards into supported composed cards without removing content',()=>{
 const d=structuredClone(generated);
 d.screens[0].elements.push({id:'income-card',kind:'card',title:'Monthly Income',description:'AED 28,000'});
 const normalized=normalizeGeneratedDemo(d);
 const card=normalized.screens[0].elements.at(-1);
 assert.equal(card.kind,'composed');
 assert.equal(card.title,'Monthly Income');
 assert.equal(card.items[0].kind,'card');
 assert.equal(card.items[0].text,'AED 28,000');
 assert.deepEqual(explainGeneratedDemo(normalized,'portal'),[]);
 assert.equal(d.screens[0].elements.at(-1).kind,'card');
});
test('Compiler translates typed form drift and composed progress/select values but keeps invalid routes rejected',()=>{
 const d=structuredClone(generated);
 const form=d.screens[1].elements[0];
 form.fields.push({id:'telephone',label:'Mobile Number',type:'tel'},{id:'document',label:'Income proof',type:'upload'},
 {id:'employment',label:'Employment',type:'dropdown',options:[{label:'Salaried',value:'salaried'},{label:'Self-employed',value:'self'}]});
 d.screens[0].elements.push({id:'custom',kind:'composed',title:'Verification',items:[
  {id:'progress',kind:'progress',label:'Progress',value:'30'},
  {id:'status',kind:'select',label:'Document Type',options:[{label:'Emirates ID',value:'eid'}]}
 ]});
 const norm=normalizeGeneratedDemo(d);
 assert.equal(norm.screens[1].elements[0].fields[1].type,'text');
 assert.equal(norm.screens[1].elements[0].fields[2].type,'file');
 assert.deepEqual(norm.screens[1].elements[0].fields[3].options,['Salaried','Self-employed']);
 assert.equal(norm.screens[0].elements.at(-1).items[0].value,30);
 assert.deepEqual(explainGeneratedDemo(norm,'portal'),[]);
 assert.equal(d.screens[1].elements[0].fields[1].type,'tel');
 norm.screens[1].elements[0].nextScreen='missing';
 assert.ok(explainGeneratedDemo(norm,'portal').some(x=>x.includes('unknown destination')));
});
test('Compiler diagnoses missing form fields explicitly and does not invent consent or navigation',()=>{
 const d=structuredClone(generated);
 const form=d.screens[1].elements[0];
 delete form.fields[0].label;
 form.actionLabel='';
 const errors=explainGeneratedDemo(normalizeGeneratedDemo(d),'portal');
 assert.ok(errors.some(e=>e.includes('.fields[0]')));
 assert.ok(errors.some(e=>e.includes('.actionLabel')));
 assert.equal(form.actionLabel,'');
});
