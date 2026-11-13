import React,{useState} from 'react';
import type {Element} from './demo';
import './styles.css';
type Composed=Extract<Element,{kind:'composed'}>;
export default function ComposedElement({element,onNavigate}:{element:Composed;onNavigate:(id?:string)=>void}){
 const [values,setValues]=useState<Record<string,string>>({});
 const [errors,setErrors]=useState<Record<string,string>>({});
 function act(destination?:string){
  const problems:Record<string,string>={};
  element.items.forEach(item=>{
   if(item.required&&(item.kind==='checkbox'?values[item.id]!=='true':!String(values[item.id]||'').trim()))problems[item.id]=item.kind==='checkbox'?'Please check this box':'Required field';
  });
  setErrors(problems);
  if(!Object.keys(problems).length&&destination)onNavigate(destination);
 }
 return <section className="surface composed-surface">
  <div className="section-head"><div><h3>{element.title}</h3></div></div>
  <div className="composed-items">{element.items.map(item=>{
   const val=values[item.id]||'';
   switch(item.kind){
    case 'text':return <p className="composed-text" key={item.id}>{item.text||item.label}</p>;
    case 'card':return <div className="composed-card" key={item.id}><strong>{item.label}</strong><p>{item.text}</p></div>;
    case 'progress':return <div className="composed-progress" key={item.id}><span>{item.label}</span><progress max={100} value={item.value}/><small>{item.value}%</small></div>;
    case 'checkbox':return <div className="composed-field" key={item.id}><label className="composed-checkbox"><input type="checkbox" checked={val==='true'} onChange={e=>setValues(p=>({...p,[item.id]:String(e.target.checked)}))}/><span>{item.label}{item.required?' *':''}</span></label>{errors[item.id]&&<small className="error">{errors[item.id]}</small>}</div>;
    case 'select':return <div className="composed-field" key={item.id}><label>{item.label}{item.required?' *':''}</label><select value={val} onChange={e=>setValues(p=>({...p,[item.id]:e.target.value}))}><option value="">Select an option</option>{item.options?.map(x=><option key={x} value={x}>{x}</option>)}</select>{errors[item.id]&&<small className="error">{errors[item.id]}</small>}</div>;
    case 'input':return <div className="composed-field" key={item.id}><label>{item.label}{item.required?' *':''}</label><input type={item.inputType||'text'} value={val} onChange={e=>setValues(p=>({...p,[item.id]:e.target.value}))} placeholder={item.text||''}/>{errors[item.id]&&<small className="error">{errors[item.id]}</small>}</div>;
    case 'button':return <button type="button" className="btn primary composed-action" key={item.id} onClick={()=>act(item.nextScreen)}>{item.label}</button>;
   }
  })}</div>
 </section>;
}
