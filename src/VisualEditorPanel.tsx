import React,{useEffect,useState} from 'react';
import {Plus,Trash2,GripVertical,ArrowDown,ArrowUp,Workflow,LayoutTemplate,PanelsTopLeft,Link2,ChevronDown,Palette,Settings2} from 'lucide-react';
import type {DemoDefinition} from './demo';
// @ts-ignore Mobile layout is shared with renderer and tests.
import {effectiveMobilePlacement,placeMobileElement} from './mobileLayout.mjs';
// @ts-ignore Shared navigation labels and pure editor mutation.
import {mobileTemplateLabels,editNavigationItem} from './mobileComponents.mjs';
// @ts-ignore This validated editing engine is shared with Node regression tests.
import {addVisualScreen,renameVisualScreen,addVisualComponent,moveVisualComponent,removeVisualComponent,editVisualComponent,setVisualAppearance,addVisualField,editVisualField,moveVisualField,removeVisualField,editVisualItem,setVisualItemAppearance,moveVisualItem,removeVisualItem,setVisualSubmitVisibility,removeVisualButton,connectVisualFlow,visualFlowActions,visualFlowEdges,palette} from './visualEditor.mjs';
import './visualEditor.css';
type Selection={level:'screen'|'element'|'field'|'button'|'item'|'nav-link'|'header';screenId:string;elementId?:string;childId?:string};
type Props={demo:DemoDefinition;screenId:string;selected:Selection|null;busy:boolean;onSelectScreen:(id:string)=>void;onSelect:(choice:Selection)=>void;onChange:(next:DemoDefinition,description:string)=>void;onError:(reason:string)=>void};
const labels:Record<string,string>={hero:'Hero banner',notice:'Text / card',form:'Form',actions:'Buttons',table:'Data table',stats:'Summary cards',composed:'Generated section',navigation:'Mobile menu / footer',...mobileTemplateLabels};
const colors=['#F58220','#2563EB','#0E9389','#159447','#4C1D95','#DC2626','#1F2937','#FFFFFF'];
export default function VisualEditorPanel({demo,screenId,selected,busy,onSelectScreen,onSelect,onChange,onError}:Props){
 const[mode,setMode]=useState<'screens'|'components'|'flow'>('components');
 const[screenName,setScreenName]=useState('');
 const[flowFrom,setFlowFrom]=useState('');
 const[flowAction,setFlowAction]=useState('');
 const[drag,setDrag]=useState<{kind:'component'|'field'|'palette';id:string;formId?:string}|null>(null);
 useEffect(()=>{if(selected&&['element','field','button','item','nav-link'].includes(selected.level))setMode('components');},[selected?.level,selected?.screenId,selected?.elementId,selected?.childId]);
 const screen=demo.screens.find(s=>s.id===screenId)||demo.screens[0];
 const element=screen?.elements.find(e=>e.id===selected?.elementId);
 const field=element?.kind==='form'&&selected?.level==='field'?element.fields.find(f=>f.id===selected.childId):null;
 const item=element?.kind==='composed'&&selected?.level==='item'?element.items.find(i=>i.id===selected.childId):null;
 const navLink=element?.kind==='navigation'&&selected?.level==='nav-link'?element.links.find(l=>l.id===selected.childId):null;
 const actions:{id:string;label:string;screenId:string}[]=flowFrom?visualFlowActions(demo,flowFrom):[];
 const act=(description:string,fn:()=>DemoDefinition)=>{if(busy)return;try{const next=fn();onChange(next,description);}catch(e){onError(e instanceof Error?e.message:'Unable to edit component.');}};
 const choose=(elementId:string,childId?:string)=>onSelect({level:childId?'field':'element',screenId:screen.id,elementId,...(childId?{childId}:{})});
 const updateItem=(patch:Record<string,unknown>)=>{if(element?.kind!=='composed'||!item)return;act('Edit generated item',()=>editVisualItem(demo,screen.id,element.id,item.id,patch));};
 const updateField=(patch:Record<string,unknown>)=>{if(element?.kind!=='form'||!field)return;act('Edit field',()=>editVisualField(demo,screen.id,element.id,field.id,patch));};
 const updateElement=(patch:Record<string,unknown>)=>{if(!element)return;act('Edit component',()=>editVisualComponent(demo,screen.id,element.id,patch));};
 const updateAppearance=(patch:Record<string,unknown>)=>{if(!element)return;act('Update appearance',()=>item?setVisualItemAppearance(demo,screen.id,element.id,item.id,patch):setVisualAppearance(demo,screen.id,element.id,patch,selected?.level==='button'?selected.childId:undefined));};
 const flowEdges:{from:string;to:string;actionId:string;label:string}[]=visualFlowEdges(demo);
 const elTitle=(el:DemoDefinition['screens'][number]['elements'][number])=>('title'in el&&typeof el.title==='string'?el.title:labels[el.kind]||el.kind);
 const navLabel=demo.channel==='mobile'?'Screen':'Page';
 const chosenButton=element?.kind==='actions'&&selected?.level==='button'?element.buttons.find(b=>b.id===selected.childId):null;
 const isSubmit=element?.kind==='form'&&selected?.level==='button'&&selected.childId==='__submit__';
 const appearance=(item?.appearance||(isSubmit?element.submitAppearance:chosenButton?.appearance||element?.appearance))||{};
 return <aside className="ve-panel">
  <div className="ve-top"><div><strong>Visual Studio</strong><small>Design and connect your application</small></div><span className="ve-state">Visual editor</span></div>
  <div className="ve-tabs" role="tablist">
   <button className={mode==='screens'?'active':''} onClick={()=>setMode('screens')}><PanelsTopLeft size={15}/>{navLabel}s</button>
   <button className={mode==='components'?'active':''} onClick={()=>setMode('components')}><LayoutTemplate size={15}/>Design</button>
   <button className={mode==='flow'?'active':''} onClick={()=>setMode('flow')}><Workflow size={15}/>Flow</button>
  </div>
  <div className="ve-scroll">
   {mode==='screens'&&<div className="ve-section">
    <div className="ve-section-heading"><b>{navLabel} manager</b><span>{demo.screens.length}/12</span></div>
    <p className="ve-help">Select any {navLabel.toLowerCase()} to edit it. Add a blank {navLabel.toLowerCase()} after the selected one.</p>
    {demo.screens.map((s,i)=><button key={s.id} className={'ve-screen-row '+(screen.id===s.id?'active':'')} onClick={()=>{onSelectScreen(s.id);onSelect({level:'screen',screenId:s.id});}}>
     <span className="ve-number">{String(i+1).padStart(2,'0')}</span><span>{s.title}</span><small>{s.elements.length} sections</small>
    </button>)}
    <div className="ve-field"><label>New {navLabel.toLowerCase()} name</label><input value={screenName} onChange={e=>setScreenName(e.target.value)} placeholder={'e.g. Review & Submit'}/></div>
    <button className="ve-primary" disabled={busy||!screenName.trim()||demo.screens.length>=12} onClick={()=>{try{const result=addVisualScreen(demo,screenName,screen.id);onChange(result.definition,'Add '+navLabel.toLowerCase());onSelectScreen(result.screenId);onSelect({level:'screen',screenId:result.screenId});setScreenName('');}catch(e){onError(String(e instanceof Error?e.message:e));}}}><Plus size={15}/> Add {navLabel}</button>
    <div className="ve-section-heading"><b>Current {navLabel.toLowerCase()}</b></div>
    <div className="ve-field"><label>Title</label><input key={screen.id} defaultValue={screen.title} onBlur={e=>{if(e.target.value!==screen.title)act('Rename screen',()=>renameVisualScreen(demo,screen.id,e.target.value));}}/></div>
   </div>}
   {mode==='components'&&<div className="ve-section">
    <div className="ve-section-heading"><b>Component library</b><span>Drag or click to add</span></div>
    {[
      {name:'Basic controls',items:palette.filter((kind:string)=>!(kind in mobileTemplateLabels))},
      ...(demo.channel==='mobile'?[
        {name:'Mobile layout & navigation',items:['bottom-nav','mobile-menu','search-field','progress-steps','profile-card']},
        {name:'Banking & identity journeys · Demo',items:['uaepass-login','uaepass-ekyc','face-verification','otp-entry','document-upload']}
      ]:[])
     ].map(group=><React.Fragment key={group.name}>
       <div className="ve-palette-heading">{group.name}</div>
       <div className="ve-palette">{group.items.map((kind:string)=><button key={kind} draggable onDragStart={e=>{setDrag({kind:'palette',id:kind});e.dataTransfer.effectAllowed='copy';e.dataTransfer.setData('text/plain','palette:'+kind);}} onClick={()=>{try{const out=addVisualComponent(demo,screen.id,kind);onChange(out.definition,'Add '+labels[kind]);choose(out.elementId);}catch(e){onError(String(e instanceof Error?e.message:e));}}}><Plus size={13}/>{labels[kind]||kind}</button>)}</div>
     </React.Fragment>)}
    <div className="ve-section-heading"><b>{screen.title}</b><span>{screen.elements.length} components</span></div>
    <p className="ve-help">Drag components to reorder them. Click to edit their properties. Changes appear in the preview immediately.</p>
    <div className="ve-components">
     {screen.elements.map((el,i)=><div key={el.id} className={'ve-component-row '+(selected?.elementId===el.id?'active':'')}
      draggable onDragStart={e=>{setDrag({kind:'component',id:el.id});e.dataTransfer.setData('text/plain','component:'+el.id);}}
      onDragOver={e=>e.preventDefault()}
      onDrop={e=>{e.preventDefault();const raw=e.dataTransfer.getData('text/plain');if(raw.startsWith('component:'))act('Reorder component',()=>moveVisualComponent(demo,screen.id,raw.slice(10),i));else if(raw.startsWith('palette:')){try{const out=addVisualComponent(demo,screen.id,raw.slice(8));onChange(moveVisualComponent(out.definition,screen.id,out.elementId,i),'Add component');choose(out.elementId);}catch(err){onError(String(err));}}setDrag(null);}}
     >
      <GripVertical size={14}/><button className="ve-component-title" onClick={()=>choose(el.id)}><strong>{elTitle(el)}</strong><small>{labels[el.kind]}{el.kind==='navigation'?' · '+effectiveMobilePlacement(el):''}</small></button>
      <button title="Move up" disabled={i===0} onClick={()=>act('Move component',()=>moveVisualComponent(demo,screen.id,el.id,i-1))}><ArrowUp size={13}/></button>
      <button title="Move down" disabled={i===screen.elements.length-1} onClick={()=>act('Move component',()=>moveVisualComponent(demo,screen.id,el.id,i+1))}><ArrowDown size={13}/></button>
     </div>)}
    </div>
    {element&&<div className="ve-properties" key={screen.id+':'+element.id+':'+(selected?.childId||'')}>
     <div className="ve-section-heading"><b><Settings2 size={14}/> Properties</b><span>{selected?.level==='field'?'Field':selected?.level==='item'?'Generated item':selected?.level==='nav-link'?'Menu item':selected?.level==='button'?'Button':labels[element.kind]}</span></div>
     {navLink&&element?.kind==='navigation'?<div className="ve-fields">
       <div className="ve-field"><label>Menu item label</label><input key={element.id+':'+navLink.id+':label'} defaultValue={navLink.label} onBlur={e=>{if(e.target.value!==navLink.label)act('Rename menu item',()=>editNavigationItem(demo,screen.id,element.id,navLink.id,{label:e.target.value}));}}/></div>
       <div className="ve-field"><label>Destination screen</label><select value={navLink.screenId||''} onChange={e=>act('Connect menu destination',()=>editNavigationItem(demo,screen.id,element.id,navLink.id,{screenId:e.target.value}))}><option value="">Not connected</option>{demo.screens.map(s=><option key={s.id} value={s.id}>{s.title}</option>)}</select></div>
       <small className="ve-help">Navigation only runs in Run Preview. Choose a destination to make this item functional.</small>
     </div>:item?<div className="ve-fields">
      <div className="ve-field"><label>Item label / heading</label><input key={item.id+':label'} defaultValue={item.label} onBlur={e=>{if(e.target.value!==item.label)updateItem({label:e.target.value});}}/></div>
      {item.kind!=='divider'&&<div className="ve-field"><label>Body text</label><textarea key={item.id+':text'} defaultValue={item.text||''} onBlur={e=>{if(e.target.value!==item.text)updateItem({text:e.target.value});}}/></div>}
      <div className="ve-field"><label><Palette size={13}/> Background color</label><div className="ve-colors">{colors.map(color=><button key={color} type="button" aria-label={'Set background '+color} title={color} style={{background:color}} onClick={()=>updateAppearance({backgroundColor:color})}/>)}</div></div>
      <div className="ve-field"><label>Text color</label><div className="ve-colors">{colors.map(color=><button key={color} type="button" aria-label={'Set text '+color} title={color} style={{background:color}} onClick={()=>updateAppearance({textColor:color})}/>)}</div><label className="ve-color-picker">Custom text color <input aria-label="Choose custom item text color" type="color" value={appearance.textColor||'#203448'} onChange={e=>updateAppearance({textColor:e.target.value})}/><span>{appearance.textColor||'Default'}</span></label></div>
      <button className="ve-danger" onClick={()=>{act('Remove generated item',()=>removeVisualItem(demo,screen.id,element.id,item.id));onSelect({level:'element',screenId:screen.id,elementId:element.id});}}><Trash2 size={13}/> Remove item</button>
     </div>:field?<div className="ve-fields">
      <div className="ve-field"><label>Field label</label><input key={field.id+':'+field.label} defaultValue={field.label} onBlur={e=>{if(e.target.value!==field.label)updateField({label:e.target.value});}}/></div>
      <div className="ve-field"><label>Input type</label><select value={field.type} onChange={e=>updateField({type:e.target.value})}>{['text','email','number','date','select','checkbox','file','password'].map(t=><option key={t} value={t}>{t}</option>)}</select></div>
      {field.type==='select'&&<div className="ve-field"><label>Options (one per line)</label><textarea key={field.id} defaultValue={(field.options||[]).join('\n')} onBlur={e=>updateField({options:e.target.value.split('\n').map(x=>x.trim()).filter(Boolean)})}/></div>}
      <label className="ve-check"><input type="checkbox" checked={!!field.required} onChange={e=>updateField({required:e.target.checked})}/> Required field</label>
      <button className="ve-danger" onClick={()=>{act('Remove field',()=>removeVisualField(demo,screen.id,element.id,field.id));choose(element.id);}}><Trash2 size={13}/> Remove field</button>
     </div>:<>
      {selected?.level==='button'?<div className="ve-field"><label>Button label</label><input key={element.id+':button'} defaultValue={isSubmit?element.actionLabel:chosenButton?.label||''} onBlur={e=>{if(isSubmit)updateElement({actionLabel:e.target.value});else if(chosenButton){act('Rename button',()=>{const next=structuredClone(demo);const e2=next.screens.find(s=>s.id===screen.id)?.elements.find(el=>el.id===element.id);if(e2?.kind==='actions'){const b=e2.buttons.find(x=>x.id===chosenButton.id);if(b)b.label=e.target.value;}return next;});}}}/></div>:<>
       {element.kind==='hero'&&<div className="ve-field"><label>Eyebrow / brand label</label><input key={element.id+':eyebrow'} defaultValue={element.eyebrow||''} placeholder="e.g. Kapiko Bank" onBlur={e=>{if(e.target.value!==(element.eyebrow||''))updateElement({eyebrow:e.target.value});}}/><small className="ve-help">The small label above the banner heading</small></div>}
       {'title'in element&&<div className="ve-field"><label>Title</label><input key={element.id+':title'} defaultValue={String(element.title||'')} onBlur={e=>{if(e.target.value!==element.title)updateElement({title:e.target.value});}}/></div>}
       {'body'in element&&<div className="ve-field"><label>Body text</label><textarea key={element.id+':body'} defaultValue={element.body} onBlur={e=>updateElement({body:e.target.value})}/></div>}
       {'description'in element&&<div className="ve-field"><label>Description</label><textarea key={element.id+':description'} defaultValue={element.description||''} onBlur={e=>updateElement({description:e.target.value})}/></div>}
      </>}
      <div className="ve-field"><label><Palette size={13}/> Background color</label><div className="ve-colors">{colors.map(color=><button key={color} aria-label={'Set background '+color} title={color} style={{background:color}} className={appearance.backgroundColor===color?'active':''} onClick={()=>updateAppearance({backgroundColor:color})}/>)}</div><label className="ve-color-picker">Custom color <input aria-label="Choose custom background color" type="color" value={appearance.backgroundColor||"#0E9389"} onChange={e=>updateAppearance({backgroundColor:e.target.value})}/><span>{appearance.backgroundColor||"Select a color"}</span></label></div>
      <div className="ve-field"><label>Text color</label><div className="ve-colors">{colors.map(color=><button key={color} type="button" aria-label={'Set text '+color} title={color} style={{background:color}} onClick={()=>updateAppearance({textColor:color})}/>)}</div><label className="ve-color-picker">Custom text color <input aria-label="Choose custom text color" type="color" value={appearance.textColor||'#203448'} onChange={e=>updateAppearance({textColor:e.target.value})}/><span>{appearance.textColor||'Default'}</span></label></div>
      <div className="ve-field"><label>Alignment</label><select value={appearance.alignment||'left'} onChange={e=>updateAppearance({alignment:e.target.value})}><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option></select></div>
      {!selected?.childId&&<button className="ve-danger" onClick={()=>{act('Remove component',()=>removeVisualComponent(demo,screen.id,element.id));onSelect({level:'screen',screenId:screen.id});}}><Trash2 size={13}/> Remove component</button>}
     </>}
     {element.kind==='navigation'&&selected?.level!=='nav-link'&&<div className="ve-field">
       <label>Position on mobile screen</label>
       <select aria-label="Mobile navigation placement" value={effectiveMobilePlacement(element)}
         onChange={e=>act('Move navigation to '+e.target.value,()=>placeMobileElement(demo,screen.id,element.id,e.target.value as 'header-left'|'header-right'|'body'|'bottom'))}>
         {element.variant==='menu'&&<><option value="header-left">Header · Top left</option><option value="header-right">Header · Top right</option></>}
         {element.variant==='footer'&&<option value="bottom">Bottom navigation</option>}
         <option value="body">Content section</option>
       </select>
       <small className="ve-help">You can also drag the component into the matching region on the phone.</small>
      </div>}
     {element.kind==='navigation'&&<div className="ve-field-list">
       <div className="ve-section-heading"><b>Navigation items</b><span>{element.links.length}</span></div>
       {element.links.map(l=><button key={l.id} className={'ve-secondary'+(selected?.childId===l.id?' active':'')} onClick={()=>onSelect({level:'nav-link',screenId:screen.id,elementId:element.id,childId:l.id})}>{l.label} · {demo.screens.find(s=>s.id===l.screenId)?.title||'Connect in Flow'}</button>)}
     </div>}
     {element.kind==='composed'&&<div className="ve-field-list"><div className="ve-section-heading"><b>Generated components</b><span>{element.items.length}</span></div>{element.items.map((child,i)=><div className={'ve-field-row '+(selected?.level==='item'&&selected.childId===child.id?'active':'')} key={child.id} draggable onDragStart={e=>e.dataTransfer.setData('text/plain','item:'+element.id+':'+child.id)} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();const raw=e.dataTransfer.getData('text/plain');if(raw.startsWith('item:'+element.id+':'))act('Reorder generated item',()=>moveVisualItem(demo,screen.id,element.id,raw.slice(('item:'+element.id+':').length),i));}}><GripVertical size={13}/><button onClick={()=>onSelect({level:'item',screenId:screen.id,elementId:element.id,childId:child.id})}>{child.label||child.kind}</button></div>)}</div>}
     {element.kind==='form'&&<div className="ve-field-list"><div className="ve-section-heading"><b>Form fields</b><button onClick={()=>{try{const out=addVisualField(demo,screen.id,element.id,'text');onChange(out.definition,'Add field');choose(element.id,out.fieldId);}catch(e){onError(String(e));}}}><Plus size={14}/> Add</button></div>
      {element.fields.map((f,i)=><div key={f.id} draggable onDragStart={e=>{setDrag({kind:'field',id:f.id,formId:element.id});e.dataTransfer.setData('text/plain','field:'+element.id+':'+f.id);}}
       onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();const raw=e.dataTransfer.getData('text/plain');if(raw.startsWith('field:'+element.id+':'))act('Reorder field',()=>moveVisualField(demo,screen.id,element.id,raw.split(':')[2],i));setDrag(null);}}
       className={'ve-field-row '+(selected?.childId===f.id?'active':'')}><GripVertical size={13}/><button onClick={()=>choose(element.id,f.id)}>{f.label}</button></div>)}
      <button className="ve-secondary" onClick={()=>{if(element.hideSubmit)act('Restore submit button',()=>setVisualSubmitVisibility(demo,screen.id,element.id,true));else onSelect({level:'button',screenId:screen.id,elementId:element.id,childId:'__submit__'});}}>{element.hideSubmit?'Restore submit button':'Edit '+element.actionLabel+' button'}</button>
     </div>}
     {element.kind==='actions'&&element.buttons.map(b=><button key={b.id} className="ve-secondary" onClick={()=>onSelect({level:'button',screenId:screen.id,elementId:element.id,childId:b.id})}>Edit {b.label}</button>)}
    </div>}
   </div>}
   {mode==='flow'&&<div className="ve-section">
    <div className="ve-section-heading"><b>Visual flow designer</b><span>{flowEdges.length} links</span></div>
    <p className="ve-help">Select a source event and click a destination node to connect the screens. The navigation changes in the actual application preview.</p>
    <div className="ve-field"><label>Source screen</label><select value={flowFrom} onChange={e=>{setFlowFrom(e.target.value);setFlowAction('');}}><option value="">Choose source</option>{demo.screens.map(s=><option key={s.id} value={s.id}>{s.title}</option>)}</select></div>
    {flowFrom&&<div className="ve-field"><label>Button / submit event</label><select value={flowAction} onChange={e=>setFlowAction(e.target.value)}><option value="">Choose action</option>{actions.map(a=><option key={a.id} value={a.id}>{a.label}{a.screenId?' → '+demo.screens.find(s=>s.id===a.screenId)?.title:''}</option>)}</select></div>}
    <div className="ve-flow-canvas">{demo.screens.map((s,i)=><React.Fragment key={s.id}><button className={'ve-flow-node '+(flowFrom===s.id?'source':'')} title={flowAction&&flowFrom&&flowFrom!==s.id?'Connect to '+s.title:'Select as source'} onClick={()=>{if(flowFrom&&flowAction&&flowFrom!==s.id){act('Connect workflow',()=>connectVisualFlow(demo,flowFrom,flowAction,s.id));setFlowAction('');}else{setFlowFrom(s.id);onSelectScreen(s.id);}}}><small>{String(i+1).padStart(2,'0')}</small><strong>{s.title}</strong>{flowFrom&&flowAction&&flowFrom!==s.id&&<span><Link2 size={13}/> Connect here</span>}</button>{flowEdges.filter(e=>e.from===s.id).map(edge=><div className="ve-flow-connection" key={edge.actionId+'-'+edge.to}><ArrowDown size={14}/><span>{edge.label} → {demo.screens.find(target=>target.id===edge.to)?.title}</span></div>)}</React.Fragment>)}</div>
    <div className="ve-section-heading"><b>Configured navigation</b></div>
    {flowEdges.map((e,i)=><div key={i} className="ve-edge"><span>{demo.screens.find(s=>s.id===e.from)?.title}</span><span>→</span><span>{demo.screens.find(s=>s.id===e.to)?.title}</span><small>{e.label}</small></div>)}
    {!flowEdges.length&&<p className="ve-help">No linked screens yet. Choose a source event and destination above.</p>}
   </div>}
  </div>
  <div className="ve-footer">Changes save to this project · Undo in workspace · No AI required for editing</div>
 </aside>;
}