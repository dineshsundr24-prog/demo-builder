// One row-action contract for all tabular components and destinations.
// No executable expressions or direct mutations of row data.
const isString=(v,max=160)=>typeof v==='string'&&v.length<=max;
export function validTableRowAction(action,screenIds=[]){
 if(action===undefined)return true;
 return !!action&&action.type==='navigate'&&isString(action.label,60)&&action.label.trim()&&
 isString(action.screenId,120)&&screenIds.includes(action.screenId)&&
 (action.passRow===undefined||typeof action.passRow==='boolean');
}
export function configureTableRowAction(d,sourceScreenId,elementId,destinationId,{label='View',passRow=true,itemId}={}){
 const next=structuredClone(d);
 const screen=next.screens.find(s=>s.id===sourceScreenId);
 if(!screen)throw Error('Source page no longer exists.');
 const element=screen.elements.find(e=>e.id===elementId);
 if(!element)throw Error('Table no longer exists.');
 if(destinationId&&(!next.screens.some(s=>s.id===destinationId)||destinationId===sourceScreenId))throw Error('Choose a different, existing destination page.');
 if(typeof label!=='string'||!label.trim()||label.length>60)throw Error('Action label must be 1–60 characters.');
 let table=element;
 if(itemId!==undefined){
  if(element.kind!=='composed')throw Error('Generated table section does not exist.');
  table=element.items.find(x=>x.id===itemId);
 }
 if(table?.kind!=='table')throw Error('Choose a data table.');
 if(destinationId){table.rowAction={type:'navigate',label:label.trim(),screenId:destinationId,passRow:!!passRow};if(element.kind==='table')table.detailScreen=destinationId;}
 else{delete table.rowAction;if(element.kind==='table')delete table.detailScreen;}
 return next;
}
export function effectiveTableAction(table){
 if(table?.rowAction?.type==='navigate')return table.rowAction;
 if(table?.kind==='table'&&table?.detailScreen)return{type:'navigate',label:'View',screenId:table.detailScreen,passRow:true};
 return null;
}
export function selectedRowContext(destinationId,table,row,sourceScreenId){
 const action=effectiveTableAction(table);
 if(!action||action.screenId!==destinationId||action.passRow===false)return null;
 const columns=(table.columns||[]).filter(c=>c.id!=='action'&&c.id!=='actions').slice(0,24);
 return{destinationId,sourceScreenId,columns:columns.map(c=>({id:c.id,label:c.label})),
  row:Object.fromEntries(columns.map(c=>[c.id,String(row?.[c.id]??'').slice(0,500)]))};
}
