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

// Convert business requirements into a scoped, evidence-preserving batch.
// Global requirements remain visible to every batch, but specific screen details
// are sent only for the screens that batch is allowed to create.
export function plannedBatchPayload(requirement,fullPlan,group,meta={}){
 if(typeof requirement!=='string'||!Array.isArray(fullPlan)||!Array.isArray(group)||!group.length)throw Error('Invalid screen generation input.');
 const headings=[...requirement.matchAll(/^\\s{0,3}#{1,5}\\s*Screen\\s+(\\d{1,2})\\s*[-–—:]\\s*.+?\\s*$/gim)];
 const sections=new Map();
 for(let i=0;i<headings.length;i++){
  const start=headings[i].index, end=i+1<headings.length?headings[i+1].index:requirement.length;
  sections.set(Number(headings[i][1]),requirement.slice(start,end).trim());
 }
 const globalContext=requirement.slice(0,headings[0]?.index??0).trim();
 const expected=fullPlan.map(x=>({id:x.id,title:x.title}));
 return {
  task:'Generate exactly the supplied batch screens as a valid JSON object. Do not generate screens outside the batch.',
  project:{name:String(meta.name||''),company:String(meta.company||''),channel:meta.channel,designGuidelines:String(meta.designGuidelines||'')},
  globalRequirements:globalContext,
  availableScreensForNavigation:expected,
  screensToGenerate:group.map(x=>({id:x.id,title:x.title,requirements:sections.get(x.number)||x.title})),
  expectedOutput:{screens:group.map(x=>({id:x.id,title:x.title,subtitle:'string',elements:'1-4 valid top-level components'}))},
  rules:{fixedScreenIds:true,additionalScreens:false,screenCount:group.length,fictionalDataOnly:true,simulatedExternalServices:true}
 };
}
// JSON mode requires the actual input to explicitly demand JSON output, not
// merely supply a JSON-encoded requirements object.
export function plannedBatchInput(request){
 return 'Return only a valid JSON object with a screens array. The output must be JSON, without markdown or commentary.\\n'+JSON.stringify(request);
}
