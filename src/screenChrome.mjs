// Shared presentation contract, used by editor, viewer, and backend verification.
// Screen chrome is an optional override of the application-wide chrome.
// Absence of an override preserves all existing version-1 demos.
export function resolveScreenChrome(demo,screen,company='',projectName=''){
 const global=demo?.chrome||{};
 const local=screen?.chrome||{};
 const brandName=local.brandName||global.brandName||company||((demo?.name||projectName).match(/^(.+?\bBank)\b/i)?.[1])||projectName||'Demo application';
 return {
  brandName,
  showBrandIcon:typeof local.showBrandIcon==='boolean'?local.showBrandIcon:global.showBrandIcon!==false,
  showBackButton:typeof local.showBackButton==='boolean'?local.showBackButton:global.showBackButton!==false
 };
}
export function validScreenChrome(chrome){
 if(chrome===undefined)return true;
 if(!chrome||typeof chrome!=='object'||Array.isArray(chrome))return false;
 const keys=Object.keys(chrome);
 if(!keys.length||keys.some(k=>!['brandName','showBrandIcon','showBackButton'].includes(k)))return false;
 if(chrome.brandName!==undefined&&(typeof chrome.brandName!=='string'||!chrome.brandName.trim()||chrome.brandName.length>100))return false;
 if(chrome.showBrandIcon!==undefined&&typeof chrome.showBrandIcon!=='boolean')return false;
 if(chrome.showBackButton!==undefined&&typeof chrome.showBackButton!=='boolean')return false;
 return true;
}
