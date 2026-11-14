import React,{useState} from 'react';
import type {Element} from './demo';
// @ts-ignore Safe runtime is shared between browser and Node regression tests.
import {dynamicRows,dynamicCsv,executeDynamicActions} from './componentRuntime.mjs';
import './styles.css';
import './dynamicComponent.css';
type Composed=Extract<Element,{kind:'composed'}>;
type Item=Composed['items'][number];
export default function ComposedElement({element,onNavigate}:{element:Composed;onNavigate:(id?:string)=>void}){
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
 return <section className="surface composed-surface dynamic-surface">
  <div className="section-head"><div><h3>{element.title}</h3></div></div>
  <div className="composed-items">{element.items.map(item=>{
   if(visible[item.id]===false)return null;
   if(item.visibleWhen&&String(values[item.visibleWhen.field]||'')!==item.visibleWhen.equals)return null;
   const val=values[item.id]||'';
   switch(item.kind){
    case 'text':return <p className="composed-text" key={item.id}>{item.text||item.label}</p>;
    case 'badge':return <span className="dynamic-badge" key={item.id}>{item.text||item.label}</span>;
    case 'divider':return <hr className="dynamic-divider" key={item.id}/>;
    case 'card':return <div className="composed-card" key={item.id}><strong>{item.label}</strong><p>{item.text}</p></div>;
    case 'progress':return <div className="composed-progress" key={item.id}><span>{item.label}</span><progress max={100} value={item.value}/><small>{item.value}%</small></div>;
    case 'checkbox':return <div className="composed-field" key={item.id}><label className="composed-checkbox"><input type="checkbox" checked={val==='true'} onChange={e=>setValues(p=>({...p,[item.id]:String(e.target.checked)}))}/><span>{item.label}{item.required?' *':''}</span></label>{errors[item.id]&&<small className="error">{errors[item.id]}</small>}</div>;
    case 'select':return <div className="composed-field" key={item.id}><label>{item.label}{item.required?' *':''}</label><select value={val} onChange={e=>setValues(p=>({...p,[item.id]:e.target.value}))}><option value="">Select an option</option>{item.options?.map(x=><option key={x} value={x}>{x}</option>)}</select>{errors[item.id]&&<small className="error">{errors[item.id]}</small>}</div>;
    case 'input':return <div className="composed-field" key={item.id}><label>{item.label}{item.required?' *':''}</label><input type={item.inputType||'text'} value={val} onChange={e=>setValues(p=>({...p,[item.id]:e.target.value}))} placeholder={item.text||''}/>{errors[item.id]&&<small className="error">{errors[item.id]}</small>}</div>;
    case 'button':return <button type="button" className="btn primary composed-action" key={item.id} onClick={()=>act(item)}>{item.label}</button>;
    case 'table':{const rows=dynamicRows(item,values) as Record<string,string>[];return <div className="dynamic-table-wrap" key={item.id}><div className="dynamic-table-title">{item.label}</div><div className="table-scroll"><table><thead><tr>{item.columns?.map(c=><th key={c.id}>{c.label}</th>)}</tr></thead><tbody>{rows.map((r,i)=><tr key={i}>{item.columns?.map(c=><td key={c.id}>{r[c.id]}</td>)}</tr>)}{rows.length===0&&<tr><td colSpan={item.columns?.length||1} className="empty">No matching records</td></tr>}</tbody></table></div></div>;}
   }
  })}</div>
  {notice&&<div role="status" className="notice success dynamic-notice">{notice}</div>}
 </section>;
}
