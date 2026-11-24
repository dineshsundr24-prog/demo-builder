// @ts-ignore Validated visual style definitions are shared across app and runtime.
import {appearanceToStyle} from './visualStyle.mjs';
import React,{useState} from 'react';
import {GripVertical,ArrowUp,ArrowDown,Trash2} from 'lucide-react';
import type {Element,RowSelection} from './demo';
// @ts-ignore Shared row action contract.
import {effectiveTableAction,selectedRowContext} from './tableRowActions.mjs';
// @ts-ignore Safe runtime is shared between browser and Node regression tests.
import {dynamicRows,dynamicCsv,executeDynamicActions} from './componentRuntime.mjs';
import './styles.css';
import './dynamicComponent.css';
type Composed=Extract<Element,{kind:'composed'}>;
type Item=Composed['items'][number];
type EditorControls={selectedItemId?:string;onSelect:(itemId:string)=>void;onMove:(itemId:string,toIndex:number)=>void;onRemove:(itemId:string)=>void};
export default function ComposedElement({element,onNavigate,editor}:{element:Composed;onNavigate:(id?:string,context?:RowSelection|null)=>void;editor?:EditorControls}){
 const [values,setValues]=useState<Record<string,string>>({});
 const [visible,setVisible]=useState<Record<string,boolean>>({});
 const [errors,setErrors]=useState<Record<string,string>>({});
 const [notice,setNotice]=useState('');
 function download(item:Item,current:Record<string,string>){
  if(item.kind!=='table')return;
  const data=dynamicCsv(item,current);
  const url=URL.createObjectURL(new Blob([data],{type:'text/csv;charset=utf-8'}));
  const link=document.createElement('a');link.href=url;link.download=(item.label||'demo-data').replace(/[^a-z0-9_-]/gi,'-').slice(0,60)+'.csv';
  document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
 }
 function act(item:Item){
  const result=executeDynamicActions(element,item,values,visible);
  setValues(result.values);setVisible(result.visibility);setErrors(result.errors);setNotice('');
  for(const event of result.events){
   if(event.type==='navigate')onNavigate(event.screen);
   if(event.type==='notice')setNotice(event.message);
   if(event.type==='download-csv'){const table=element.items.find(x=>x.id===event.target);if(table)download(table,result.values);}
  }
 }
 return <section className="surface composed-surface dynamic-surface" style={appearanceToStyle(element.appearance)}>
  <div className="section-head"><div><h3>{element.title}</h3></div></div>
  <div className="composed-items">{element.items.map((item,itemIndex)=>{
   if(visible[item.id]===false)return null;
   if(item.visibleWhen&&String(values[item.visibleWhen.field]||'')!==item.visibleWhen.equals)return null;
   const val=values[item.id]||'';
   const renderItem=()=>{switch(item.kind){
    case 'text':return <p className="composed-text" style={appearanceToStyle(item.appearance)} key={item.id}>{item.text||item.label}</p>;
    case 'badge':return <span className="dynamic-badge" style={appearanceToStyle(item.appearance)} key={item.id}>{item.text||item.label}</span>;
    case 'divider':return <hr className="dynamic-divider" style={appearanceToStyle(item.appearance)} key={item.id}/>;
    case 'card':return <div className="composed-card" style={appearanceToStyle(item.appearance)} key={item.id}><strong>{item.label}</strong><p>{item.text}</p></div>;
    case 'progress':return <div className="composed-progress" style={appearanceToStyle(item.appearance)} key={item.id}><span>{item.label}</span><progress max={100} value={item.value}/><small>{item.value}%</small></div>;
    case 'checkbox':return <div className="composed-field" style={appearanceToStyle(item.appearance)} key={item.id}><label className="composed-checkbox"><input type="checkbox" checked={val==='true'} onChange={e=>setValues(p=>({...p,[item.id]:String(e.target.checked)}))}/><span>{item.label}{item.required?' *':''}</span></label>{errors[item.id]&&<small className="error">{errors[item.id]}</small>}</div>;
    case 'select':return <div className="composed-field" style={appearanceToStyle(item.appearance)} key={item.id}><label>{item.label}{item.required?' *':''}</label><select value={val} onChange={e=>setValues(p=>({...p,[item.id]:e.target.value}))}><option value="">Select an option</option>{item.options?.map(x=><option key={x} value={x}>{x}</option>)}</select>{errors[item.id]&&<small className="error">{errors[item.id]}</small>}</div>;
    case 'input':return <div className="composed-field" style={appearanceToStyle(item.appearance)} key={item.id}><label>{item.label}{item.required?' *':''}</label><input type={item.inputType||'text'} value={val} onChange={e=>setValues(p=>({...p,[item.id]:e.target.value}))} placeholder={item.text||''}/>{errors[item.id]&&<small className="error">{errors[item.id]}</small>}</div>;
    case 'button':return <button type="button" className="btn primary composed-action" style={appearanceToStyle(item.appearance)} key={item.id} onClick={()=>act(item)}>{item.label}</button>;
    case 'table':{
    const rows=dynamicRows(item,values) as Record<string,string>[];
    const action=effectiveTableAction(item);
    const hasActionCol=item.columns?.some(c=>c.id==='action'||c.id==='actions');
    return <div className="dynamic-table-wrap" style={appearanceToStyle(item.appearance)} key={item.id}>
      <div className="dynamic-table-title">{item.label}</div>
      <div className="table-scroll"><table><thead><tr>{item.columns?.map(c=><th key={c.id}>{c.label}</th>)}{action&&!hasActionCol&&<th>Action</th>}</tr></thead><tbody>
      {rows.map((row,i)=><tr key={i}>{item.columns?.map(c=><td key={c.id}>{action&&(c.id==='action'||c.id==='actions')?
       <button type="button" className="report-row-action" onClick={()=>onNavigate(action.screenId,selectedRowContext(action.screenId,item,row,''))}>{action.label}</button>:row[c.id]}</td>)}
       {action&&!hasActionCol&&<td><button type="button" className="report-row-action" onClick={()=>onNavigate(action.screenId,selectedRowContext(action.screenId,item,row,''))}>{action.label}</button></td>}
      </tr>)}
      {rows.length===0&&<tr><td colSpan={(item.columns?.length||1)+(action&&!hasActionCol?1:0)} className="empty">No matching records</td></tr>}
      </tbody></table></div></div>;
   }
   }};
   if(!editor)return renderItem();
   return <div key={item.id} className={'composed-editable-item'+(editor.selectedItemId===item.id?' composed-item-selected':'')}
    data-select-level="item" data-select-element={element.id} data-select-child={item.id}
    draggable onDragStart={e=>{e.stopPropagation();e.dataTransfer.setData('text/plain','item:'+element.id+':'+item.id);e.dataTransfer.effectAllowed='move';}}
    onDragOver={e=>{e.preventDefault();e.stopPropagation();}}
    onDrop={e=>{e.preventDefault();e.stopPropagation();const raw=e.dataTransfer.getData('text/plain');if(raw.startsWith('item:'+element.id+':')){const from=raw.slice(('item:'+element.id+':').length);editor.onMove(from,itemIndex);}}}>
    <div className="composed-item-toolbar" data-editor-control="true" onClick={e=>e.stopPropagation()}>
      <button type="button" className="composed-item-title" onClick={()=>editor.onSelect(item.id)} title={'Select '+item.label}><GripVertical size={13}/><span>{item.label||item.kind}</span></button>
      <button type="button" aria-label={'Move '+item.label+' up'} disabled={itemIndex===0} onClick={()=>editor.onMove(item.id,itemIndex-1)}><ArrowUp size={13}/></button>
      <button type="button" aria-label={'Move '+item.label+' down'} disabled={itemIndex===element.items.length-1} onClick={()=>editor.onMove(item.id,itemIndex+1)}><ArrowDown size={13}/></button>
      <button type="button" aria-label={'Remove '+item.label} onClick={()=>editor.onRemove(item.id)}><Trash2 size={13}/></button>
    </div>{renderItem()}</div>;
  })}</div>
  {notice&&<div role="status" className="notice success dynamic-notice">{notice}</div>}
 </section>;
}
