// Preflight for external data dependencies. Decisions about existing systems are business ambiguity,
// not component-schema errors. Never silently fabricate real banking integrations.
const sourceRe=/\b(?:existing|current|our|live|actual|production)\s+(?:(?:bank(?:ing)?|core|crm|customer|enterprise|backend|external|company|internal)\s+)?(?:system|database|api|service|platform|records|data)\b|\b(?:fetch|pull|sync|load|retrieve|integrate|connect)\s+(?:(?:the|our|real|existing|live)\s+)?(?:data|records|information)\s+from\b|\b(?:live|real.time|production)\s+(?:data|integration|feed)\b/i;
const explicitDemo=/\b(?:use|with|using|prefer|choose|only)\s+(?:(?:local|sample|mock|mocked|fictional|synthetic|simulated|demo)\s+){1,3}(?:data|records|values|information)\b|\bno\s+(?:real|live|external)\s+(?:connection|integration|data)\b/i;
const explicitPlaceholder=/\b(?:integration\s+(?:placeholder|stub)|placeholder\s+(?:for\s+)?(?:an?\s+)?integration|mock\s+api|api\s+stub|connection\s+placeholder)\b/i;
export function externalDataDecision(instruction,clarifications=[]){
 const text=String(instruction||'');
 if(!sourceRe.test(text))return null;
 const answerText=(Array.isArray(clarifications)?clarifications:[]).map(x=>String(x.answer||'')).join(' ');
 if(explicitDemo.test(text)||explicitDemo.test(answerText))return{mode:'demo',explicit:true};
 if(explicitPlaceholder.test(text)||explicitPlaceholder.test(answerText))return{mode:'placeholder',explicit:true};
 const negative=/\b(?:do not|don't|without|no)\s+(?:connect|integrate|access|fetch)\b/i.test(text);
 if(negative)return{mode:'demo',explicit:true};
 return{mode:'clarify',question:'This demo does not have a connection to your existing banking system. Which data behavior should I use?',options:['Use fictional local demo data and simulated interactions','Create an integration placeholder without connecting to a live system'],reason:'MEYON cannot retrieve live banking records from the current demo environment without a configured integration.'};
}
export function externalDataGuard(text,clarifications=[]){
 const decision=externalDataDecision(text,clarifications);
 if(!decision||decision.mode!=='clarify')return null;
 return{needsClarification:true,question:decision.question,options:decision.options,reason:decision.reason,summary:'Select a data-source approach before generating the demo. No screens were changed.'};
}
