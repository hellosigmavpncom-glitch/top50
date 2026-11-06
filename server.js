
'use strict';

const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const PORT=3000,DIR=__dirname;
const PROFILES=[
 {key:'zhong',name:'Zhong',handle:'@zhong',id:'UCyagEfIN1okQ-s996XAqCFQ',accent:'#7187ff'},
 {key:'fede',name:'Fede Vigevani',handle:'@fedevigevani',id:'UCoQm-PeHC-cbJclKJYJ8LzA',accent:'#bd82ff'}
];
const state={creators:{},updated:null,error:null,source:'MIXERNO'};
const api=id=>`https://mixerno.space/api/youtube-channel-counter/user/${encodeURIComponent(id)}`;
const HEADERS={
 'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
 'Accept':'application/json','Accept-Language':'en-US,en;q=0.9',
 'Referer':'https://mixerno.space/','Origin':'https://mixerno.space',
 'Cache-Control':'no-cache'
};

async function stats(p){
 try{
  const r=await fetch(api(p.id),{headers:HEADERS,signal:AbortSignal.timeout(12000)});
  if(!r.ok){
   const body=await r.text();
   console.error(`[Mixerno/${p.name}] HTTP ${r.status}`,{server:r.headers.get('server'),cfMitigated:r.headers.get('cf-mitigated'),response:body.slice(0,180)});
   throw Error(`HTTP ${r.status}`);
  }
  const data=await r.json();
  if(!Array.isArray(data.counts))throw Error('Invalid Mixerno counts');

  const values=Object.fromEntries(data.counts.map(x=>[x.value,Number(x.count)]));
  const get=k=>values[k];
  const estimation={subscriberCount:get('subscribers'),viewCount:get('views'),videoCount:get('videos')};
  const apiCounters={subscriberCount:get('apisubscribers'),viewCount:get('apiviews'),videoCount:get('videos')};

  if(![...Object.values(estimation),...Object.values(apiCounters)].every(Number.isFinite))
   throw Error('Missing or invalid Mixerno counters');

  const user=Object.fromEntries((data.user||[]).map(x=>[x.value,x.count]));
  state.creators[p.key]={
   ...state.creators[p.key],name:p.name,id:p.id,
   counters:{estimation,api:apiCounters},
   avatar:user.pfp||state.creators[p.key]?.avatar||null,
   goal:get('goal'),source:'MIXERNO',error:null
  };
  console.log(`[Mixerno/${p.name}] ${estimation.subscriberCount.toLocaleString()} subscribers`);
  return true;
 }catch(e){
  console.error(`[Mixerno/${p.name}] ${e.message}`);
  if(state.creators[p.key])state.creators[p.key].error=e.message;
  return false;
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
 }finally{busy=false;}
}

const server=http.createServer((req,res)=>{
 res.setHeader('Cache-Control','no-store, no-cache, must-revalidate');
 res.setHeader('Access-Control-Allow-Origin','*');

 if(req.url==='/api/stats'||req.url==='/health'){
  const health=req.url==='/health';
  res.writeHead(200,{'Content-Type':'application/json'});
  return res.end(JSON.stringify(health
   ?{ok:true,source:state.source,updated:state.updated,error:state.error}
   :{source:state.source,profiles:PROFILES.map(({key,name,handle,accent})=>({key,name,handle,accent})),creators:state.creators,updated:state.updated,error:state.error}
  ));
 }

 if(req.url==='/'||req.url==='/index.html'){
  try{
   res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});
   return res.end(fs.readFileSync(path.join(DIR,'index.html')));
  }catch{
   res.writeHead(500);
   return res.end('Frontend unavailable');
  }
 }

 res.writeHead(404);
 res.end('Not found');
});

server.listen(PORT,'127.0.0.1',()=>{
 console.log(`Local server: http://127.0.0.1:${PORT} · MIXERNO`);
 refresh();
 setInterval(refresh,5000);
});
