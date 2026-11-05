
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const PORT=process.env.PORT||3000;DIR=__dirname;
const PROFILES=[
 {key:'zhong',name:'Zhong',handle:'@zhong',id:'UCyagEfIN1okQ-s996XAqCFQ',accent:'#7187ff'},
 {key:'fede',name:'Fede Vigevani',handle:'@fedevigevani',id:'UCoQm-PeHC-cbJclKJYJ8LzA',accent:'#bd82ff'}
];

const state={creators:{},updated:null,error:null};
const api=id=>`https://api.socialcounts.org/youtube-live-subscriber-count/${encodeURIComponent(id)}`;

async function stats(p){
 try{
  const r=await fetch(api(p.id),{headers:{'Cache-Control':'no-cache'}});
  if(!r.ok)throw Error(`HTTP ${r.status}`);

  const data=await r.json();
  if(!data.counters)throw Error('Invalid counters');

  state.creators[p.key]={...state.creators[p.key],...data,name:p.name,id:p.id,error:null};
  return true;
 }catch(e){
  console.error(`[${p.name}]`,e.message);
  if(state.creators[p.key])state.creators[p.key].error=e.message;
  return false;
 }
}

async function avatar(p){
 try{
  const r=await fetch(`https://www.youtube.com/channel/${p.id}`,{
   headers:{'User-Agent':'Mozilla/5.0 Chrome/130.0 Safari/537.36'}
  });
  if(!r.ok)throw Error(`HTTP ${r.status}`);

  const html=await r.text();
  const tag=html.match(/<meta\b(?=[^>]*\bproperty=["']og:image["'])[^>]*>/i)?.[0];
  const url=tag?.match(/\bcontent=["']([^"']+)["']/i)?.[1];

  if(!url)throw Error('Avatar not found');

  state.creators[p.key]={...state.creators[p.key],avatar:url.replace(/&amp;/g,'&')};
 }catch(e){
  console.error(`[${p.name} avatar]`,e.message);
 }
}

let busy=false;

async function refresh(){
 if(busy)return;
 busy=true;

 try{
  const results=await Promise.all(PROFILES.map(stats));
  if(results.some(Boolean))state.updated=new Date().toISOString();
  state.error=results.every(Boolean)?null:'One or more channels failed to update';
 }finally{
  busy=false;
 }
}

const server=http.createServer((req,res)=>{
 res.setHeader('Cache-Control','no-store, no-cache, must-revalidate');
 res.setHeader('Access-Control-Allow-Origin','*');

 if(req.url==='/api/stats'){
  res.writeHead(200,{'Content-Type':'application/json'});
  return res.end(JSON.stringify({
   profiles:PROFILES.map(({key,name,handle,accent})=>({key,name,handle,accent})),
   creators:state.creators,updated:state.updated,error:state.error
  }));
 }

 if(req.url==='/health'){
  res.writeHead(200,{'Content-Type':'application/json'});
  return res.end(JSON.stringify({ok:true,updated:state.updated,error:state.error}));
 }

 if(req.url==='/'||req.url==='/index.html'){
  try{
   res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});
   return res.end(fs.readFileSync(path.join(DIR,'index.html')));
  }catch(e){
   res.writeHead(500);
   return res.end('Frontend unavailable');
  }
 }

 res.writeHead(404);
 res.end('Not found');
});

server.listen(PORT,'0.0.0.0',async()=>{
  console.log(`Server running on port ${PORT}`);
  await refresh();
  setInterval(refresh,5000);
  setInterval(()=>PROFILES.forEach(avatar),21600000);
});