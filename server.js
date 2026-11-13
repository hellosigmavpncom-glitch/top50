const express=require("express"),app=express(),path=require("path"),crypto=require("crypto"),PORT=process.env.PORT||3000;
const chs={
  celine:{id:"UC1a2ZCw7tugRZYRMnecNj3A",name:"Celine Dept",handle:"@celinedept"},
  kondzilla:{id:"UCffDXn7ycAzwL2LDlbyWOTw",name:"Canal KondZilla",handle:"@kondzilla"},
  vystats:{id:"UCnKrmx7XhDqbiMD3aSBwz_g",name:"VYStats",handle:"@VYStats"}
};
const STREAM_ID="Nr1IWBNNQFA";
let cache={celine:null,kondzilla:null,vystats:null,stream:null,lastUpdated:null},busy=false;
let music={title:"Waiting for VLC...",artist:"",updatedAt:null};

app.use(express.json({limit:"2kb"}));
app.use((req,res,next)=>{res.setHeader("Cache-Control","no-store");next()});

async function fetchCh(k,ch){
  try{
    const r=await fetch(`https://mixerno.space/api/youtube-channel-counter/user/${ch.id}`,{signal:AbortSignal.timeout(10000),headers:{"User-Agent":"Mozilla/5.0"}});
    if(!r.ok)throw 0;
    const raw=await r.json(),gc=v=>raw.counts?.find(x=>x.value===v)?.count??0,gu=v=>raw.user?.find(x=>x.value===v)?.count??"";
    const est=gc("subscribers"),apiSub=gc("apisubscribers"),avatar=gu("pfp");
    if(!est||isNaN(Number(est)))throw 0;
    return{id:ch.id,name:gu("name")||ch.name,handle:ch.handle,avatar:String(avatar).trim(),estimatedSubscriberCount:Number(est),apiSubscriberCount:Number(apiSub),viewCount:Number(gc("views")),apiViewCount:Number(gc("apiviews")),videoCount:Number(gc("videos"))};
  }catch{return null}
}

async function fetchStream(){
  try{
    const r=await fetch(`https://api.basepoint.live/youtube/stream/${STREAM_ID}`,{signal:AbortSignal.timeout(10000),headers:{"User-Agent":"Mozilla/5.0"}});
    if(!r.ok)throw 0;
    return await r.json();
  }catch{return null}
}

async function update(){
  if(busy)return;
  busy=true;
  try{
    const [cRes,kRes,vRes,sRes]=await Promise.all([
      fetchCh("celine",chs.celine),fetchCh("kondzilla",chs.kondzilla),
      fetchCh("vystats",chs.vystats),fetchStream()
    ]);
    if(cRes)cache.celine=cRes;
    if(kRes)cache.kondzilla=kRes;
    if(vRes)cache.vystats=vRes;
    if(sRes)cache.stream=sRes;
    if(cRes||kRes||vRes||sRes)cache.lastUpdated=new Date().toISOString();
  }finally{busy=false}
}

app.get("/api/stats",(_,res)=>res.json(cache));
app.get("/api/music",(_,res)=>res.json(music));

app.post("/api/music",(req,res)=>{
  const expected=process.env.MUSIC_TOKEN||"",provided=String(req.headers.authorization||"").replace(/^Bearer\s+/i,"");
  if(!expected||!provided)return res.sendStatus(401);
  const a=Buffer.from(provided),b=Buffer.from(expected);
  if(a.length!==b.length||!crypto.timingSafeEqual(a,b))return res.sendStatus(401);
  const title=String(req.body?.title||"").trim(),artist=String(req.body?.artist||"").trim();
  if(!title||title.length>300||artist.length>150)return res.sendStatus(400);
  music={title,artist,updatedAt:new Date().toISOString()};
  res.json({ok:true});
});

app.get("/api/avatar/:key",async(req,res)=>{
  const c=cache[req.params.key],fb="https://upload.wikimedia.org/wikipedia/commons/9/99/Sample_User_Icon.png";
  if(!c?.avatar)return res.redirect(fb);
  try{
    const r=await fetch(new URL(c.avatar),{signal:AbortSignal.timeout(8000),headers:{"User-Agent":"Mozilla/5.0","Referer":"https://www.youtube.com/"}});
    if(!r.ok)throw 0;
    res.set("Content-Type",r.headers.get("content-type")||"image/jpeg").send(Buffer.from(await r.arrayBuffer()));
  }catch{res.redirect(fb)}
});

app.get("/",(_,res)=>res.sendFile(path.join(__dirname,"index.html")));
app.listen(PORT,()=>{console.log(`[RUN] Port ${PORT}`);update();setInterval(update,5000)});
