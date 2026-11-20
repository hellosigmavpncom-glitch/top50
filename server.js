const express=require("express"),app=express();
const {chromium}=require("playwright");
const CHANNELS={lucan:{id:"UCuz_0MPcY5O0vsIfFPKFpGg"},mine:{id:"UCnKrmx7XhDqbiMD3aSBwz_g"}};
const h={"User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36","Accept":"application/json,text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8","Accept-Language":"en-US,en;q=0.9","Cache-Control":"no-cache","Pragma":"no-cache","Sec-Ch-Ua":'"Chromium";v="122","Not(A:Brand";v="8","Google Chrome";v="122"',"Sec-Ch-Ua-Mobile":"?0","Sec-Ch-Ua-Platform":'"Windows"',"Sec-Fetch-Dest":"empty","Sec-Fetch-Mode":"cors","Sec-Fetch-Site":"cross-site","DNT":"1","Connection":"keep-alive","X-Forwarded-For":"192.168.1.1","X-Client-IP":"192.168.1.1","Referer":"https://socialcounts.org/"};

const clean=o=>Object.fromEntries(["subscriberCount","viewCount","videoCount"].map(k=>[k,Number(o?.[k])||0]));
const empty=()=>({estimation:{},api:{},socialcounts:{estimation:{},api:{}},nextcounts:{},channel:{},updated:null,error:null,ncFailed:false,sourceErrors:{}});
const data=Object.fromEntries(Object.keys(CHANNELS).map(k=>[k,empty()]));
const logged={lucan:{},mine:{}};
let busy=false, browserInstance=null, contextInstance=null;

const logError=(k,s,e)=>{
const msg=`[${s}] ${e.message}`;
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

async function getBrowserContext(){
  if(!browserInstance){
    browserInstance=await chromium.launch({
      headless:true,
      args:[
        "--disable-blink-features=AutomationControlled",
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage"
      ]
    });
    contextInstance=await browserInstance.newContext({extraHTTPHeaders:h});
    await contextInstance.addInitScript(()=>{Object.defineProperty(navigator,'webdriver',{get:()=>undefined});});
  }
  return contextInstance;
}

app.get("/",(q,r)=>r.sendFile(__dirname+"/index.html"));
app.get("/api/stats",(q,r)=>(r.set("Cache-Control","no-store"),r.json(data)));
app.get("/api/diagnostics",(q,r)=>(r.set("Cache-Control","no-store"),r.json(Object.fromEntries(Object.entries(data).map(([k,d])=>[k,{updated:d.updated,error:d.error,ncFailed:d.ncFailed,sourceErrors:d.sourceErrors}])))));

app.get("/api/avatar/:key",async(q,r)=>{
try{
const u=data[q.params.key]?.channel?.avatar;
if(!u)return r.sendStatus(404);
const ctx=await getBrowserContext();
const page=await ctx.newPage();
const resp=await page.goto(u,{timeout:15000});
if(!resp.ok())throw Error(`HTTP ${resp.status()}`);
const buffer=await resp.body();
r.set({"Content-Type":resp.headers()["content-type"]||"image/jpeg","Cache-Control":"public,max-age=21600"});
r.send(buffer);
await page.close();
}catch(e){console.error(`[AVATAR] ${q.params.key}: ${e.message}`);r.sendStatus(502);}
});

const get=async u=>{
let page;
try{
const ctx=await getBrowserContext();
page=await ctx.newPage();
const resp=await page.goto(u,{waitUntil:"domcontentloaded",timeout:12000});
const status=resp.status();
const contentType=resp.headers()["content-type"]||"";
const body=await resp.text();
await page.close();

if(status!==200||!contentType.includes("application/json")){
const e=Error(`HTTP ${status} (Cloudflare Block or Non-JSON)`);
e.status=status;e.body=body.slice(0,500);throw e;
}
return JSON.parse(body);
}catch(e){
if(page&&!page.isClosed())await page.close().catch(()=>{});
e.url=u;throw e;
}
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
}catch(e){console.error("[SERVER] Update error:",e);}
finally{busy=false;}
};

app.listen(process.env.PORT||3000,()=>{
console.log("Playwright Tracker running");
updateAll();
setInterval(updateAll,2000);
});
