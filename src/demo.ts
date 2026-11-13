// Versioned, declarative demo contract. No eval, Function constructor, or arbitrary code.
export type Field = {id:string;label:string;type:'text'|'email'|'password'|'number'|'select'|'date';placeholder?:string;required?:boolean;options?:string[]};
export type Element =
  | {id:string;kind:'hero';eyebrow?:string;title:string;description:string}
  | {id:string;kind:'stats';items:{id:string;label:string;value:string;delta?:string}[]}
  | {id:string;kind:'form';title:string;description?:string;fields:Field[];actionLabel:string;nextScreen?:string}
  | {id:string;kind:'table';title:string;subtitle?:string;columns:{id:string;label:string}[];rows:Record<string,string>[];detailScreen?:string}
  | {id:string;kind:'notice';tone:'info'|'success';title:string;body:string}
  | {id:string;kind:'actions';buttons:{id:string;label:string;variant?:'primary'|'secondary';nextScreen?:string}[]};
export type ScreenChrome={brandName?:string;showBrandIcon?:boolean;showBackButton?:boolean};
export type Screen = {id:string;title:string;subtitle:string;elements:Element[];chrome?:ScreenChrome};
export type DemoChrome={brandName:string;showBrandIcon:boolean;showBackButton:boolean};
export type DemoDefinition = {schemaVersion:1;id:string;name:string;description:string;channel:'portal'|'mobile';theme:'navy'|'teal';chrome?:DemoChrome;screens:Screen[]};
export const starter:DemoDefinition = {
 schemaVersion:1,id:'banking-operations',name:'Banking Operations',description:'Customer onboarding and servicing workflow',channel:'portal',theme:'navy',
 screens:[
 {id:'overview',title:'Overview',subtitle:'Operational visibility across your onboarding pipeline',elements:[
  {id:'overview-hero',kind:'hero',eyebrow:'WORKSPACE OVERVIEW',title:'Good morning, Alex',description:'Here is what is happening across your applications today.'},
  {id:'overview-stats',kind:'stats',items:[{id:'active',label:'Active applications',value:'1,284',delta:'+12.8%'},{id:'pending',label:'Pending review',value:'38',delta:'8 priority'},{id:'approved',label:'Approved this month',value:'426',delta:'+6.4%'}]},
  {id:'overview-table',kind:'table',title:'Recent applications',subtitle:'Track the status of your latest requests',columns:[{id:'reference',label:'Application ID'},{id:'customer',label:'Customer'},{id:'product',label:'Product'},{id:'status',label:'Status'}],rows:[{reference:'APP-20481',customer:'Sarah Ahmed',product:'Home Finance',status:'In review'},{reference:'APP-20480',customer:'Omar Khalid',product:'Home Finance',status:'Approved'},{reference:'APP-20479',customer:'Maya Hassan',product:'Personal Finance',status:'Pending'},{reference:'APP-20478',customer:'Ali Mansoor',product:'Home Finance',status:'Approved'}],detailScreen:'application'}
 ]},
 {id:'applications',title:'Applications',subtitle:'Search and review submitted customer applications',elements:[
 {id:'application-list',kind:'table',title:'All applications',subtitle:'Select an application to review its details',columns:[{id:'reference',label:'Application ID'},{id:'customer',label:'Customer name'},{id:'product',label:'Product'},{id:'status',label:'Status'}],rows:[{reference:'APP-20481',customer:'Sarah Ahmed',product:'Home Finance',status:'In review'},{reference:'APP-20480',customer:'Omar Khalid',product:'Home Finance',status:'Approved'},{reference:'APP-20479',customer:'Maya Hassan',product:'Personal Finance',status:'Pending'},{reference:'APP-20478',customer:'Ali Mansoor',product:'Home Finance',status:'Approved'}],detailScreen:'application'}]},
 {id:'application',title:'Application review',subtitle:'Review customer information and complete the assessment',elements:[
 {id:'application-notice',kind:'notice',tone:'info',title:'Review required',body:'Verify the customer information before proceeding.'},
 {id:'application-form',kind:'form',title:'Customer information',description:'Fields marked with an asterisk are required.',fields:[{id:'applicant',label:'Customer name',type:'text',placeholder:'Sarah Ahmed',required:true},{id:'email',label:'Email address',type:'email',placeholder:'customer@example.com',required:true},{id:'loan',label:'Requested amount (AED)',type:'number',placeholder:'750000',required:true},{id:'decision',label:'Review decision',type:'select',options:['Approved','Request more information','Rejected'],required:true}],actionLabel:'Submit review',nextScreen:'complete'}]},
 {id:'complete',title:'Review complete',subtitle:'Application review has been recorded',elements:[
 {id:'complete-success',kind:'notice',tone:'success',title:'Review submitted successfully',body:'Your changes were saved in this demo session.'},
 {id:'complete-action',kind:'actions',buttons:[{id:'back',label:'Return to applications',nextScreen:'applications'}]}]}
 ]};
export const mobileStarter:DemoDefinition={
 schemaVersion:1,id:'mobile-onboarding',name:'Customer Onboarding',description:'A mobile account opening journey',channel:'mobile',theme:'teal',
 screens:[
 {id:'welcome',title:'Welcome',subtitle:'Your banking, made simple',elements:[
 {id:'welcome-hero',kind:'hero',eyebrow:'WELCOME',title:'Banking that moves with you',description:'Open your account in a few simple steps. Secure, seamless, and designed around you.'},
 {id:'welcome-actions',kind:'actions',buttons:[{id:'get-started',label:'Get started',nextScreen:'profile'}]}]},
 {id:'profile',title:'Your details',subtitle:'Tell us a little about yourself',elements:[
 {id:'profile-form',kind:'form',title:'Personal details',fields:[{id:'full-name',label:'Full name',type:'text',placeholder:'Enter your full name',required:true},{id:'mobile',label:'Mobile number',type:'text',placeholder:'+971 50 000 0000',required:true},{id:'email',label:'Email address',type:'email',placeholder:'you@example.com',required:true}],actionLabel:'Continue',nextScreen:'verify'}]},
 {id:'verify',title:'Verification',subtitle:'Confirm your identity',elements:[
 {id:'verification-notice',kind:'notice',tone:'info',title:'Identity verification',body:'This is an interactive prototype. No verification service is contacted.'},
 {id:'verify-form',kind:'form',title:'Enter verification code',fields:[{id:'otp',label:'6-digit code',type:'text',placeholder:'123456',required:true}],actionLabel:'Verify and continue',nextScreen:'done'}]},
 {id:'done',title:'All set',subtitle:'Your journey is complete',elements:[
 {id:'done-notice',kind:'notice',tone:'success',title:'Details submitted',body:'Your onboarding demo is complete. No real account has been created.'},
 {id:'restart',kind:'actions',buttons:[{id:'start-again',label:'Start again',nextScreen:'welcome'}]}]}
 ]};
export function validateDemo(value:unknown):value is DemoDefinition {
 if(!value||typeof value!=='object')return false;
 const d=value as Partial<DemoDefinition>;
 if(d.chrome&&(!d.chrome.brandName||typeof d.chrome.brandName!=='string'||d.chrome.brandName.length>100||typeof d.chrome.showBrandIcon!=='boolean'||typeof d.chrome.showBackButton!=='boolean'))return false;
 if(d.schemaVersion!==1||!d.id||!d.name||!['portal','mobile'].includes(d.channel||'')||!['navy','teal'].includes(d.theme||'')||!Array.isArray(d.screens)||d.screens.length===0)return false;
 const ids=new Set<string>();
 for(const s of d.screens){if(!s||typeof s.id!=='string'||!s.title||!Array.isArray(s.elements)||ids.has(s.id))return false;
 if(s.chrome&&(!Object.keys(s.chrome).length||Object.keys(s.chrome).some(k=>!['brandName','showBrandIcon','showBackButton'].includes(k))||(s.chrome.brandName!==undefined&&(typeof s.chrome.brandName!=='string'||!s.chrome.brandName.trim()||s.chrome.brandName.length>100))||(s.chrome.showBrandIcon!==undefined&&typeof s.chrome.showBrandIcon!=='boolean')||(s.chrome.showBackButton!==undefined&&typeof s.chrome.showBackButton!=='boolean')))return false;
 ids.add(s.id);
 const els=new Set<string>();for(const e of s.elements){if(!e||typeof e.id!=='string'||els.has(e.id)||!['hero','stats','form','table','notice','actions'].includes(e.kind))return false;els.add(e.id);}}
 return d.screens.every(s=>s.elements.every(e=>(e.kind==='form'&&!e.fields.every(f=>!!f.id&&!!f.label&&['text','email','password','number','select','date'].includes(f.type)))?false:true));
}
export function cloneDemo(d:DemoDefinition):DemoDefinition{return JSON.parse(JSON.stringify(d)) as DemoDefinition;}
