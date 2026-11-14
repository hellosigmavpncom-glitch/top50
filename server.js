
const express=require("express"),app=express(),path=require("path"),crypto=require("crypto");
const PORT=process.env.PORT||3000,STREAM_ID="Nr1IWBNNQFA";
const chs={
 celine:{id:"UC1a2ZCw7tugRZYRMnecNj3A",name:"Celine Dept",handle:"@celinedept"},
 kondzilla:{id:"UCffDXn7ycAzwL2LDlbyWOTw",name:"Canal KondZilla",handle:"@kondzilla"},
 vystats:{id:"UCnKrmx7XhDqbiMD3aSBwz_g",name:"VYStats",handle:"@VYStats"}
};
let cache={celine:null,kondzilla:null,vystats:null,stream:null,lastUpdated:null};
let music={title:"Waiting for VLC...",artist:""},busy=false;
app.use(express.json({limit:"2kb"}));
app.use((q,s,n)=>{s.setHeader("Cache-Control","no-store");n()});
const n=v=>Number(String(v??0).replace(/,/g,""))||0;
const get=async url=>{
 let r=await fetch(url,{signal:AbortSignal.timeout(12000),headers:{"User-Agent":"Mozilla/5.0"}});
 if(!r.ok)throw Error("HTTP "+r.status);
 return r.json();
};

async function flashcounts(ch){
 const d=await get(`https://flashcounts.jp/api/youtube/channels/${ch.id}`);
 const sub=n(d.subscribers?.count);
 if(!sub)throw Error("Missing estimated subscribers");
 const avatar=d.channel?.thumbnail||"";
 return{
  id:ch.id,name:d.channel?.title||ch.name,
  handle:d.channel?.handle||ch.handle,avatar,
  estimatedSubscriberCount:sub,
  apiSubscriberCount:n(d.subscribers?.api),
  viewCount:n(d.views?.count),
  apiViewCount:n(d.views?.api),
  videoCount:n(d.videos?.count)
 };
}

async function fetchCh(k,ch){
 try{
  const d=await flashcounts(ch);
  cache[k]={...cache[k],...d};
  console.log(`[${k}] FlashCounts: ${d.estimatedSubscriberCount.toLocaleString()} subscribers`);
  return d;
 }catch(e){
  console.log(`[${k}] FlashCounts: ${e.message}`);
  return null;
 }
}

async function fetchStream(){
 return get(`https://api.basepoint.live/youtube/stream/${STREAM_ID}`);
}

async function update(){
 if(busy)return;
 busy=true;
 try{
  const keys=Object.keys(chs);
  const results=await Promise.all(keys.map(k=>fetchCh(k,chs[k])));
  const s=await fetchStream().catch(e=>{
   console.log("[Stream]",e.message);return null;
  });
  if(s)cache.stream=s;
  if(results.some(Boolean)||s)cache.lastUpdated=new Date().toISOString();
 }catch(e){console.log("[Update]",e.message)}
 finally{busy=false}
}

app.get("/api/stats",(_,r)=>r.json(cache));
app.get("/api/music",(_,r)=>r.json(music));

app.post("/api/music",(q,r)=>{
 const a=process.env.MUSIC_TOKEN||"";
 const b=String(q.headers.authorization||"").replace(/^Bearer\s+/i,"");
 const x=Buffer.from(a),y=Buffer.from(b);
 if(!a||!b||x.length!==y.length||!crypto.timingSafeEqual(x,y))return r.sendStatus(401);
 const title=String(q.body?.title||"").trim();
 const artist=String(q.body?.artist||"").trim();
 if(!title||title.length>300||artist.length>150)return r.sendStatus(400);
 music={title,artist,updatedAt:new Date().toISOString()};
 r.json({ok:true});
});

app.get("/api/avatar/:key",async(q,r)=>{
 const url=cache[q.params.key]?.avatar;
 if(!url)return r.sendStatus(404);
 try{
  const u=new URL(url);
  if(!["https:"].includes(u.protocol))return r.sendStatus(400);
  const x=await fetch(u,{signal:AbortSignal.timeout(10000),headers:{
   "User-Agent":"Mozilla/5.0",
   "Referer":"https://www.youtube.com/"
  }});
  if(!x.ok)throw Error("HTTP "+x.status);
  r.set("Content-Type",x.headers.get("content-type")||"image/jpeg");
  r.set("Cache-Control","public, max-age=3600");
  r.send(Buffer.from(await x.arrayBuffer()));
 }catch(e){
  console.log(`[Avatar ${q.params.key}] ${e.message}`);
  r.sendStatus(502);
 }
});

app.get("/",(_,r)=>r.sendFile(path.join(__dirname,"index.html")));

app.listen(PORT,()=>{
 console.log(`[RUN] Port ${PORT}`);
 update();
 setInterval(update,5000);
});
