// Navigation links are independent from screen content. A portal can link more than once
// to an existing screen without duplicating it or modifying its header/fields.
const normalize=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
export function validNavigationLinks(demo){
 const links=demo?.navLinks;
 if(links===undefined)return true;
 if(demo.channel!=='portal'||!Array.isArray(links)||links.length>12)return false;
 const ids=new Set(),labels=new Set();
 const screenIds=new Set((demo.screens||[]).map(s=>s.id));
 const rootLabels=new Set((demo.screens||[]).filter(s=>!s.parentScreenId).map(s=>normalize(s.title)));
 for(const link of links){
  if(!link||typeof link!=='object'||Array.isArray(link))return false;
  if(Object.keys(link).some(k=>!['id','label','screenId'].includes(k)))return false;
  if(typeof link.id!=='string'||!/^nav-[a-z0-9_-]{1,60}$/.test(link.id)||ids.has(link.id))return false;
  if(typeof link.label!=='string'||!link.label.trim()||link.label.length>85)return false;
  if(typeof link.screenId!=='string'||!screenIds.has(link.screenId))return false;
  const name=normalize(link.label);
  if(!name||labels.has(name)||rootLabels.has(name))return false;
  ids.add(link.id);labels.add(name);
 }
 return true;
}
export function planPortalMenuLink(demo,instruction,selectedScreenId){
 const phrase=String(instruction||'').trim();
 if(demo?.channel!=='portal'||!/\b(?:add|create|insert|include|show)\b/i.test(phrase))return null;
 if(!/\b(?:left\s*(?:side\s*)?(?:menu|navigation|nav)|sidebar|navigation\s*menu|menu\s*(?:item|option|entry)|nav\s*(?:item|option))\b/i.test(phrase))return null;
 if(/\b(?:subsection|sub\s*menu|submenu|nested|under\s+reports?)\b/i.test(phrase))return null;
 const words=[
  /\b(?:add|create|insert|include|show)\s+(?:a\s+|an\s+|the\s+)?(?:new\s+)?["“']?(.+?)["”']?\s+(?:option|menu\s*item|menu\s*option|menu\s*entry|item|link|entry)\s+(?:in|on|to)\s+(?:the\s+)?(?:left\s+)?(?:menu|navigation|sidebar)/i,
  /\b(?:add|create|insert|include|show)\s+(?:a\s+|an\s+|the\s+)?(?:new\s+)?["“']?(.+?)["”']?\s+(?:in|on|to)\s+(?:the\s+)?(?:left\s+)?(?:menu|navigation|sidebar)/i,
  /\b(?:left\s+menu|sidebar)\s*[:,-]?\s*(?:add\s+)?["“']?([^."”']+)["”']?\s*(?:option|menu item)?/i
 ];
 let label=words.map(re=>re.exec(phrase)?.[1]?.trim()).find(Boolean);
 if(!label)return null;
 label=label.replace(/^(?:a|an|the)\s+/i,'').replace(/\s+(?:as\s+an?\s+option|option|menu\s*item)$/i,'').trim();
 if(!label||label.length>85)return null;
 const matching=(demo.screens||[]).filter(s=>normalize(s.title)===normalize(label)&&!s.parentScreenId);
 // An existing same-named root entry is already visible; no duplicate.
 if(matching.length) return {alreadyExists:true,label,screenId:matching[0].id};
 const requestedDestination=/\b(?:open|navigate\s+to|link\s+to|point\s+to)\s+(?:the\s+)?(.+?)\s*(?:screen|page)?(?:[.!?]|$)/i.exec(phrase)?.[1]?.trim();
 const candidates=(demo.screens||[]).filter(s=>!s.parentScreenId);
 const exact=candidates.find(s=>requestedDestination&&normalize(s.title)===normalize(requestedDestination));
 const chosen=exact||candidates.find(s=>s.id===selectedScreenId);
 if(!chosen)return null;
 return {label,screenId:chosen.id};
}
export function navigationMenuLinks(demo){return demo?.channel==='portal'&&Array.isArray(demo.navLinks)?demo.navLinks:[]}
