import {validMobilePlacement} from './mobileLayout.mjs';
// Shared, safe mobile component templates; nothing contacts UAE PASS or a biometric service.
// Navigation is first-class so Flow and Design edit the same destination identifiers.
const id=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,60}$/.test(v);
export const mobileTemplateLabels={
 'bottom-nav':'Bottom navigation / footer',
 'mobile-menu':'Mobile menu',
 'uaepass-login':'UAE PASS sign-in (demo)',
 'uaepass-ekyc':'UAE PASS DV eKYC (demo)',
 'face-verification':'Face verification (demo)',
 'otp-entry':'OTP verification',
 'document-upload':'Document upload',
 'search-field':'Search input',
 'progress-steps':'Progress indicator',
 'profile-card':'Profile summary',
};
export function validMobileNavigation(el,screenIds=[]){
 return !!el&&el.kind==='navigation'&&id(el.id)&&['footer','menu'].includes(el.variant)&&validMobilePlacement(el)&&
 typeof el.title==='string'&&el.title.length<=100&&
 Array.isArray(el.links)&&el.links.length>=1&&el.links.length<=6&&
 new Set(el.links.map(l=>l.id)).size===el.links.length&&
 el.links.every(l=>l&&id(l.id)&&typeof l.label==='string'&&l.label.trim()&&l.label.length<=60&&
 (l.screenId===undefined||(typeof l.screenId==='string'&&screenIds.includes(l.screenId))));
}
const safeNotice=message=>[{type:'notice',message}];
export function mobileTemplate(kind,id){
 const text=(suffix,label,text)=>({id:suffix,kind:'text',label,text});
 const card=(suffix,label,text)=>({id:suffix,kind:'card',label,text});
 const button=(suffix,label,message)=>({id:suffix,kind:'button',label,actions:safeNotice(message)});
 const composed=(title,items)=>({id,kind:'composed',title,items});
 if(kind==='bottom-nav')return{id,kind:'navigation',variant:'footer',placement:'bottom',title:'Bottom Navigation',links:[
  {id:'home',label:'Home'},{id:'services',label:'Services'},{id:'activity',label:'Activity'},{id:'profile',label:'Profile'}]};
 if(kind==='mobile-menu')return{id,kind:'navigation',variant:'menu',placement:'header-right',title:'Menu',links:[
  {id:'dashboard',label:'Dashboard'},{id:'applications',label:'Applications'},{id:'documents',label:'Documents'},{id:'settings',label:'Settings'}]};
 if(kind==='uaepass-login')return composed('UAE PASS sign-in — simulated',[
  card('intro','Sign in securely','Authenticate with UAE PASS to continue. This is a fictional local demo, not an official UAE PASS login.'),
  text('details','Demo instructions','In a real integration, authentication happens through the official UAE PASS service.'),
  button('sign-in','Continue with UAE PASS (demo)','Simulated sign-in step completed. No UAE PASS request was sent.')
 ]);
 if(kind==='uaepass-ekyc')return composed('eKYC · UAE PASS Digital Vault — simulated',[
  card('intro','Identity and document verification','This is a demonstration of the requested UAE PASS data/document-sharing journey. No real personal records are retrieved.'),
  {id:'consent',kind:'checkbox',label:'I agree to share my identity details for this demonstration',required:true},
  card('attributes','Sample identity details','Name: Demo Customer · Emirates ID: XXX-XXXX-XXXXXXX-X · Account: Verified (sample only)'),
  button('share','Retrieve documents (demo)','Sample identity/document information displayed. No UAE PASS Digital Vault connection was made.')
 ]);
 if(kind==='face-verification')return composed('Face verification — simulated',[
  card('camera','Face scan preview','Camera and biometric matching are not activated. No image, biometric template or face data is captured.'),
  text('tips','Positioning guidance','Center your face in the outline and ensure adequate lighting. This is an illustrative step.'),
  button('verify','Simulate face verification','Demo verification complete. No facial recognition or liveness check was performed.')
 ]);
 if(kind==='otp-entry')return composed('OTP verification — simulated',[
  text('hint','One-time passcode','Enter the demonstration code shown by your tester. No SMS is sent.'),
  {id:'otp',kind:'input',label:'Verification code',inputType:'text',required:true,text:'Enter code'},
  button('verify','Verify code (demo)','Demo code submitted. This is not an actual OTP validation.')
 ]);
 if(kind==='document-upload')return{id,kind:'form',title:'Document upload',description:'Choose a local file for this demo. No data is transmitted.',fields:[
  {id:'doc-type',label:'Document Type',type:'select',options:['Emirates ID','Passport','Proof of Address'],required:true},
  {id:'doc-file',label:'Choose Document',type:'file',required:true}
 ],actionLabel:'Continue'};
 if(kind==='search-field')return composed('Search',[
  {id:'search',kind:'input',label:'Search',inputType:'text',text:'Search by name or reference'},
  button('search-btn','Search (demo)','Use this component with local demo data; no backend search is performed.')
 ]);
 if(kind==='progress-steps')return composed('Application progress',[
  {id:'progress',kind:'progress',label:'Onboarding progress',value:25},
  text('step','Current step','Step 1 of 4 · Registration')
 ]);
 if(kind==='profile-card')return composed('Customer profile',[
  card('identity','Demo Customer','Account holder · UAE resident · Fictional sample data'),
  text('reference','Reference','DEMO-1001')
 ]);
 throw Error('Unknown mobile template.');
}
export function editNavigationItem(d,screenId,elementId,linkId,changes){
 const next=structuredClone(d),screen=next.screens.find(s=>s.id===screenId),el=screen?.elements.find(e=>e.id===elementId);
 if(el?.kind!=='navigation')throw Error('Navigation component not found.');
 const link=el.links.find(l=>l.id===linkId);
 if(!link)throw Error('Navigation item not found.');
 if(Object.keys(changes).some(k=>!['label','screenId'].includes(k)))throw Error('Unsupported navigation property.');
 if(changes.label!==undefined){
  if(typeof changes.label!=='string'||!changes.label.trim()||changes.label.length>60)throw Error('Navigation label is invalid.');
  link.label=changes.label.trim();
 }
 if(changes.screenId!==undefined){
  if(changes.screenId!==''&&!next.screens.some(s=>s.id===changes.screenId))throw Error('Destination does not exist.');
  if(changes.screenId==='')delete link.screenId;else link.screenId=changes.screenId;
 }
 return next;
}
