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
export function decodeSnapshot(encoded){
 if(typeof encoded!=='string'||!encoded||encoded.length>32000)throw Error('Invalid or oversized published link.');
 const decoded=new TextDecoder('utf-8',{fatal:true}).decode(base64UrlToBytes(encoded));
 const snap=JSON.parse(decoded);
 if(!snap||snap.shareVersion!==VERSION||!Number.isSafeInteger(snap.version)||snap.version<1||typeof snap.projectName!=='string'||typeof snap.publishedAt!=='string'||!snap.demo||typeof snap.demo!=='object')throw Error('Unsupported published demo link.');
 return snap;
}
export function isViewerPath(hash){return typeof hash==='string'&&hash.startsWith('#/view/');}
