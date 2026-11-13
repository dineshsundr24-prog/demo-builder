import {validScreenChrome} from './screenChrome.mjs';
// Portable, immutable viewer snapshots. No credentials, messages or private project context.
// The public URL contains the demo data; only publish information suitable for sharing.
const VERSION=1;
function bytesToBase64Url(bytes){
 let binary='';for(const b of bytes)binary+=String.fromCharCode(b);
 return btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
function base64UrlToBytes(text){
 if(!/^[A-Za-z0-9_-]+$/.test(text))throw Error('Invalid snapshot encoding.');
 const raw=atob(text.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-text.length%4)%4));
 return Uint8Array.from(raw,c=>c.charCodeAt(0));
}
export function makeSnapshot(demo,metadata){
 if(!demo||!Array.isArray(demo.screens)||!demo.screens.length)throw Error('A valid demo is required.');
 const snapshot={shareVersion:VERSION,version:metadata.version,publishedAt:metadata.publishedAt,projectName:String(metadata.projectName||'Demo').slice(0,110),company:String(metadata.company||'').slice(0,110),demo:structuredClone(demo)};
 if(!Number.isSafeInteger(snapshot.version)||snapshot.version<1)throw Error('Invalid version.');
 if(Number.isNaN(Date.parse(snapshot.publishedAt)))throw Error('Invalid publication date.');
 return snapshot;
}
export function encodeSnapshot(snapshot){
 const json=JSON.stringify(snapshot);
 if(json.length>24000)throw Error('This demo is too large for portable link publishing. Export the JSON instead; hosted publishing requires server storage.');
 const bytes=new TextEncoder().encode(json);
 const result=bytesToBase64Url(bytes);
 if(result.length>32000)throw Error('Snapshot URL size limit exceeded. Export JSON instead.');
 return result;
}
export function isValidShareDemo(d){
 if(!d||typeof d!=='object'||d.schemaVersion!==1||typeof d.id!=='string'||typeof d.name!=='string'||!['mobile','portal'].includes(d.channel)||!['navy','teal'].includes(d.theme)||!Array.isArray(d.screens)||!d.screens.length||d.screens.length>12)return false;
 if(d.chrome&&(typeof d.chrome.brandName!=='string'||typeof d.chrome.showBrandIcon!=='boolean'||typeof d.chrome.showBackButton!=='boolean'))return false;
 const screens=new Set();
 for(const sc of d.screens){
  if(!sc||typeof sc.id!=='string'||typeof sc.title!=='string'||typeof sc.subtitle!=='string'||screens.has(sc.id)||!Array.isArray(sc.elements)||sc.elements.length>16||!validScreenChrome(sc.chrome))return false;
  screens.add(sc.id);
  const elements=new Set();
  for(const el of sc.elements){
   if(!el||typeof el.id!=='string'||!el.id||elements.has(el.id))return false;
   elements.add(el.id);
   switch(el.kind){
    case 'hero':if(typeof el.title!=='string'||typeof el.description!=='string')return false;break;
    case 'notice':if(!['info','success'].includes(el.tone)||typeof el.title!=='string'||typeof el.body!=='string')return false;break;
    case 'stats':if(!Array.isArray(el.items)||el.items.length>10||el.items.some(i=>!i||typeof i.id!=='string'||typeof i.label!=='string'||typeof i.value!=='string'))return false;break;
    case 'actions':if(!Array.isArray(el.buttons)||el.buttons.length>12||el.buttons.some(b=>!b||typeof b.id!=='string'||typeof b.label!=='string'||b.nextScreen&&typeof b.nextScreen!=='string'))return false;break;
    case 'table':if(typeof el.title!=='string'||!Array.isArray(el.columns)||el.columns.length>12||el.columns.some(c=>!c||typeof c.id!=='string'||typeof c.label!=='string')||!Array.isArray(el.rows)||el.rows.length>100||el.rows.some(row=>!row||typeof row!=='object'||Array.isArray(row)||Object.values(row).some(v=>typeof v!=='string')))return false;break;
    case 'form':if(typeof el.title!=='string'||typeof el.actionLabel!=='string'||!Array.isArray(el.fields)||!el.fields.length||el.fields.length>20||el.fields.some(f=>!f||typeof f.id!=='string'||typeof f.label!=='string'||!['text','email','password','number','select'].includes(f.type)||f.options&&(!Array.isArray(f.options)||f.options.some(o=>typeof o!=='string'))))return false;break;
    default:return false;
   }
  }
 }
 for(const sc of d.screens)for(const el of sc.elements){
  const links=el.kind==='form'?[el.nextScreen]:el.kind==='actions'?el.buttons.map(b=>b.nextScreen):el.kind==='table'?[el.detailScreen]:[];
  if(links.some(id=>id&&!screens.has(id)))return false;
 }
 return true;
}

export function decodeSnapshot(encoded){
 if(typeof encoded!=='string'||!encoded||encoded.length>32000)throw Error('Invalid or oversized published link.');
 const decoded=new TextDecoder('utf-8',{fatal:true}).decode(base64UrlToBytes(encoded));
 const snap=JSON.parse(decoded);
 if(!snap||snap.shareVersion!==VERSION||!Number.isSafeInteger(snap.version)||snap.version<1||typeof snap.projectName!=='string'||typeof snap.publishedAt!=='string'||!isValidShareDemo(snap.demo))throw Error('Unsupported published demo link.');
 return snap;
}
export function isViewerPath(hash){return typeof hash==='string'&&hash.startsWith('#/view/');}
