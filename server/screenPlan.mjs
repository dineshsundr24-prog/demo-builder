// The BA owns the explicitly numbered screen list. AI is allowed to author
// content within those slots, not add/delete/rename slots during generation.
const slug=text=>String(text).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,48)||'screen';
export function explicitScreenPlan(requirement,max=12){
 if(typeof requirement!=='string')return null;
 const re=/^\s{0,3}#{1,5}\s*Screen\s+(\d{1,2})\s*[-–—:]\s*(.+?)\s*$/gim;
 const entries=[...requirement.matchAll(re)].map(m=>({number:Number(m[1]),title:m[2].replace(/\*+/g,'').trim().slice(0,85)}));
 if(entries.length<2||entries.length>max||new Set(entries.map(e=>e.number)).size!==entries.length)return null;
 if(entries.some((e,i)=>e.number!==i+1||!e.title))return null;
 const ids=new Set();
 return entries.map(({title,number})=>{
  const base=slug(title);let id=base,n=2;
  while(ids.has(id))id=base+'-'+n++;
  ids.add(id);
  return{id,title,number};
 });
}
export function plannedScreenGroups(plan,size=3){
 if(!Array.isArray(plan)||plan.length<2)return[];
 const groups=[];for(let i=0;i<plan.length;i+=size)groups.push(plan.slice(i,i+size));
 return groups;
}
export function mergePlannedScreens(plan,batches,meta){
 if(!Array.isArray(plan)||!Array.isArray(batches))throw Error('Missing planned screens.');
 const flat=batches.flatMap(b=>b.screens||[]);
 if(flat.length!==plan.length)throw Error('Generated batch count does not match approved screen list.');
 const byId=new Map();
 for(const screen of flat){
  if(!screen||typeof screen.id!=='string'||byId.has(screen.id))throw Error('Generated batch has invalid or duplicate screen IDs.');
  byId.set(screen.id,screen);
 }
 const screens=plan.map(slot=>{
  const screen=byId.get(slot.id);
  if(!screen||!Array.isArray(screen.elements)||!screen.elements.length)throw Error('The generated screen '+slot.title+' is missing or empty.');
  return{...screen,id:slot.id,title:slot.title};
 });
 if(byId.size!==plan.length)throw Error('AI generated an unplanned screen.');
 return{schemaVersion:1,id:meta.id,name:meta.name,description:meta.description,theme:meta.theme,channel:meta.channel,screens};
}

// JSON mode requires the input message itself to instruct JSON generation.
export function plannedBatchInput(request){
 return 'Return only a valid JSON object containing the exact requested screens array.\\n'+JSON.stringify(request);
}
