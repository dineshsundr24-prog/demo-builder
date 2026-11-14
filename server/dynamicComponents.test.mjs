import test from 'node:test';
import assert from 'node:assert/strict';
import {validDynamicComponent,dynamicRows,dynamicCsv,executeDynamicActions} from '../src/componentRuntime.mjs';
import {clarificationResponse,clarificationForPlan} from './refinementAssistance.mjs';
import {applyOperations} from './operations.mjs';
import {validateStrictDemo} from './refine.mjs';
const component={kind:'composed',id:'interactive-user-report',title:'Interactive User Reports',items:[
 {kind:'input',id:'query',label:'Find users',inputType:'text'},
 {kind:'select',id:'status',label:'Filter status',options:['Active','Inactive']},
 {kind:'table',id:'users',label:'User register',columns:[{id:'name',label:'Name'},{id:'status',label:'Status'}],rows:[{name:'Alice',status:'Active'},{name:'Bob',status:'Inactive'}],filterField:'query'},
 {kind:'button',id:'export',label:'Download CSV',actions:[{type:'download-csv',target:'users'}]},
 {kind:'button',id:'show',label:'Show details',actions:[{type:'show',target:'note'},{type:'notice',message:'Details shown'}]},
 {kind:'card',id:'note',label:'Details',text:'Fictional data'}
]};
const demo={schemaVersion:1,id:'test',name:'Test',channel:'portal',theme:'navy',screens:[
 {id:'dashboard',title:'Dashboard',subtitle:'Overview',elements:[{kind:'notice',id:'header',tone:'info',title:'Dashboard',body:'Keep'}]},
 {id:'reports',title:'Reports',subtitle:'Reports',elements:[{kind:'notice',id:'placeholder',tone:'info',title:'Reports',body:'Placeholder'}]}
]};
test('AI defined component can combine search, table, CSV and stateful controls',()=>{
 assert.equal(validDynamicComponent(component,['dashboard','reports']),true);
 assert.deepEqual(dynamicRows(component.items[2],{query:'ali'}).map(x=>x.name),['Alice']);
 assert.equal(dynamicRows(component.items[2],{query:'absent'}).length,0);
 const event=executeDynamicActions(component,component.items[3],{query:'ali'});
 assert.deepEqual(event.events,[{type:'download-csv',target:'users'}]);
 assert.equal(dynamicCsv(component.items[2],{query:'ali'}).includes('Bob'),false);
});
test('Declarative local state actions update, toggle, increment and visibility',()=>{
 const x=structuredClone(component);x.items.push({kind:'input',id:'count',label:'Count'});
 x.items.push({kind:'button',id:'modify',label:'Modify',actions:[{type:'set',target:'query',value:'Alice'},{type:'toggle',target:'status'},{type:'increment',target:'count',amount:2},{type:'hide',target:'note'}]});
 assert.equal(validDynamicComponent(x,['dashboard','reports']),true);
 const outcome=executeDynamicActions(x,x.items.at(-1),{status:'false',count:'3'});
 assert.deepEqual([outcome.values.query,outcome.values.status,outcome.values.count],['Alice','true','5']);
 assert.equal(outcome.visibility.note,false);
});
test('Required input blocks navigation; valid input allows navigation to real screen',()=>{
 const x=structuredClone(component);x.items[0].required=true;
 x.items.push({kind:'button',id:'next',label:'Next',actions:[{type:'navigate',screen:'dashboard'}]});
 assert.equal(validDynamicComponent(x,['dashboard','reports']),true);
 assert.ok(executeDynamicActions(x,x.items.at(-1),{}).errors.query);
 assert.deepEqual(executeDynamicActions(x,x.items.at(-1),{query:'Alice'}).events,[{type:'navigate',screen:'dashboard'}]);
});
test('Invalid actions fail before render, including unknown targets, network-like code, and foreign screens',()=>{
 const x=structuredClone(component);
 x.items[3].actions[0].target='unknown';
 assert.equal(validDynamicComponent(x,['dashboard','reports']),false);
 x.items[3].actions=[{type:'fetch',target:'users',url:'https://bank'}];
 assert.equal(validDynamicComponent(x,['dashboard','reports']),false);
 x.items[3].actions=[{type:'navigate',screen:'other-bank'}];
 assert.equal(validDynamicComponent(x,['dashboard','reports']),false);
});
test('Unsafe CSV formula cells are escaped, including quotes',()=>{
 const x=structuredClone(component.items[2]);x.rows=[{name:'=HYPERLINK("http://x","click")',status:'Active'}];
 const csv=dynamicCsv(x,{});
 assert.ok(csv.includes(`"'=HYPERLINK`));
 assert.ok(csv.includes('""click""'));
});
test('AI defined component can be added atomically and unrelated screens remain unchanged',()=>{
 const target={level:'screen',screenId:'reports'};
 const result=applyOperations(demo,target,[{op:'add-component',target,component}],'portal');
 assert.equal(validateStrictDemo(result.definition,'portal'),true);
 assert.deepEqual(result.definition.screens[0],demo.screens[0]);
 assert.equal(result.definition.screens[1].elements.at(-1).id,component.id);
 assert.equal(demo.screens[1].elements.length,1);
});
test('Ambiguous behavior gets chat-friendly options instead of an unsupported error',()=>{
 const a=clarificationResponse('add payment control',{status:'unsupported',reason:'No live payment gateway'},'missing capability');
 assert.equal(a.needsClarification,true);
 assert.match(a.question,/simulate|simulated/i);
 assert.ok(a.options.length>=2);
 assert.ok(!JSON.stringify(a).includes('screens[1].elements'));
});
test('Model may ask user one specific question and two suggestions',()=>{
 const a=clarificationForPlan({status:'clarify',question:'Should this approval use a popup or a new screen?',options:['Popup','New screen']});
 assert.match(a.question,/popup/);
 assert.deepEqual(a.options,['Popup','New screen']);
});

test('Simulated submit requires mandatory data before showing a confirmation notice',()=>{
 const c=structuredClone(component);
 c.items[0].required=true;
 const submit={id:'submit',kind:'button',label:'Submit',actions:[{type:'notice',message:'Submitted for demo'}]};
 c.items.push(submit);
 assert.equal(validDynamicComponent(c,['dashboard','reports']),true);
 const blocked=executeDynamicActions(c,submit,{});
 assert.equal(blocked.errors.query,'Required field');
 assert.equal(blocked.events.length,0);
 const approved=executeDynamicActions(c,submit,{query:'Ready'});
 assert.equal(approved.errors.query,undefined);
 assert.deepEqual(approved.events,[{type:'notice',message:'Submitted for demo'}]);
});
