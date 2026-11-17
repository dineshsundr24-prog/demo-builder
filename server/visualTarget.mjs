// Resolve simple visual refinements against the actual, stable inventory of visible controls.
// Supports form submit controls, action buttons and generated components without prompt-specific paths.
import {buildRegistry,normalizeName,resolveChangeSet} from './registry.mjs';
const colors={orange:'#F58220',red:'#D32F2F',blue:'#1565C0',green:'#2E7D32',teal:'#008E86',purple:'#6A1B9A',black:'#212121',white:'#FFFFFF',yellow:'#F9A825',grey:'#757575',gray:'#757575',pink:'#D81B60'};
function visualProperty(instruction){
 const s=String(instruction||'');
 const explicit=s.match(/#[0-9a-fA-F]{6}\b/);
 const found=Object.entries(colors).filter(([name])=>new RegExp('\\b'+name+'\\b','i').test(s));
 const isColor=/\b(colou?r|background|foreground|fill)\b/i.test(s);
 if(isColor){
  const value=explicit?.[0]||(found.length===1?found[0][1]:null);
  if(!value)return null;
  return {property:/\b(text|font|foreground)\s+colou?r\b/i.test(s)?'textColor':'backgroundColor',value};
 }
 if(/\b(?:centre|center)(?:ed)?\b/i.test(s))return {property:/\btext\b/i.test(s)?'textAlign':'alignment',value:'center'};
 if(/\b(?:align|alignment)\b/i.test(s)){
  const value=/\bleft\b/i.test(s)?'left':/\bright\b/i.test(s)?'right':/\bcenter\b|\bcentre\b/i.test(s)?'center':null;
  if(value)return{property:/\btext\b/i.test(s)?'textAlign':'alignment',value};
 }
 return null;
}
export function resolveVisualTarget(demo,selection,instruction){
 const style=visualProperty(instruction);
 if(!style)return null;
 // Combined changes should use the ordinary grounded planner.
 if(/\b(?:and\s+(?:also\s+)?(?:add|remove|delete|create|rename|hide|show|move|change|set|update))\b/i.test(instruction))return null;
 const registry=buildRegistry(demo,selection);
 const eligible=registry.filter(x=>x.target.screenId===selection.screenId&&x.capabilities.includes('set-style')&&
  (selection.level==='screen'||x.target.elementId===selection.elementId)&&
  ['element','button','item'].includes(x.target.level));
 const normalized=normalizeName(instruction);
 const matched=eligible.filter(x=>{
  const label=normalizeName(x.label);
  return label.length>=3&&(' '+normalized+' ').includes(' '+label+' ');
 });
 let hits=matched.filter(x=>x.target.level==='button'||x.target.level==='item');
 if(!hits.length)hits=matched;
 if(!hits.length&&selection.level!=='screen'){
  hits=eligible.filter(x=>x.target.level===selection.level&&x.target.elementId===selection.elementId&&x.target.childId===selection.childId);
 }
 if(!hits.length)return null;
 const bestLength=Math.max(...hits.map(x=>normalizeName(x.label).length));
 const best=hits.filter(x=>normalizeName(x.label).length===bestLength);
 if(best.length!==1)return{status:'ambiguous',choices:best.map(x=>x.target),reason:'More than one visible control matches the requested name.'};
 return {status:'resolved',operations:resolveChangeSet(registry,selection,[{action:'set-style',targetId:best[0].id,...style}]),entry:best[0],style};
}
