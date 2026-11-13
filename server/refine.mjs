// Piece 3: target, patch, verify. No model-generated code is executed.
export function locateScreen(demo, requestedId, instruction=''){
 if(!demo||!Array.isArray(demo.screens)||!demo.screens.length)throw Error('No demo screens to refine.');
 const explicit=demo.screens.find(s=>s.id===requestedId);
 // The explicitly selected preview screen is authoritative.
 if(explicit)return explicit;
 const normalized=String(instruction).toLowerCase();
 const mentioned=demo.screens.filter(s=>normalized.includes(s.title.toLowerCase())||normalized.includes(s.id.toLowerCase().replaceAll('-',' ')));
 if(mentioned.length===1)return mentioned[0];
 throw Error('Select the target screen in the preview before requesting a refinement.');
}
export function applyScreenPatch(demo,screenId,updated,validateDemo){
 if(!demo||!Array.isArray(demo.screens))throw Error('Existing demo missing.');
 const idx=demo.screens.findIndex(s=>s.id===screenId);
 if(idx<0)throw Error('Target screen no longer exists.');
 if(!updated||typeof updated!=='object'||Array.isArray(updated)||updated.id!==screenId||!Array.isArray(updated.elements))throw Error('AI changed the screen identity or returned an invalid screen.');
 // Merge only the explicitly requested screen. Other screens are never passed through model output.
 const candidate={...demo,screens:demo.screens.map((s,i)=>i===idx?structuredClone(updated):structuredClone(s))};
 if(!validateDemo(candidate,demo.channel))throw Error('The proposed screen modification failed validation; your existing demo is unchanged.');
 for(let i=0;i<demo.screens.length;i++)if(i!==idx&&JSON.stringify(candidate.screens[i])!==JSON.stringify(demo.screens[i]))throw Error('Preservation check failed: another screen changed.');
 if(JSON.stringify(candidate.screens[idx])===JSON.stringify(demo.screens[idx]))throw Error('AI proposed no changes. Rephrase the instruction and try again.');
 return candidate;
}
export function validateStrictDemo(d,channel){
 if(!d||d.schemaVersion!==1||typeof d.id!=='string'||!d.id||typeof d.name!=='string'||!d.name||d.channel!==channel||!['navy','teal'].includes(d.theme)||!Array.isArray(d.screens)||!d.screens.length||d.screens.length>12)return false;
 const ids=new Set();
 for(const s of d.screens){
  if(!s||typeof s.id!=='string'||!s.id||typeof s.title!=='string'||!s.title||!Array.isArray(s.elements)||s.elements.length>15||ids.has(s.id))return false;
  ids.add(s.id);
  const elIds=new Set();
  for(const e of s.elements){
   if(!e||typeof e.id!=='string'||!e.id||elIds.has(e.id))return false;
   elIds.add(e.id);
   if(e.kind==='hero'&&!(typeof e.title==='string'&&typeof e.description==='string'))return false;
   if(e.kind==='stats'&&(!Array.isArray(e.items)||e.items.some(x=>!x||typeof x.id!=='string'||typeof x.label!=='string'||typeof x.value!=='string')))return false;
   if(e.kind==='notice'&&(!['info','success'].includes(e.tone)||typeof e.title!=='string'||typeof e.body!=='string'))return false;
   if(e.kind==='actions'&&(!Array.isArray(e.buttons)||e.buttons.some(b=>!b||typeof b.id!=='string'||typeof b.label!=='string'||b.nextScreen&&typeof b.nextScreen!=='string')))return false;
   if(e.kind==='form'&&(!Array.isArray(e.fields)||!e.fields.length||typeof e.title!=='string'||typeof e.actionLabel!=='string'||e.fields.some(f=>!f||typeof f.id!=='string'||typeof f.label!=='string'||!['text','email','password','number','select'].includes(f.type))))return false;
   if(e.kind==='table'&&(!Array.isArray(e.columns)||!Array.isArray(e.rows)||e.rows.some(r=>!r||typeof r!=='object'||Object.values(r).some(v=>typeof v!=='string'))))return false;
   if(!['hero','stats','notice','actions','form','table'].includes(e.kind))return false;
  }
 }
 for(const s of d.screens)for(const e of s.elements){
  const links=e.kind==='actions'?e.buttons.map(b=>b.nextScreen):e.kind==='form'?[e.nextScreen]:e.kind==='table'?[e.detailScreen]:[];
  if(links.some(id=>id&&!ids.has(id)))return false;
 }
 return true;
}
