import test from 'node:test';
import assert from 'node:assert/strict';
import {validImageDemo,rectangularRegion,applyImageAction,portableHtml} from '../src/imageDemo.mjs';
const src='data:image/png;base64,aGVsbG8=';
const demo={schemaVersion:1,kind:'image-demo',name:'Kapiko Screenshot Journey',screens:[
 {id:'welcome',title:'Welcome',role:'screen',src,hotspots:[{id:'continue',label:'Continue',action:'go',target:'profile',x:.15,y:.7,w:.7,h:.08},{id:'help',label:'Help',action:'open-overlay',target:'help-modal',x:.8,y:.05,w:.1,h:.05}]},
 {id:'profile',title:'Profile',role:'screen',src,hotspots:[{id:'back',label:'Back',action:'back',x:.02,y:.02,w:.12,h:.06}]},
 {id:'help-modal',title:'Help',role:'overlay',src,hotspots:[{id:'close',label:'Close',action:'close-overlay',x:.8,y:.03,w:.1,h:.05}]}
]};
test('Screenshot contract validates multiple image screens and four simple hotspot actions',()=>{assert.equal(validImageDemo(demo),true);});
test('Relative coordinates stay within [0,1] even on reverse drags',()=>{assert.deepEqual(rectangularRegion(.8,.9,.2,.3),{x:.2,y:.3,w:.6000000000000001,h:.6000000000000001});});
test('Screenshot hotspots preserve navigation stack and back action',()=>{const forward=applyImageAction(demo,'welcome',demo.screens[0].hotspots[0]);assert.equal(forward.screenId,'profile');assert.deepEqual(forward.history,['welcome']);const back=applyImageAction(demo,'profile',demo.screens[1].hotspots[0],forward.history);assert.equal(back.screenId,'welcome');});
test('Screenshot image popups remain on the current base screen and close safely',()=>{const opened=applyImageAction(demo,'welcome',demo.screens[0].hotspots[1]);assert.equal(opened.screenId,'welcome');assert.equal(opened.overlay,'help-modal');assert.equal(applyImageAction(demo,'welcome',demo.screens[2].hotspots[0],[],opened.overlay).overlay,null);});
test('Reject invalid hotspot bounds and destinations, and unsafe image sources',()=>{const bad=structuredClone(demo);bad.screens[0].hotspots[0].x=.85;assert.equal(validImageDemo(bad),false);bad.screens[0].hotspots[0].x=.15;bad.screens[0].hotspots[0].target='missing';assert.equal(validImageDemo(bad),false);bad.screens[0].hotspots[0].target='profile';bad.screens[1].src='https://example.com/secret.png';assert.equal(validImageDemo(bad),false);});
test('Portable HTML export embeds the screens without AI calls or editor secrets',()=>{const html=portableHtml(demo);assert.match(html,/Screenshot Demo/);assert.match(html,/Kapiko Screenshot Journey/);assert.match(html,/aGVsbG8/);assert.doesNotMatch(html,/OPENAI_API_KEY|DEMO_ACCESS_TOKEN/);});
test('Portable HTML escapes script-breaking markup in labels',()=>{const d=structuredClone(demo);d.screens[0].title='</script><script>alert(1)</script>';const html=portableHtml(d);assert.equal(html.includes('</script><script>alert(1)'),false);});
