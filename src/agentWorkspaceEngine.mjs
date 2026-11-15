// Agentic Workspace POC: deterministic tool executor over an isolated demo snapshot.
// Nothing here writes the user's project, invokes AI, or calls live banking systems.
import {compileSemanticComponent} from '../server/semanticCompiler.mjs';
import {validComposed} from './composed.mjs';

const clean=s=>String(s||'').trim().toLowerCase().replace(/[^a-z0-9]+/g,' ');
const clone=value=>structuredClone(value);
const matching=(s,term)=>clean(s).includes(clean(term));
export function workspaceFromDemo(input){
 if(!input||input.channel!=='portal'||!Array.isArray(input.screens)||!input.screens.length)throw Error('Select a generated portal demo before opening the workspace.');
 const demo=clone(input);
 const menu=[
  ...(demo.navLinks||[]).map(l=>({id:'link:'+l.id,label:l.label,screenId:l.screenId,kind:'link'})),
  ...demo.screens.filter(s=>!s.parentScreenId).map(s=>({id:'screen:'+s.id,label:s.title,screenId:s.id,kind:'screen'}))
 ];
 return{demo,menu,trace:[],lastResult:null,approval:null,awaiting:null,selectedScreenId:demo.screens[0].id};
}
function verified(state,next,condition){
 if(!condition)throw Error('Outcome verification failed. No change was applied.');
 if(JSON.stringify(state.demo.screens)!==JSON.stringify(next.demo.screens)&&!next.lastResult?.allowScreenEdit)throw Error('A screen changed outside an authorized operation.');
 if(state.menu.length!==next.menu.length)throw Error('An unintended navigation item was added or removed.');
 const oldIds=state.menu.map(x=>x.id).sort().join('|'),newIds=next.menu.map(x=>x.id).sort().join('|');
 if(oldIds!==newIds)throw Error('Navigation identities changed.');
 return next;
}
export function moveMenuBefore(state,moving,before){
 const from=state.menu.findIndex(x=>matching(x.label,moving));
 const to=state.menu.findIndex(x=>matching(x.label,before));
 if(from<0||to<0)return{...state,awaiting:{kind:'target',question:from<0?'Which existing menu entry represents Service Request?':'Which menu entry represents Reports?',options:state.menu.map(x=>x.label)},lastResult:{status:'clarification',message:'The required menu target was not found; no edit was made.'}};
 if(from===to)throw Error('Cannot move a menu item before itself.');
 const next=clone(state),item=next.menu.splice(from,1)[0];
 const insert=next.menu.findIndex(x=>x.id===state.menu[to].id);
 next.menu.splice(insert,0,item);
 const idx=next.menu.findIndex(x=>x.id===item.id);
 next.trace.push({tool:'moveNavigationNode',detail:item.label+' → before '+state.menu[to].label});
 next.trace.push({tool:'verifyNavigationOrder',detail:'Exact adjacency: '+next.menu[idx].label+' immediately before '+next.menu[idx+1]?.label});
 next.lastResult={status:'passed',message:'Navigation order verified. No screen content was changed.'};
 return verified(state,next,idx>=0&&next.menu[idx+1]?.id===state.menu[to].id);
}
export function addActivitySection(state,selectedScreenId=state.selectedScreenId){
 const index=state.demo.screens.findIndex(s=>s.id===selectedScreenId);
 if(index<0)throw Error('Target screen not found.');
 const next=clone(state),screen=next.demo.screens[index];
 if(screen.elements.some(x=>x.id==='generated-user-activity-dashboard'))return {...state,lastResult:{status:'passed',message:'User Activity Dashboard already exists in this workspace; no duplicate was created.'}};
 const requirement='Create a User Activity Dashboard showing login history, last activity, and failed login attempts with search and download. Use fictional demo data.';
 const component=compileSemanticComponent({title:'User Activity Dashboard',type:'table',fields:['User ID','Login History','Last Activity','Failed Login Attempts'],search:true,download:true,filter:false,showSummary:true},requirement,next.demo.screens.map(s=>s.id),'demo');
 if(!validComposed(component,next.demo.screens.map(s=>s.id)))throw Error('Interactive component compilation failed.');
 const table=component.items.find(x=>x.kind==='table');
 if(!table||!['Login History','Last Activity','Failed Login Attempts'].every(f=>table.columns.some(c=>c.label===f)))throw Error('A required metric was omitted.');
 screen.elements.push(component);
 next.selectedScreenId=selectedScreenId;
 next.trace.push({tool:'compileComponent',detail:'Build table + Search + CSV using safe semantic compiler'});
 next.trace.push({tool:'addComponent',detail:'Add User Activity Dashboard to '+screen.title});
 next.trace.push({tool:'verifyComponent',detail:'All 3 required metrics, Search, CSV and unchanged sibling screens'});
 next.lastResult={status:'passed',message:'Interactive dashboard compiled and verified in the isolated workspace.',allowScreenEdit:true};
 if(state.demo.screens.some((old,i)=>i!==index&&JSON.stringify(old)!==JSON.stringify(next.demo.screens[i])))throw Error('Unrelated screen changed.');
 if(next.demo.screens[index].elements.length!==state.demo.screens[index].elements.length+1)throw Error('Missing component after compilation.');
 return next;
}
export function requestApproval(state){
 return{...state,awaiting:{kind:'approval',question:'How should approving an application work in this demo?',options:['Show a confirmation before approving','Approve immediately with a success message','Navigate to a confirmation screen']},lastResult:{status:'clarification',message:'Awaiting one business decision. No changes applied.'},trace:[...state.trace,{tool:'requestClarification',detail:'Approval confirmation behavior is unspecified'}]};
}
export function answerApproval(state,choice){
 if(state.awaiting?.kind!=='approval')throw Error('No approval clarification is pending.');
 if(!state.awaiting.options.includes(choice))throw Error('Unsupported clarification choice.');
 const next=clone(state);
 next.approval={mode:choice,status:'Pending',lastAction:''};
 next.awaiting=null;
 next.trace.push({tool:'resolveClarification',detail:choice});
 next.trace.push({tool:'configureApproval',detail:'Demo-only approval control with selected behavior'});
 next.trace.push({tool:'verifyInteraction',detail:'Approval remains pending until interaction; no external integration'});
 next.lastResult={status:'passed',message:'Approval behavior configured. Test it in the preview.'};
 return next;
}
export function executeApproval(state,confirmed){
 if(!state.approval)throw Error('Approval interaction has not been configured.');
 if((state.approval.mode.includes('confirmation before')||state.approval.mode.includes('confirmation screen'))&&!confirmed)return {...state,approval:{...state.approval,lastAction:state.approval.mode.includes('confirmation screen')?'confirmation-screen':'confirmation-required'}};
 const next=clone(state);next.approval.status='Approved';next.approval.lastAction='Approved locally; no banking action executed';
 return next;
}

const titleCase=s=>String(s).trim().replace(/\b\w/g,c=>c.toUpperCase());
const slug=s=>clean(s).trim().replace(/\s+/g,'-').slice(0,42);
export function createRequestedScreen(state,instruction){
 const prompt=String(instruction||'').trim();
 const intent=/\b(?:add|create|build|generate)\s+(?:(?:a|an|the)\s+)?(?:new\s+)?(?:menu\s+(?:called|named)\s+|screen\s+(?:called|named)\s+)([a-z][a-z0-9 &/-]{2,60}?)(?=\.|,|\s+and\s+|\s+with\s+|$)/i.exec(prompt);
 if(!intent)return null;
 const label=titleCase(intent[1]);
 if(!label||label.length>60)return{...state,lastResult:{status:'unsupported',message:'Please use a short screen or menu name (up to 60 characters).'}};
 const wantsTable=/\b(table|list|history|actions|activity|audit|records|dashboard|showing)\b/i.test(prompt);
 if(!wantsTable)return{...state,lastResult:{status:'unsupported',message:'This experiment can create data-table screens. Other screen types require a separate capability.'}};
 const fieldsSegment=/\b(?:showing|displaying|containing|including)\s+(.+?)(?=\s+with\s+(?:search|filter|export)|\.|$)/i.exec(prompt);
 if(!fieldsSegment)return{...state,lastResult:{status:'clarification',message:'Which columns should the new screen display?',allowScreenEdit:false},awaiting:{kind:'target',question:'Specify columns after “showing”, for example: showing user, action, timestamp and status.',options:[]}};
 const fields=fieldsSegment[1].split(/,|\s+and\s+/i).map(s=>titleCase(s.replace(/^(?:the|a|an)\s+/i,'').trim())).filter(x=>x.length>1&&x.length<70);
 const columns=[...new Set(fields.map(x=>x.toLowerCase()))].map(key=>fields.find(x=>x.toLowerCase()===key)).slice(0,9);
 if(columns.length<2)return{...state,lastResult:{status:'clarification',message:'Please specify at least two columns.'},awaiting:{kind:'target',question:'Provide two or more column names after “showing”.',options:[]}};
 const requested=prompt.toLowerCase(),hasSearch=/\bsearch\b/.test(requested),hasFilter=/\bfilter(?:s|ing)?\b/.test(requested);
 const filterName=columns.find(x=>/status|state|type|category/i.test(x));
 if(hasFilter&&!filterName)return{...state,lastResult:{status:'clarification',message:'A filter field is needed before I can add filtering.'},awaiting:{kind:'target',question:'Please include a Status, Type or Category column for filtering.',options:[]}};
 if(/\b(?:real|live|database|api|synchroni[sz]e|backend|authentication|permission|role-based)\b/i.test(prompt))return{...state,lastResult:{status:'unsupported',message:'Live integrations, authentication and permissions are outside this isolated POC. No changes applied.'}};
 const existing=state.menu.find(x=>clean(x.label)===clean(label));
 if(existing)return{...state,lastResult:{status:'unsupported',message:'A menu or screen named '+label+' already exists. No duplicate was added.'}};
 const next=clone(state),screenId='lab-'+slug(label);
 if(next.demo.screens.some(s=>s.id===screenId))return{...state,lastResult:{status:'unsupported',message:'Screen identifier already exists. No changes applied.'}};
 const component=compileSemanticComponent({title:label+' Records',type:'table',fields:columns,search:hasSearch,download:/\b(csv|export|download)\b/i.test(prompt),filter:false,showSummary:true},prompt,next.demo.screens.map(s=>s.id),'demo');
 const table=component.items.find(x=>x.kind==='table');
 if(!table||!columns.every(x=>table.columns.some(c=>clean(c.label)===clean(x))))throw Error('Generated component did not preserve all requested columns.');
 if(hasFilter){
  const col=table.columns.find(c=>clean(c.label)===clean(filterName));
  if(!col)throw Error('Missing requested filter column.');
  const options=[...new Set(table.rows.map(r=>r[col.id]))];
  component.items.splice(component.items.findIndex(x=>x.id==='data-table'),0,{id:'filter-select',kind:'select',label:'Filter by '+filterName,options:['All',...options]});
  table.filterFields=[{field:'filter-select',column:col.id}];
 }
 if(!validComposed(component,next.demo.screens.map(s=>s.id)))throw Error('Generated table failed structural verification.');
 next.demo.screens.push({id:screenId,title:label,subtitle:'Fictional demo records · no backend connection',elements:[component]});
 next.menu.push({id:'screen:'+screenId,label,screenId,kind:'screen'});
 next.selectedScreenId=screenId;next.awaiting=null;
 next.lastResult={status:'passed',message:'Created '+label+' with '+columns.length+' columns'+(hasSearch?', search':'')+(hasFilter?', status filtering':'')+'. Original screens unchanged.',allowScreenEdit:true};
 next.trace.push({tool:'parseScreenRequest',detail:'Screen: '+label+'; fields: '+columns.join(', ')});
 next.trace.push({tool:'compileComponent',detail:'Safe table runtime with fictional rows'});
 next.trace.push({tool:'verifyNewScreen',detail:'New screen exists, navigation resolves, existing screens preserved'});
 if(next.demo.screens.length!==state.demo.screens.length+1||state.demo.screens.some((s,i)=>JSON.stringify(s)!==JSON.stringify(next.demo.screens[i]))||next.menu.length!==state.menu.length+1)throw Error('Isolation verification failed; original workspace unchanged.');
 return next;
}

export function routeLabInstruction(state,instruction){
 const q=clean(instruction);
 const newScreen=createRequestedScreen(state,instruction);
 if(newScreen)return newScreen;
 if((q.includes('move')||q.includes('reorder'))&&q.includes('service request')&&q.includes('report'))return moveMenuBefore(state,'service request','report');
 if((q.includes('create')||q.includes('build')||q.includes('add'))&&(q.includes('user activity')||q.includes('login history')))return addActivitySection(state);
 if((q.includes('approval')||q.includes('approve'))&&(q.includes('add')||q.includes('create')||q.includes('configure')))return requestApproval(state);
 return{...state,lastResult:{status:'unsupported',message:'This POC supports three controlled tasks. No change was applied.'},trace:[...state.trace,{tool:'scopeGuard',detail:'Unrecognized instruction; no mutation'}]};
}
