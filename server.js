
const express=require("express"),app=express(),renderer=require("./render"),encoder=require("./encode");
const CHANNELS={lucan:{id:"UCuz_0MPcY5O0vsIfFPKFpGg",user:"LucanPevidor"},mine:{id:"UCnKrmx7XhDqbiMD3aSBwz_g",user:"vystatsyt"}};
const headers={"User-Agent":"Mozilla/5.0","Accept":"application/json","Accept-Language":"en-US,en;q=0.9","Cache-Control":"no-cache","Pragma":"no-cache"};
const num=v=>v===null||v===undefined||v===""||!Number.isFinite(Number(v))?null:Number(v);
const empty=()=>({sctools:{},freewebtools:{},channel:{},updated:null,error:null,sourceErrors:{}});
const data=Object.fromEntries(Object.keys(CHANNELS).map(k=>[k,empty()]));
const logged={lucan:{},mine:{}};let busy=false;
const log=(k,s,e)=>{const msg=e?`${e.message}${e.status?` | STATUS: ${e.status}`:""}${e.body?` | BODY: ${e.body}`:""}${e.url?` | URL: ${e.url}`:""}`:"";data[k].sourceErrors[s]=msg||null;if(msg&&logged[k][s]!==msg)console.error(`[${new Date().toLocaleTimeString()}] [${k.toUpperCase()}] [${s}] ${msg}`);if(!msg&&logged[k][s])console.log(`[${k.toUpperCase()}] ${s} recovered`);logged[k][s]=msg||null;};
const get=async url=>{const r=await fetch(url,{headers,signal:AbortSignal.timeout(12000)}),body=await r.text();if(!r.ok){const e=Error(`HTTP ${r.status}`);e.status=r.status;e.body=body.slice(0,400);e.url=url;throw e;}try{return JSON.parse(body);}catch(e){e.body=body.slice(0,400);e.url=url;throw e;}};
app.get("/",(q,r)=>r.sendFile(__dirname+"/index.html"));
app.get("/takumi-preview",async(q,r)=>{try{const png=await renderer.renderDashboard(await rendererData());r.set({"Content-Type":"image/png","Cache-Control":"no-store, no-cache, must-revalidate"}).send(png);}catch(e){console.error("[TAKUMI PREVIEW]",e.stack||e.message);r.status(500).send(e.stack||e.message);}});
app.get("/api/stats",(q,r)=>(r.set("Cache-Control","no-store"),r.json(data)));
app.get("/api/diagnostics",(q,r)=>(r.set("Cache-Control","no-store"),r.json(Object.fromEntries(Object.entries(data).map(([k,d])=>[k,{updated:d.updated,error:d.error,sourceErrors:d.sourceErrors}])))));
app.get("/api/avatar/:key",async(q,r)=>{try{const u=data[q.params.key]?.channel?.avatar;if(!u)return r.sendStatus(404);const url=new URL(u);if(url.protocol!=="https:")return r.sendStatus(400);const x=await fetch(url,{signal:AbortSignal.timeout(12000)});if(!x.ok)throw Error(`HTTP ${x.status}`);r.set({"Content-Type":x.headers.get("content-type")||"image/jpeg","Cache-Control":"public,max-age=21600"});r.send(Buffer.from(await x.arrayBuffer()));}catch(e){console.error(`[AVATAR] ${q.params.key}: ${e.message}`);if(!r.headersSent)r.sendStatus(502);}});
const rendererData=()=>Object.fromEntries(Object.entries(data).map(([k,d])=>[k,{...d,sctools:{...d.sctools,linearCount:d.sctools.linearSubscribers,estCount:d.sctools.estSubscribers,apiCount:d.sctools.apiSubscribers,viewCount:d.sctools.estViews,videoCount:d.sctools.apiVideos,averages:{hourly:d.sctools.hourly,daily:d.sctools.daily}},freewebtools:{...d.freewebtools,estimation:{estimated_count:d.freewebtools.estimatedSubscribers,display_count:d.freewebtools.displayCount,growth_rate_per_hour:d.freewebtools.hourly,growth_rate_per_day:d.freewebtools.daily},subscriberCount:d.freewebtools.apiSubscribers,viewCount:d.freewebtools.viewCount,videoCount:d.freewebtools.videoCount,thumbnail:d.channel.avatar}}]));
renderer.attach(app,()=>rendererData());
encoder.attach(app,()=>rendererData());
const update=async k=>{const{id,user}=CHANNELS[k],d=data[k],urls=[`https://ests.sctools.org/api/get/${id}`,`https://www.freewebtools.com/api/youtube/channel?user=${encodeURIComponent(user)}&_t=${Date.now()}`];
const[st,fw]=await Promise.all(urls.map((u,i)=>get(u).then(j=>{if(i===1&&j.refreshFailed)throw Error(j.refreshFailure||"FreeWebTools refresh failed");log(k,i?"FreeWebTools":"SCTools");return j;}).catch(e=>(log(k,i?"FreeWebTools":"SCTools",e),null))));
if(st?.stats){const x=st.stats;d.sctools={estSubscribers:num(x.estCount),linearSubscribers:num(x.linearCount),apiSubscribers:num(x.apiCount),estViews:num(x.viewCount),apiViews:null,estVideos:null,apiVideos:num(x.videoCount),hourly:num(st.averages?.hourly),daily:num(st.averages?.daily),nextUpdate:st.nextUpdate??null};d.channel={...d.channel,name:st.info?.name||d.channel.name||"",avatar:st.info?.avatar||d.channel.avatar||"",country:st.info?.country||d.channel.country||""};}
if(fw){const e=fw.estimation||{};d.freewebtools={estimatedSubscribers:num(e.estimated_count),displayCount:e.display_count??null,apiSubscribers:num(fw.subscriberCount),estimatedViews:null,viewCount:num(fw.viewCount),estimatedVideos:null,videoCount:num(fw.videoCount),hourly:num(e.growth_rate_per_hour),daily:num(e.growth_rate_per_day),confidence:e.confidence??null,fromCache:!!fw.fromCache};d.channel={...d.channel,name:d.channel.name||fw.title||"",handle:fw.customUrl||d.channel.handle||"",avatar:d.channel.avatar||fw.thumbnail||"",description:d.channel.description||fw.description||""};}
d.updated=Date.now();d.error=!st&&!fw?"Both sources unavailable":null;
};
const updateAll=async()=>{if(busy)return;busy=true;try{await Promise.all(Object.keys(CHANNELS).map(update));console.log(`[${new Date().toLocaleTimeString()}] Updated | Lucan: ${data.lucan.updated?"OK":"NO DATA"} | MY CHANNEL: ${data.mine.updated?"OK":"NO DATA"}`);}catch(e){console.error("[SERVER]",e.message);}finally{busy=false;}};
const server=app.listen(process.env.PORT||3000,()=>{console.log("SCTools + FreeWebTools Tracker running");updateAll();setInterval(updateAll,5000);});
const shutdown=()=>{console.log("Shutting down");server.close(()=>process.exit(0));setTimeout(()=>process.exit(1),10000).unref();};
process.on("SIGTERM",shutdown);
process.on("SIGINT",shutdown);
