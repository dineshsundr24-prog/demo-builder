import test from 'node:test';
import assert from 'node:assert/strict';
import {reportToolsIntent,filteredReportRows,reportCsv,validReportTools} from './reportTools.mjs';
import {applyOperations} from './operations.mjs';
import {validateStrictDemo} from './refine.mjs';
const baseline={schemaVersion:1,id:'kapiko',name:'Kapiko Bank Portal',description:'Portal prototype',channel:'portal',theme:'navy',
 screens:[{id:'dashboard',title:'Dashboard',subtitle:'Overview',elements:[{id:'summary',kind:'notice',tone:'info',title:'Summary',body:'Unchanged'}]},
 {id:'reports',title:'Reports',subtitle:'Reports overview',elements:[{id:'stats',kind:'stats',items:[{id:'total',label:'Users',value:'5'}]}]},
 {id:'user-reports',title:'User Reports',subtitle:'User report',parentScreenId:'reports',elements:[{id:'notice',kind:'notice',tone:'info',title:'User Reports',body:'Placeholder'}]},
 {id:'approval',title:'Approvals',subtitle:'Review approvals',elements:[{id:'review',kind:'notice',tone:'info',title:'Review',body:'Sample'}]}]};
const target={level:'screen',screenId:'user-reports'};
function configure(base=baseline,screen=target,tools={search:true,filter:true,download:true}){return applyOperations(base,screen,[{op:'configure-report',target:screen,tools}],'portal').definition;}
test('Master-level report request identifies search, filter, and download without AI',()=>{
 assert.deepEqual(reportToolsIntent('In this section Add Search, Filters, Download option,'),{search:true,filter:true,download:true});
 assert.deepEqual(reportToolsIntent('add a download CSV option'),{search:false,filter:false,download:true});
 assert.equal(reportToolsIntent('rename User Reports to People'),null);
});
test('Reports: create a usable sample table for a blank User Reports child screen',()=>{
 const next=configure();
 const child=next.screens.find(s=>s.id==='user-reports');
 const table=child.elements.find(e=>e.kind==='table');
 assert.deepEqual(table.tools,{search:true,filter:true,download:true});
 assert.equal(table.columns.length,4);
 assert.equal(table.rows.length,5);
 assert.ok(table.subtitle.includes('Fictional'));
 assert.ok(validateStrictDemo(next,'portal'));
 for(const sc of baseline.screens)if(sc.id!=='user-reports')assert.deepEqual(sc,next.screens.find(s=>s.id===sc.id));
 assert.equal(baseline.screens[2].elements.length,1);
});
test('Reports: enhance existing table without replacing rows or changing other screens',()=>{
 const withTable=configure();
 const base=structuredClone(withTable);
 const t=base.screens[2].elements.find(e=>e.kind==='table');
 t.tools={search:false,filter:false,download:false};
 const next=configure(base,target,{search:true,filter:true,download:true});
 const after=next.screens[2].elements.find(e=>e.kind==='table');
 assert.deepEqual(after.rows,t.rows);
 assert.deepEqual(after.columns,t.columns);
 assert.equal(after.tools.download,true);
 assert.deepEqual(next.screens[1],base.screens[1]);
});
test('Reports: duplicated configure request rejects no-op rather than creating another table',()=>{
 const first=configure();
 assert.throws(()=>configure(first),/did not produce a change/);
 assert.equal(first.screens[2].elements.filter(e=>e.kind==='table').length,1);
});
test('Reports: do not allow report tools to mutate a mobile flow or another selected screen',()=>{
 const mobile=structuredClone(baseline);mobile.channel='mobile';delete mobile.screens[2].parentScreenId;
 assert.throws(()=>applyOperations(mobile,target,[{op:'configure-report',target,tools:{download:true}}],'mobile'),/portal/);
 const wrong={level:'screen',screenId:'dashboard'};
 assert.throws(()=>applyOperations(baseline,target,[{op:'configure-report',target:wrong,tools:{search:true}}],'portal'),/another screen/);
});
test('Reports: filter and search compose and only displayed rows are exported',()=>{
 const table=configure().screens[2].elements.find(e=>e.kind==='table');
 const filtered=filteredReportRows(table.rows,table.columns,'a','Active','status');
 assert.ok(filtered.length>=1);
 assert.ok(filtered.every(r=>r.status==='Active'));
 assert.ok(filtered.every(r=>Object.values(r).some(v=>v.toLowerCase().includes('a'))));
 const csv=reportCsv(table.columns,filtered);
 assert.equal(csv.split('\r\n').length,filtered.length+1);
 assert.match(csv,/User Name/);
});
test('Reports: CSV formulas cannot execute when spreadsheet opens exported file',()=>{
 const csv=reportCsv([{id:'name',label:'Name'}],[{name:'=HYPERLINK("https://x","click")'},{name:'-1+2'}]);
 assert.match(csv,/"'=HYPERLINK/);
 assert.ok(csv.includes("\"'-1+2\""));
});
test('Reports: filterColumn must point to a real table column',()=>{
 const table=configure().screens[2].elements.find(e=>e.kind==='table');
 assert.equal(validReportTools({search:true,filter:true,download:true,filterColumn:'missing'},table.columns),false);
 assert.equal(validReportTools({search:true,filter:true,download:true,filterColumn:'role'},table.columns),true);
});
