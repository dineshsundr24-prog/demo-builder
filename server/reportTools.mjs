// Portal reporting capability, independent of model-generated HTML.
export function reportToolsIntent(instruction){
 const text=String(instruction||'').trim();
 if(!/\b(add|include|enable|provide|show|put|create|need|with)\b/i.test(text))return null;
 const search=/\bsearch(?:ing)?\b/i.test(text);
 const filter=/\bfilters?\b/i.test(text);
 const download=/\b(download|export|csv)\b/i.test(text);
 if(!search&&!filter&&!download)return null;
 // Other requested widgets require separate planning rather than silently dropping them.
 const stripped=text.replace(/\b(add|include|enable|provide|show|put|create|need|with|in|this|the|section|screen|report|reports|user|users|table|list|and|a|an|option|options|to|for|please|also|of|on|under|search|searching|filters?|download|export|csv|button|buttons|controls?|toolbar|feature|features)\b/gi,'').replace(/[^a-z0-9]+/gi,' ').trim();
 if(stripped)return null;
 return{search,filter,download};
}
export function validReportTools(t,columns){
 if(t===undefined)return true;
 if(!t||typeof t!=='object'||Array.isArray(t))return false;
 if(Object.keys(t).some(k=>!['search','filter','download','filterColumn'].includes(k)))return false;
 if(['search','filter','download'].some(k=>t[k]!==undefined&&typeof t[k]!=='boolean'))return false;
 if(t.filterColumn!==undefined&&(typeof t.filterColumn!=='string'||!columns.some(c=>c.id===t.filterColumn)))return false;
 return true;
}
export function makeExampleReportTable(screen){
 const id=screen.id+'-report-table';
 const columns=[{id:'userId',label:'User ID'},{id:'userName',label:'User Name'},{id:'role',label:'Role'},{id:'status',label:'Status'}];
 const rows=[
  {userId:'USR-1001',userName:'Aisha Khan',role:'Reviewer',status:'Active'},
  {userId:'USR-1002',userName:'Omar Malik',role:'Approver',status:'Active'},
  {userId:'USR-1003',userName:'Sara Nasser',role:'Operations',status:'Inactive'},
  {userId:'USR-1004',userName:'Ali Hassan',role:'Reviewer',status:'Active'},
  {userId:'USR-1005',userName:'Maya Ahmed',role:'Administrator',status:'Inactive'}
 ];
 return {id,kind:'table',title:screen.title+' Register',subtitle:'Fictional sample records for demonstration only',columns,rows};
}
export function filteredReportRows(rows,columns,query='',selected='',filterColumn=''){
 const q=String(query).trim().toLowerCase();
 return rows.filter(row=>{
  const matchesSearch=!q||columns.some(col=>String(row[col.id]||'').toLowerCase().includes(q));
  const matchesFilter=!selected||String(row[filterColumn]||'')===selected;
  return matchesSearch&&matchesFilter;
 });
}
export function csvValue(value){
 const raw=String(value??'');
 const safe=/^[\s]*[=+@\-]/.test(raw)?"'"+raw:raw;
 return '"'+safe.replace(/"/g,'""')+'"';
}
export function reportCsv(columns,rows){
 return '\uFEFF'+[columns.map(c=>csvValue(c.label)).join(','),...rows.map(r=>columns.map(c=>csvValue(r[c.id])).join(','))].join('\r\n');
}
