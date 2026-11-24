import test from 'node:test';import assert from 'node:assert/strict';
import {explicitScreenPlan,plannedScreenGroups,mergePlannedScreens} from './screenPlan.mjs';
import {normalizeGeneratedDemo,explainGeneratedDemo} from './generationContract.mjs';
const sections=['Welcome','Sign In','Sign Up','Mobile OTP Verification','eKYC Using UAE PASS','Face Verification','Dashboard','Income Update','Income Verification & Review','Income Update Confirmation','My Service Requests','Customer Profile'];
const brief=sections.map((name,i)=>'### Screen '+(i+1)+' – '+name+'\nCreate the '+name+' screen.').join('\n\n');
const meta={id:'kapiko-test',name:'Kapiko Bank',description:'A simulated UAE banking app',channel:'mobile',theme:'navy'};
test('RCA: numbered requirement locks exactly 12 distinct screens, no model-suggested 13th',()=>{
 const plan=explicitScreenPlan(brief);
 assert.equal(plan.length,12);
 assert.equal(new Set(plan.map(p=>p.id)).size,12);
 assert.deepEqual(plan.map(p=>p.title),sections);
 assert.deepEqual(plannedScreenGroups(plan).map(g=>g.length),[3,3,3,3]);
 const generated=plannedScreenGroups(plan).map(g=>({screens:g.map(slot=>({id:slot.id,title:slot.title,subtitle:'Demo',elements:[{id:'intro',kind:'notice',title:'Demo',body:'Example',tone:'info'}]}))}));
 const merged=mergePlannedScreens(plan,generated,meta);
 assert.equal(merged.screens.length,12);
 assert.deepEqual(explainGeneratedDemo(normalizeGeneratedDemo(merged),'mobile'),[]);
 const extra=structuredClone(generated);extra[3].screens.push({id:'unplanned',title:'Additional screen',subtitle:'Extra',elements:[{id:'intro',kind:'notice',title:'Extra',body:'Extra',tone:'info'}]});
 assert.throws(()=>mergePlannedScreens(plan,extra,meta),/count does not match/);
});
test('Plan compiler rejects invented, missing, duplicate and relabeled screen IDs',()=>{
 const plan=explicitScreenPlan(brief);const batches=plannedScreenGroups(plan).map(g=>({screens:g.map(slot=>({id:slot.id,title:slot.title,subtitle:'x',elements:[{id:'notice',kind:'notice',title:'Notice',tone:'info',body:'Text'}]}))}));
 for(const change of [
  b=>{b[0].screens[0].id='invented-screen'},
  b=>{b[1].screens[0].id=b[0].screens[0].id},
  b=>{b[1].screens[0].elements=[]}
 ]){
  const copy=structuredClone(batches);change(copy);
  assert.throws(()=>mergePlannedScreens(plan,copy,meta));
 }
});
test('Non-numbered requirements continue through ordinary generation path',()=>{
 assert.equal(explicitScreenPlan('Create a sign in and profile mobile application'),null);
 assert.equal(explicitScreenPlan('### Screen 1 – Login\n### Screen 3 – Dashboard'),null);
 assert.equal(explicitScreenPlan(brief+'\n### Screen 13 – Extra'),null);
});
