// User-facing clarification contract for ambiguous or unsatisfied dynamic-demo requests.
// A clarification is returned in the same chat, not a technical 422 rejection.
export function clarificationForPlan(plan,issue='',instruction=''){
 const candidate=String(instruction||'').trim();
 if(plan?.status==='clarify'&&typeof plan.question==='string'&&plan.question.trim()){
  const options=Array.isArray(plan.options)?plan.options.filter(x=>typeof x==='string'&&x.trim()).slice(0,4):[];
  return {question:plan.question.slice(0,280),options:options.length?options:['Use a locally simulated demo interaction','Create a visual clickable approximation'],reason:'A behavior choice is needed before creating the interactive component.'};
 }
 if(plan?.status==='unsupported'){
  const reason=typeof plan.reason==='string'?plan.reason.slice(0,180):'The requested behavior is not available as a built-in action.';
  return {question:'MEYON can build a safe clickable approximation. Should this interaction use simulated local demo behavior, or only show a visual component with navigation?',options:['Simulate the interaction locally','Visual component with navigation','Describe another behavior'],reason};
 }
 const detail=String(issue||'');
 if(/target|ambiguous|selected|registry/i.test(detail)){
  return{question:'Which part of the selected screen should receive this change?',options:['Add it as a new section on this screen','Replace the existing selected component','Describe its exact position'],reason:'MEYON needs to confirm the target before changing existing content.'};
 }
 if(/component|action|schema|invalid|missing|field|operation|capability/i.test(detail)){
  return{question:'How should the new component behave when a user interacts with it?',options:['Use local demo data and simulated actions','Navigation and simple input only','I will describe the interaction'],reason:'MEYON could not validate the proposed interaction and has preserved your existing demo.'};
 }
 return{question:'Can you clarify the expected clickable behavior for this request?',options:['Use the closest working interactive component','Build a visual prototype with simple navigation','I will describe the behavior'],reason:'MEYON needs one detail before safely updating the demo.'};
}
export function clarificationResponse(input,plan,issue){
 const c=clarificationForPlan(plan,issue,input);
 return{needsClarification:true,question:c.question,options:c.options,reason:c.reason,summary:'One clarification is needed. Your original screen and requirement remain unchanged.'};
}
