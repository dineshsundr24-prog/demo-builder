import React,{useState} from 'react';
import {ArrowLeft,ArrowRight,CheckCircle2,ChevronRight,Info,Minus,Plus,Search,ShieldCheck,Wallet} from 'lucide-react';
import {DemoDefinition,Element,validateDemo} from './demo';
import './styles.css';
import './workspace.css';
import './viewer.css';
type PublishedSnapshot={shareVersion:number;version:number;publishedAt:string;projectName:string;company:string;demo:DemoDefinition};
export default function PublishedViewer({snapshot}:{snapshot:PublishedSnapshot|null}){
 const [screenId,setScreenId]=useState('');const[zoom,setZoom]=useState(100);const[formValues,setFormValues]=useState<Record<string,string>>({});const[errors,setErrors]=useState<Record<string,string>>({});const[search,setSearch]=useState('');const[notice,setNotice]=useState('');
 if(!snapshot||!validateDemo(snapshot.demo))return <div className="viewer-error"><h1>Published link cannot be opened</h1><p>This share link is damaged, unsupported or contains an invalid demo definition.</p></div>;
 const demo=snapshot.demo;
 const screen=demo.screens.find(s=>s.id===screenId)||demo.screens[0];
 const brand=demo.chrome?.brandName||snapshot.company||(demo.name.match(/^(.+?\bBank)\b/i)?.[1])||snapshot.projectName;
 const showIcon=demo.chrome?.showBrandIcon!==false;
 const showBack=demo.chrome?.showBackButton!==false;
 const isMobile=demo.channel==='mobile';
 function go(id?:string){if(id&&demo.screens.some(s=>s.id===id)){setScreenId(id);setFormValues({});setErrors({});setSearch('');setNotice('');}}
 function submit(el:Extract<Element,{kind:'form'}>){
  const issues:Record<string,string>={};
  for(const f of el.fields){
   const value=(formValues[f.id]||'').trim();
   if(f.required&&!value)issues[f.id]='Required field';
   if(value&&f.type==='email'&&!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value))issues[f.id]='Enter a valid email';
  }
  setErrors(issues);
  if(!Object.keys(issues).length){if(el.nextScreen)go(el.nextScreen);else setNotice('Demo form completed. No real information was submitted.');}
 }
 function render(el:Element){
  switch(el.kind){
   case 'hero':return <section className="hero"><div className="eyebrow">{el.eyebrow}</div><h2>{el.title}</h2><p>{el.description}</p></section>;
   case 'stats':return <section className="stats">{el.items.map(x=><div key={x.id} className="stat"><div className="stat-label">{x.label}</div><div className="stat-number">{x.value}</div>{x.delta&&<div className="stat-delta">{x.delta}</div>}</div>)}</section>;
   case 'notice':return <div className={'notice '+el.tone}>{el.tone==='success'?<CheckCircle2 size={19}/>:<Info size={19}/>}<div><strong>{el.title}</strong><p>{el.body}</p></div></div>;
   case 'actions':return <div className="button-row">{el.buttons.map(b=><button className={'btn '+(b.variant==='secondary'?'outline':'primary')} key={b.id} onClick={()=>go(b.nextScreen)}>{b.label}<ArrowRight size={14}/></button>)}</div>;
   case 'table':{const rows=el.rows.filter(r=>!search||Object.values(r).some(v=>v.toLowerCase().includes(search.toLowerCase())));return <section className="surface"><div className="section-head"><div><h3>{el.title}</h3><p>{el.subtitle}</p></div><div className="search"><Search size={14}/><input aria-label="Search records" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search records"/></div></div><div className="table-scroll"><table><thead><tr>{el.columns.map(c=><th key={c.id}>{c.label}</th>)}{el.detailScreen&&<th/>}</tr></thead><tbody>{rows.map((r,i)=><tr className={el.detailScreen?'clickable':''} key={r.reference||i} onClick={()=>go(el.detailScreen)}>{el.columns.map(c=><td key={c.id}>{c.id==='status'?<span className={'status '+(r[c.id]==='Approved'?'approved':'pending')}>{r[c.id]}</span>:r[c.id]}</td>)}{el.detailScreen&&<td><ChevronRight size={15}/></td>}</tr>)}{rows.length===0&&<tr><td className="empty" colSpan={el.columns.length+1}>No matching records</td></tr>}</tbody></table></div></section>;}
   case 'form':return <section className="surface form-surface"><div className="section-head"><div><h3>{el.title}</h3><p>{el.description}</p></div></div><form onSubmit={e=>{e.preventDefault();submit(el);}}><div className="form-grid">{el.fields.map(f=><label className="field" key={f.id}><span>{f.label}{f.required&&<em> *</em>}</span>{f.type==='select'?<select value={formValues[f.id]||''} onChange={e=>setFormValues(v=>({...v,[f.id]:e.target.value}))}><option value="">Select an option</option>{(f.options||[]).map(o=><option key={o}>{o}</option>)}</select>:<input type={f.type} value={formValues[f.id]||''} onChange={e=>setFormValues(v=>({...v,[f.id]:e.target.value}))} placeholder={f.placeholder}/ >}{errors[f.id]&&<small className="error">{errors[f.id]}</small>}</label>)}</div><div className="form-footer"><button className="btn primary">{el.actionLabel}<ArrowRight size={15}/></button></div></form></section>;
  }
 }
 return <div className="published-viewer"><header className="published-header"><div><strong>{snapshot.projectName}</strong><span>Read-only demo · Version {snapshot.version}</span></div><div><ShieldCheck size={16}/> Interactive prototype — no live transactions</div></header><main className="published-main"><div className="published-toolbar"><div><strong>{demo.name}</strong><small>{isMobile?'Mobile application':'Web portal'} · Published {new Date(snapshot.publishedAt).toLocaleDateString()}</small></div>{isMobile&&<div className="zoom-controls" aria-label="Mobile preview zoom"><button aria-label="Zoom out" disabled={zoom<=50} onClick={()=>setZoom(v=>Math.max(50,v-10))}><Minus size={15}/></button><button className="zoom-value" onClick={()=>setZoom(100)} title="Reset zoom">{zoom}%</button><button aria-label="Zoom in" disabled={zoom>=150} onClick={()=>setZoom(v=>Math.min(150,v+10))}><Plus size={15}/></button></div>}</div><div className="published-screens">{demo.screens.map((s,i)=><button key={s.id} className={s.id===screen.id?'active':''} onClick={()=>go(s.id)}>{String(i+1).padStart(2,'0')} · {s.title}</button>)}</div><div className={'published-canvas '+(isMobile?'published-mobile':'published-portal')}><div className={isMobile?'device-zoom-stage':'web-zoom-stage'} style={isMobile?{width:390*zoom/100,height:780*zoom/100}:undefined}><div className={'render-frame '+(isMobile?'mobile-frame':'portal-frame')+' theme-'+demo.theme} style={isMobile?{transform:`scale(${zoom/100})`,transformOrigin:'top left'}:undefined}><div className="demo-shell">{!isMobile&&<nav className="demo-nav"><div className="demo-logo">{showIcon&&<Wallet size={18}/>} {brand}</div>{demo.screens.map(s=><button className={s.id===screen.id?'on':''} key={s.id} onClick={()=>go(s.id)}><ChevronRight size={14}/>{s.title}</button>)}</nav>}<div className="demo-main">{isMobile&&<div className="mobile-brand">{showIcon&&<span className="mobile-symbol"><Wallet size={17}/></span>}<span>{brand}</span></div>}{showBack&&screen.id!==demo.screens[0].id&&<button className="back-link" onClick={()=>go(demo.screens[0].id)}><ArrowLeft size={15}/>Back</button>}<div className="screen-intro"><h1>{screen.title}</h1><p>{screen.subtitle}</p></div><div className="elements">{screen.elements.map(e=><React.Fragment key={e.id}>{render(e)}</React.Fragment>)}</div>{notice&&<div className="notice success"><CheckCircle2 size={18}/>{notice}</div>}</div></div></div></div></div></main><footer className="published-footer">Frozen published snapshot · Content is embedded in the share link · No editor or access token is included</footer></div>;
}
