
const express=require("express"),app=express();
const CHANNELS={lucan:{id:"UCuz_0MPcY5O0vsIfFPKFpGg"},mine:{id:"UCnKrmx7XhDqbiMD3aSBwz_g"}};
const h={"User-Agent":"Mozilla/5.0","Accept":"application/json"};
const clean=o=>Object.fromEntries(["subscriberCount","viewCount","videoCount"].map(k=>[k,Number(o?.[k])||0]));
const empty=()=>({estimation:{},api:{},socialcounts:{estimation:{},api:{}},nextcounts:{},channel:{},updated:null,error:null,ncFailed:false,sourceErrors:{}});
const data=Object.fromEntries(Object.keys(CHANNELS).map(k=>[k,empty()]));
const logged={lucan:{},mine:{}};
let busy=false;

const logError=(k,s,e)=>{
const url=e.url?new URL(e.url):null;
const headers=e.headers||{};
const msg=`${s} ${e.status||e.code||"NETWORK"}: ${e.message}${e.body?` | BODY: ${e.body}`:""}${url?` | URL: ${url.host}${url.pathname}`:""}${headers.server?` | SERVER: ${headers.server}`:""}${headers["cf-ray"]?` | CF-RAY: ${headers["cf-ray"]}`:""}${headers["content-type"]?` | TYPE: ${headers["content-type"]}`:""}`;
data[k].sourceErrors[s]=msg;
if(logged[k][s]===msg)return;
console.error(`[${new Date().toLocaleTimeString()}] [${k.toUpperCase()}] ${msg}`);
logged[k][s]=msg;
};
const logSuccess=(k,s)=>{
data[k].sourceErrors[s]=null;
if(logged[k][s])console.log(`[${new Date().toLocaleTimeString()}] [${k.toUpperCase()}] ${s} recovered`);
logged[k][s]=null;
};

app.get("/",(q,r)=>r.sendFile(__dirname+"/index.html"));
app.get("/api/stats",(q,r)=>(r.set("Cache-Control","no-store"),r.json(data)));
app.get("/api/diagnostics",(q,r)=>(r.set("Cache-Control","no-store"),r.json(Object.fromEntries(Object.entries(data).map(([k,d])=>[k,{updated:d.updated,error:d.error,ncFailed:d.ncFailed,sourceErrors:d.sourceErrors}])))));

app.get("/api/avatar/:key",async(q,r)=>{
try{
const u=data[q.params.key]?.channel?.avatar;
if(!u)return r.sendStatus(404);
const a=await fetch(u,{headers:h,signal:AbortSignal.timeout(15000)});
if(!a.ok)throw Error(`HTTP ${a.status}`);
r.set({"Content-Type":a.headers.get("content-type")||"image/jpeg","Cache-Control":"public,max-age=21600"});
r.send(Buffer.from(await a.arrayBuffer()));
}catch(e){console.error(`[AVATAR] ${q.params.key}: ${e.message}`);r.sendStatus(502);}
});

const get=async u=>{
let r;
try{r=await fetch(u,{headers:h,signal:AbortSignal.timeout(12000)});}
catch(e){e.url=u;e.code=e.cause?.code||e.code;throw e;}
const body=await r.text();
const headers=Object.fromEntries(["server","cf-ray","content-type","retry-after"].map(k=>[k,r.headers.get(k)]).filter(x=>x[1]));
if(!r.ok){
const e=Error(`HTTP ${r.status}`);
e.status=r.status;e.url=u;e.body=body.slice(0,500);e.headers=headers;
throw e;
}
try{return JSON.parse(body);}
catch(e){e.url=u;e.status=r.status;e.body=body.slice(0,500);e.headers=headers;e.message=`Invalid JSON: ${e.message}`;throw e;}
};

const update=async k=>{
const id=CHANNELS[k].id,d=data[k];
const sc=get(`https://api.socialcounts.org/youtube-live-subscriber-count/${id}`).then(j=>(logSuccess(k,"SocialCounts"),j)).catch(e=>(logError(k,"SocialCounts",e),null));
const nc=get(`https://api.nextcounts.com/api/platforms/youtube/entity/${id}?countMode=estimated`).then(j=>(logSuccess(k,"NextCounts"),j.data)).catch(e=>(logError(k,"NextCounts",e),d.ncFailed=true,null));
const [s,n]=await Promise.all([sc,nc]);

if(s?.counters){
d.socialcounts={estimation:clean(s.counters.estimation),api:clean(s.counters.api)};
d.estimation=d.socialcounts.estimation;d.api=d.socialcounts.api;
d.updated=Date.now();d.error=null;
const c=s.channel||s.info;
if(c)d.channel={...d.channel,name:c.name||d.channel.name||"",handle:c.handle||d.channel.handle||"",description:c.description||d.channel.description||"",avatar:c.avatar||d.channel.avatar||""};
}
if(n){
d.nextcounts={...d.nextcounts,reported:Number(n.reported??n.currentCount??n.subscribersCount)||0,subscribers:Number(n.subscribersCount)||0,views:Number(n.totalViews??n.secondaryCount)||0,videos:Number(n.videosCount??n.uploadsCount)||0,estimatedSubscribers:n.estimatedSubscribers!=null?Number(n.estimatedSubscribers):null,subscriberCountText:n.subscriberCountText??d.nextcounts.subscriberCountText??"",totalViewsText:n.totalViewsText??d.nextcounts.totalViewsText??"",videosCountText:n.videosCountText??d.nextcounts.videosCountText??""};
d.channel={...d.channel,name:n.title||d.channel.name||"",handle:n.handle||d.channel.handle||"",description:k==="lucan"?"Jesus loves you! I hope to bring you joy with every video!":n.description??d.channel.description??"",avatar:n.avatar||d.channel.avatar||""};
console.log(`[${new Date().toLocaleTimeString()}] [${k.toUpperCase()}] NextCounts DATA | Subs: ${d.nextcounts.subscribers.toLocaleString()} | Views: ${d.nextcounts.views.toLocaleString()} | Videos: ${d.nextcounts.videos.toLocaleString()}`);
d.ncFailed=false;
}
d.nextcounts.estimatedSubscribers=d.nextcounts.estimatedSubscribers??d.socialcounts.estimation.subscriberCount??null;
d.nextcounts.estimatedViews=d.socialcounts.estimation.viewCount??null;
d.nextcounts.estimatedVideos=d.socialcounts.estimation.videoCount??null;
if(!s&&!d.updated)d.error="SocialCounts unavailable";
};

const updateAll=async()=>{
if(busy)return;
busy=true;
try{
await Promise.all(Object.keys(CHANNELS).map(update));
console.log(`[${new Date().toLocaleTimeString()}] Update cycle completed | Lucan: ${data.lucan.updated?"OK":"NO DATA"} | MY CHANNEL: ${data.mine.updated?"OK":"NO DATA"}`);
}catch(e){console.error("[SERVER] Update error:",e);}
finally{busy=false;}
};

app.listen(process.env.PORT||3000,()=>{
console.log("Tracker running");
updateAll();
setInterval(updateAll,2000);
});
