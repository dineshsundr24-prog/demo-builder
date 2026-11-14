import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeGeneratedDemo,explainGeneratedDemo,generationClarification} from './generationContract.mjs';
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
 assert.ok(explainGeneratedDemo(fixed,'portal').some(e=>e.includes('invalid form')));
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
