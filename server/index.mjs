import http from 'node:http';
import {timingSafeEqual} from 'node:crypto';

const port=Number(process.env.PORT||10000);
const frontendOrigin=process.env.FRONTEND_ORIGIN||'https://demo-builder-nonprod.onrender.com';
const model=process.env.OPENAI_MODEL||'gpt-4.1-mini';
const usage=new Map();
const buckets=new Map();

function respond(res,status,body,origin=''){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Access-Control-Allow-Origin':origin||frontendOrigin,'Vary':'Origin'});res.end(JSON.stringify(body));}
function authorized(given,expected){if(!expected||typeof given!=='string')return false;const a=Buffer.from(given);const b=Buffer.from(expected);return a.length===b.length&&timingSafeEqual(a,b);}
function rateLimited(key){const now=Date.now();const hit=buckets.get(key)||{time:now,count:0};if(now-hit.time>60000){hit.time=now;hit.count=0;}hit.count++;buckets.set(key,hit);if(buckets.size>2000){for(const [k,v] of buckets){if(now-v.time>120000)buckets.delete(k);}}return hit.count>6;}
async function readBody(req){let text='';for await(const chunk of req){text+=chunk.toString();if(text.length>60000)throw new Error('Request too large.');}return JSON.parse(text);}
const kindSet=new Set(['hero','stats','form','table','notice','actions']);
const fieldTypes=new Set(['text','email','password','number','select']);
const str=(v,max=140)=>typeof v==='string'&&v.length>0&&v.length<=max;
function validDemo(d,channel){
 if(!d||d.schemaVersion!==1||!str(d.id)||!str(d.name)||!str(d.description,500)||d.channel!==channel||!['navy','teal'].includes(d.theme)||!Array.isArray(d.screens)||d.screens.length<2||d.screens.length>9)return false;
 const screenIds=new Set();let total=0;
 for(const s of d.screens){
  if(!str(s.id)||!str(s.title)||!str(s.subtitle,500)||screenIds.has(s.id)||!Array.isArray(s.elements)||s.elements.length<1||s.elements.length>8)return false;
  screenIds.add(s.id);const elementIds=new Set();
  for(const e of s.elements){total++;
   if(!str(e.id)||elementIds.has(e.id)||!kindSet.has(e.kind))return false;elementIds.add(e.id);
   switch(e.kind){
    case 'hero':if(!str(e.title)||!str(e.description,600))return false;break;
    case 'stats':if(!Array.isArray(e.items)||e.items.length<1||e.items.length>6||e.items.some(x=>!str(x.id)||!str(x.label)||!str(x.value)))return false;break;
    case 'notice':if(!['info','success'].includes(e.tone)||!str(e.title)||!str(e.body,600))return false;break;
    case 'form':if(!str(e.title)||!str(e.actionLabel)||!Array.isArray(e.fields)||e.fields.length<1||e.fields.length>16||e.fields.some(f=>!str(f.id)||!str(f.label)||!fieldTypes.has(f.type)||f.options&&(!Array.isArray(f.options)||f.options.some(o=>!str(o)))))return false;break;
    case 'actions':if(!Array.isArray(e.buttons)||e.buttons.length<1||e.buttons.length>5||e.buttons.some(b=>!str(b.id)||!str(b.label)))return false;break;
    case 'table':if(!str(e.title)||!Array.isArray(e.columns)||e.columns.length<1||e.columns.length>10||e.columns.some(c=>!str(c.id)||!str(c.label))||!Array.isArray(e.rows)||e.rows.length>30||e.rows.some(row=>!row||typeof row!=='object'||Object.values(row).some(v=>typeof v!=='string')))return false;break;
   }
  }
 }
 if(total>45)return false;
 for(const s of d.screens)for(const e of s.elements){
  if(e.kind==='form'&&e.nextScreen&&!screenIds.has(e.nextScreen))return false;
  if(e.kind==='table'&&e.detailScreen&&!screenIds.has(e.detailScreen))return false;
  if(e.kind==='actions'&&e.buttons.some(b=>b.nextScreen&&!screenIds.has(b.nextScreen)))return false;
 }
 return true;
}

const system=`You are the Demo Builder requirement interpreter. Generate a COMPLETE, polished, realistic, interactive business application demo in STRICT JSON only, based on user story and project context. Never write markdown, commentary or code. Do not claim live external integrations. Supply coherent realistic sample data, clear visual hierarchy, properly linked nextScreen, and unambiguous required form fields. Match the company and guidelines and cover all key steps. Output EXACTLY the following contract with schemaVersion:1,id,name,description,channel ('mobile' or 'portal'),theme ('navy' or 'teal'),screens array containing 3-7 screens (2-9 allowed). Each screen {id,title,subtitle,elements:[...]}. Unique stable ASCII IDs. Elements may be:
{kind:'hero',id,eyebrow,title,description}
{kind:'stats',id,items:[{id,label,value,delta?}]}
{kind:'form',id,title,description?,fields:[{id,label,type:'text'|'email'|'password'|'number'|'select',placeholder?,required?,options?}],actionLabel,nextScreen?}
{kind:'table',id,title,subtitle?,columns:[{id,label}],rows:[{columnId:'value'}],detailScreen?}
{kind:'notice',id,tone:'info'|'success',title,body}
{kind:'actions',id,buttons:[{id,label,variant:'primary'|'secondary',nextScreen?}]}
Choose screen patterns intelligently: mobile flows (welcome, registration, verification, consent, confirmation); portals (dashboard, list, review, decision). The first screen must offer a way to navigate forward; at least one screen must contain a form or table. Last screen should provide a completion notice or useful summary. Do not mention features unsupported by this component schema in generated screen text. Restrict text lengths and rows (max 8 rows). Include sensible UAE locality and AED amounts where relevant. Do not generate executable JS, HTML, or CSS.`;

async function generate(body){
 const project=body?.project||{};
 const channel=project.channel;
 if(!['portal','mobile'].includes(channel)||typeof body.requirement!=='string'||body.requirement.trim().length<15||body.requirement.length>12000)throw Object.assign(new Error('A requirement of 15–12,000 characters and a valid channel are required.'),{status:400});
 const context=JSON.stringify({projectName:String(project.name||'New application').slice(0,120),company:String(project.company||'').slice(0,120),designGuidelines:String(project.guidelines||'').slice(0,1600),channel,requirement:body.requirement.slice(0,12000)});
 const ctrl=new AbortController();const timeout=setTimeout(()=>ctrl.abort(),90000);
 let raw;
 try{
  const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',signal:ctrl.signal,headers:{'Authorization':`Bearer ${process.env.OPENAI_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({model,instructions:system,input:'Generate a valid JSON Demo Definition object that follows the schema and requirements. Project context JSON:\n'+context,text:{format:{type:'json_object'}},max_output_tokens:7500,store:false})});
  raw=await response.json();
  if(!response.ok){
   const code=String(raw?.error?.code||'unknown');
   const type=String(raw?.error?.type||'unknown');
   const param=String(raw?.error?.param||'none');
   const detail=String(raw?.error?.message||'').replace(/sk-[A-Za-z0-9_-]+/g,'[redacted]').slice(0,400);
   console.error('OpenAI API rejected generation',{httpStatus:response.status,type,code,param,message:detail});
   const isModel=code==='model_not_found'||/model.*(not exist|access|available|unsupported)/i.test(detail);
   const isQuota=code==='insufficient_quota'||response.status===429;
   const isKey=response.status===401||code==='invalid_api_key';
   const message=isModel?'The configured AI model is unavailable to this API project. Contact the administrator.':isQuota?'OpenAI API quota or rate limit reached. Check project billing and limits.':isKey?'The OpenAI API key is invalid or lacks access. Check the Render OPENAI_API_KEY setting.':response.status===400?'OpenAI rejected a request setting ('+param+'). The server log contains the exact reason.':'OpenAI request failed (HTTP '+response.status+').';
   throw Object.assign(new Error(message),{status:502});
  }
 }finally{clearTimeout(timeout);}
 const output=Array.isArray(raw?.output)?raw.output.filter(x=>x.type==='message').flatMap(x=>x.content||[]).filter(x=>x.type==='output_text').map(x=>x.text).join(''):'';
 let parsed;
 try{parsed=JSON.parse(output);}catch{throw Object.assign(new Error('AI returned an incomplete or invalid definition. Please retry.'),{status:502});}
 if(!validDemo(parsed,channel))throw Object.assign(new Error('Generated demo did not pass validation. Please retry or simplify the requirement.'),{status:422});
 return{definition:parsed,summary:`Generated ${parsed.screens.length} interactive screens for ${parsed.name}.`,usage:{model:raw.model||model,inputTokens:raw.usage?.input_tokens||0,outputTokens:raw.usage?.output_tokens||0}};
}

const server=http.createServer(async(req,res)=>{
 const origin=req.headers.origin||'';
 if(origin&&origin!==frontendOrigin){respond(res,403,{error:'Origin not allowed.'},frontendOrigin);return;}
 if(req.method==='OPTIONS'){res.writeHead(204,{'Access-Control-Allow-Origin':frontendOrigin,'Access-Control-Allow-Headers':'content-type,x-builder-access','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Vary':'Origin'});res.end();return;}
 if(req.url==='/health'&&req.method==='GET'){respond(res,200,{status:'ok'});return;}
 if(req.url==='/api/status'&&req.method==='GET'){respond(res,200,{ready:Boolean(process.env.OPENAI_API_KEY&&process.env.DEMO_ACCESS_TOKEN),model,requiresAccessToken:true});return;}
 if(req.url!=='/api/generate'||req.method!=='POST'){respond(res,404,{error:'Not found.'});return;}
 if(!process.env.OPENAI_API_KEY||!process.env.DEMO_ACCESS_TOKEN){respond(res,503,{error:'AI backend is not configured. Set OPENAI_API_KEY and DEMO_ACCESS_TOKEN in the Render service environment.'});return;}
 if(!authorized(req.headers['x-builder-access'],process.env.DEMO_ACCESS_TOKEN)){respond(res,401,{error:'Invalid Demo Builder access token.'});return;}
 const client=req.socket.remoteAddress||'unknown';if(rateLimited(client)){respond(res,429,{error:'Generation limit reached (6 requests/minute).'});return;}
 try{const result=await generate(await readBody(req));respond(res,200,result);}
 catch(err){console.error('Generation error:',err?.message||'unknown');respond(res,err?.status||500,{error:err?.status?err.message:'Unable to generate the demo. Please try again.'});}
});
server.listen(port,'0.0.0.0',()=>console.log(`Demo Builder API listening on ${port}`));
