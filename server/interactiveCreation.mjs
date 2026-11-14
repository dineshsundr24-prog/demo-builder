// Dedicated creation path: one user intent -> one validated interactive section -> one atomic screen edit.
// Existing component/field edits remain within the grounded operations planner.
import {normalizeComponent,componentValidationIssues,issueCategory} from './editRecovery.mjs';
import {validComposed} from '../src/composed.mjs';
import {applyOperations} from './operations.mjs';

export function interactiveCreationIntent(instruction,selection){
 const text=String(instruction||'').trim();
 if(selection?.level!=='screen')return false;
 if(!/\b(create|build|design|generate|add|make|insert)\b/i.test(text))return false;
 if(/\b(under|beneath|within)\s+(?:the\s+)?\w+\s+(?:menu|navigation)\b/i.test(text))return false;
 if(/\b(subsection|submenu|sub-menu)\b/i.test(text))return false;
 if(/\b(replace|remove|rename|modify|update|change|move|reorder|delete)\b/i.test(text))return false;
 return /\b(dashboard|widget|component|panel|interactive\s+(?:section|view|form|table|report|screen)|activity\s+view|calculator|monitor|tracker|timeline)\b/i.test(text);
}
export function safeCreationDiagnostic(error){
 const issues=Array.isArray(error?.validationIssues)?error.validationIssues.map(x=>String(x).split(':')[0]).slice(0,10):[];
 return {category:issueCategory(String(error?.message||'')),issuePaths:issues};
}
export async function createInteractiveSection({demo,target,instruction,scope,generate}){
 const screen=demo.screens.find(s=>s.id===target.screenId);
 if(!screen)throw Error('Selected screen is missing.');
 if(screen.elements.length>=15)throw Error('Selected screen has no room for another component.');
 let partial=null,issues=[],lastError=null;
 for(let attempt=0;attempt<3;attempt++){
  try{
   const generated=await generate({action:'add-component'},partial,scope,issues);
   const component=normalizeComponent(generated);
   const problems=componentValidationIssues(component,scope.screenIds);
   if(component&&validComposed(component,scope.screenIds)&&!problems.length){
    const operation={op:'add-component',target:{level:'screen',screenId:target.screenId},component};
    const result=applyOperations(demo,target,[operation],demo.channel);
    return{scope:'planned',target,label:screen.title,operations:[operation],definition:result.definition,
      checks:result.checks,preservedScreens:result.preservedScreens,
      summary:'Created an interactive demo section on '+screen.title+' using '+(scope.dataSourceMode==='placeholder'?'a disconnected integration placeholder':'local fictional data and supported interactions')+'. Review and Apply.',
      usage:{model:'component-generation',inputTokens:0,outputTokens:0}};
   }
   partial=component;issues=problems;
   lastError=new Error('Component schema invalid after synthesis');
   lastError.validationIssues=issues;
  }catch(error){
   lastError=error;
   if(error?.validationIssues)issues=error.validationIssues;
   if(/already exists|too many|no room|preserv|screen/.test(String(error?.message||''))&&attempt>0)break;
  }
 }
 const error=new Error('Component creation could not produce a valid executable definition');
 error.validationIssues=issues.length?issues:lastError?.validationIssues||[];
 error.causeCode=lastError?.message||'generation';
 throw error;
}
