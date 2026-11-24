export {configureTableRowAction} from './tableRowActions.mjs';
import {placeMobileElement} from './mobileLayout.mjs';
// Pure visual editing operations shared by the Studio and Node regression tests.
// Edits operate on the single Demo Definition consumed by Preview and Published Viewer.
import {mobileTemplate,mobileTemplateLabels,validMobileNavigation} from './mobileComponents.mjs';
const clone=x=>structuredClone(x);
const slug=s=>String(s||'').trim().toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,40)||'item';
const unique=(base,ids)=>{let id=base,n=2;while(ids.includes(id))id=base+'-'+n++;return id;};
export const palette=['text','card','form','button','notice','hero','table',...Object.keys(mobileTemplateLabels)];
const requireScreen=(d,id)=>{const s=d.screens.find(x=>x.id===id);if(!s)throw Error('Screen does not exist.');return s;};
export function addVisualScreen(d,title,afterId){
 if(d.screens.length>=12)throw Error('Maximum 12 screens reached.');
 title=String(title||'').trim();
 if(title.length<2||title.length>85)throw Error('Give the screen a name of 2–85 characters.');
 if(d.screens.some(s=>s.title.toLowerCase()===title.toLowerCase()))throw Error('A screen with that name already exists.');
 const next=clone(d),id=unique('screen-'+slug(title),next.screens.map(s=>s.id)),at=next.screens.findIndex(s=>s.id===afterId);
 next.screens.splice(at<0?next.screens.length:at+1,0,{id,title,subtitle:'New '+(d.channel==='mobile'?'screen':'page'),elements:[{id:'intro',kind:'notice',tone:'info',title,body:'Edit this section using the visual designer.'}]});
 return {definition:next,screenId:id};
}
export function renameVisualScreen(d,screenId,title){
 const next=clone(d),sc=requireScreen(next,screenId);
 title=String(title||'').trim();
 if(title.length<2||title.length>85)throw Error('Screen title must have 2–85 characters.');
 if(next.screens.some(x=>x.id!==screenId&&x.title.toLowerCase()===title.toLowerCase()))throw Error('A screen with that name already exists.');
 sc.title=title;return next;
}
export {placeMobileElement};
export function addVisualComponent(d,screenId,kind){
 if(!palette.includes(kind))throw Error('Unsupported component kind.');
 const next=clone(d),sc=requireScreen(next,screenId);
 if(sc.elements.length>=15)throw Error('Maximum 15 components on a screen.');
 const id=unique('visual-'+kind,sc.elements.map(x=>x.id));
 const common={id};
 let el;
 if(kind==='text')el={...common,kind:'notice',tone:'info',title:'Text heading',body:'Description text'};
 if(kind==='card')el={...common,kind:'notice',tone:'info',title:'Card title',body:'Card description'};
 if(kind==='notice')el={...common,kind:'notice',tone:'success',title:'Notice',body:'Information for the user'};
 if(kind==='hero')el={...common,kind:'hero',eyebrow:'INTRODUCTION',title:'New heading',description:'Describe the next step.'};
 if(kind==='form')el={...common,kind:'form',title:'Form',description:'Enter your details',fields:[{id:'field-1',label:'New field',type:'text',required:false}],actionLabel:'Continue'};
 if(kind==='button')el={...common,kind:'actions',buttons:[{id:'button-1',label:'Continue',variant:'primary'}]};
 if(kind==='table')el={...common,kind:'table',title:'Records',subtitle:'Sample entries',columns:[{id:'reference',label:'Reference'},{id:'status',label:'Status'}],rows:[{reference:'DEMO-1001',status:'Pending'}]};
 if(Object.hasOwn(mobileTemplateLabels,kind))el=mobileTemplate(kind,id);
 if(el?.kind==='navigation'&&next.channel!=='mobile')throw Error('Mobile navigation is available only for mobile projects.');
 sc.elements.push(el);
 if(el.kind==='navigation'){
  // Make the new component available even if a slot is occupied: use the body
  // until the BA explicitly frees or selects a header/footer position.
  const slot=el.placement;
  if(slot!=='body'&&sc.elements.some(other=>other.id!==id&&other.kind==='navigation'&&(other.placement||(other.variant==='menu'?'header-right':'bottom'))===slot))el.placement='body';
 }
 return{definition:next,elementId:id};
}
// Insert a library component directly at the chosen location on the canvas.
export function insertVisualComponent(d,screenId,kind,beforeElementId){
 const added=addVisualComponent(d,screenId,kind);
 if(!beforeElementId)return added;
 const target=requireScreen(added.definition,screenId).elements.findIndex(e=>e.id===beforeElementId);
 if(target<0)throw Error('Drop location is no longer available.');
 return{definition:moveVisualComponent(added.definition,screenId,added.elementId,target),elementId:added.elementId};
}
export function moveVisualComponentBefore(d,screenId,elementId,beforeElementId){
 const sc=requireScreen(d,screenId);
 if(elementId===beforeElementId)return clone(d);
 const target=sc.elements.findIndex(e=>e.id===beforeElementId);
 if(target<0)throw Error('Drop location is no longer available.');
 const current=sc.elements.findIndex(e=>e.id===elementId);
 if(current<0)throw Error('Dragged component no longer exists.');
 return moveVisualComponent(d,screenId,elementId,current<target?target-1:target);
}
export function moveVisualComponent(d,screenId,elementId,toIndex){
 const next=clone(d),elements=requireScreen(next,screenId).elements;
 const from=elements.findIndex(e=>e.id===elementId);
 if(from<0)throw Error('Component not found.');
 const index=Math.max(0,Math.min(elements.length-1,Number(toIndex)));
 elements.splice(index,0,elements.splice(from,1)[0]);
 return next;
}
export function removeVisualComponent(d,screenId,elementId){
 const next=clone(d),sc=requireScreen(next,screenId);
 const index=sc.elements.findIndex(x=>x.id===elementId);
 if(index<0)throw Error('Component not found.');
 sc.elements.splice(index,1);return next;
}
export function setVisualSubmitVisibility(d,screenId,formId,visible){
 const next=clone(d),form=requireScreen(next,screenId).elements.find(e=>e.id===formId);
 if(form?.kind!=='form')throw Error('Select a form to change its submit button.');
 form.hideSubmit=!visible;
 return next;
}
export function removeVisualButton(d,screenId,elementId,buttonId){
 const next=clone(d),sc=requireScreen(next,screenId);
 const group=sc.elements.find(e=>e.id===elementId);
 if(group?.kind!=='actions')throw Error('Select an action button.');
 if(!group.buttons.some(b=>b.id===buttonId))throw Error('Button does not exist.');
 if(group.buttons.length===1)sc.elements=sc.elements.filter(e=>e.id!==elementId);
 else group.buttons=group.buttons.filter(b=>b.id!==buttonId);
 return next;
}
export function editVisualComponent(d,screenId,elementId,patch){
 const next=clone(d),el=requireScreen(next,screenId).elements.find(x=>x.id===elementId);
 if(!el)throw Error('Component not found.');
 const permitted={hero:['title','description','eyebrow'],notice:['title','body','tone'],form:['title','description','actionLabel'],table:['title','subtitle'],actions:[],stats:[],composed:['title'],navigation:['title']};
 for(const [name,value] of Object.entries(patch)){
  if(!permitted[el.kind]?.includes(name)||typeof value!=='string')throw Error('This property cannot be edited here.');
  if(value.length>350)throw Error('Text is too long.');
  if(name==='title'&&!value.trim())throw Error('Title cannot be blank. Enter a heading or use Undo to restore it.');
  el[name]=value;
 }
 return next;
}
export function setVisualAppearance(d,screenId,elementId,appearance,buttonId){
 const next=clone(d),el=requireScreen(next,screenId).elements.find(x=>x.id===elementId);
 if(!el)throw Error('Component not found.');
 let node=el;
 if(buttonId){
  if(el.kind==='actions'){node=el.buttons.find(b=>b.id===buttonId);}
  else if(el.kind==='form'&&buttonId==='__submit__'){node={appearance:el.submitAppearance};}
  else throw Error('Not an editable button.');
  if(!node)throw Error('Button not found.');
 }
 const allowed=['backgroundColor','textColor','alignment','textAlign','padding','borderRadius'];
 for(const [key,value] of Object.entries(appearance)){
  if(!allowed.includes(key))throw Error('Unsupported appearance property.');
  if(['backgroundColor','textColor'].includes(key)&&!(typeof value==='string'&&/^#[a-fA-F0-9]{6}$/.test(value)))throw Error('Invalid color.');
  if(['alignment','textAlign'].includes(key)&&!['left','center','right'].includes(value))throw Error('Invalid alignment.');
  if(['padding','borderRadius'].includes(key)&&!(Number.isInteger(value)&&value>=0&&value<=48))throw Error('Invalid spacing.');
 }
 const updated={...(node.appearance||{}),...appearance};
 if(buttonId==='__submit__')el.submitAppearance=updated;else node.appearance=updated;
 return next;
}
// A generated/composed section contains stable, editable child items.
// Editing them uses the same application definition as the published renderer.
export function editVisualItem(d,screenId,elementId,itemId,patch){
 const next=clone(d),section=requireScreen(next,screenId).elements.find(e=>e.id===elementId);
 if(section?.kind!=='composed')throw Error('Select a generated section.');
 const item=section.items.find(i=>i.id===itemId);
 if(!item)throw Error('Generated item no longer exists.');
 for(const [key,value] of Object.entries(patch)){
  if(!['label','text'].includes(key)||typeof value!=='string'||value.length>350)throw Error('Unsupported generated item property.');
  if(key==='label'&&!value.trim())throw Error('Item label cannot be blank.');
  item[key]=value;
 }
 return next;
}
export function setVisualItemAppearance(d,screenId,elementId,itemId,patch){
 const next=clone(d),section=requireScreen(next,screenId).elements.find(e=>e.id===elementId);
 if(section?.kind!=='composed')throw Error('Select a generated section.');
 const item=section.items.find(i=>i.id===itemId);
 if(!item)throw Error('Generated item no longer exists.');
 const allowed=['backgroundColor','textColor','textAlign','alignment','padding','borderRadius'];
 for(const [key,value] of Object.entries(patch)){
  if(!allowed.includes(key))throw Error('Unsupported appearance property.');
  if(['backgroundColor','textColor'].includes(key)&&!(typeof value==='string'&&/^#[a-fA-F0-9]{6}$/.test(value)))throw Error('Invalid color.');
  if(['alignment','textAlign'].includes(key)&&!['left','center','right'].includes(value))throw Error('Invalid alignment.');
  if(['padding','borderRadius'].includes(key)&&!(Number.isInteger(value)&&value>=0&&value<=48))throw Error('Invalid spacing.');
 }
 item.appearance={...(item.appearance||{}),...patch};return next;
}
export function moveVisualItem(d,screenId,elementId,itemId,toIndex){
 const next=clone(d),section=requireScreen(next,screenId).elements.find(e=>e.id===elementId);
 if(section?.kind!=='composed')throw Error('Select a generated section.');
 const idx=section.items.findIndex(i=>i.id===itemId);
 if(idx<0)throw Error('Generated item no longer exists.');
 const dest=Math.max(0,Math.min(section.items.length-1,Number(toIndex)));
 section.items.splice(dest,0,section.items.splice(idx,1)[0]);return next;
}
export function removeVisualItem(d,screenId,elementId,itemId){
 const next=clone(d),section=requireScreen(next,screenId).elements.find(e=>e.id===elementId);
 if(section?.kind!=='composed')throw Error('Select a generated section.');
 if(!section.items.some(i=>i.id===itemId))throw Error('Generated item no longer exists.');
 // Do not silently orphan downstream dynamic bindings.
 if(section.items.some(i=>i.id!==itemId&&(i.visibleWhen?.field===itemId||i.filterField===itemId||i.filterFields?.some(f=>f.field===itemId)||i.actions?.some(a=>a.target===itemId))))throw Error('This item is referenced by another control. Update its dependent behavior before removing it.');
 section.items=section.items.filter(i=>i.id!==itemId);return next;
}
export function addVisualField(d,screenId,formId,type='text'){
 const next=clone(d),form=requireScreen(next,screenId).elements.find(e=>e.id===formId);
 if(form?.kind!=='form')throw Error('Select a form first.');
 if(form.fields.length>=20)throw Error('Maximum 20 form fields.');
 const supported=['text','email','password','number','select','date','checkbox','file'];
 if(!supported.includes(type))throw Error('Invalid input type.');
 const id=unique('field',form.fields.map(f=>f.id));
 const field={id,label:type==='file'?'Choose file':'New field',type,required:false};
 if(type==='select')field.options=['Option A','Option B'];
 form.fields.push(field);return{definition:next,fieldId:id};
}
export function editVisualField(d,screenId,formId,fieldId,patch){
 const next=clone(d),form=requireScreen(next,screenId).elements.find(e=>e.id===formId);
 if(form?.kind!=='form')throw Error('Form not found.');
 const field=form.fields.find(f=>f.id===fieldId);
 if(!field)throw Error('Field not found.');
 for(const [k,v] of Object.entries(patch)){
  if(k==='label'&&typeof v==='string'&&v.trim()&&v.length<=100)field.label=v.trim();
  else if(k==='required'&&typeof v==='boolean')field.required=v;
  else if(k==='type'&&['text','email','password','number','select','date','checkbox','file'].includes(v)){field.type=v;if(v==='select'&&!field.options?.length)field.options=['Option A','Option B'];}
  else if(k==='options'&&Array.isArray(v)&&v.length>0&&v.length<=20&&v.every(x=>typeof x==='string'))field.options=v;
  else throw Error('Unsupported field value.');
 }
 return next;
}
export function moveVisualField(d,screenId,formId,fieldId,toIndex){
 const next=clone(d),form=requireScreen(next,screenId).elements.find(e=>e.id===formId);
 if(form?.kind!=='form')throw Error('Form not found.');
 const from=form.fields.findIndex(f=>f.id===fieldId);
 if(from<0)throw Error('Field not found.');
 const index=Math.max(0,Math.min(form.fields.length-1,Number(toIndex)));
 form.fields.splice(index,0,form.fields.splice(from,1)[0]);return next;
}
export function removeVisualField(d,screenId,formId,fieldId){
 const next=clone(d),form=requireScreen(next,screenId).elements.find(e=>e.id===formId);
 if(form?.kind!=='form'||form.fields.length<=1)throw Error('Form must contain at least one field.');
 form.fields=form.fields.filter(f=>f.id!==fieldId);
 return next;
}
export function connectVisualFlow(d,fromId,sourceId,toId){
 const next=clone(d),source=requireScreen(next,fromId);
 if(!next.screens.some(s=>s.id===toId))throw Error('Destination screen does not exist.');
 if(fromId===toId)throw Error('Select a different destination.');
 const key=String(sourceId||'');
 if(key.startsWith('form:')){
  const el=source.elements.find(e=>e.id===key.slice(5));
  if(el?.kind!=='form')throw Error('Source form does not exist.');
  el.nextScreen=toId;
 }else if(key.startsWith('button:')){
  const [,elementId,buttonId]=key.split(':');
  const el=source.elements.find(e=>e.id===elementId);
  const b=el?.kind==='actions'?el.buttons.find(b=>b.id===buttonId):null;
  if(!b)throw Error('Source button does not exist.');
  b.nextScreen=toId;
 }else if(key.startsWith('nav:')){
  const [,elementId,linkId]=key.split(':');const el=source.elements.find(e=>e.id===elementId);
  if(el?.kind!=='navigation')throw Error('Source navigation component does not exist.');
  const link=el.links.find(l=>l.id===linkId);if(!link)throw Error('Navigation item does not exist.');
  link.screenId=toId;
 }else if(key.startsWith('table:')){
  const el=source.elements.find(e=>e.id===key.slice(6));
  if(el?.kind!=='table')throw Error('Table does not exist.');
  el.rowAction={type:'navigate',label:el.rowAction?.label||'View',screenId:toId,passRow:el.rowAction?.passRow!==false};
  el.detailScreen=toId;
 }else if(key.startsWith('composed-table:')){
  const [,elementId,itemId]=key.split(':');const el=source.elements.find(e=>e.id===elementId);
  const item=el?.kind==='composed'?el.items.find(i=>i.id===itemId&&i.kind==='table'):null;
  if(!item)throw Error('Generated table does not exist.');
  item.rowAction={type:'navigate',label:item.rowAction?.label||'View',screenId:toId,passRow:item.rowAction?.passRow!==false};
 }else if(key.startsWith('composed:')){
  const [,elementId,itemId]=key.split(':');const el=source.elements.find(e=>e.id===elementId);
  if(el?.kind!=='composed')throw Error('Source reusable template does not exist.');
  const button=el.items.find(i=>i.id===itemId&&i.kind==='button');
  if(!button)throw Error('Template button does not exist.');
  button.nextScreen=toId;
 }else throw Error('Choose a button, menu item or form submit event.');
 return next;
}
export function visualFlowActions(d,screenId){
 const sc=requireScreen(d,screenId);
 return sc.elements.flatMap(el=>el.kind==='form'?(el.hideSubmit?[]:[{id:'form:'+el.id,label:el.actionLabel,screenId:el.nextScreen||''}]):
  el.kind==='actions'?el.buttons.map(b=>({id:'button:'+el.id+':'+b.id,label:b.label,screenId:b.nextScreen||''})):
  el.kind==='navigation'?el.links.map(link=>({id:'nav:'+el.id+':'+link.id,label:link.label,screenId:link.screenId||''})):
  el.kind==='table'?[{id:'table:'+el.id,label:el.rowAction?.label||'View',screenId:el.rowAction?.screenId||el.detailScreen||''}]:
  el.kind==='composed'?el.items.filter(item=>item.kind==='button'||item.kind==='table').map(item=>item.kind==='table'?{id:'composed-table:'+el.id+':'+item.id,label:item.rowAction?.label||'View',screenId:item.rowAction?.screenId||''}:{id:'composed:'+el.id+':'+item.id,label:item.label,screenId:item.nextScreen||''}):[]);
}
export function visualFlowEdges(d){return d.screens.flatMap(s=>visualFlowActions(d,s.id).filter(a=>a.screenId).map(a=>({from:s.id,to:a.screenId,actionId:a.id,label:a.label})));}