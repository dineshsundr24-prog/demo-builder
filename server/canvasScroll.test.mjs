import test from 'node:test';import assert from 'node:assert/strict';
import {wheelMovement,boundedScroll,edgeDragMovement} from '../src/canvasScroll.mjs';
test('Canvas wheel uses pixel, line and page units, plus Shift horizontal scroll',()=>{
 const el={clientHeight:500};assert.deepEqual(wheelMovement({deltaMode:0,deltaX:3,deltaY:120,shiftKey:false},el),{x:3,y:120});
 assert.deepEqual(wheelMovement({deltaMode:1,deltaX:0,deltaY:3,shiftKey:false},el),{x:0,y:48});
 assert.deepEqual(wheelMovement({deltaMode:2,deltaX:0,deltaY:1,shiftKey:false},el),{x:0,y:500});
 assert.deepEqual(wheelMovement({deltaMode:0,deltaX:2,deltaY:100,shiftKey:true},el),{x:102,y:0});
});
test('Canvas scrolling moves inside available space and never consumes gestures at boundary',()=>{
 const el={scrollWidth:950,clientWidth:600,scrollHeight:1800,clientHeight:520,scrollTop:0,scrollLeft:0};
 assert.deepEqual(boundedScroll(el,{x:0,y:180}),{x:0,y:180,consumed:true});
 assert.deepEqual(boundedScroll({...el,scrollTop:1280},{x:0,y:160}),{x:0,y:1280,consumed:false});
 assert.deepEqual(boundedScroll(el,{x:-50,y:-10}),{x:0,y:0,consumed:false});
 assert.deepEqual(boundedScroll(el,{x:500,y:0}),{x:350,y:0,consumed:true});
});
test('Design canvas drag scrolls near edges and stops when pointer is away',()=>{
 const b={left:100,right:600,top:100,bottom:600};
 assert.ok(edgeDragMovement({x:350,y:591},b).y>0);
 assert.ok(edgeDragMovement({x:350,y:110},b).y<0);
 assert.ok(edgeDragMovement({x:110,y:300},b).x<0);
 assert.ok(edgeDragMovement({x:590,y:300},b).x>0);
 assert.deepEqual(edgeDragMovement({x:350,y:350},b),{x:0,y:0});
});
