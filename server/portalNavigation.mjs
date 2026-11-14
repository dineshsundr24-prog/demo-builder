// Deterministic portal navigation intent. A subsection is a real child screen, not a form element.
const norm=x=>String(x||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().replace(/s$/,'');
export function planPortalSubsection(demo,instruction){
 if(demo?.channel!=='portal'||!Array.isArray(demo.screens))return null;
 const phrase=String(instruction||'').trim();
 if(!/\b(add|create|insert|include)\b/i.test(phrase)||!/\b(sub\s*section|sub\s*menu|submenu|child\s+(?:menu|page)|nested\s+(?:menu|item)|user\s+report\s+section)\b/i.test(phrase))return null;
 const under=/\b(?:under|inside|beneath|within)\s+(?:the\s+)?(.+?)(?:\s+(?:on|in)\s+(?:the\s+)?left\s+(?:menu|navigation)|[.,!?]|$)/i.exec(phrase);
 const parentPhrase=under?.[1]?.replace(/\s+(?:menu|navigation|tab|section|screen)$/i,'').trim();
 const roots=demo.screens.filter(s=>!s.parentScreenId);
 let parent=roots.find(s=>parentPhrase&&norm(s.title)===norm(parentPhrase));
 if(!parent&&parentPhrase){const matches=roots.filter(s=>norm(s.title).includes(norm(parentPhrase))||norm(parentPhrase).includes(norm(s.title)));if(matches.length===1)parent=matches[0];}
 if(!parent)return null;
 const named=/\b(?:called|named|titled|labelled|labeled)\s+["“']?(.+?)["”']?(?:\s+(?:under|inside|beneath|within)\b|[.,!?]|$)/i.exec(phrase);
 const adding=/\b(?:add|create|insert|include)\s+(?:a\s+|an\s+|the\s+)?(.+?)\s+(?:subsection|sub-section|sub section|section|submenu|sub-menu|sub menu|child page|nested menu item)\s+(?:under|inside|beneath|within)\b/i.exec(phrase);
 let title=named?.[1]?.trim()||adding?.[1]?.trim();
 if(title&&/^(?:a|an|the|new|another)$/i.test(title))title='';
 if(!title)title=norm(parent.title)==='report'?'User Reports':'New subsection';
 return{parentScreenId:parent.id,title:title.slice(0,85)};
}
export function portalNavigationRoots(screens){return screens.filter(s=>!s.parentScreenId)}
export function portalChildren(screens,id){return screens.filter(s=>s.parentScreenId===id)}
