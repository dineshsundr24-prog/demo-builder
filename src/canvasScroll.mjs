// Single scroll policy for a visual editing surface, independent of the simulated app.
// Pure functions keep wheel and drag scrolling consistent and testable.
export function wheelMovement(event, viewport){
 const unit=event.deltaMode===1?16:event.deltaMode===2?viewport.clientHeight:1;
 const dy=event.deltaY*unit;
 const dx=event.deltaX*unit;
 return {x:dx+(event.shiftKey?dy:0), y:event.shiftKey?0:dy};
}
export function boundedScroll(viewport,delta){
 const maxX=Math.max(0,viewport.scrollWidth-viewport.clientWidth);
 const maxY=Math.max(0,viewport.scrollHeight-viewport.clientHeight);
 const x=Math.min(maxX,Math.max(0,viewport.scrollLeft+delta.x));
 const y=Math.min(maxY,Math.max(0,viewport.scrollTop+delta.y));
 return {x,y,consumed:Math.abs(x-viewport.scrollLeft)>0.1||Math.abs(y-viewport.scrollTop)>0.1};
}
export function edgeDragMovement(position,bounds){
 const band=65,step=32;
 const near=(distance)=>distance>=0&&distance<band?(band-distance)/band*step:0;
 return {x:near(position.x-bounds.left)*-1+near(bounds.right-position.x), y:near(position.y-bounds.top)*-1+near(bounds.bottom-position.y)};
}
