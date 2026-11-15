import React,{useEffect,useRef,useState} from 'react';
import {ArrowRight,CheckCircle2,ChevronRight,ClipboardCheck,Code2,Play,RotateCcw,ShieldCheck,SquareTerminal,X} from 'lucide-react';
import type {DemoDefinition} from './demo';
import ComposedElement from './ComposedElement';
// @ts-ignore Shared pure testable workspace engine.
import {workspaceFromDemo,routeLabInstruction,answerApproval,executeApproval} from './agentWorkspaceEngine.mjs';
import './agentWorkspaceLab.css';

const tasks=[
 {id:'nav',name:'Reorder navigation',instruction:'Move Service Request immediately above Reports in the left menu.'},
 {id:'component',name:'Generate interactive component',instruction:'Create a User Activity Dashboard showing login history, last activity and failed login attempts with search and CSV export.'},
 {id:'clarify',name:'Clarify and configure approval',instruction:'Add an approval action to the portal with unspecified confirmation behavior.'},
 {id:'custom',name:'Create new screen from instruction',instruction:'Add a new menu called Customer Audit. Create a screen showing user, action, timestamp and status, with search and filtering. Do not modify existing screens.'}
];
const sample:DemoDefinition={schemaVersion:1,id:'kapiko-lab-sample',name:'Kapiko Bank – Isolated Lab',description:'Fictional test workspace',channel:'portal',theme:'navy',
 navLinks:[{id:'nav-service-request',label:'Service Request',screenId:'applications'}],
 screens:[
  {id:'overview',title:'Kapiko Bank – Operations Overview',subtitle:'Operational KPIs',elements:[
   {kind:'stats',id:'kpis',items:[{id:'total',label:'Total Applications',value:'1,248'},{id:'review',label:'Pending Review',value:'178'},{id:'approved',label:'Approved',value:'865'}]}]},
  {id:'applications',title:'Customer Applications',subtitle:'Application review',elements:[{kind:'notice',id:'review-queue',title:'Applications',body:'Fictional customer applications for demo testing',tone:'info'}]},
  {id:'reports',title:'Reports',subtitle:'Reporting',elements:[{kind:'notice',id:'reports-notice',title:'Reports',body:'Existing report screen remains unchanged',tone:'info'}]}
 ]};
type Trace={tool:string;detail:string};
type LabState={demo:DemoDefinition;menu:{id:string;label:string;screenId:string;kind:string}[];trace:Trace[];lastResult:{status:string;message:string;allowScreenEdit?:boolean}|null;approval:{mode:string;status:string;lastAction:string}|null;awaiting:{kind:string;question:string;options:string[]}|null;selectedScreenId:string};

export default function AgentWorkspaceLab({demo,projectName,onClose}:{demo:DemoDefinition|null;projectName:string;onClose:()=>void}){
 const [source,setSource]=useState<'sample'|'project'>(demo?.channel==='portal'?'project':'sample');
 const [state,setState]=useState<LabState>(()=>workspaceFromDemo(demo?.channel==='portal'?demo:sample));
 const [command,setCommand]=useState(tasks[0].instruction);
 const [selectedTask,setSelectedTask]=useState(tasks[0].id);
 const [showInstruction,setShowInstruction]=useState(false);
 const [showEvidence,setShowEvidence]=useState(false);
 const [error,setError]=useState('');
 const [confirmation,setConfirmation]=useState(false);
 const [history,setHistory]=useState<string[]>([]);
 const previewRef=useRef<HTMLElement>(null);
 const active=state.demo.screens.find(s=>s.id===state.selectedScreenId)||state.demo.screens[0];
 const completed=new Set(history);
 const status=(state.lastResult?.status||'idle');
 const activityVisible=active.elements.some(el=>el.id==='generated-user-activity-dashboard');
 const generatedScreen=active.id.startsWith('lab-');
 const selectTask=(t:typeof tasks[number])=>{setSelectedTask(t.id);setCommand(t.instruction);setError('');setState(s=>({...s,lastResult:null,awaiting:null}));};
 useEffect(()=>{
  if(status==='passed'&&(activityVisible||generatedScreen)){
   const preview=previewRef.current;
   if(preview)preview.scrollTo({top:preview.scrollHeight,behavior:'smooth'});
  }
 },[state.demo,status,activityVisible,generatedScreen]);
 function reset(nextSource: 'sample'|'project'=source){
  setSource(nextSource);setState(workspaceFromDemo(nextSource==='project'&&demo?.channel==='portal'?demo:sample));
  setError('');setHistory([]);setConfirmation(false);setSelectedTask(tasks[0].id);setCommand(tasks[0].instruction);setShowInstruction(false);setShowEvidence(false);
 }
 function run(instruction:string,taskId?:string){
  setCommand(instruction);setConfirmation(false);
  try{
   const output=routeLabInstruction(state,instruction) as LabState;
   setState(output);setError('');
   if(output.lastResult?.status==='passed'&&taskId)setHistory(h=>[...h,taskId]);
  }catch(e){setError(e instanceof Error?e.message:'The requested action could not be verified.');}
 }
 function selectAnswer(answer:string){
  try{const output=answerApproval(state,answer) as LabState;setState(output);setError('');setHistory(h=>[...h,'clarify']);}
  catch(e){setError(e instanceof Error?e.message:'Clarification failed');}
 }
 function approve(confirm:boolean){
  try{const output=executeApproval(state,confirm) as LabState;setState(output);setConfirmation(['confirmation-required','confirmation-screen'].includes(output.approval?.lastAction||''));setError('');}
  catch(e){setError(e instanceof Error?e.message:'Approval simulation failed');}
 }

 return <div className="agentlab-overlay" role="dialog" aria-modal="true" aria-label="Agentic Demo Workspace lab">
  <section className="agentlab-frame agentlab-simple">
   <header className="agentlab-header">
    <div><span className="agentlab-eyebrow">MEYON · ISOLATED TEST</span><h2>Agentic Demo Workspace</h2><p>Choose a test, execute it, and inspect the result. Your original project stays unchanged.</p></div>
    <button onClick={onClose} aria-label="Close lab"><X size={19}/></button>
   </header>
   <div className="agentlab-strip">
    <ShieldCheck size={16}/>
    <span>Controlled proof of concept · new screen creation supported · no AI model calls</span>
    <div className="agentlab-switch"><button className={source==='sample'?'active':''} onClick={()=>reset('sample')}>Sample Kapiko</button><button disabled={demo?.channel!=='portal'} className={source==='project'?'active':''} onClick={()=>reset('project')}>Current portal copy</button></div>
   </div>
   <div className="agentlab-simple-content">
    <aside className="agentlab-simple-controls">
     <h3>1. Choose a test</h3>
     <div className="agentlab-simple-tasks">{tasks.map((t,i)=><button key={t.id} className={'agentlab-simple-task '+(selectedTask===t.id?'selected':'')} onClick={()=>selectTask(t)} aria-pressed={selectedTask===t.id}><span className="agentlab-task-number">{completed.has(t.id)?<CheckCircle2 size={16}/>:i+1}</span><span>{t.name}</span></button>)}</div>
     <h3>2. Run the instruction</h3>
     <div className="agentlab-instruction-summary">{command}</div>
     <button className="agentlab-text-link" onClick={()=>setShowInstruction(v=>!v)}>{showInstruction?'Hide instruction editor':'Edit instruction'}</button>
     {showInstruction&&<textarea aria-label="Edit test instruction" value={command} onChange={e=>setCommand(e.target.value)} rows={3}/>}
     <button className="agentlab-run" onClick={()=>run(command,selectedTask)}><Play size={16}/> Execute test</button>
     <h3>3. Result</h3>
     {state.awaiting?.kind==='approval'?<div className="agentlab-simple-response" role="status">
      <strong>Clarification needed</strong>
      <p>{state.awaiting.question}</p>
      <div className="agentlab-simple-choices">{state.awaiting.options.map(o=><button key={o} onClick={()=>selectAnswer(o)}>{o}</button>)}</div>
     </div>:state.awaiting?.kind==='target'?<div className="agentlab-simple-response" role="status"><strong>Choose a valid target</strong><p>{state.awaiting.question}</p><small>{state.awaiting.options.join(', ')}</small></div>:state.lastResult?<div className={'agentlab-simple-response '+(status==='passed'?'passed':status==='clarification'?'pending':'blocked')} role="status"><strong>{status==='passed'?'Test completed':status==='clarification'?'More information needed':'No change applied'}</strong><p>{state.lastResult.message}</p>{status==='passed'&&(activityVisible||generatedScreen)&&<p>Generated component is shown on the right. Test the available controls.</p>}</div>:<div className="agentlab-simple-response idle"><p>Click <strong>Execute test</strong> to see the result here.</p></div>}
     {error&&<div className="agentlab-simple-response blocked" role="alert"><strong>Execution error</strong><p>{error}</p></div>}
     <button className="agentlab-text-link" onClick={()=>setShowEvidence(v=>!v)}>{showEvidence?'Hide execution details':'View execution details'}</button>
     {showEvidence&&<div className="agentlab-trace"><strong>Executed tools</strong>{state.trace.length?state.trace.map((t,i)=><div key={i}><code>{t.tool}</code><small>{t.detail}</small></div>):<p>No tools executed yet.</p>}</div>}
     <button className="agentlab-reset" onClick={()=>reset()}><RotateCcw size={15}/> Reset test workspace</button>
    </aside>
    <main className="agentlab-simple-preview" ref={previewRef}>
     <div className="agentlab-simple-preview-heading"><div><strong>Live preview</strong><span>{state.demo.name}</span></div><span>{completed.size} of {tasks.length} tests completed</span></div>
     <div className="agentlab-portal">
      <nav className="agentlab-nav"><strong>{source==='sample'?'Kapiko Bank':projectName}</strong>{state.menu.map(item=><button className={item.screenId===active.id?'active':''} key={item.id} onClick={()=>setState(s=>({...s,selectedScreenId:item.screenId}))}><span className="agentlab-menu-square"/>{item.label}</button>)}</nav>
      <div className="agentlab-screen">
       <div className="agentlab-screen-label">Current screen</div><h2>{active.title}</h2><p className="agentlab-muted">{active.subtitle}</p>
       {active.elements.map(el=>{
        if(el.kind==='composed')return <ComposedElement key={el.id} element={el} onNavigate={id=>{if(id&&state.demo.screens.some(s=>s.id===id))setState(prev=>({...prev,selectedScreenId:id}));}}/>;
        if(el.kind==='stats')return <div className="agentlab-stats" key={el.id}>{el.items.map(x=><div key={x.id}><span>{x.label}</span><strong>{x.value}</strong></div>)}</div>;
        if(el.kind==='notice')return <div key={el.id} className="agentlab-notice"><strong>{el.title}</strong><p>{el.body}</p></div>;
        return <div key={el.id} className="agentlab-notice">Existing {el.kind} component preserved in copied screen</div>;
       })}
       {state.approval&&<div className="agentlab-approval"><strong>Approval interaction · demo only</strong><p>Application status: <b>{state.approval.status}</b></p><button onClick={()=>approve(false)} disabled={state.approval.status==='Approved'}>{state.approval.mode.includes('confirmation screen')?'Continue to confirmation': 'Approve application'}</button>{confirmation&&<div className={"agentlab-confirm"+(state.approval.mode.includes("confirmation screen")?" agentlab-confirm-screen":"")}><p>{state.approval.mode.includes("confirmation screen")?"Confirmation screen — review approval of this fictional application":"Approve this fictional application?"}</p><button onClick={()=>approve(true)}>Confirm approval</button><button onClick={()=>setConfirmation(false)}>Cancel</button></div>}{state.approval.lastAction&&!confirmation&&<small>{state.approval.lastAction}</small>}</div>}
      </div>
     </div>
     <div className="agentlab-bottom"><Code2 size={16}/><span>Sandbox only · original project is not changed</span></div>
    </main>
   </div>
  </section>
 </div>;
}
