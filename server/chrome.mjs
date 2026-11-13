// Application chrome contract. Shared, deterministic changes are not screen patches.
// Previous schemaVersion 1 demos remain compatible when chrome is absent.
const clean = v => String(v||'').replace(/\s+/g,' ').trim();
export function inferredBrand(demo,company='',projectName=''){
 const companyName=clean(company);
 if(companyName)return companyName;
 for(const candidate of [demo?.name,projectName]){
  const match=clean(candidate).match(/^(.+?\bBank)\b/i);
  if(match)return match[1];
 }
 return clean(projectName)||clean(demo?.name)||'Demo application';
}
export function effectiveChrome(demo,company='',projectName=''){
 const c=demo?.chrome||{};
 return {
  brandName: typeof c.brandName==='string'&&c.brandName.trim()?c.brandName.trim():inferredBrand(demo,company,projectName),
  showBrandIcon: c.showBrandIcon!==false,
  showBackButton: c.showBackButton!==false
 };
}
export function isGlobalRequest(instruction){
 return /\b(all|every|each)\s+(?:the\s+)?screens?\b|\bacross\s+(?:all\s+)?screens?\b|\bapplication[- ]wide\b|\bglobal(?:ly)?\b/i.test(instruction);
}
export function classifyGlobalEdit(instruction){
 if(!isGlobalRequest(instruction))return null;
 const looksLikeChrome=/\b(header|brand|logo|bank name|bank icon|back icon|back button)\b/i.test(instruction);
 if(!looksLikeChrome)return {supported:false,reason:'This is a multi-screen request. Only shared header/branding changes can be applied globally in this version. Make separate screen edits or regenerate.'};
 const brandMatch=instruction.match(/\b(?:update|change|rename|set|replace)(?:\s+(?:the|that|this|our))?\s+(?:app(?:lication)?\s+)?(?:header|branding|brand|bank name)\s+(?:as|to|with)\s+([a-z][a-z0-9 &.'-]{2,70}?)(?=\s*(?:[,.;\n]|\b(?:keep|remove|hide|on|for|in|and|across|update|apply|do not)\b|$))/i);
 const removal=/\b(?:remove|hide|without)\b[^.\n]{0,90}\b(?:icon|logo)\b|\b(?:icon|logo)\b[^.\n]{0,60}\b(?:remove|hide)\b/i.test(instruction);
 const preserveBack=/\b(?:keep|retain|preserve|don't remove|do not remove)\b[^.\n]{0,50}\bback\b/i.test(instruction);
 const hideBack=/\b(?:remove|hide)\b[^.\n]{0,50}\bback\b/i.test(instruction);
 if(hideBack&&preserveBack)return {supported:false,reason:'Conflicting instructions about the Back button.'};
 if(!brandMatch&&!removal&&!preserveBack&&!hideBack)return {supported:false,reason:'Unable to identify a supported shared-header change. No screens were modified.'};
 return {supported:true,brandName:brandMatch?clean(brandMatch[1]):null,removeBrandIcon:removal,preserveBack,hideBack};
}
export function applyChromeEdit(demo,request,company='',projectName=''){
 if(!request?.supported)throw Error(request?.reason||'Unsupported global change.');
 if(!demo||!Array.isArray(demo.screens))throw Error('Valid demo required.');
 const before=effectiveChrome(demo,company,projectName);
 const next={...before};
 if(request.brandName)next.brandName=request.brandName;
 if(request.removeBrandIcon)next.showBrandIcon=false;
 if(request.preserveBack)next.showBackButton=true;
 if(request.hideBack)next.showBackButton=false;
 const changed=JSON.stringify(before)!==JSON.stringify(next);
 if(!changed)throw Error('Requested header settings are already active; no changes were necessary.');
 const result={...structuredClone(demo),chrome:next};
 if(JSON.stringify(result.screens)!==JSON.stringify(demo.screens))throw Error('Preservation failure: screen content was modified.');
 const visible=effectiveChrome(result,company,projectName);
 if(request.brandName&&visible.brandName!==request.brandName)throw Error('Brand change was not applied.');
 if(request.removeBrandIcon&&visible.showBrandIcon!==false)throw Error('Brand icon is still visible.');
 if(request.preserveBack&&visible.showBackButton!==true)throw Error('Back behavior not preserved.');
 return {definition:result,chrome:visible};
}
