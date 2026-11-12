const app=require('express')(),path=require('path'),PORT=process.env.PORT||3000;
const chs={celine:{id:'UC1a2ZCw7tugRZYRMnecNj3A',name:'Celine Dept'},kondzilla:{id:'UCffDXn7ycAzwL2LDlbyWOTw',name:'Canal KondZilla'}};
const STREAM_ID='B8iHWmFwaHY';
let cache={celine:null,kondzilla:null,stream:null,lastUpdated:null},busy=false;
app.use((req,res,next)=>{res.setHeader("Cache-Control","no-store");next();});
async function fetchCh(k,ch){
  try{
    const r=await fetch(`https://mixerno.space/api/youtube-channel-counter/user/${ch.id}`,{signal:AbortSignal.timeout(10000),headers:{"User-Agent":"Mozilla/5.0"}});
    if(!r.ok)throw 0;const raw=await r.json();
    const gc=v=>raw.counts?.find(x=>x.value===v)?.count??0,gu=v=>raw.user?.find(x=>x.value===v)?.count??"";
    const est=gc("subscribers"),apiSub=gc("apisubscribers");
    const name=gu("name")||ch.name,avatar=gu("pfp");
    if(!est||isNaN(Number(est)))throw 0;
    return{id:ch.id,name,handle:`@${k==='celine'?'celinedept':'kondzilla'}`,avatar:avatar.trim(),estimatedSubscriberCount:Number(est),apiSubscriberCount:Number(apiSub),viewCount:Number(gc("views")),apiViewCount:Number(gc("apiviews")),videoCount:Number(gc("videos"))};
  }catch{return null;}
}
async function fetchStream(){
  try{
    const r=await fetch(`https://api.basepoint.live/youtube/stream/${STREAM_ID}`,{signal:AbortSignal.timeout(10000),headers:{"User-Agent":"Mozilla/5.0"}});
    if(!r.ok)throw 0;
    return await r.json();
  }catch{return null;}
}
async function update(){
  if(busy)return;busy=true;
  const [cRes,kRes,sRes]=await Promise.all([
    fetchCh('celine',chs.celine),
    fetchCh('kondzilla',chs.kondzilla),
    fetchStream()
  ]);
  if(cRes)cache.celine=cRes;
  if(kRes)cache.kondzilla=kRes;
  if(sRes)cache.stream=sRes;
  if(cache.celine||cache.kondzilla||cache.stream)cache.lastUpdated=new Date().toISOString();
  busy=false;
}
app.get("/api/stats",(_,res)=>res.json(cache));
app.get("/api/avatar/:key",async(req,res)=>{
  const c=cache[req.params.key],fb="https://upload.wikimedia.org/wikipedia/commons/9/99/Sample_User_Icon.png";
  if(!c?.avatar)return res.redirect(fb);
  try{
    const r=await fetch(new URL(c.avatar),{signal:AbortSignal.timeout(8000),headers:{"User-Agent":"Mozilla/5.0","Referer":"https://www.youtube.com/"}});
    if(!r.ok)throw 0;
    res.set("Content-Type",r.headers.get("content-type")||"image/jpeg").send(Buffer.from(await r.arrayBuffer()));
  }catch{res.redirect(fb);}
});
app.use(require('express').static(path.join(__dirname,"public")));
app.listen(PORT,()=>{console.log(`[RUN] Port ${PORT}`);update();setInterval(update,5000);});
