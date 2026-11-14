// Pure image-demo data contract. Screenshots are assets, not generated markup.
export const hotspotActions=['go','back','open-overlay','close-overlay'];
export function validImageDemo(d){
 if(!d||d.schemaVersion!==1||d.kind!=='image-demo'||!Array.isArray(d.screens)||d.screens.length>20)return false;
 const ids=new Set();
 for(const s of d.screens){
  if(!s||typeof s.id!=='string'||!s.id||ids.has(s.id)||typeof s.title!=='string'||!s.title||typeof s.src!=='string'||!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(s.src)||s.src.length>20_000_000||!Array.isArray(s.hotspots))return false;
  if(s.role!==undefined&&!['screen','overlay'].includes(s.role))return false;
  if(s.hotspots.length>60)return false;
  ids.add(s.id);
 }
 for(const s of d.screens)for(const h of s.hotspots){
  if(!h||typeof h.id!=='string'||!h.id||!hotspotActions.includes(h.action)||!Number.isFinite(h.x)||!Number.isFinite(h.y)||!Number.isFinite(h.w)||!Number.isFinite(h.h)||h.x<0||h.y<0||h.w<=0||h.h<=0||h.x+h.w>1.00001||h.y+h.h>1.00001)return false;
  if(['go','open-overlay'].includes(h.action)&&(!ids.has(h.target)|| (h.action==='open-overlay'&&d.screens.find(t=>t.id===h.target)?.role!=='overlay')))return false;
 }
 return true;
}
export function rectangularRegion(x1,y1,x2,y2){
 const clip=v=>Math.max(0,Math.min(1,v));
 const x=clip(Math.min(x1,x2)),y=clip(Math.min(y1,y2));
 const right=clip(Math.max(x1,x2)),bottom=clip(Math.max(y1,y2));
 return{x,y,w:right-x,h:bottom-y};
}
export function applyImageAction(d,screenId,action,history=[],overlay=null){
 if(!validImageDemo(d))throw Error('Invalid image demo.');
 const screen=d.screens.find(s=>s.id===screenId)||d.screens[0];
 const next=[...history];
 if(action.action==='go'){
  if(!d.screens.some(s=>s.id===action.target))return{screenId:screen.id,history:next,overlay};
  next.push(screen.id);return{screenId:action.target,history:next,overlay:null};
 }
 if(action.action==='back')return{screenId:next.pop()||screen.id,history:next,overlay:null};
 if(action.action==='open-overlay')return{screenId:screen.id,history:next,overlay:action.target};
 if(action.action==='close-overlay')return{screenId:screen.id,history:next,overlay:null};
 return{screenId:screen.id,history:next,overlay};
}
export function portableHtml(d){
 if(!validImageDemo(d)||!d.screens.length)throw Error('Add valid screenshots and hotspots before exporting.');
 // JSON encoded as a script-safe literal; the viewer uses DOM APIs only.
 const data=JSON.stringify(d).replace(/</g,'\\u003c').replace(/>/g,'\\u003e').replace(/&/g,'\\u0026');
 return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Screenshot Demo</title>
<style>*{box-sizing:border-box}body{margin:0;font:14px system-ui;background:#151f30;color:white}header{display:flex;align-items:center;justify-content:space-between;padding:12px 18px;gap:12px}button{cursor:pointer}header button{border:1px solid #8793a8;color:white;background:transparent;border-radius:7px;padding:8px 12px}.layout{display:flex;justify-content:center;gap:14px;align-items:start;padding:12px;flex-wrap:wrap}.screen{position:relative;max-width:min(100%,440px);width:100%;line-height:0;border-radius:14px;overflow:hidden;box-shadow:0 12px 32px #0007}.screen>img{display:block;width:100%;height:auto}.hotspot{position:absolute;border:1px dashed transparent;background:transparent;padding:0}.show .hotspot{border:2px dashed #00e5ff;background:#00e5ff24}.overlay{position:fixed;inset:0;background:#0009;display:flex;justify-content:center;align-items:center;padding:18px}.overlay .screen{max-height:90vh;overflow:auto}.hidden{display:none!important}</style>
<header><strong id="name"></strong><div><button id="back">Back</button><button id="highlight">Show hotspots</button></div></header><main class="layout"><div id="screen" class="screen"></div></main><div id="overlay" class="overlay hidden"><div id="popup" class="screen"></div></div>
<script>const demo=${data};let current=demo.screens.find(x=>x.role!=='overlay')?.id||demo.screens[0].id,history=[],active=null,show=false;
document.getElementById('name').textContent=demo.name||'Screenshot Demo';
const screen=document.getElementById('screen'),popup=document.getElementById('popup'),overlay=document.getElementById('overlay');
function draw(el,s){el.replaceChildren();el.classList.toggle('show',show);if(!s)return;const img=document.createElement('img');img.src=s.src;img.alt=s.title;el.append(img);s.hotspots.forEach(h=>{const b=document.createElement('button');b.className='hotspot';b.title=h.label||h.action;b.setAttribute('aria-label',h.label||h.action);b.style.left=(h.x*100)+'%';b.style.top=(h.y*100)+'%';b.style.width=(h.w*100)+'%';b.style.height=(h.h*100)+'%';b.onclick=()=>act(h);el.append(b)})}
function render(){draw(screen,demo.screens.find(x=>x.id===current));overlay.classList.toggle('hidden',!active);if(active)draw(popup,demo.screens.find(x=>x.id===active))}
function act(h){if(h.action==='go'){history.push(current);current=h.target;active=null}else if(h.action==='back'){if(active)active=null;else current=history.pop()||current}else if(h.action==='open-overlay'){active=h.target}else if(h.action==='close-overlay'){active=null}render()}
document.getElementById('back').onclick=()=>act({action:'back'});
document.getElementById('highlight').onclick=()=>{show=!show;document.getElementById('highlight').textContent=show?'Hide hotspots':'Show hotspots';render()};
overlay.addEventListener('click',e=>{if(e.target===overlay)act({action:'close-overlay'})});render();</script></html>`;
}
