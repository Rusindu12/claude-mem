import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {timingSafeEqual} from 'node:crypto';
import {accountStatus,TARGETS} from './exchanges.js';
const token=process.env.CRYPTOAI_BACKEND_TOKEN;
if(!token||token.length<32)throw Error('Set CRYPTOAI_BACKEND_TOKEN to a random secret of at least 32 characters.');
const allowed=new Set((process.env.CRYPTOAI_ALLOWED_ORIGINS||'https://localhost').split(',').map(x=>x.trim()));
const files={'/':'index.html','/index.html':'index.html','/app.js':'app.js','/engine.js':'engine.js','/settings.js':'settings.js'};
const types={html:'text/html; charset=utf-8',js:'text/javascript; charset=utf-8'};
const recent=new Map();
function authorized(req){const provided=Buffer.from(req.headers.authorization||''),expected=Buffer.from('Bearer '+token);return provided.length===expected.length&&timingSafeEqual(provided,expected);}
function json(res,status,body){res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(body));}
const server=http.createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
  const path=new URL(req.url,'http://internal').pathname;
  if(path.startsWith('/api/')) {
    const origin=req.headers.origin;
    // Explicit allowlist for cross-origin APK requests; same-origin browser GETs do not need CORS.
    if(origin){let same=false;try{same=new URL(origin).host===req.headers.host;}catch{}if(!same&&!allowed.has(origin))return json(res,403,{error:'Origin not allowed'});res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');}
    if(req.method==='OPTIONS'){res.setHeader('Access-Control-Allow-Methods','GET, OPTIONS');res.setHeader('Access-Control-Allow-Headers','Authorization');res.writeHead(204);return res.end();}
    if(!authorized(req))return json(res,401,{error:'Backend token required'});
    if(req.method!=='GET')return json(res,405,{error:'Read-only backend: order execution is disabled'});
    if(path==='/api/testnet/targets')return json(res,200,{targets:Object.keys(TARGETS),executionEnabled:false});
    const target=path.slice('/api/testnet/account/'.length);
    if(!path.startsWith('/api/testnet/account/')||!Object.hasOwn(TARGETS,target))return json(res,404,{error:'Unknown API endpoint'});
    const now=Date.now();if(now-(recent.get(target)||0)<3000)return json(res,429,{error:'Wait 3 seconds before checking this target again'});recent.set(target,now);
    try{return json(res,200,await accountStatus(target));}catch(e){return json(res,502,{error:e.message});}
  }
  if(req.method!=='GET'||!files[path]){res.writeHead(404);return res.end('Not found');}
  try{const name=files[path],content=await readFile(fileURLToPath(new URL('../www/'+name,import.meta.url)));res.writeHead(200,{'Content-Type':types[name.split('.').at(-1)],'Cache-Control':'no-store'});res.end(content);}catch{res.writeHead(500);res.end('App unavailable');}
});
server.listen(Number(process.env.PORT||4174),'0.0.0.0',()=>console.log('CryptoAI read-only testnet backend listening. Order execution disabled.'));
