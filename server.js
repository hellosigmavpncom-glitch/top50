
const express=require("express"),app=express(),path=require("path"),crypto=require("crypto");
const PORT=process.env.PORT||3000,STREAM_ID="Nr1IWBNNQFA",AVATAR_TTL=21600000;
const chs={
 celine:{id:"UC1a2ZCw7tugRZYRMnecNj3A",name:"Celine Dept",handle:"@celinedept"},
 kondzilla:{id:"UCffDXn7ycAzwL2LDlbyWOTw",name:"Canal KondZilla",handle:"@kondzilla"},
 vystats:{id:"UCnKrmx7XhDqbiMD3aSBwz_g",name:"VYStats",handle:"@VYStats"}
};
let cache={celine:null,kondzilla:null,vystats:null,stream:null,lastUpdated:null},music={title:"Waiting for VLC...",artist:""},busy=false;
const avatars={};
app.use(express.json({limit:"2kb"}));
app.use((q,s,n)=>{s.setHeader("Cache-Control","no-store");n()});
const num=v=>Number(String(v??0).replace(/,/g,""))||0;
async function get(url,headers={}){
 const r=await fetch(url,{signal:AbortSignal.timeout(15000),headers:{"User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",...headers}});
 if(!r.ok)throw Error("HTTP "+r.status);
 return r;
}
async function json(url){return(await get(url)).json()}
const mix=(d,k)=>d?.counts?.find(x=>x.value===k)?.count;
const user=(d,k)=>d?.user?.find(x=>x.value===k)?.count;

async function fetchMixerno(ch){
 const d=await json(`https://mixerno.space/api/youtube-channel-counter/user/${ch.id}`),subs=num(mix(d,"subscribers"));
 if(!subs)throw Error("Missing Mixerno subscriber count");
 return{id:ch.id,name:user(d,"name")||ch.name,handle:ch.handle,estimatedSubscriberCount:subs,apiSubscriberCount:num(mix(d,"apisubscribers")),viewCount:num(mix(d,"views")),apiViewCount:num(mix(d,"apiviews")),videoCount:num(mix(d,"videos"))};
}
async function fetchCh(k,ch){
 try{
  const d=await json(`https://flashcounts.jp/api/youtube/channels/${ch.id}`),s=d.subscribers||{};
  if(!num(s.count))throw Error("Missing estimated subscribers");
  const c=d.channel||{},v=d.views||{},data={id:ch.id,name:c.title||ch.name,handle:c.handle||ch.handle,estimatedSubscriberCount:num(s.count),apiSubscriberCount:num(s.api),viewCount:num(v.count),apiViewCount:num(v.api),videoCount:num(d.videos?.count)};
  cache[k]={...cache[k],...data};
  console.log(`[${k}] FlashCounts · ${data.estimatedSubscriberCount.toLocaleString()}`);
 }catch(e){
  console.log(`[${k}] FlashCounts: ${e.message} · trying Mixerno`);
  try{const data=await fetchMixerno(ch);cache[k]={...cache[k],...data};console.log(`[${k}] Mixerno · ${data.estimatedSubscriberCount.toLocaleString()}`)}
  catch(x){console.log(`[${k}] Mixerno: ${x.message}`)}
 }
 return cache[k];
}
function extractObject(s,start){
 start=s.indexOf("{",start);
 if(start<0)return null;
 let depth=0,string=false,escape=false;
 for(let i=start;i<s.length;i++){
  const c=s[i];
  if(string){if(escape)escape=false;else if(c==="\\")escape=true;else if(c==='"')string=false;continue}
  if(c==='"'){string=true;continue}
  if(c==="{")depth++;
  if(c==="}"&&!--depth){try{return JSON.parse(s.slice(start,i+1))}catch{return null}}
 }
 return null;
}
function avatarUrls(html){
 const urls=[],pos=html.indexOf('"channelMetadataRenderer"');
 if(pos>=0){
  const data=extractObject(html,pos+'"channelMetadataRenderer"'.length);
  const list=data?.avatar?.thumbnails||[];
  list.sort((a,b)=>(b.width||0)-(a.width||0)).forEach(x=>{
   if(!x.url)return;
   const u=x.url;
   urls.push(u.replace(/=s\d+(?:-[^?&]*)?/,"=s0"));
   urls.push(u.replace(/=s\d+(?:-[^?&]*)?/,"=s1000-c-k-c0x00ffffff-no-rj"));
   urls.push(u);
  });
 }
 const tags=html.match(/<meta\b[^>]*>/gi)||[];
 for(const tag of tags){
  if(/property=["']og:image["']/i.test(tag)){
   const m=tag.match(/\bcontent=["']([^"']+)/i);
   if(m){
    const u=m[1].replace(/&amp;/g,"&");
    urls.push(u.replace(/=s\d+(?:-[^?&]*)?/,"=s0"),u);
   }
  }
 }
 return [...new Set(urls)];
}
async function fetchAvatar(k){
 const old=avatars[k];
 if(old?.body&&Date.now()-old.time<AVATAR_TTL)return old;
 if(old?.loading)return old.loading;
 const ch=chs[k];
 if(!ch)throw Error("Unknown channel");
 const loading=(async()=>{
  try{
   const page=await get(`https://www.youtube.com/channel/${ch.id}?hl=en`,{"Accept-Language":"en-US,en;q=0.9","Accept":"text/html"});
   const html=await page.text();
   if(!html.includes(ch.id))throw Error(`Unexpected YouTube page (${html.length} bytes)`);
   const urls=avatarUrls(html);
   if(!urls.length)throw Error(`Avatar not found (${html.length} bytes)`);
   let lastError;
   for(const url of urls){
    try{
     const u=new URL(url);
     if(!["yt3.ggpht.com","yt3.googleusercontent.com"].includes(u.hostname))continue;
     const img=await get(u.href,{"Referer":"https://www.youtube.com/"});
     const type=img.headers.get("content-type")||"image/jpeg";
     if(!type.startsWith("image/"))throw Error("Invalid image response: "+type);
     const body=Buffer.from(await img.arrayBuffer());
     if(!body.length||body.length>8e6)throw Error("Invalid avatar size");
     const result={body,type,time:Date.now()};
     avatars[k]=result;
     console.log(`[Avatar ${k}] YouTube · ${Math.round(body.length/1024)} KB`);
     return result;
    }catch(e){lastError=e}
   }
   throw lastError||Error("No usable YouTube avatar URL");
  }catch(e){
   console.log(`[Avatar ${k}] ${e.message}`);
   if(old?.body)return old;
   throw e;
  }
 })();
 avatars[k]={...old,loading};
 try{return await loading}finally{if(avatars[k]?.loading===loading)delete avatars[k].loading}
}
async function update(){
 if(busy)return;
 busy=true;
 try{
  const results=await Promise.all(Object.entries(chs).map(([k,c])=>fetchCh(k,c)));
  const s=await json(`https://api.basepoint.live/youtube/stream/${STREAM_ID}`).catch(e=>{console.log("[Stream]",e.message);return null});
  if(s)cache.stream=s;
  if(results.some(Boolean)||s)cache.lastUpdated=new Date().toISOString();
 }catch(e){console.log("[Update]",e.message)}
 finally{busy=false}
}
app.get("/api/stats",(_,r)=>r.json(cache));
app.get("/api/music",(_,r)=>r.json(music));
app.post("/api/music",(q,r)=>{
 const a=Buffer.from(process.env.MUSIC_TOKEN||""),b=Buffer.from(String(q.headers.authorization||"").replace(/^Bearer\s+/i,""));
 if(!a.length||!b.length||a.length!==b.length||!crypto.timingSafeEqual(a,b))return r.sendStatus(401);
 const title=String(q.body?.title||"").trim(),artist=String(q.body?.artist||"").trim();
 if(!title||title.length>300||artist.length>150)return r.sendStatus(400);
 music={title,artist,updatedAt:new Date().toISOString()};
 r.json({ok:true});
});
app.get("/api/avatar/:key",async(q,r)=>{
 if(!chs[q.params.key])return r.sendStatus(404);
 try{
  const a=await fetchAvatar(q.params.key);
  r.set("Content-Type",a.type).set("Cache-Control","public,max-age=21600").set("X-Content-Type-Options","nosniff").send(a.body);
 }catch(e){r.status(502).send("Avatar unavailable")}
});
app.get("/",(_,r)=>r.sendFile(path.join(__dirname,"index.html")));
app.listen(PORT,()=>{console.log(`[RUN] Port ${PORT}`);update();setInterval(update,5000)});
