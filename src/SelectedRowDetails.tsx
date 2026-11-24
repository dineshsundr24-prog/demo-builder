import React from 'react';
import type {RowSelection} from './demo';
export default function SelectedRowDetails({context}:{context:RowSelection|null}){
 if(!context)return null;
 return <section className="selected-record-summary" aria-label="Selected application information">
  <div className="selected-record-title">Selected application · Sample record</div>
  <div className="selected-record-grid">
   {context.columns.map(col=><div className="selected-record-field" key={col.id}><span>{col.label}</span><strong>{context.row[col.id]||'—'}</strong></div>)}
  </div>
 </section>;
}
