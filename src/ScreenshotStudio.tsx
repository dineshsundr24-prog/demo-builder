import React,{useEffect,useRef,useState} from 'react';
import {ArrowLeft,ArrowRight,Check,Download,Eye,EyeOff,Images,Maximize2,Minus,Plus,Save,ShieldCheck,Trash2,Upload,X} from 'lucide-react';
// @ts-ignore Shared pure validation and HTML export functions.
import {rectangularRegion,validImageDemo,portableHtml,applyImageAction} from './imageDemo.mjs';
import './screenshotStudio.css';
type Action='go'|'back'|'open-overlay'|'close-overlay';
type Hotspot={id:string;label:string;action:Action;target?:string;x:number;y:number;w:number;h:number};
type ImageScreen={id:string;title:string;role?:'screen'|'overlay';src:string;hotspots:Hotspot[]};
type ImageDemo={schemaVersion:1;kind:'image-demo';name:string;screens:ImageScreen[]};
const id=()=>crypto.randomUUID();
const storeKey=(projectId:string)=>'meyon-images-'+projectId;
function openDatabase():Promise<IDBDatabase>{return new Promise((ok,fail)=>{const r=indexedDB.open('meyon-screenshot-studio',1);r.onupgradeneeded=()=>r.result.createObjectStore('projects');r.onsuccess=()=>ok(r.result);r.onerror=()=>fail(r.error);});}
async function loadDemo(projectId:string):Promise<ImageDemo|null>{const db=await openDatabase();return new Promise((ok,fail)=>{const tx=db.transaction('projects','readonly');const r=tx.objectStore('projects').get(storeKey(projectId));r.onsuccess=()=>{db.close();ok(r.result||null)};r.onerror=()=>{db.close();fail(r.error)};});}
async function saveDemo(projectId:string,demo:ImageDemo):Promise<void>{const db=await openDatabase();return new Promise((ok,fail)=>{const tx=db.transaction('projects','readwrite');tx.objectStore('projects').put(demo,storeKey(projectId));tx.oncomplete=()=>{db.close();ok()};tx.onerror=()=>{db.close();fail(tx.error)};});}
function readImage(f:File):Promise<string>{return new Promise((ok,fail)=>{const r=new FileReader();r.onload=()=>ok(String(r.result));r.onerror=()=>fail(r.error);r.readAsDataURL(f);});}
function imageDimensions(src:string):Promise<{width:number;height:number}>{return new Promise((ok,fail)=>{const img=new Image();img.onload=()=>ok({width:img.naturalWidth,height:img.naturalHeight});img.onerror=()=>fail(Error('Cannot read image'));img.src=src;});}
export default function ScreenshotStudio({projectId,projectName,onClose}:{projectId:string;projectName:string;onClose:()=>void}){
 const[demo,setDemo]=useState<ImageDemo>({schemaVersion:1,kind:'image-demo',name:projectName,screens:[]});
 const[selected,setSelected]=useState('');
 const[mode,setMode]=useState<'edit'|'preview'>('edit');
 const[tool,setTool]=useState<'hotspot'|'blur'>('hotspot');
 const[highlight,setHighlight]=useState(true);
 const[hotspotDraft,setHotspotDraft]=useState<{screenId:string;rect:{x:number;y:number;w:number;h:number}}|null>(null);
 const[hotspotEdit,setHotspotEdit]=useState<{label:string;action:Action;target:string}>({label:'Continue',action:'go',target:''});
 const[drag,setDrag]=useState<{x:number;y:number}|null>(null);
 const[rectangle,setRectangle]=useState<{x:number;y:number;w:number;h:number}|null>(null);
 const[history,setHistory]=useState<string[]>([]);
 const[overlay,setOverlay]=useState<string|null>(null);
 const[notice,setNotice]=useState('');
 const[busy,setBusy]=useState(false);
 const[loaded,setLoaded]=useState(false);
 const[fullscreen,setFullscreen]=useState(false);
 const fileInput=useRef<HTMLInputElement>(null);
 const stage=useRef<HTMLDivElement>(null);
 const screen=demo.screens.find(s=>s.id===selected)||demo.screens.find(s=>s.role!=='overlay')||demo.screens[0];
 const activeOverlay=demo.screens.find(s=>s.id===overlay);
 useEffect(()=>{let cancelled=false;loadDemo(projectId).then(v=>{if(!cancelled&&v&&validImageDemo(v)){setDemo(v);setSelected(v.screens.find(s=>s.role!=='overlay')?.id||v.screens[0]?.id||'')}}).catch(()=>{if(!cancelled)setNotice('Browser asset storage unavailable. You can still export a portable HTML file.')}).finally(()=>{if(!cancelled)setLoaded(true)});return()=>{cancelled=true}},[projectId]);
 useEffect(()=>{if(!loaded||!validImageDemo(demo))return;const t=setTimeout(()=>saveDemo(projectId,demo).catch(()=>setNotice('Images could not be saved. Export your HTML demo before closing.')),350);return()=>clearTimeout(t)},[demo,loaded,projectId]);
 useEffect(()=>{const onKey=(e:KeyboardEvent)=>{if(e.key==='Escape'){setHotspotDraft(null);setFullscreen(false);setOverlay(null)}};window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey)},[]);
 function update(next:ImageDemo){setDemo(next);}
 function updateScreen(screenId:string,fn:(s:ImageScreen)=>ImageScreen){setDemo(d=>({...d,screens:d.screens.map(s=>s.id===screenId?fn(s):s)}));}
 async function upload(files:FileList|null){if(!files?.length)return;setBusy(true);
  try{const list=Array.from(files);if(demo.screens.length+list.length>20)throw Error('Maximum 20 screenshots per project.');
   const screens:ImageScreen[]=[];for(const f of list){if(!['image/png','image/jpeg','image/webp'].includes(f.type))throw Error('Use PNG, JPG or WebP only.');if(f.size>8*1024*1024)throw Error('Each image must be under 8 MB.');
    const src=await readImage(f);await imageDimensions(src);screens.push({id:id(),title:f.name.replace(/\.[^.]+$/,'').replace(/[_-]/g,' ').slice(0,80)||'Screen',role:'screen',src,hotspots:[]});
   }update({...demo,screens:[...demo.screens,...screens]});if(!screen)setSelected(screens[0].id);
   setNotice('Uploaded '+screens.length+' screenshots. Drag a rectangle to assign a clickable action.');
  }catch(e){setNotice(e instanceof Error?e.message:'Upload failed.')}finally{setBusy(false);if(fileInput.current)fileInput.current.value=''}
 }
 function swap(i:number,delta:number){const j=i+delta;if(j<0||j>=demo.screens.length)return;const arr=[...demo.screens];[arr[i],arr[j]]=[arr[j],arr[i]];update({...demo,screens:arr});}
 function removeScreen(sid:string){const next=demo.screens.filter(s=>s.id!==sid).map(s=>({...s,hotspots:s.hotspots.filter(h=>h.target!==sid)}));update({...demo,screens:next});if(selected===sid)setSelected(next[0]?.id||'');setOverlay(null);}
 function point(e:React.PointerEvent<HTMLDivElement>){const b=stage.current?.getBoundingClientRect();if(!b||!b.width||!b.height)return{x:0,y:0};return{x:Math.max(0,Math.min(1,(e.clientX-b.left)/b.width)),y:Math.max(0,Math.min(1,(e.clientY-b.top)/b.height))};}
 function pointerDown(e:React.PointerEvent<HTMLDivElement>){if(mode!=='edit'||!screen||hotspotDraft)return;if((e.target as HTMLElement).closest('button'))return;const p=point(e);setDrag(p);setRectangle({...p,w:0,h:0});e.currentTarget.setPointerCapture(e.pointerId);}
 function pointerMove(e:React.PointerEvent<HTMLDivElement>){if(!drag)return;const p=point(e);setRectangle(rectangularRegion(drag.x,drag.y,p.x,p.y));}
 async function blurAt(rect:{x:number;y:number;w:number;h:number}){if(!screen)return;const original=screen;const img=new Image();img.src=original.src;await new Promise<void>((ok,fail)=>{img.onload=()=>ok();img.onerror=()=>fail(Error('Cannot open screenshot'))});const canvas=document.createElement('canvas');canvas.width=img.naturalWidth;canvas.height=img.naturalHeight;const ctx=canvas.getContext('2d');if(!ctx)throw Error('Canvas unavailable');ctx.drawImage(img,0,0);const x=Math.round(rect.x*canvas.width),y=Math.round(rect.y*canvas.height),w=Math.round(rect.w*canvas.width),h=Math.round(rect.h*canvas.height);ctx.fillStyle='#777';ctx.fillRect(x,y,w,h);ctx.fillStyle='#999';ctx.fillRect(x+3,y+3,Math.max(1,w-6),Math.max(1,h-6));updateScreen(original.id,s=>({...s,src:canvas.toDataURL('image/png')}));setNotice('Selected region permanently covered in this demo copy. Verify it before publishing.');}
 function pointerUp(e:React.PointerEvent<HTMLDivElement>){if(!drag||!screen)return;const p=point(e);const rect=rectangularRegion(drag.x,drag.y,p.x,p.y);setDrag(null);setRectangle(null);if(rect.w<.015||rect.h<.008)return;if(tool==='blur'){void blurAt(rect).catch(err=>setNotice(String(err)));return;}setHotspotEdit({label:'Continue',action:'go',target:demo.screens.find(s=>s.id!==screen.id&&s.role!=='overlay')?.id||''});setHotspotDraft({screenId:screen.id,rect});}
 function saveHotspot(){if(!hotspotDraft)return;const h:Hotspot={id:id(),label:hotspotEdit.label.trim()||hotspotEdit.action,action:hotspotEdit.action,...hotspotDraft.rect};if(['go','open-overlay'].includes(h.action)){if(!hotspotEdit.target){setNotice('Select a destination.');return;}h.target=hotspotEdit.target;}updateScreen(hotspotDraft.screenId,s=>({...s,hotspots:[...s.hotspots,h]}));setHotspotDraft(null);setNotice('Clickable region saved.');}
 function perform(h:Hotspot){const result=applyImageAction(demo,screen.id,h,history,overlay);setSelected(result.screenId);setHistory(result.history);setOverlay(result.overlay);}
 function exportStandalone(){try{const html=portableHtml(demo);const url=URL.createObjectURL(new Blob([html],{type:'text/html'}));const a=document.createElement('a');a.href=url;a.download=(demo.name||'screenshot-demo').replace(/[^a-z0-9-]+/gi,'-').toLowerCase()+'.html';a.click();URL.revokeObjectURL(url);setNotice('Standalone playable HTML exported. Review screenshots for confidential information before sharing.');}catch(e){setNotice(e instanceof Error?e.message:'Export failed.');}}
 const overlayOptions=demo.screens.filter(s=>s.role==='overlay'&&s.id!==screen?.id);
 const targetOptions=(hotspotEdit.action==='open-overlay'?overlayOptions:demo.screens.filter(s=>s.role!=='overlay'&&s.id!==screen?.id));
 return <div className={'shot-studio'+(fullscreen?' fullscreen':'')}>
  <header className="shot-header"><div><strong><Images size={18}/> Screenshot Demo</strong><small>{projectName} · No AI analysis</small></div><div className="shot-header-actions"><button onClick={()=>setFullscreen(v=>!v)}><Maximize2 size={15}/>{fullscreen?'Exit full screen':'Full screen'}</button><button onClick={exportStandalone} disabled={!demo.screens.length}><Download size={15}/>Export playable HTML</button><button onClick={onClose} aria-label="Close screenshot studio"><X size={18}/></button></div></header>
  <div className="shot-workspace">
   <aside className="shot-sidebar"><div className="shot-sidebar-head"><strong>Screens ({demo.screens.length})</strong><button onClick={()=>fileInput.current?.click()} disabled={busy}><Plus size={15}/>Add</button><input hidden ref={fileInput} type="file" multiple accept="image/png,image/jpeg,image/webp" onChange={e=>void upload(e.target.files)}/></div>
    {!demo.screens.length&&<p className="shot-empty-text">Upload screenshots to create an exact-looking demo. No AI tokens.</p>}
    <div className="shot-screens">{demo.screens.map((s,i)=><div className={'shot-screen-row'+(screen?.id===s.id?' active':'')} key={s.id}><button className="shot-thumb" onClick={()=>{setSelected(s.id);setOverlay(null);setHistory([])}}><img src={s.src} alt=""/><span>{i+1}</span></button><div className="shot-screen-details"><input aria-label="Screen name" value={s.title} onChange={e=>updateScreen(s.id,x=>({...x,title:e.target.value}))}/><small>{s.hotspots.length} clickable area(s)</small><select aria-label="Screen role" value={s.role||'screen'} onChange={e=>updateScreen(s.id,x=>({...x,role:e.target.value as 'screen'|'overlay'}))}><option value="screen">Screen</option><option value="overlay">Popup image</option></select></div><div className="shot-move"><button disabled={i===0} title="Move up" onClick={()=>swap(i,-1)}>↑</button><button disabled={i===demo.screens.length-1} title="Move down" onClick={()=>swap(i,1)}>↓</button><button title="Delete screen" onClick={()=>removeScreen(s.id)}><Trash2 size={13}/></button></div></div>)}</div>
    <p className="shot-warning"><ShieldCheck size={14}/>Screenshots may contain confidential customer details. Use the Cover tool to hide sensitive areas before sharing.</p>
   </aside>
   <section className="shot-presentation"><div className="shot-toolbar"><div><button className={mode==='edit'?'active':''} onClick={()=>{setMode('edit');setOverlay(null)}}>Edit regions</button><button className={mode==='preview'?'active':''} onClick={()=>{setMode('preview');setOverlay(null)}}><Eye size={14}/>Preview flow</button></div><div>{mode==='edit'?<><button className={tool==='hotspot'?'active':''} onClick={()=>setTool('hotspot')}>+ Clickable area</button><button className={tool==='blur'?'active':''} onClick={()=>setTool('blur')}>Cover private data</button></>:<><button onClick={()=>{setHistory([]);setSelected(demo.screens.find(s=>s.role!=='overlay')?.id||'');setOverlay(null)}}>Restart</button><button onClick={()=>setHighlight(v=>!v)}>{highlight?<EyeOff size={14}/>:<Eye size={14}/>} {highlight?'Hide':'Show'} hotspots</button><button onClick={()=>perform({id:'back',label:'Back',action:'back',x:0,y:0,w:.1,h:.1})}><ArrowLeft size={14}/>Back</button></>}</div></div>
    <div className="shot-canvas">
     {!screen?<div className="shot-upload-call" onClick={()=>fileInput.current?.click()}><Upload size={36}/><h2>Upload your screens</h2><p>Select multiple PNG, JPG or WebP files. Each image becomes a screen with its original appearance.</p><button>Choose screenshots</button></div>:
      <div className="shot-stage-wrap"><div ref={stage} className={'shot-stage'+(mode==='edit'?' drawing':'')+(highlight&&mode==='preview'?' show-hotspots':'')} style={{maxWidth:fullscreen?'min(100%, 620px)':'min(100%, 520px)'}} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp}><img draggable={false} src={screen.src} alt={screen.title}/>{screen.hotspots.map(h=><button key={h.id} className={'shot-hotspot'+(mode==='edit'||highlight?' visible':'')} style={{left:h.x*100+'%',top:h.y*100+'%',width:h.w*100+'%',height:h.h*100+'%'}} title={h.label} onClick={e=>{e.stopPropagation();if(mode==='preview')perform(h);else if(window.confirm('Remove clickable area: '+h.label+'?'))updateScreen(screen.id,x=>({...x,hotspots:x.hotspots.filter(a=>a.id!==h.id)}))}} aria-label={h.label}>{mode==='edit'&&<span>{h.label}</span>}</button>)}{rectangle&&<div className="shot-drawing" style={{left:rectangle.x*100+'%',top:rectangle.y*100+'%',width:rectangle.w*100+'%',height:rectangle.h*100+'%'}}/>}</div><div className="shot-stage-caption">{screen.title} · {mode==='edit'?'Drag over a button or field to create a clickable region':'Click marked regions to navigate'} </div></div>}
     {mode==='preview'&&activeOverlay&&<div className="shot-overlay" onClick={()=>setOverlay(null)}><div className="shot-overlay-image" onClick={e=>e.stopPropagation()}><img src={activeOverlay.src} alt={activeOverlay.title}/>{activeOverlay.hotspots.map(h=><button key={h.id} className={'shot-hotspot'+(highlight?' visible':'')} style={{left:h.x*100+'%',top:h.y*100+'%',width:h.w*100+'%',height:h.h*100+'%'}} onClick={()=>perform(h)} title={h.label}/>)}</div></div>}
    </div>
   </section>
  </div>
  {notice&&<div className="shot-notice" role="status">{notice}<button onClick={()=>setNotice('')}><X size={14}/></button></div>}
  {hotspotDraft&&<div className="shot-modal"><div className="shot-modal-card"><h3>Configure clickable region</h3><p>Select what should happen when this area is clicked.</p><label>Area label<input value={hotspotEdit.label} onChange={e=>setHotspotEdit(v=>({...v,label:e.target.value}))}/></label><label>Action<select value={hotspotEdit.action} onChange={e=>setHotspotEdit(v=>({...v,action:e.target.value as Action,target:''}))}><option value="go">Go to screen</option><option value="back">Back</option><option value="open-overlay">Open popup image</option><option value="close-overlay">Close popup</option></select></label>{['go','open-overlay'].includes(hotspotEdit.action)&&<label>Destination<select value={hotspotEdit.target} onChange={e=>setHotspotEdit(v=>({...v,target:e.target.value}))}><option value="">Select destination</option>{targetOptions.map(s=><option key={s.id} value={s.id}>{s.title}</option>)}</select></label>}<div><button onClick={()=>setHotspotDraft(null)}>Cancel</button><button className="primary" onClick={saveHotspot}><Check size={14}/>Save hotspot</button></div></div></div>}
 </div>;
}
