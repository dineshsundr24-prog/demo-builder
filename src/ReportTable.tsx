import React,{useMemo,useState} from 'react';
import {ChevronRight,Download,Search,SlidersHorizontal} from 'lucide-react';
import type {Element} from './demo';
// @ts-ignore Shared pure report filtering and CSV export functions.
import {filteredReportRows,reportCsv} from '../server/reportTools.mjs';
import './reportTable.css';

type Table=Extract<Element,{kind:'table'}>;
export default function ReportTable({element,onNavigate}:{element:Table;onNavigate:(id?:string)=>void}){
 const [query,setQuery]=useState('');
 const [filter,setFilter]=useState('');
 const tools=element.tools;
 const searchEnabled=tools?.search!==false;
 const filterEnabled=tools?.filter===true;
 const downloadEnabled=tools?.download===true;
 const filterColumn=tools?.filterColumn|| (element.columns.some(c=>c.id==='status')?'status':element.columns.some(c=>c.id==='role')?'role':element.columns[0]?.id||'');
 const filterOptions=useMemo(()=>[...new Set(element.rows.map(r=>r[filterColumn]).filter(Boolean))].sort(),[element.rows,filterColumn]);
 const rows=filteredReportRows(element.rows,element.columns,searchEnabled?query:'',filterEnabled?filter:'',filterColumn) as Record<string,string>[];
 function downloadCsv(){
  const csv=reportCsv(element.columns,rows);
  const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;a.download=(element.title||'report').replace(/[^a-z0-9_-]+/gi,'-').replace(/^-|-$/g,'').slice(0,65)+'.csv';
  document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
 }
 return <section className="surface report-table-surface">
  <div className="section-head report-section-head"><div className="report-title"><h3>{element.title}</h3>{element.subtitle&&<p>{element.subtitle}</p>}</div>
  {(searchEnabled||filterEnabled||downloadEnabled)&&<div className="report-toolbar">
   {searchEnabled&&<label className="report-search"><Search size={14}/><input aria-label={'Search '+element.title} value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search records"/></label>}
   {filterEnabled&&<label className="report-filter"><SlidersHorizontal size={14}/><select aria-label={'Filter '+element.title} value={filter} onChange={e=>setFilter(e.target.value)}><option value="">All {element.columns.find(c=>c.id===filterColumn)?.label||'records'}</option>{filterOptions.map(value=><option key={value} value={value}>{value}</option>)}</select></label>}
   {downloadEnabled&&<button type="button" className="report-download" onClick={downloadCsv} title="Download displayed records as CSV" aria-label={'Download '+element.title+' CSV'}><Download size={14}/><span>Download CSV</span></button>}
  </div>}
  </div>
  <div className="table-scroll"><table><thead><tr>{element.columns.map(c=><th key={c.id}>{c.label}</th>)}{element.detailScreen&&<th aria-label="Details"/>}</tr></thead><tbody>
   {rows.map((row,i)=><tr key={row.reference||row.userId||i} className={element.detailScreen?'clickable':''} onClick={()=>element.detailScreen&&onNavigate(element.detailScreen)}>{element.columns.map(c=><td key={c.id}>{c.id==='status'?<span className={'status '+(row[c.id]==='Approved'||row[c.id]==='Active'?'approved':'pending')}>{row[c.id]}</span>:row[c.id]}</td>)}{element.detailScreen&&<td><ChevronRight size={15}/></td>}</tr>)}
   {!rows.length&&<tr><td className="empty" colSpan={element.columns.length+(element.detailScreen?1:0)}>No matching records</td></tr>}
  </tbody></table></div>
  {(filterEnabled||downloadEnabled)&&<div className="report-count">{rows.length} of {element.rows.length} sample records</div>}
 </section>;
}
