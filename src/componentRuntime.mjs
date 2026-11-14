// Safe declarative interactions for AI-composed demo components.
// All actions operate on local prototype state: no eval, script injection, API calls, or arbitrary paths.
const id=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,60}$/.test(v);
const str=(v,max=500)=>typeof v==='string'&&v.length<=max;
const actionTypes=new Set(['navigate','set','toggle','increment','reset','show','hide','download-csv','notice']);
export const dynamicKinds=['text','card','input','checkbox','select','button','progress','table','badge','divider'];
export function validDynamicComponent(element,screenIds=[]){
 if(!element||element.kind!=='composed'||!id(element.id)||!str(element.title,160)||!element.title.trim()||!Array.isArray(element.items)||element.items.length<1||element.items.length>24)return false;
 const ids=new Set(),items=element.items;
 for(const x of items){
  if(!x||!id(x.id)||ids.has(x.id)||!dynamicKinds.includes(x.kind)||!str(x.label,160))return false;
  ids.add(x.id);
  if(x.text!==undefined&&!str(x.text,500))return false;
  if(x.required!==undefined&&typeof x.required!=='boolean')return false;
  if(x.visibleWhen!==undefined&&(!x.visibleWhen||!id(x.visibleWhen.field)||typeof x.visibleWhen.equals!=='string'))return false;
  if(x.kind==='select'&&(!Array.isArray(x.options)||x.options.length<1||x.options.length>30||x.options.some(v=>!str(v,100))))return false;
  if(x.kind==='progress'&&(!Number.isFinite(x.value)||x.value<0||x.value>100))return false;
  if(x.kind==='input'&&x.inputType!==undefined&&!['text','email','number','date','password'].includes(x.inputType))return false;
  if(x.kind==='table'){
   if(!Array.isArray(x.columns)||!x.columns.length||x.columns.length>10||x.columns.some(c=>!c||!id(c.id)||!str(c.label,100)||!c.label)||!Array.isArray(x.rows)||x.rows.length>50||x.rows.some(row=>!row||typeof row!=='object'||Array.isArray(row)||Object.values(row).some(v=>typeof v!=='string'||v.length>500)))return false;
   if(x.filterField!==undefined&&!id(x.filterField))return false;
   if(x.filterColumn!==undefined&&!x.columns.some(c=>c.id===x.filterColumn))return false;
  }
  if(x.kind==='button'){
   if(x.nextScreen!==undefined&&(!screenIds.includes(x.nextScreen)||!str(x.nextScreen)))return false;
   if(x.actions!==undefined&&(!Array.isArray(x.actions)||!x.actions.length||x.actions.length>6))return false;
  }else if(x.actions!==undefined||x.nextScreen!==undefined)return false;
 }
 for(const x of items){
  if(x.visibleWhen&&!ids.has(x.visibleWhen.field))return false;
  if(x.kind==='table'&&x.filterField&&!ids.has(x.filterField))return false;
  for(const a of x.actions||[]){
   if(!a||!actionTypes.has(a.type))return false;
   if(a.type==='navigate'&&(!str(a.screen)||!screenIds.includes(a.screen)))return false;
   if(['set','toggle','increment','show','hide'].includes(a.type)&&(!id(a.target)||!ids.has(a.target)))return false;
   if(a.type==='set'&&(typeof a.value!=='string'||a.value.length>200))return false;
   if(a.type==='increment'&&(a.amount!==undefined&&(!Number.isFinite(a.amount)||Math.abs(a.amount)>1000)))return false;
   if(a.type==='notice'&&(!str(a.message,200)||!a.message.trim()))return false;
   if(a.type==='download-csv'&&(!id(a.target)||!items.some(t=>t.id===a.target&&t.kind==='table')))return false;
  }
 }
 return true;
}
export function dynamicRows(item,values){
 const filter=String(item.filterField?values[item.filterField]||'':'').trim().toLowerCase();
 if(!filter)return item.rows||[];
 const column=item.filterColumn;
 return(item.rows||[]).filter(row=>(column?[row[column]]:item.columns.map(c=>row[c.id])).some(v=>String(v||'').toLowerCase().includes(filter)));
}
export function safeCsvCell(value){
 const raw=String(value??'');
 const safe=/^[\s]*[=+@\-]/.test(raw)?"'"+raw:raw;
 return '"'+safe.replace(/"/g,'""')+'"';
}
export function dynamicCsv(item,values){
 const rows=dynamicRows(item,values);
 return '\uFEFF'+[item.columns.map(c=>safeCsvCell(c.label)).join(','),...rows.map(r=>item.columns.map(c=>safeCsvCell(r[c.id])).join(','))].join('\r\n');
}
export function executeDynamicActions(element,button,values,visible={}){
 const errors={},updates={...values},visibility={...visible},events=[];
 // 'required' applies only to relevant form controls, never to unrelated hidden controls.
 const actionable=element.items.filter(x=>['input','select','checkbox'].includes(x.kind)&&x.required&&visibility[x.id]!==false&&(!x.visibleWhen||String(values[x.visibleWhen.field]||'')===x.visibleWhen.equals));
 if(button.actions?.some(a=>a.type==='navigate')||button.nextScreen)for(const x of actionable){
  if(x.kind==='checkbox'?values[x.id]!=='true':!String(values[x.id]||'').trim())errors[x.id]=x.kind==='checkbox'?'Please check this box':'Required field';
 }
 if(Object.keys(errors).length)return{values:updates,visibility,errors,events};
 for(const a of button.actions||[]){
  if(a.type==='set')updates[a.target]=a.value;
  if(a.type==='toggle')updates[a.target]=updates[a.target]==='true'?'false':'true';
  if(a.type==='increment')updates[a.target]=String((Number(updates[a.target])||0)+(a.amount??1));
  if(a.type==='reset')for(const x of element.items)if(['input','select','checkbox'].includes(x.kind))updates[x.id]='';
  if(a.type==='show')visibility[a.target]=true;
  if(a.type==='hide')visibility[a.target]=false;
  if(a.type==='notice')events.push({type:'notice',message:a.message});
  if(a.type==='navigate')events.push({type:'navigate',screen:a.screen});
  if(a.type==='download-csv')events.push({type:'download-csv',target:a.target});
 }
 if(button.nextScreen)events.push({type:'navigate',screen:button.nextScreen});
 return{values:updates,visibility,errors,events};
}
