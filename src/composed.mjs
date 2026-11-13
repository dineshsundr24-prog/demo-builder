// Declarative, demo-only component definitions. No model-generated code is executed.
export const composedKinds=['text','card','input','checkbox','select','button','progress'];
export function validComposed(element,screenIds=[]){
 if(!element||element.kind!=='composed'||typeof element.id!=='string'||!element.id||typeof element.title!=='string'||!element.title.trim()||!Array.isArray(element.items)||element.items.length<1||element.items.length>16)return false;
 const ids=new Set();
 for(const item of element.items){
  if(!item||typeof item!=='object'||typeof item.id!=='string'||!/^[a-zA-Z0-9_-]{1,60}$/.test(item.id)||ids.has(item.id)||!composedKinds.includes(item.kind))return false;
  ids.add(item.id);
  if(typeof item.label!=='string'||item.label.length>160)return false;
  if(item.text!==undefined&&(typeof item.text!=='string'||item.text.length>500))return false;
  if(item.required!==undefined&&typeof item.required!=='boolean')return false;
  if(item.kind==='select'&&(!Array.isArray(item.options)||!item.options.length||item.options.length>20||item.options.some(o=>typeof o!=='string'||o.length>100)))return false;
  if(item.kind==='progress'&&(!Number.isFinite(item.value)||item.value<0||item.value>100))return false;
  if(item.kind==='input'&&item.inputType!==undefined&&!['text','email','number','date'].includes(item.inputType))return false;
  if(item.nextScreen!==undefined&&(typeof item.nextScreen!=='string'||(screenIds.length&&!screenIds.includes(item.nextScreen))))return false;
  if(item.nextScreen!==undefined&&item.kind!=='button')return false;
 }
 return true;
}
