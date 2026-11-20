
const express=require("express"),app=express();
const CHANNELS={lucan:{id:"UCuz_0MPcY5O0vsIfFPKFpGg"},mine:{id:"UCnKrmx7XhDqbiMD3aSBwz_g"}};
const headers={"User-Agent":"Mozilla/5.0","Accept":"application/json","Accept-Language":"en-US,en;q=0.9","Cache-Control":"no-cache","Pragma":"no-cache"};
const clean=o=>Object.fromEntries(["subscriberCount","viewCount","videoCount"].map(k=>[k,Number(o?.[k])||0]));
const empty=()=>({sctools:{},socialcounts:{estimation:{},api:{}},estimation:{},api:{},channel:{},updated:null,error:null,sourceErrors:{}});
const data=Object.fromEntries(Object.keys(CHANNELS).map(k=>[k,empty()]));
const logged={lucan:{},mine:{}};
let busy=false;

const logError=(k,s,e)=>{
const msg=`[${s}] ${e.message}${e.status?` | STATUS: ${e.status}`:""}${e.body?` | BODY: ${e.body}`:""}${e.url?` | URL: ${e.url}`:""}`;
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

const get=async url=>{
const r=await fetch(url,{headers,signal:AbortSignal.timeout(12000)});
const body=await r.text();
if(!r.ok){
const e=Error(`HTTP ${r.status}`);
e.status=r.status;e.body=body.slice(0,400);e.url=url;throw e;
}
try{return JSON.parse(body);}
catch(e){e.body=body.slice(0,400);e.url=url;throw e;}
};

app.get("/",(q,r)=>r.sendFile(__dirname+"/index.html"));
app.get("/api/stats",(q,r)=>(r.set("Cache-Control","no-store"),r.json(data)));
app.get("/api/diagnostics",(q,r)=>(r.set("Cache-Control","no-store"),r.json(Object.fromEntries(Object.entries(data).map(([k,d])=>[k,{updated:d.updated,error:d.error,sourceErrors:d.sourceErrors}])))));

app.get("/api/avatar/:key",async(q,r)=>{
try{
const u=data[q.params.key]?.channel?.avatar;
if(!u)return r.sendStatus(404);
const url=new URL(u);
if(url.protocol!=="https:")return r.sendStatus(400);
const resp=await fetch(url,{signal:AbortSignal.timeout(12000)});
if(!resp.ok)throw Error(`HTTP ${resp.status}`);
r.set({"Content-Type":resp.headers.get("content-type")||"image/jpeg","Cache-Control":"public,max-age=21600"});
r.send(Buffer.from(await resp.arrayBuffer()));
}catch(e){console.error(`[AVATAR] ${q.params.key}: ${e.message}`);if(!r.headersSent)r.sendStatus(502);}
});

const update=async k=>{
const id=CHANNELS[k].id,d=data[k];
const st=get(`https://ests.sctools.org/api/get/channel/${id}`).then(j=>(logSuccess(k,"SCTools"),j)).catch(e=>(logError(k,"SCTools",e),null));
const sc=get(`https://api.socialcounts.org/youtube-live-subscriber-count/${id}`).then(j=>(logSuccess(k,"SocialCounts"),j)).catch(e=>(logError(k,"SocialCounts",e),null));
const [t,s]=await Promise.all([st,sc]);

if(t?.stats){
const x=t.stats;
d.sctools={estSubscribers:Number(x.estCount)||0,linearSubscribers:Number(x.linearCount)||0,apiSubscribers:Number(x.apiCount)||0,apiViews:Number(x.viewCount)||0,apiVideos:Number(x.videoCount)||0,hourly:Number(t.averages?.hourly)||0,daily:Number(t.averages?.daily)||0,nextUpdate:t.nextUpdate??null};
d.channel={...d.channel,name:t.info?.name||d.channel.name||"",avatar:t.info?.avatar||d.channel.avatar||"",country:t.info?.country||d.channel.country||""};
d.sctoolsUpdated=Date.now();
}
if(s?.counters){
d.socialcounts={estimation:clean(s.counters.estimation),api:clean(s.counters.api)};
d.estimation=d.socialcounts.estimation;
d.api=d.socialcounts.api;
const c=s.channel||s.info||{};
d.channel={...d.channel,name:d.channel.name||c.name||"",handle:c.handle||d.channel.handle||"",description:c.description||d.channel.description||(k==="lucan"?"Jesus loves you! I hope to bring you joy with every video!":""),avatar:d.channel.avatar||c.avatar||""};
d.socialcountsUpdated=Date.now();
}
d.updated=Date.now();
if(!t&&!s)d.error="SCTools and SocialCounts unavailable";
else d.error=null;
};

const updateAll=async()=>{
if(busy)return;
busy=true;
try{
await Promise.all(Object.keys(CHANNELS).map(update));
console.log(`[${new Date().toLocaleTimeString()}] Update completed | Lucan: ${data.lucan.updated?"OK":"NO DATA"} | MY CHANNEL: ${data.mine.updated?"OK":"NO DATA"}`);
}catch(e){console.error("[SERVER]",e.message);}
finally{busy=false;}
};

app.listen(process.env.PORT||3000,()=>{
console.log("SCTools + SocialCounts Tracker running");
updateAll();
setInterval(updateAll,5000);
});
