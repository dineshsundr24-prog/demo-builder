// @ts-ignore Shared UI and backend proposal verification.
import {verifyEditScope} from './editScope.mjs';
// @ts-ignore Shared portal-navigation helpers.
import {navigationMenuLinks} from './portalMenuLinks.mjs';
import ReportTable from './ReportTable';
import ScreenshotStudio from './ScreenshotStudio';
import ComposedElement from './ComposedElement';
import React,{useEffect,useRef,useState} from 'react';
import{createRoot}from'react-dom/client';
import{ArrowLeft,ArrowRight,Check,CheckCircle2,ChevronDown,ChevronRight,Code2,Copy,Download,Eye,FileJson,FolderPlus,Info,LayoutDashboard,MessageSquare,Monitor,MoreHorizontal,Paperclip,Plus,Minus,RefreshCw,Search,Send,Settings2,ShieldCheck,Smartphone,Sparkles,Upload,Wallet,X,MousePointer2,Maximize2,Minimize2,Images}from'lucide-react';
import{cloneDemo,DemoDefinition,Element,mobileStarter,starter,validateDemo}from './demo';
import PublishedViewer from './PublishedViewer';
// @ts-ignore Shared pure JS contract is also exercised by backend tests.
import {resolveScreenChrome} from './screenChrome.mjs';
// @ts-ignore JS source is shared with Node regression tests.
import{makeSnapshot,encodeSnapshot,decodeSnapshot,isViewerPath}from './publish.mjs';
import './styles.css';
import './workspace.css';

type DemoRevision={id:string;date:string;instruction:string;screenId:string;before:DemoDefinition};
type Target={level:'screen'|'header'|'element'|'field'|'button';screenId:string;elementId?:string;childId?:string};
type AmbiguousTarget={projectId:string;instruction:string;choices:{id:string;label:string;screen:string;type:string;target:Target}[];question:string};
type PendingEdit={projectId:string;instruction:string;target:Target;scope:'global'|'screen';before:DemoDefinition;definition:DemoDefinition;operations:unknown[];checks:string[];summary:string;label:string};
type PublishedVersion={version:number;publishedAt:string;url:string};
type Project={id:string;name:string;company:string;channel:'mobile'|'portal';guidelines:string;requirement:string;generationClarifications?:string[];files:string[];demo:DemoDefinition|null;messages:Message[];revisions?:DemoRevision[];publishedVersions?:PublishedVersion[]};
type Message={id:string;role:'user'|'system';text:string;date:string};
type WorkspaceState={projects:Project[];activeId:string};
const KEY='demo-builder-piece1-v1';
const API='https://demo-builder-ai-nonprod.onrender.com';
const seed:Project={id:'project-example',name:'Banking Onboarding',company:'Example Bank',channel:'mobile',guidelines:'Modern, accessible financial services interface',requirement:'',files:[],demo:null,messages:[]};
function initial():WorkspaceState{try{const raw=localStorage.getItem(KEY);if(raw){const p=JSON.parse(raw) as WorkspaceState;if(Array.isArray(p.projects)&&p.projects.length&&typeof p.activeId==='string')return p;}}catch{}return{projects:[seed],activeId:seed.id};}
function makeId(){return crypto.randomUUID?.()||Math.random().toString(36).slice(2);}
function App(){
 const[state,setState]=useState<WorkspaceState>(initial);
 const[composer,setComposer]=useState('');const[screenId,setScreenId]=useState('');const[expandedPortalMenus,setExpandedPortalMenus]=useState<Record<string,boolean>>({});const[details,setDetails]=useState(false);
 const[createOpen,setCreateOpen]=useState(false);const[createName,setCreateName]=useState('');const[createCompany,setCreateCompany]=useState('');const[createChannel,setCreateChannel]=useState<'mobile'|'portal'>('mobile');
 const[screenshotOpen,setScreenshotOpen]=useState(false);
 const[zoom,setZoom]=useState(100);const[tab,setTab]=useState<'preview'|'definition'>('preview');const[toast,setToast]=useState('');const[search,setSearch]=useState('');const[expanded,setExpanded]=useState(false);
 const[importOpen,setImportOpen]=useState(false);const[jsonDraft,setJsonDraft]=useState('');
 const[publishOpen,setPublishOpen]=useState(false);const[publishedUrl,setPublishedUrl]=useState('');
 const[selectMode,setSelectMode]=useState(false);const[selected,setSelected]=useState<Target|null>(null);const[visualComment,setVisualComment]=useState('');
 const[pending,setPending]=useState<PendingEdit|null>(null);
 const[ambiguity,setAmbiguity]=useState<AmbiguousTarget|null>(null);
 const[generationQuestion,setGenerationQuestion]=useState<{projectId:string;question:string;reason:string;suggestions:string[]}|null>(null);
 const[refinementQuestion,setRefinementQuestion]=useState<{projectId:string;instruction:string;target:Target;question:string;reason:string;options:string[];clarifications:{question:string;answer:string}[]}|null>(null);
 const[aiReady,setAiReady]=useState(false);const[aiOnline,setAiOnline]=useState(false);const[aiModel,setAiModel]=useState('');const[aiBusy,setAiBusy]=useState(false);
 const[accessModal,setAccessModal]=useState(false);const[rememberAI,setRememberAI]=useState(()=>{try{return localStorage.getItem('meyon-demo-ai-remember')==='yes';}catch{return false;}});const[accessToken,setAccessToken]=useState(()=>{try{return sessionStorage.getItem('meyon-demo-ai-access')||(localStorage.getItem('meyon-demo-ai-remember')==='yes'?localStorage.getItem('meyon-demo-ai-saved')||'':'');}catch{return '';}});const[accessDraft,setAccessDraft]=useState('');
 const[formValues,setFormValues]=useState<Record<string,string>>({});const[errors,setErrors]=useState<Record<string,string>>({});
 const fileInput=useRef<HTMLInputElement>(null);const end=useRef<HTMLDivElement>(null);
 const project=state.projects.find(p=>p.id===state.activeId)||state.projects[0];
 const demo=pending?.projectId===project.id?pending.definition:project.demo;
 const screen=demo?.screens.find(s=>s.id===screenId)||demo?.screens[0];
 const activeSelection=selected?.screenId===screen?.id?selected:null;
 const targetName=(t:Target|null)=>{
  if(!t||!demo)return 'Current screen';
  const scr=demo.screens.find(x=>x.id===t.screenId);
  if(!scr)return 'Current screen';
  if(t.level==='screen')return scr.title+' · Entire screen';
  if(t.level==='header')return scr.title+' · Header';
  const el=scr.elements.find(x=>x.id===t.elementId);
  if(t.level==='element')return (el&&'title' in el?String(el.title):el?.kind||'Section')+' · Section';
  if(t.level==='field'&&el?.kind==='form')return (el.fields.find(x=>x.id===t.childId)?.label||'Field')+' · Field';
  if(t.level==='button'&&el?.kind==='actions')return (el.buttons.find(x=>x.id===t.childId)?.label||'Button')+' · Button';
  return 'Selected component';
 };
 function pick(e:React.MouseEvent<HTMLElement>){
  if(!selectMode||!screen)return;
  e.preventDefault();e.stopPropagation();
  const clicked=(e.target as HTMLElement).closest<HTMLElement>('[data-select-level]');
  const level=(clicked?.dataset.selectLevel||'screen') as Target['level'];
  const choice:Target={level,screenId:screen.id};
  if(clicked?.dataset.selectElement)choice.elementId=clicked.dataset.selectElement;
  if(clicked?.dataset.selectChild)choice.childId=clicked.dataset.selectChild;
  setSelected(choice);setVisualComment('');
 }
 const screenChrome=resolveScreenChrome(demo,screen,project.company,project.name);
 const brandName=screenChrome.brandName;
 const showBrandIcon=screenChrome.showBrandIcon;
 const showBackButton=screenChrome.showBackButton;
 useEffect(()=>{try{localStorage.setItem(KEY,JSON.stringify(state));}catch{setToast('Browser storage is unavailable. Export your definition before leaving.');}},[state]);
 useEffect(()=>{end.current?.scrollIntoView({behavior:'smooth',block:'nearest'});},[project.messages.length,project.id]);
 useEffect(()=>{const controller=new AbortController();fetch(API+'/api/status',{signal:controller.signal}).then(r=>r.ok?r.json():Promise.reject(Error('unavailable'))).then(v=>{setAiReady(Boolean(v.ready));setAiOnline(true);setAiModel(String(v.model||''));}).catch(()=>{if(!controller.signal.aborted){setAiOnline(false);setAiReady(false);}});return()=>controller.abort();},[]);
 function updateProject(change:Partial<Project>){setState(s=>({...s,projects:s.projects.map(p=>p.id===s.activeId?{...p,...change}:p)}));}
 function switchProject(id:string){setState(s=>({...s,activeId:id}));setScreenId('');setComposer('');setErrors({});setSearch('');setSelected(null);setSelectMode(false);setPending(null);setAmbiguity(null);setGenerationQuestion(null);setRefinementQuestion(null);}
 function createProject(){const name=createName.trim();if(!name){setToast('Enter a project name.');return;}const p:Project={id:makeId(),name,company:createCompany.trim(),channel:createChannel,guidelines:'',requirement:'',files:[],demo:null,messages:[]};setState(s=>({projects:[...s.projects,p],activeId:p.id}));setScreenId('');setCreateOpen(false);setCreateName('');setCreateCompany('');setComposer('');}
 async function generateFor(projectSnapshot:Project,brief:string){
  if(aiBusy)return;
  if(!aiReady){setToast('AI server is not configured yet. Add the OpenAI API key on Render.');return;}
  if(!accessToken){setAccessModal(true);setToast('Enter the Demo Builder access token to enable generation.');return;}
  setAiBusy(true);
  const target=projectSnapshot.id;
  try{
    const result=await fetch(API+'/api/generate',{method:'POST',headers:{'Content-Type':'application/json','x-builder-access':accessToken},body:JSON.stringify({project:{name:projectSnapshot.name,company:projectSnapshot.company,channel:projectSnapshot.channel,guidelines:projectSnapshot.guidelines},requirement:[brief,...(projectSnapshot.generationClarifications||[]).map(x=>'Clarification from product owner: '+x)].join('\n\n')})});
    const data=await result.json();
    if(!result.ok)throw Error(String(data.error||'Generation failed.'));
    if(data.needsClarification&&typeof data.question==='string'){
      const suggestions=Array.isArray(data.suggestions)?data.suggestions.filter((x:unknown):x is string=>typeof x==='string').slice(0,3):[];
      setGenerationQuestion({projectId:target,question:data.question,reason:String(data.reason||''),suggestions});
      setState(prev=>({...prev,projects:prev.projects.map(p=>p.id===target?{...p,messages:[...p.messages,{id:makeId(),role:'system',text:data.question,date:new Date().toISOString()}]}:p)}));
      setToast('MEYON needs one clarification. Your original brief is preserved.');
      return;
    }
    setGenerationQuestion(null);
    if(!validateDemo(data.definition)||data.definition.channel!==projectSnapshot.channel)throw Error('Generated demo did not pass client validation.');
    const msg:Message={id:makeId(),role:'system',text:String(data.summary||'Demo generated successfully.')+'\nModel: '+String(data.usage?.model||'Configured model')+' · Input tokens: '+String(data.usage?.inputTokens||0)+' · Output tokens: '+String(data.usage?.outputTokens||0),date:new Date().toISOString()};
    setState(prev=>({...prev,projects:prev.projects.map(p=>p.id===target?{...p,demo:cloneDemo(data.definition),revisions:[],messages:[...p.messages,msg]}:p)}));
    if(state.activeId===target){setScreenId(data.definition.screens[0].id);setTab('preview');setFormValues({});}
    setSelected(null);setPending(null);setToast('AI generated '+data.definition.screens.length+' interactive screens.');
  }catch(err){const message=err instanceof Error?err.message:'Unable to connect to AI service.';setToast(message);}
  finally{setAiBusy(false);}
 }
 async function refineFor(projectSnapshot:Project,instruction:string,targetScreenId:string,override?:Target,clarifications:{question:string;answer:string}[]=[]){
  if(aiBusy||!projectSnapshot.demo)return;
  if(pending){setToast('Apply or discard the pending preview before requesting another change.');return;}
  if(!aiReady){setToast('AI backend is not ready. Original demo unchanged.');return;}
  if(!accessToken){setAccessModal(true);setToast('Connect the AI access token first.');return;}
  const target:Target=override||{level:'screen',screenId:targetScreenId};
  const before=cloneDemo(projectSnapshot.demo);
  setAmbiguity(null);
  setAiBusy(true);
  try{
   const response=await fetch(API+'/api/plan',{method:'POST',headers:{'Content-Type':'application/json','x-builder-access':accessToken},
    body:JSON.stringify({project:{name:projectSnapshot.name,company:projectSnapshot.company,channel:projectSnapshot.channel,guidelines:projectSnapshot.guidelines},definition:before,target,instruction,clarifications})});
   const result=await response.json();
   if(response.ok&&result.planningFailed){
    const code=typeof result.errorCode==='string'?result.errorCode:'PLAN_EXECUTION';
    const message=String(result.reason||'MEYON could not safely complete this edit.');
    setRefinementQuestion(null);
    setState(prev=>({...prev,projects:prev.projects.map(p=>p.id===projectSnapshot.id?{...p,messages:[...p.messages,{id:makeId(),role:'system',text:'No changes applied ('+code+'): '+message+' The existing demo is preserved.',date:new Date().toISOString()}]}:p)}));
    setToast(message);
    return;
   }
   if(response.ok&&result.needsClarification&&typeof result.question==='string'){
    const choices=Array.isArray(result.options)?result.options.filter((x:unknown):x is string=>typeof x==='string').slice(0,4):[];
    if(clarifications.some(q=>q.question.trim().toLowerCase()===result.question.trim().toLowerCase())){
     throw Error('MEYON could not implement the previously clarified interaction. Your original demo is preserved; please review the chosen capability rather than answering the same question again.');
    }
    setRefinementQuestion({projectId:projectSnapshot.id,instruction,target,question:result.question,reason:String(result.reason||''),options:choices,clarifications});
    setState(prev=>({...prev,projects:prev.projects.map(p=>p.id===projectSnapshot.id?{...p,messages:[...p.messages,{id:makeId(),role:'system',text:result.question,date:new Date().toISOString()}]}:p)}));
    setToast('MEYON needs one clarification. No existing screens were changed.');
    return;
   }
   if(!response.ok){
    if(result.code==='AMBIGUOUS_TARGET'&&Array.isArray(result.choices)){
     setAmbiguity({projectId:projectSnapshot.id,instruction,choices:result.choices,question:String(result.error||'Which component do you mean?')});
     setToast('Select the correct component to continue.');
     return;
    }
    throw Error(String(result.error||'Unable to prepare edit.'));
   }
   setRefinementQuestion(null);
   const next=result.definition as DemoDefinition;
   const addedSubsections=Array.isArray(result.operations)?result.operations.filter((o:{op?:string})=>o.op==='add-subsection').length:0;
   if(!validateDemo(next)||next.channel!==before.channel||next.screens.length!==before.screens.length+addedSubsections)throw Error('Plan failed schema validation.');
   const isGlobal=result.scope==='global';
   verifyEditScope(before,next,target,isGlobal?'global':'screen',result.operations||[]);
   const draft:PendingEdit={projectId:projectSnapshot.id,instruction,target,scope:isGlobal?'global':'screen',before,definition:cloneDemo(next),operations:result.operations||[],checks:result.checks||[],summary:String(result.summary||'Scoped edit prepared.'),label:String(result.label||targetName(target))};
   setPending(draft);setScreenId(typeof result.createdScreenId==='string'?result.createdScreenId:target.screenId);setSelectMode(false);setTab('preview');setFormValues({});setErrors({});
   setToast('Change proposed. Review the preview and choose Apply or Discard.');
  }catch(err){
   const message=err instanceof Error?err.message:'Unable to plan edit.';
   const failed:Message={id:makeId(),role:'system',text:'No changes applied: '+message,date:new Date().toISOString()};
   setState(prev=>({...prev,projects:prev.projects.map(p=>p.id===projectSnapshot.id?{...p,messages:[...p.messages,failed]}:p)}));
   setToast(message);
  }finally{setAiBusy(false);}
 }
 function applyPending(){
  if(!pending||pending.projectId!==project.id)return;
  if(JSON.stringify(project.demo)!==JSON.stringify(pending.before)){setToast('Draft changed since preview was created. Discard and prepare the edit again.');return;}
  const history:DemoRevision={id:makeId(),date:new Date().toISOString(),instruction:pending.instruction,screenId:pending.target.screenId,before:cloneDemo(pending.before)};
  const note:Message={id:makeId(),role:'system',text:'Applied verified operations on '+pending.label+'. Checks: '+pending.checks.join('; ')+'. Undo is available.',date:new Date().toISOString()};
  updateProject({demo:cloneDemo(pending.definition),revisions:[...(project.revisions||[]),history].slice(-8),messages:[...project.messages,note]});
  setPending(null);setSelected(null);setVisualComment('');setFormValues({});setErrors({});
  setToast('Changes applied. Undo is available.');
 }
 function discardPending(){setPending(null);setSelected(null);setVisualComment('');setFormValues({});setErrors({});setToast('Proposed edit discarded. Existing demo unchanged.');}
 function requestVisualEdit(){
  const comment=visualComment.trim();
  if(!comment||!project.demo||!screen)return;
  const t=activeSelection||{level:'screen' as const,screenId:screen.id};
  const msg:Message={id:makeId(),role:'user',text:'['+targetName(t)+'] '+comment,date:new Date().toISOString()};
  setState(prev=>({...prev,projects:prev.projects.map(p=>p.id===project.id?{...p,messages:[...p.messages,msg]}:p)}));
  void refineFor(project,comment,screen.id,t);
 }

 function undoLastEdit(){
  if(pending){setToast('Apply or discard the preview first.');return;}
  const history=project.revisions||[];
  if(!history.length)return;
  const last=history[history.length-1];
  const restored=cloneDemo(last.before);
  updateProject({demo:restored,revisions:history.slice(0,-1),messages:[...project.messages,{id:makeId(),role:'system',date:new Date().toISOString(),text:'Undid the previous edit on '+(restored.screens.find(s=>s.id===last.screenId)?.title||'selected screen')+'. All prior screens restored.'}]});
  setScreenId(last.screenId);setTab('preview');setFormValues({});setErrors({});
  setToast('Previous screen edit undone.');
 }
 function answerGenerationQuestion(answer:string){
  if(!generationQuestion||generationQuestion.projectId!==project.id||!answer.trim()||aiBusy)return;
  const note='Q: '+generationQuestion.question+' A: '+answer.trim();
  const clarified=[...(project.generationClarifications||[]),note];
  const snapshot={...project,generationClarifications:clarified};
  updateProject({generationClarifications:clarified,messages:[...project.messages,{id:makeId(),role:'user',text:answer.trim(),date:new Date().toISOString()}]});
  setGenerationQuestion(null);
  void generateFor(snapshot,project.requirement);
 }
 function answerRefinementQuestion(answer:string){
  const pendingQuestion=refinementQuestion;
  if(!pendingQuestion||pendingQuestion.projectId!==project.id||!answer.trim()||aiBusy||pending)return;
  const combined=pendingQuestion.instruction;
  const clarifications=[...pendingQuestion.clarifications,{question:pendingQuestion.question,answer:answer.trim()}];
  const msg:Message={id:makeId(),role:'user',text:answer.trim(),date:new Date().toISOString()};
  setState(prev=>({...prev,projects:prev.projects.map(p=>p.id===pendingQuestion.projectId?{...p,messages:[...p.messages,msg]}:p)}));
  setRefinementQuestion(null);
  void refineFor(project,combined,pendingQuestion.target.screenId,pendingQuestion.target,clarifications);
 }
 function send(){
  const text=composer.trim();
  if(!text||aiBusy||pending){if(pending)setToast('Apply or discard the preview first.');return;}
  if(generationQuestion?.projectId===project.id&&!project.demo){setComposer('');answerGenerationQuestion(text);return;}
  if(refinementQuestion?.projectId===project.id&&project.demo){setComposer('');answerRefinementQuestion(text);return;}
  const snapshot=project;
  const msg:Message={id:makeId(),role:'user',text,date:new Date().toISOString()};
  setComposer('');
  if(snapshot.demo){
    const target=screen?.id||snapshot.demo.screens[0].id;
    setState(p=>({...p,projects:p.projects.map(x=>x.id===snapshot.id?{...x,messages:[...x.messages,msg]}:x)}));
    void refineFor(snapshot,text,target,activeSelection||undefined);
  }else{
    const brief=[snapshot.requirement,text].filter(Boolean).join('\n\n');
    setState(p=>({...p,projects:p.projects.map(x=>x.id===snapshot.id?{...x,requirement:brief,messages:[...x.messages,msg]}:x)}));
    if(aiReady&&accessToken){void generateFor(snapshot,brief);}
    else if(!aiReady){setToast('Requirement saved. Configure AI backend before generating.');}
    else{setAccessModal(true);setToast('Requirement saved. Connect AI to generate your demo.');}
  }
}
 function generateBrief(){if(generationQuestion?.projectId===project.id){setToast('Answer the clarification first to continue this draft.');return;}if(!project.requirement.trim()){setToast('Enter a requirement first.');return;}if(pending){setToast('Discard the pending edit before regenerating.');return;}void generateFor(project,project.requirement);}
 function loadSample(){setPending(null);setSelected(null);const sample=cloneDemo(project.channel==='mobile'?mobileStarter:starter);updateProject({demo:sample,revisions:[]});setScreenId(sample.screens[0].id);setTab('preview');setToast('Example loaded. This is a starter template, not AI-generated.');}
 function applyDefinition(){try{if(pending)throw Error('Discard the proposed change before importing.');const obj:unknown=JSON.parse(jsonDraft);if(!validateDemo(obj))throw Error('Definition is not valid for schema version 1.');if(obj.channel!==project.channel)throw Error('Definition channel must match the current project channel.');updateProject({demo:cloneDemo(obj),revisions:[]});setScreenId(obj.screens[0].id);setImportOpen(false);setTab('preview');setToast('Demo definition imported.');}catch(e){setToast(e instanceof Error?e.message:'Invalid JSON.');}}
 function resetDemo(){if(pending){setToast('Discard the proposed change first.');return;}setSelected(null);updateProject({demo:null,revisions:[]});setScreenId('');setToast('Preview cleared. Project requirements were preserved.');}
 function publishDemo(){
  if(!demo||aiBusy||pending){setToast(pending?'Apply or discard the proposed edit before publishing.':'A completed demo is required to publish a snapshot.');return;}
  try{
   if(!validateDemo(demo))throw Error('This demo did not pass validation.');
   const version=Math.max(0,...(project.publishedVersions||[]).map(v=>v.version))+1;
   const publishedAt=new Date().toISOString();
   const snapshot=makeSnapshot(demo,{version,publishedAt,projectName:project.name,company:project.company});
   const url=window.location.origin+window.location.pathname+'#/view/'+encodeSnapshot(snapshot);
   const versions=[...(project.publishedVersions||[]),{version,publishedAt,url}].slice(-8);
   updateProject({publishedVersions:versions});
   setPublishedUrl(url);setPublishOpen(true);
   setToast('Version '+version+' frozen. Copy the share link to view this snapshot without editor access.');
  }catch(err){setToast(err instanceof Error?err.message:'Publishing failed.');}
 }
 function restorePublished(v:PublishedVersion){
  try{if(pending)throw Error('Discard the proposed edit before restoring a published version.');
   const payload=decodeSnapshot(v.url.split('#/view/')[1]);
   const restored=payload.demo as DemoDefinition;
   if(!validateDemo(restored)||restored.channel!==project.channel)throw Error('Published version is invalid for this project.');
   updateProject({demo:cloneDemo(restored),revisions:[],messages:[...project.messages,{id:makeId(),role:'system',text:'Restored draft from published version '+v.version+'. Previously published links remain frozen.',date:new Date().toISOString()}]});
   setScreenId(restored.screens[0].id);setPublishOpen(false);setTab('preview');setErrors({});setFormValues({});
   setToast('Draft restored from version '+v.version+'. Published snapshots were not changed.');
  }catch(err){setToast(err instanceof Error?err.message:'Could not restore version.');}
 }
 function go(id?:string){if(id&&demo?.screens.some(s=>s.id===id)){setSelected(null);setScreenId(id);setErrors({});setSearch('');}}
 function submit(el:Extract<Element,{kind:'form'}>){const err:Record<string,string>={};for(const f of el.fields){const v=(formValues[f.id]||'').trim();if(f.required&&((f.type==='checkbox'&&v!=='true')||(f.type!=='checkbox'&&!v)))err[f.id]=f.type==='checkbox'?'Please check this box':'Required field';if(v&&f.type==='email'&&!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v))err[f.id]='Enter a valid email';}setErrors(err);if(!Object.keys(err).length){go(el.nextScreen);if(!el.nextScreen)setToast('Demo form submitted. No actual backend call was made.');}}
 function exportJSON(){if(!demo)return;if(pending){setToast('Apply or discard the proposed edit before exporting.');return;}const url=URL.createObjectURL(new Blob([JSON.stringify(demo,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=demo.id+'.json';a.click();URL.revokeObjectURL(url);}
 async function handleFiles(files:FileList|null){if(!files?.length)return;const names=Array.from(files).map(f=>f.name);updateProject({files:[...project.files,...names]});setToast('Attached filenames recorded locally. Document extraction and AI processing are not connected yet.');if(fileInput.current)fileInput.current.value='';}
 function render(el:Element){
 switch(el.kind){
 case'hero':return <section className="hero"><div className="eyebrow">{el.eyebrow}</div><h2>{el.title}</h2><p>{el.description}</p></section>;
 case'stats':return <section className="stats">{el.items.map(x=><div key={x.id} className="stat"><div className="stat-label">{x.label}</div><div className="stat-number">{x.value}</div>{x.delta&&<div className="stat-delta">{x.delta}</div>}</div>)}</section>;
 case'notice':return <div className={'notice '+el.tone}>{el.tone==='success'?<CheckCircle2 size={19}/>:<Info size={19}/>}<div><strong>{el.title}</strong><p>{el.body}</p></div></div>;
 case'actions':return <div className="button-row">{el.buttons.map(b=><button data-select-level="button" data-select-element={el.id} data-select-child={b.id} className={'btn '+(b.variant==='secondary'?'outline':'primary')+(activeSelection?.level==='button'&&activeSelection.elementId===el.id&&activeSelection.childId===b.id?' visual-selected':'')} key={b.id} onClick={()=>go(b.nextScreen)}>{b.label}<ArrowRight size={14}/></button>)}</div>;
 case'table':return <ReportTable key={el.id} element={el} onNavigate={go}/>;
 case'composed':return <ComposedElement key={el.id} element={el} onNavigate={go}/>;
 case'form':return <section className="surface form-surface"><div className="section-head"><div><h3>{el.title}</h3><p>{el.description}</p></div></div><form onSubmit={e=>{e.preventDefault();submit(el);}}><div className="form-grid">{el.fields.map(f=><label data-select-level="field" data-select-element={el.id} data-select-child={f.id} className={'field'+(f.type==='checkbox'?' checkbox-field':'')+(activeSelection?.level==='field'&&activeSelection.elementId===el.id&&activeSelection.childId===f.id?' visual-selected':'')} key={f.id}><span>{f.label}{f.required&&<em> *</em>}</span>{f.type==='checkbox'?<input type="checkbox" checked={formValues[f.id]==='true'} onChange={e=>setFormValues(v=>({...v,[f.id]:String(e.target.checked)}))} aria-label={f.label}/>:f.type==='select'?<select value={formValues[f.id]||''} onChange={e=>setFormValues(v=>({...v,[f.id]:e.target.value}))}><option value="">Select an option</option>{(f.options||[]).map(o=><option key={o}>{o}</option>)}</select>:<input type={f.type} value={formValues[f.id]||''} onChange={e=>setFormValues(v=>({...v,[f.id]:e.target.value}))} placeholder={f.placeholder}/ >}{errors[f.id]&&<small className="error">{errors[f.id]}</small>}</label>)}</div><div className="form-footer"><button className="btn primary">{el.actionLabel}<ArrowRight size={15}/></button></div></form></section>;
 }
 }
 const empty=<div className="empty-preview"><div className="empty-symbol"><Monitor size={29}/></div><h2>No demo generated yet</h2><p>Enter the requirements in chat, connect the AI service, then generate interactive screens. You can still load a labeled example to evaluate the renderer.</p><button className="btn outline" onClick={loadSample}><Eye size={16}/>Load example {project.channel==='mobile'?'mobile':'portal'} demo</button></div>;
 return <div className="studio">
 <aside className="studio-sidebar"><div className="studio-brand"><div className="studio-mark"><Sparkles size={19}/></div><div><strong>Demo Builder</strong><small>AI experience studio</small></div></div>
 <div className="studio-side-label">WORKSPACE</div><div className="studio-side-active"><LayoutDashboard size={17}/>Demo studio</div>
 <div className="studio-side-label projects-label">YOUR PROJECTS <button title="New project" aria-label="New project" onClick={()=>setCreateOpen(true)}><Plus size={16}/></button></div>
 <div className="studio-projects">{state.projects.map(p=><button key={p.id} onClick={()=>switchProject(p.id)} className={'studio-project '+(project.id===p.id?'active':'')}><span className="project-initial">{p.name.slice(0,1).toUpperCase()}</span><span className="project-label">{p.name}<small>{p.channel==='mobile'?'Mobile application':'Web portal'}</small></span></button>)}</div>
 <div className="studio-side-footer"><ShieldCheck size={15}/>Standalone NONPROD <small>Piece 4 / 4</small></div>
 </aside>
 <main className="studio-main"><header className="studio-header"><div className="studio-breadcrumb"><span>Projects</span><ChevronRight size={15}/><strong>{project.name}</strong><span className="studio-status">Draft</span>{(project.publishedVersions||[]).length>0&&<span className="studio-status">Published v{project.publishedVersions?.[project.publishedVersions.length-1].version}</span>}</div><div className="studio-header-actions"><span className="studio-channel-label">{project.channel==='mobile'?<Smartphone size={14}/>:<Monitor size={14}/>} {project.channel==='mobile'?'Mobile':'Portal'}</span><button className="shot-entry" onClick={()=>setScreenshotOpen(true)}><Images size={16}/> Screenshot Demo</button><span className="local-label"><Check size={14}/>Saved in browser</span><button className="studio-icon" title="Project settings" onClick={()=>setDetails(v=>!v)}><Settings2 size={18}/></button><button className="studio-button" onClick={()=>setCreateOpen(true)}><Plus size={16}/>New project</button></div></header>
 {details&&<div className="studio-modal-overlay" onClick={()=>setDetails(false)}><section className="studio-details" onClick={e=>e.stopPropagation()}><div className="details-header"><h3>Project context</h3><button className="studio-icon" onClick={()=>setDetails(false)}><X size={16}/></button></div><div className="details-grid"><label>Company<input value={project.company} onChange={e=>updateProject({company:e.target.value})} placeholder="Company or bank"/></label><label>Design guidelines<textarea value={project.guidelines} onChange={e=>updateProject({guidelines:e.target.value})} placeholder="Brand colors, spacing, typography, style..."/></label></div><div className="details-summary"><strong>Integration-ready fields</strong><span>companyId · projectId · storyId · demoId · demoVersion · designGuidelines · approvedRequirements</span><p>MEYON integration is planned after standalone acceptance. No MEYON connection is active.</p></div></section></div>}
 <section className="studio-workarea"><div className="chat-pane"><div className="pane-heading"><div><MessageSquare size={18}/><strong>AI Demo Chat</strong></div><button className={'ai-connect '+(aiReady?'ready':'pending')} onClick={()=>setAccessModal(true)} title="AI backend connection">{aiBusy?'Generating…':!aiOnline?'AI service offline':!aiReady?'AI setup required':accessToken?'AI connected':'Connect AI'}</button></div><div className="chat-scroll">
 {project.messages.length===0?<div className="chat-welcome"><span className="chat-welcome-mark"><Sparkles size={23}/></span><h2>What are we building?</h2><p>Describe an application, paste a user story or attach reference material. Your input is saved to the project brief.</p><div className="chat-note"><Info size={17}/><span>{aiReady?'AI generation is available after connecting the access token. Enter a requirement to create real interactive screens. Once generated, chat edits only the currently selected preview screen.':'AI generation requires an OpenAI API key on the separate Render backend. Requirements are saved locally until it is configured.'}</span></div><div className="hint-title">A GOOD STARTING PROMPT</div><div className="sample-prompt">Create a mobile customer onboarding demo with registration, identity verification, consent and a final confirmation screen.</div></div>:<div className="message-list">{project.messages.map(m=><div className={'chat-message '+m.role} key={m.id}><div className="message-role">{m.role==='user'?'You':'System'}</div><p>{m.text}</p></div>)}</div>}
 {refinementQuestion?.projectId===project.id&&!pending&&<div className="generation-question"><div className="generation-question-heading"><Sparkles size={17}/><strong>MEYON needs your input</strong></div><p>{refinementQuestion.question}</p>{refinementQuestion.reason&&<small>{refinementQuestion.reason}</small>}<div className="generation-question-choices">{refinementQuestion.options.map(option=><button key={option} disabled={aiBusy} onClick={()=>answerRefinementQuestion(option)}>{option}</button>)}</div><small>Choose an option or type your answer below. MEYON will continue the original instruction without changing other screens.</small></div>}
 {generationQuestion?.projectId===project.id&&<div className="generation-question"><div className="generation-question-heading"><Sparkles size={17}/><strong>One clarification to continue</strong></div><p>{generationQuestion.question}</p>{generationQuestion.reason&&<small>{generationQuestion.reason}</small>}<div className="generation-question-choices">{generationQuestion.suggestions.map(option=><button key={option} disabled={aiBusy} onClick={()=>answerGenerationQuestion(option)}>{option}</button>)}</div><small>Or type your own answer below. The original project requirement will be kept.</small></div>}
 {aiBusy&&<div className="chat-progress" role="status"><Sparkles size={17}/> {demo?'Preparing scoped change operations for review…':'Interpreting requirements and generating application screens…'}</div>}<div ref={end}/></div>
 {project.requirement&&<div className="brief-status"><CheckCircle2 size={15}/><span>Project brief saved {demo?'· Refine selected screen':''}</span>{(project.revisions||[]).length>0&&<button className="undo-edit" title="Restore the demo before its most recent AI screen edit" disabled={aiBusy} onClick={undoLastEdit}>Undo edit ({project.revisions?.length})</button>}<button className="brief-generate" disabled={aiBusy} onClick={generateBrief}>{aiBusy?'Generating…':'Generate demo'}</button><button onClick={()=>setDetails(true)}>Context</button></div>}
 {project.files.length>0&&<div className="attachment-list">{project.files.map((f,i)=><span key={i}><Paperclip size={12}/>{f}</span>)}</div>}
 <div className="chat-composer"><textarea aria-label="Describe your requirements" placeholder={demo?'Edit '+(screen?.title||'the selected screen')+' or request an all-screen header change...':'Describe the application to generate...'} value={composer} onChange={e=>setComposer(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();send();}}}/><div className="composer-bottom"><div><input type="file" multiple accept=".txt,.md,.json,.pdf,.doc,.docx,.png,.jpg,.jpeg,.webp" ref={fileInput} hidden onChange={e=>handleFiles(e.target.files)}/><button className="attach-btn" title="Attach references" onClick={()=>fileInput.current?.click()}><Paperclip size={17}/> Attach</button><span className="composer-hint">Ctrl/⌘ + Enter to add</span></div><button className="send-btn" disabled={!composer.trim()||aiBusy} onClick={send} title={demo?'Prepare a scoped change for preview and approval':'Generate demo from requirement'}><Send size={17}/></button></div></div>
 </div>
 <div className={'preview-pane '+(expanded?'fullscreen-preview':'')}><div className="pane-heading preview-heading"><div><Eye size={18}/><strong>Interactive Preview</strong></div><div className="preview-controls"><button className={tab==='preview'?'active':''} onClick={()=>setTab('preview')}>Preview</button><button className={tab==='definition'?'active':''} onClick={()=>setTab('definition')}>Definition</button></div></div>
 {tab==='definition'?<div className="studio-json">{demo?<pre>{JSON.stringify(demo,null,2)}</pre>:<div className="studio-json-empty">A validated Demo Definition will appear here when a demo is loaded or generated.</div>}</div>:<>{pending?.projectId===project.id&&<div className="visual-review">
  <div className="visual-review-title"><CheckCircle2 size={17}/><strong>Review proposed edit</strong><span>{pending.label}</span></div>
  <p>{pending.summary}</p><div className="visual-review-checks">{pending.checks.map(c=><span key={c}><Check size={12}/>{c}</span>)}</div>
  <div className="visual-review-actions"><button className="visual-discard" onClick={discardPending}>Discard</button><button className="visual-apply" onClick={applyPending}><Check size={15}/> Apply change</button></div>
 </div>}
 {ambiguity?.projectId===project.id&&!pending&&<div className="visual-review">
  <div className="visual-review-title"><MousePointer2 size={17}/><strong>Which component should change?</strong></div>
  <p>{ambiguity.question}</p>
  <div className="visual-review-actions" style={{flexWrap:'wrap'}}>
    {ambiguity.choices.map(choice=><button key={choice.id} className="visual-apply" disabled={aiBusy} onClick={()=>{const instruction=ambiguity.instruction;setAmbiguity(null);void refineFor(project,instruction,choice.target.screenId,choice.target);}}>{choice.label} · {choice.screen}</button>)}
    <button className="visual-discard" onClick={()=>setAmbiguity(null)}>Cancel</button>
  </div>
 </div>}
 {demo&&tab==='preview'&&selectMode&&!pending&&<div className="visual-comment-bar">
  <div className="visual-comment-heading"><MousePointer2 size={15}/><strong>{activeSelection?'Selected: '+targetName(activeSelection):'Select a screen or component'}</strong><span>{activeSelection?'Add a comment below':'Click a component or blank screen area'}</span></div>
  {activeSelection&&<div className="visual-comment-entry"><input autoFocus aria-label="Comment on selected component" placeholder="What should change here?" value={visualComment} onChange={e=>setVisualComment(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();requestVisualEdit();}}}/><button disabled={!visualComment.trim()||aiBusy} onClick={requestVisualEdit}>Preview change</button></div>}
 </div>}
 <div className="preview-viewport">{demo&&screen?<><div className="active-screen-title"><strong>{String(demo.screens.findIndex(s=>s.id===screen.id)+1).padStart(2,'0')} · {screen.title}</strong></div><div className="preview-stage-layout"><div className="preview-stage-canvas"><div className={'preview-canvas '+(project.channel==='mobile'?'mobile-canvas':'web-canvas')}><div className={project.channel==='mobile'?'device-zoom-stage':'web-zoom-stage'} style={project.channel==='mobile'?{width:390*zoom/100,height:780*zoom/100}:undefined}><div className={'render-frame '+(project.channel==='mobile'?'mobile-frame':'portal-frame')+' theme-'+demo.theme} style={project.channel==='mobile'?{transform:`scale(${zoom/100})`,transformOrigin:'top left'}:undefined}><div className={'demo-shell'+(selectMode?' select-on':'')} onClickCapture={pick}>{project.channel==='portal'&&<nav className="demo-nav"><div data-select-level="header" className={'demo-logo'+(activeSelection?.level==='header'?' visual-selected':'')}>{showBrandIcon&&<Wallet size={18}/>} {brandName}</div>{navigationMenuLinks(demo).map(link=><div className="portal-menu-group" key={link.id}><div className="portal-menu-parent"><button className="portal-menu-link" onClick={()=>go(link.screenId)}><LayoutDashboard size={15}/><span>{link.label}</span></button></div></div>)}
 {demo.screens.filter(s=>!s.parentScreenId).map(parent=>{
 const children=demo.screens.filter(child=>child.parentScreenId===parent.id);
 const containsSelected=screen.id===parent.id||children.some(child=>child.id===screen.id);
 const isOpen=expandedPortalMenus[parent.id]??containsSelected;
 return <div className={'portal-menu-group'+(containsSelected?' contains-active':'')} key={parent.id}>
  <div className="portal-menu-parent"><button className={parent.id===screen.id?'on':''} onClick={()=>{go(parent.id);if(children.length)setExpandedPortalMenus(v=>({...v,[parent.id]:true}));}}><LayoutDashboard size={15}/><span>{parent.title}</span></button>{children.length>0&&<button className="portal-menu-toggle" aria-label={(isOpen?'Collapse ':'Expand ')+parent.title+' menu'} title={(isOpen?'Collapse ':'Expand ')+parent.title} onClick={()=>setExpandedPortalMenus(v=>({...v,[parent.id]:!isOpen}))}><ChevronDown size={14} className={isOpen?'expanded':''}/></button>}</div>
  {children.length>0&&isOpen&&<div className="portal-submenu">{children.map(child=><button key={child.id} className={child.id===screen.id?'on':''} onClick={()=>go(child.id)}><ChevronRight size={13}/><span>{child.title}</span></button>)}</div>}
 </div>;
})}</nav>}<div data-select-level="screen" className={'demo-main'+(activeSelection?.level==='screen'?' visual-selected':'')}>{project.channel==='mobile'&&<div data-select-level="header" className={'mobile-brand'+(activeSelection?.level==='header'?' visual-selected':'')}>{showBrandIcon&&<span className="mobile-symbol"><Wallet size={17}/></span>}<span>{brandName}</span></div>}{showBackButton&&screen.id!==demo.screens[0].id&&<button className="back-link" onClick={()=>go(demo.screens[0].id)}><ArrowLeft size={15}/>Back</button>}<div className="screen-intro"><h1>{screen.title}</h1><p>{screen.subtitle}</p></div><div className="elements">{screen.elements.map(el=><div data-select-level="element" data-select-element={el.id} className={'visual-target'+(activeSelection?.level==='element'&&activeSelection.elementId===el.id?' visual-selected':'')} key={el.id}>{render(el)}</div>)}</div></div></div></div></div></div></div><aside className="preview-side-tools" aria-label="Demo preview tools">
 <details className="preview-screen-picker"><summary title="Choose screen" aria-label="Choose demo screen"><LayoutDashboard size={16}/></summary><div className="preview-screen-picker-panel">{demo.screens.map((s,i)=><button key={s.id} className={s.id===screen.id?'active':''} onClick={e=>{e.currentTarget.closest('details')?.removeAttribute('open');go(s.id);}}>{String(i+1).padStart(2,'0')} · {s.title}</button>)}</div></details>
 <button className="side-screen-nav" title="Previous screen" aria-label="Previous screen" disabled={demo.screens.findIndex(s=>s.id===screen.id)===0} onClick={()=>go(demo.screens[Math.max(0,demo.screens.findIndex(s=>s.id===screen.id)-1)].id)}><ArrowLeft size={16}/></button>
 <button className="side-screen-nav" title="Next screen" aria-label="Next screen" disabled={demo.screens.findIndex(s=>s.id===screen.id)===demo.screens.length-1} onClick={()=>go(demo.screens[Math.min(demo.screens.length-1,demo.screens.findIndex(s=>s.id===screen.id)+1)].id)}><ArrowRight size={16}/></button>
 <div className="preview-toolbar" aria-label="Preview tools">
  <div className="preview-toolbar-primary">
   {demo&&tab==='preview'&&<button className={'visual-toggle'+(selectMode?' active':'')} title="Select a component and comment" aria-label="Select a component" disabled={aiBusy||!!pending} onClick={()=>{setSelectMode(v=>!v);setSelected(null);setVisualComment('');}}><MousePointer2 size={15}/></button>}
   {demo&&<button className="publish-action" title="Publish read-only demo" aria-label="Publish demo" disabled={aiBusy||!!pending} onClick={publishDemo}><ShieldCheck size={15}/></button>}
   <button className="preview-fullscreen-btn" title={expanded?'Exit full-screen presentation':'Full-screen presentation'} aria-label={expanded?'Exit presentation':'Present fullscreen'} onClick={()=>{setExpanded(v=>!v);setTab('preview');}}>{expanded?<Minimize2 size={16}/>:<Maximize2 size={16}/>}</button>
  </div>
  <div className="preview-toolbar-secondary">
   {demo&&project.channel==='mobile'&&tab==='preview'&&<div className="zoom-controls" aria-label="Mobile preview zoom"><button aria-label="Zoom out" title="Zoom out" disabled={zoom<=50} onClick={()=>setZoom(z=>Math.max(50,z-10))}><Minus size={15}/></button><button className="zoom-value" title="Reset zoom to 100%" aria-label="Reset zoom to 100%" onClick={()=>setZoom(100)}>{zoom}%</button><button aria-label="Zoom in" title="Zoom in" disabled={zoom>=150} onClick={()=>setZoom(z=>Math.min(150,z+10))}><Plus size={15}/></button></div>}
   <details className="preview-more-menu"><summary title="More demo actions" aria-label="More demo actions"><MoreHorizontal size={19}/></summary><div className="preview-more-panel">
    {(project.publishedVersions||[]).length>0&&<button onClick={e=>{e.currentTarget.closest('details')?.removeAttribute('open');setPublishedUrl(project.publishedVersions?.[project.publishedVersions.length-1]?.url||'');setPublishOpen(true);}}><ShieldCheck size={15}/> Versions ({project.publishedVersions?.length})</button>}
    <button onClick={e=>{e.currentTarget.closest('details')?.removeAttribute('open');setJsonDraft(demo?JSON.stringify(demo,null,2):'');setImportOpen(true);}}><Upload size={15}/> Import definition</button>
    <button disabled={!demo} onClick={e=>{e.currentTarget.closest('details')?.removeAttribute('open');exportJSON();}}><Download size={15}/> Export JSON</button>
    {demo&&<button onClick={e=>{e.currentTarget.closest('details')?.removeAttribute('open');resetDemo();}}><RefreshCw size={15}/> Clear preview</button>}
   </div></details>
  </div>
 </div>
 </aside></div></>:empty}</div></>}
 <div className="preview-bottom"><ShieldCheck size={14}/>Interactive demo · Sample transactions only · AI generation through secured backend</div></div></section>
 <div className="studio-underbar">AI generation: {aiReady?'Server ready':'Configuration required'} {aiModel&&'· '+aiModel} <span>·</span> MEYON integration remains separate</div></main>
 {screenshotOpen&&<ScreenshotStudio projectId={project.id} projectName={project.name} onClose={()=>setScreenshotOpen(false)}/>}
 {createOpen&&<div className="studio-modal-overlay" onClick={()=>setCreateOpen(false)}><div className="studio-modal" onClick={e=>e.stopPropagation()}><div className="modal-top"><div><h2>Create a project</h2><p>Start a new application demo workspace.</p></div><button onClick={()=>setCreateOpen(false)} aria-label="Close"><X size={18}/></button></div><label>Project name<input autoFocus value={createName} onChange={e=>setCreateName(e.target.value)} placeholder="e.g. Customer Onboarding"/></label><label>Company<input value={createCompany} onChange={e=>setCreateCompany(e.target.value)} placeholder="e.g. Kapiko Bank"/></label><label>Application channel<select value={createChannel} onChange={e=>setCreateChannel(e.target.value as 'mobile'|'portal')}><option value="mobile">Mobile application</option><option value="portal">Web / enterprise portal</option></select></label><div className="modal-buttons"><button className="btn outline" onClick={()=>setCreateOpen(false)}>Cancel</button><button className="btn primary" onClick={createProject}>Create project</button></div></div></div>}
 {importOpen&&<div className="studio-modal-overlay" onClick={()=>setImportOpen(false)}><div className="studio-modal wide" onClick={e=>e.stopPropagation()}><div className="modal-top"><div><h2>Import demo definition</h2><p>Version 1 JSON, with channel matching your project.</p></div><button onClick={()=>setImportOpen(false)} aria-label="Close"><X size={18}/></button></div><textarea className="json-editor" spellCheck={false} value={jsonDraft} onChange={e=>setJsonDraft(e.target.value)} placeholder="Paste structured Demo Definition JSON..."/><div className="modal-buttons"><button className="btn outline" onClick={()=>setImportOpen(false)}>Cancel</button><button className="btn primary" onClick={applyDefinition}>Validate & apply</button></div></div></div>}
 {accessModal&&<div className="studio-modal-overlay" onClick={()=>setAccessModal(false)}><div className="studio-modal" onClick={e=>e.stopPropagation()}><div className="modal-top"><div><h2>Connect AI generation</h2><p>Access is controlled by the separate Demo Builder backend.</p></div><button aria-label="Close" onClick={()=>setAccessModal(false)}><X size={18}/></button></div><div className="ai-connection">{accessToken&&<button className="btn outline" onClick={()=>{setAccessToken('');setAccessDraft('');try{sessionStorage.removeItem('meyon-demo-ai-access');localStorage.removeItem('meyon-demo-ai-saved');localStorage.removeItem('meyon-demo-ai-remember');}catch{}setRememberAI(false);setToast('AI disconnected and saved connection cleared.');}}>Disconnect this tab</button>}<strong>{!aiOnline?'Backend unavailable':aiReady?'Backend ready':'Backend needs configuration'}</strong><p>{!aiReady?'An administrator must add OPENAI_API_KEY in the Render demo-builder-ai-nonprod service. The key must never be pasted into this browser.':'Paste the Demo Builder access token (not your OpenAI API key). It stays connected on refresh. Optionally remember it on this device. Never use this option on a shared computer.'}</p><small>Model: {aiModel||'Not available'}</small></div><label>Demo Builder access token<input type="password" autoComplete="off" value={accessDraft} onChange={e=>setAccessDraft(e.target.value)} placeholder="Access token from environment setup"/></label><label style={{display:"flex",flexDirection:"row",alignItems:"center",gap:9,fontWeight:500,marginTop:12}}><input type="checkbox" style={{width:16,height:16}} checked={rememberAI} onChange={e=>setRememberAI(e.target.checked)}/>Remember on this device (use only on a private computer)</label><div className="modal-buttons"><button className="btn outline" onClick={()=>setAccessModal(false)}>Cancel</button><button className="btn primary" onClick={()=>{setAccessToken(accessDraft.trim());try{sessionStorage.setItem('meyon-demo-ai-access',accessDraft.trim());if(rememberAI){localStorage.setItem('meyon-demo-ai-remember','yes');localStorage.setItem('meyon-demo-ai-saved',accessDraft.trim());}else{localStorage.removeItem('meyon-demo-ai-remember');localStorage.removeItem('meyon-demo-ai-saved');}}catch{}setAccessModal(false);setToast(rememberAI?'AI connected and remembered on this device.':'AI connected for this browser tab.');}}>Connect</button></div></div></div>}
 {publishOpen&&<div className="studio-modal-overlay" onClick={()=>setPublishOpen(false)}><div className="studio-modal wide" onClick={e=>e.stopPropagation()}><div className="modal-top"><div><h2>Published demo versions</h2><p>Share a read-only frozen version. This portable link contains the demo data, not editor or API credentials.</p></div><button aria-label="Close" onClick={()=>setPublishOpen(false)}><X size={18}/></button></div>
 <div className="publish-caution"><Info size={18}/>Anyone with a share link can view its demo data. Use only fictional or approved sample content. Versions are stored in this browser, not on a publication database.</div>
 <div className="publish-versions">{(project.publishedVersions||[]).slice().reverse().map(v=><div className="publish-version" key={v.version}><div><strong>Version {v.version}</strong><small>{new Date(v.publishedAt).toLocaleString()}</small></div><div className="publish-version-actions"><button onClick={()=>{setPublishedUrl(v.url);navigator.clipboard.writeText(v.url).then(()=>setToast('Published link copied.')).catch(()=>setToast('Copy unavailable; select the link in the field.'));}}>Copy link</button><button onClick={()=>window.open(v.url,'_blank','noopener,noreferrer')}>Open</button><button onClick={()=>restorePublished(v)}>Restore draft</button></div></div>)}</div>
 {publishedUrl&&<label className="publish-share-label">Selected version link<input readOnly onFocus={e=>e.target.select()} value={publishedUrl}/></label>}
 <div className="modal-buttons"><button className="btn outline" onClick={()=>setPublishOpen(false)}>Close</button></div></div></div>}
 {toast&&<div className="studio-toast" role="status"><span>{toast}</span><button aria-label="Dismiss" onClick={()=>setToast('')}><X size={15}/></button></div>}
 </div>;
}
let sharedSnapshot:unknown=null;
if(isViewerPath(window.location.hash)){
 try{sharedSnapshot=decodeSnapshot(window.location.hash.slice('#/view/'.length));}catch{sharedSnapshot=null;}
}
createRoot(document.getElementById('root')!).render(<React.StrictMode>{isViewerPath(window.location.hash)?<PublishedViewer snapshot={sharedSnapshot as React.ComponentProps<typeof PublishedViewer>['snapshot']}/>:<App/>}</React.StrictMode>);
