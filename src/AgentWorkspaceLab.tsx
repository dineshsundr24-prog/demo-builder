import React,{useState} from 'react';
import {ArrowRight,CheckCircle2,ChevronRight,ClipboardCheck,Code2,Play,RotateCcw,ShieldCheck,SquareTerminal,X} from 'lucide-react';
import type {DemoDefinition} from './demo';
import ComposedElement from './ComposedElement';
// @ts-ignore Shared pure testable workspace engine.
import {workspaceFromDemo,routeLabInstruction,answerApproval,executeApproval} from './agentWorkspaceEngine.mjs';
import './agentWorkspaceLab.css';

const tasks=[
 {id:'nav',name:'Reorder navigation',instruction:'Move Service Request immediately above Reports in the left menu.'},
 {id:'component',name:'Generate interactive component',instruction:'Create a User Activity Dashboard showing login history, last activity and failed login attempts with search and CSV export.'},
 {id:'clarify',name:'Clarify and configure approval',instruction:'Add an approval action to the portal with unspecified confirmation behavior.'}
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
 const [error,setError]=useState('');
 const [confirmation,setConfirmation]=useState(false);
 const [history,setHistory]=useState<string[]>([]);
 const active=state.demo.screens.find(s=>s.id===state.selectedScreenId)||state.demo.screens[0];
 const completed=new Set(history);
 const status=(state.lastResult?.status||'idle');
 function reset(nextSource: 'sample'|'project'=source){
  setSource(nextSource);setState(workspaceFromDemo(nextSource==='project'&&demo?.channel==='portal'?demo:sample));
  setError('');setHistory([]);setConfirmation(false);
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
  <section className="agentlab-frame">
   <header className="agentlab-header"><div><span className="agentlab-eyebrow">MEYON · CONTROLLED PROOF OF CONCEPT</span><h2>Agentic Demo Workspace</h2><p>Isolated copy of {source==='project'?projectName:'Kapiko example'} · no changes to your original project</p></div>
    <button onClick={onClose} aria-label="Close lab"><X size={19}/></button>
   </header>
   <div className="agentlab-strip"><ShieldCheck size={16}/><span>Sandboxed test: three supported tasks, deterministic tools, zero model API calls. This is not yet a general-purpose coding agent.</span><div className="agentlab-switch"><button className={source==='sample'?'active':''} onClick={()=>reset('sample')}>Sample Kapiko</button><button disabled={demo?.channel!=='portal'} className={source==='project'?'active':''} onClick={()=>reset('project')}>Current portal copy</button></div></div>
   <div className="agentlab-content">
    <aside className="agentlab-left">
     <h3>Try an instruction</h3><p className="agentlab-muted">Use the prepared tests, or enter one of the supported instructions.</p>
     <div className="agentlab-task-list">{tasks.map(t=><button key={t.id} className="agentlab-task" onClick={()=>run(t.instruction,t.id)}><span>{completed.has(t.id)?<CheckCircle2 size={17}/>:<Play size={17}/>}</span><div><strong>{t.name}</strong><small>{t.instruction}</small></div><ChevronRight size={16}/></button>)}</div>
     <label className="agentlab-command-label" htmlFor="agentlab-command">Instruction</label>
     <textarea id="agentlab-command" rows={3} value={command} onChange={e=>setCommand(e.target.value)}/>
     <button className="agentlab-run" onClick={()=>run(command)}><Play size={15}/> Execute in isolated workspace</button>
     {state.awaiting?.kind==='approval'&&<div className="agentlab-clarify"><strong>Agent clarification</strong><p>{state.awaiting.question}</p>{state.awaiting.options.map(o=><button key={o} onClick={()=>selectAnswer(o)}>{o}</button>)}</div>}
     {state.awaiting?.kind==='target'&&<div className="agentlab-clarify"><strong>Target unresolved</strong><p>{state.awaiting.question}</p><small>Available entries: {state.awaiting.options.join(', ')}</small><p>Try the Sample Kapiko workspace for a complete baseline.</p></div>}
     {state.lastResult&&<div className={'agentlab-result '+(status==='passed'?'passed':status==='clarification'?'pending':'blocked')}><strong>{status==='passed'?'Outcome verified':status==='clarification'?'Clarification needed':'No change applied'}</strong><p>{state.lastResult.message}</p></div>}
     {error&&<div className="agentlab-result blocked" role="alert"><strong>Verification blocked</strong><p>{error}</p></div>}
     <div className="agentlab-trace"><div className="agentlab-trace-heading"><SquareTerminal size={16}/><strong>Tool execution & evidence</strong></div>{state.trace.length?state.trace.slice(-8).map((t,i)=><div key={i}><code>{t.tool}</code><small>{t.detail}</small></div>):<p className="agentlab-muted">Run a task to see the executed tools and verified outcome.</p>}</div>
     <button className="agentlab-reset" onClick={()=>reset()}><RotateCcw size={15}/> Reset isolated workspace</button>
    </aside>
    <main className="agentlab-right">
     <div className="agentlab-preview-heading"><div><span>LIVE SANDBOX PREVIEW</span><strong>{state.demo.name}</strong></div><div><ClipboardCheck size={17}/> {completed.size}/3 scenarios exercised</div></div>
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
     <div className="agentlab-bottom"><Code2 size={16}/><span>Read-only original project · local sandbox state · verified structural operations · no real banking transactions</span></div>
    </main>
   </div>
  </section>
 </div>;
}
