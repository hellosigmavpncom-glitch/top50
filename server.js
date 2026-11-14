
const express=require("express"),app=express(),path=require("path"),crypto=require("crypto");
const PORT=process.env.PORT||3000,STALE=90000,STREAM_ID="Nr1IWBNNQFA";
const chs={
 celine:{id:"UC1a2ZCw7tugRZYRMnecNj3A",name:"Celine Dept",handle:"@celinedept"},
 kondzilla:{id:"UCffDXn7ycAzwL2LDlbyWOTw",name:"Canal KondZilla",handle:"@kondzilla"},
 vystats:{id:"UCnKrmx7XhDqbiMD3aSBwz_g",name:"VYStats",handle:"@VYStats"}
};
let cache={celine:null,kondzilla:null,vystats:null,stream:null,lastUpdated:null},music={title:"Waiting for VLC...",artist:""},busy=false;
const sources={};
app.use(express.json({limit:"2kb"}));
app.use((q,s,n)=>{s.setHeader("Cache-Control","no-store");n()});
const get=async u=>{let r=await fetch(u,{signal:AbortSignal.timeout(10000),headers:{"User-Agent":"Mozilla/5.0"}});if(!r.ok)throw Error("HTTP "+r.status);return r.json()};
const n=v=>Number(String(v??0).replace(/,/g,""))||0;

async function social(ch){
 let c=(await get(`https://api.socialcounts.org/youtube-live-subscriber-count/${ch.id}`)).counters;
 if(!c?.estimation)throw Error("Missing SocialCounts data");
 return{id:ch.id,name:ch.name,handle:ch.handle,estimatedSubscriberCount:n(c.estimation.subscriberCount),apiSubscriberCount:n(c.api?.subscriberCount),viewCount:n(c.estimation.viewCount),apiViewCount:n(c.api?.viewCount),videoCount:n(c.estimation.videoCount)};
}
async function mixerno(ch){
 let d=await get(`https://mixerno.space/api/youtube-channel-counter/user/${ch.id}`),gc=k=>d.counts?.find(x=>x.value===k)?.count??0,gu=k=>d.user?.find(x=>x.value===k)?.count??"";
 let sub=n(gc("subscribers"));if(!sub)throw Error("Missing Mixerno subscribers");
 return{id:ch.id,name:gu("name")||ch.name,handle:ch.handle,estimatedSubscriberCount:sub,apiSubscriberCount:n(gc("apisubscribers")),viewCount:n(gc("views")),apiViewCount:n(gc("apiviews")),videoCount:n(gc("videos"))};
}
function choose(key,a,b){
 let now=Date.now(),s=sources[key]||(sources[key]={});
 for(let [k,d] of [["social",a],["mixerno",b]])if(d){
  let sig=[d.estimatedSubscriberCount,d.viewCount,d.videoCount].join(":");
  if(s[k]?.sig!==sig)s[k]={sig,changed:now,data:d};
 }
 let valid=["social","mixerno"].filter(k=>s[k]?.data&&now-s[k].changed<STALE);
 if(!valid.length){console.log(`[${key}] Both sources stale`);return null}
 valid.sort((x,y)=>s[y].changed-s[x].changed);
 let pick=valid.includes("social")&&valid.length===2&&s.social.changed>=s.mixerno.changed?"social":valid[0];
 console.log(`[${key}] ${pick}: ${s[pick].data.estimatedSubscriberCount.toLocaleString()} subscribers`);
 return s[pick].data;
}
async function fetchCh(k,ch){
 let [a,b]=await Promise.allSettled([social(ch),mixerno(ch)]);
 if(a.status==="rejected")console.log(`[${k}] SocialCounts: ${a.reason.message}`);
 if(b.status==="rejected")console.log(`[${k}] Mixerno: ${b.reason.message}`);
 return choose(k,a.status==="fulfilled"?a.value:null,b.status==="fulfilled"?b.value:null);
}
async function avatar(k,ch){
 try{
  let r=await fetch(`https://www.youtube.com/channel/${ch.id}`,{signal:AbortSignal.timeout(12000),headers:{"User-Agent":"Mozilla/5.0"}});
  if(!r.ok)throw Error("YouTube "+r.status);
  let h=await r.text(),m=h.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)/i)||h.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
  if(m)cache[k]={...cache[k],avatar:m[1].replace(/&amp;/g,"&")};
 }catch(e){console.log(`[${k}] Avatar: ${e.message}`)}
}
const fetchStream=()=>get(`https://api.basepoint.live/youtube/stream/${STREAM_ID}`);
async function update(){
 if(busy)return;busy=true;
 try{
  let keys=Object.keys(chs),results=await Promise.all(keys.map(k=>fetchCh(k,chs[k])));
  results.forEach((d,i)=>{if(d)cache[keys[i]]={...cache[keys[i]],...d}});
  let s=await fetchStream().catch(e=>{console.log("[Stream]",e.message);return null});
  if(s)cache.stream=s;
  if(results.some(Boolean)||s)cache.lastUpdated=new Date().toISOString();
 }catch(e){console.log("[Update]",e.message)}
 finally{busy=false}
}
app.get("/api/stats",(_,r)=>r.json(cache));
app.get("/api/music",(_,r)=>r.json(music));
app.post("/api/music",(q,r)=>{
 let a=Buffer.from(process.env.MUSIC_TOKEN||""),b=Buffer.from(String(q.headers.authorization||"").replace(/^Bearer\s+/i,""));
 if(!a.length||!b.length||a.length!==b.length||!crypto.timingSafeEqual(a,b))return r.sendStatus(401);
 let title=String(q.body?.title||"").trim(),artist=String(q.body?.artist||"").trim();
 if(!title||title.length>300||artist.length>150)return r.sendStatus(400);
 music={title,artist,updatedAt:new Date().toISOString()};r.json({ok:true});
});
app.get("/api/avatar/:key",async(q,r)=>{
 let url=cache[q.params.key]?.avatar;if(!url)return r.sendStatus(404);
 try{
  let x=await fetch(url,{signal:AbortSignal.timeout(8000),headers:{"User-Agent":"Mozilla/5.0","Referer":"https://www.youtube.com/"}});
  if(!x.ok)throw Error();r.set("Content-Type",x.headers.get("content-type")||"image/jpeg").send(Buffer.from(await x.arrayBuffer()));
 }catch{r.sendStatus(502)}
});
app.get("/",(_,r)=>r.sendFile(path.join(__dirname,"index.html")));
app.listen(PORT,()=>{
 console.log(`[RUN] Port ${PORT}`);
 update();setInterval(update,5000);
 Object.entries(chs).forEach(([k,ch])=>avatar(k,ch));
 setInterval(()=>Object.entries(chs).forEach(([k,ch])=>avatar(k,ch)),21600000);
});
