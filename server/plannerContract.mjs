// Canonical planner contract. LLMs may use different labels for equivalent plan outcomes.
// Normalize once and keep unknown outcomes as safe, recoverable failures.
const norm=s=>String(s||'').trim().toLowerCase().replace(/[\s-]+/g,'_');
const resolved=new Set(['resolved','success','ready','complete','completed','ok','approved','changes','apply','valid']);
const clarify=new Set(['clarify','clarification','needs_clarification','needs_clarification_from_user','clarification_required','ask','question','ask_user','needs_input','needs_user_input','requires_clarification','needs_more_information']);
const ambiguous=new Set(['ambiguous','ambiguous_target','needs_target','choose_target']);
const unsupported=new Set(['unsupported','cannot_do','not_supported','unavailable']);
export function canonicalPlan(raw){
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return{status:'invalid',reason:'Planner returned no usable object.'};
 const candidate=raw.plan&&typeof raw.plan==='object'&&!Array.isArray(raw.plan)?raw.plan:raw.result&&typeof raw.result==='object'&&!Array.isArray(raw.result)?raw.result:raw;
 const status=norm(candidate.status||candidate.type||candidate.outcome||candidate.resultType||candidate.decision);
 const changes=candidate.changes||candidate.operations||candidate.edits||candidate.actions;
 const question=candidate.question||candidate.clarificationQuestion||candidate.clarification?.question||candidate.message;
 const options=candidate.options||candidate.choices||candidate.suggestions||candidate.clarification?.options;
 if(resolved.has(status)||(!status&&Array.isArray(changes)&&changes.length))return{status:'resolved',changes:Array.isArray(changes)?changes:[]};
 if(clarify.has(status)||(!status&&typeof question==='string'&&question.trim()))return{status:'clarify',question:typeof question==='string'?question:'Which interaction should the demo use?',options:Array.isArray(options)?options:[]};
 if(ambiguous.has(status))return{status:'ambiguous',candidateIds:Array.isArray(candidate.candidateIds)?candidate.candidateIds:[],question:typeof question==='string'?question:'Which component should change?'};
 if(unsupported.has(status))return{status:'unsupported',reason:String(candidate.reason||candidate.message||'Cannot render the requested behavior.')};
 return{status:'invalid',reason:'Unrecognized AI planning response.',returnedStatus:status};
}
export function plannerContext(instruction,clarifications=[]){
 return{instruction,clarifications:clarifications.slice(0,5).map(x=>({question:String(x.question||'').slice(0,300),answer:String(x.answer||'').slice(0,500)}))};
}
