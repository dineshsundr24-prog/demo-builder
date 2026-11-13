// Piece 3: target, patch, verify. No model-generated code is executed.
function normalize(value){
 return String(value||'').toLowerCase().replace(/\b(registration|register|sign\s?up|signup|create account|account creation)\b/g,' register ').replace(/\b(verification|verify|identity verification|ekyc|e-kyc)\b/g,' verify ').replace(/\b(terms and conditions|consents|consent)\b/g,' consent ').replace(/\b(completion|confirmation|success)\b/g,' complete ').replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');
}
const intents=['register','verify','consent','complete','welcome','income','profile','dashboard','application','payment','review','loan','document','account'];
export function locateScreen(demo, requestedId, instruction=''){
 if(!demo||!Array.isArray(demo.screens)||!demo.screens.length)throw Error('No demo screens to refine.');
 const selected=demo.screens.find(s=>s.id===requestedId);
 const text=String(instruction||'');
 const normalized=normalize(text);
 // Explicit named targets always override the preview selection. This is not a model guess.
 const explicit=demo.screens.filter(s=>{
  const title=normalize(s.title),id=normalize(s.id.replace(/[-_]/g,' '));
  const titleRaw=String(s.title).toLowerCase();
  return (title.length>3&&normalized.includes(title))||(id.length>3&&normalized.includes(id))||
   (titleRaw.length>3&&text.toLowerCase().includes(titleRaw));
 });
 if(explicit.length===1)return explicit[0];
 if(explicit.length>1)throw Error('Multiple screen names were referenced. Please name exactly one screen to edit.');
 // Support natural phrasing: "On the Registration screen" even if tab is "Register Your Account".
 const phrase=text.match(/\b(?:on|in|update|change|edit|modify|refine)\s+(?:the\s+)?([a-z][a-z0-9\s&/-]{1,65}?)\s+screen\b/i);
 if(phrase){
  const target=normalize(phrase[1]);
  const wanted=intents.filter(word=>target.split(' ').includes(word));
  if(wanted.length){
   const found=demo.screens.filter(s=>wanted.some(word=>(normalize(s.title)+' '+normalize(s.id)).split(' ').includes(word)));
   if(found.length===1)return found[0];
   if(found.length>1)throw Error('More than one screen matches the instruction. Select the desired preview screen and use its full title.');
  }
  // An explicitly different screen was named but could not be found. Do not silently edit the selected screen.
  if(target&&!/^(this|current|selected|active|same)$/.test(target)){
   throw Error('No screen matches "'+phrase[1].trim()+'". Choose an existing screen tab or use its exact title.');
  }
 }
 // If the instruction has a unique specific workflow keyword in the same sentence as "screen", resolve it.
 const firstSentence=normalize(text.split(/[.!?\n]/)[0]);
 const keywords=intents.filter(word=>firstSentence.split(' ').includes(word));
 if(keywords.length===1){
  const found=demo.screens.filter(s=>(normalize(s.title)+' '+normalize(s.id)).split(' ').includes(keywords[0]));
  if(found.length===1)return found[0];
 }
 if(selected)return selected;
 throw Error('Select a target screen in the preview or mention an existing screen by name.');
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
 if(d.chrome&&(!d.chrome.brandName||typeof d.chrome.brandName!=='string'||d.chrome.brandName.length>100||typeof d.chrome.showBrandIcon!=='boolean'||typeof d.chrome.showBackButton!=='boolean'))return false;
 const ids=new Set();
 for(const s of d.screens){
  if(!s||typeof s.id!=='string'||!s.id||typeof s.title!=='string'||!s.title||!Array.isArray(s.elements)||s.elements.length>15||ids.has(s.id))return false;
  if(s.chrome&&(!Object.keys(s.chrome).length||Object.keys(s.chrome).some(k=>!['brandName','showBrandIcon','showBackButton'].includes(k))||(s.chrome.brandName!==undefined&&(typeof s.chrome.brandName!=='string'||!s.chrome.brandName.trim()||s.chrome.brandName.length>100))||(s.chrome.showBrandIcon!==undefined&&typeof s.chrome.showBrandIcon!=='boolean')||(s.chrome.showBackButton!==undefined&&typeof s.chrome.showBackButton!=='boolean')))return false;
  ids.add(s.id);
  const elIds=new Set();
  for(const e of s.elements){
   if(!e||typeof e.id!=='string'||!e.id||elIds.has(e.id))return false;
   elIds.add(e.id);
   if(e.kind==='hero'&&!(typeof e.title==='string'&&typeof e.description==='string'))return false;
   if(e.kind==='stats'&&(!Array.isArray(e.items)||e.items.some(x=>!x||typeof x.id!=='string'||typeof x.label!=='string'||typeof x.value!=='string')))return false;
   if(e.kind==='notice'&&(!['info','success'].includes(e.tone)||typeof e.title!=='string'||typeof e.body!=='string'))return false;
   if(e.kind==='actions'&&(!Array.isArray(e.buttons)||e.buttons.some(b=>!b||typeof b.id!=='string'||typeof b.label!=='string'||b.nextScreen&&typeof b.nextScreen!=='string')))return false;
   if(e.kind==='form'&&(!Array.isArray(e.fields)||!e.fields.length||typeof e.title!=='string'||typeof e.actionLabel!=='string'||e.fields.some(f=>!f||typeof f.id!=='string'||typeof f.label!=='string'||!['text','email','password','number','select','date'].includes(f.type))))return false;
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
