
const {createCanvas,loadImage,GlobalFonts}=require("@napi-rs/canvas");

const W=1280,H=720;
const C={bg:"#050713",panel:"#0b1024",panel2:"#101832",border:"#273a68",blue:"#27a9ff",purple:"#8b36ff",teal:"#25e5c0",white:"#f5f7ff",muted:"#aab8df",red:"#ff4267"};
const canvas=createCanvas(W,H),ctx=canvas.getContext("2d"),bgCanvas=createCanvas(W,H),bgCtx=bgCanvas.getContext("2d");
const history={subs:[],rates:[],last:0,previous:null},avatars={},loadedAvatars={},textSizes=new Map(),gradients=new Map();
const numberFormat=new Intl.NumberFormat("en-US");
let lastTiming={drawMs:0,outputMs:0,totalMs:0},benchmarkActive=false,renderQueue=Promise.resolve();

for(const w of [400,500,600,700,800,900])try{GlobalFonts.registerFromPath(require.resolve(`@fontsource/inter/files/inter-latin-${w}-normal.woff2`),"Inter");}catch{}

const ms=s=>Number(process.hrtime.bigint()-s)/1e6;
const fmt=v=>v==null||v===""||!Number.isFinite(Number(v))?"—":numberFormat.format(Math.round(Number(v)));
const num=(o,...keys)=>{for(const k of keys)if(o?.[k]!=null&&o[k]!==""&&Number.isFinite(Number(o[k])))return Number(o[k]);return null;};
const yieldLoop=()=>new Promise(setImmediate);
const rect=(x,y,w,h,r=12,fill=C.panel,stroke=C.border)=>{ctx.beginPath();ctx.roundRect(x,y,w,h,r);ctx.fillStyle=fill;ctx.fill();if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=1;ctx.stroke();}};
const line=(x1,y1,x2,y2,color="#ffffff20",width=1)=>{ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.strokeStyle=color;ctx.lineWidth=width;ctx.stroke();};
const gradient=(key,create)=>{if(!gradients.has(key))gradients.set(key,create());return gradients.get(key);};

function txt(v,x,y,size=16,color=C.white,weight=700,max=Infinity,align="left"){
 const s=String(v??"—"),key=`${weight}|${size}|${max}|${s}`;let f=textSizes.get(key);
 if(f===undefined){f=size;ctx.font=`${weight} ${f}px Inter,Arial,sans-serif`;while(ctx.measureText(s).width>max&&f>9){f--;ctx.font=`${weight} ${f}px Inter,Arial,sans-serif`;}if(textSizes.size>=6000)textSizes.clear();textSizes.set(key,f);}
 ctx.font=`${weight} ${f}px Inter,Arial,sans-serif`;ctx.fillStyle=color;ctx.textAlign=align;ctx.textBaseline="middle";ctx.fillText(s,x,y);
}
function icon(type,x,y,size,color){
 ctx.save();ctx.translate(x,y);ctx.strokeStyle=color;ctx.fillStyle=color;ctx.lineWidth=2.2;ctx.lineCap="round";ctx.lineJoin="round";ctx.shadowColor=color;ctx.shadowBlur=7;ctx.beginPath();
 if(type==="arrow"){ctx.moveTo(-size*.38,size*.3);ctx.lineTo(size*.3,-size*.38);ctx.moveTo(-size*.02,-size*.38);ctx.lineTo(size*.3,-size*.38);ctx.lineTo(size*.3,-size*.06);}
 else if(type==="bolt"){ctx.moveTo(size*.08,-size*.45);ctx.lineTo(-size*.2,size*.04);ctx.lineTo(size*.04,size*.04);ctx.lineTo(-size*.08,size*.45);ctx.lineTo(size*.28,-size*.12);ctx.lineTo(size*.04,-size*.12);ctx.closePath();ctx.fill();}
 else if(type==="flag"){ctx.moveTo(-size*.25,size*.43);ctx.lineTo(-size*.25,-size*.45);ctx.moveTo(-size*.22,-size*.4);ctx.lineTo(size*.3,-size*.28);ctx.lineTo(-size*.02,-size*.04);ctx.lineTo(-size*.22,-size*.1);}
 else if(type==="data"){ctx.rect(-size*.36,-size*.36,size*.72,size*.72);ctx.moveTo(-size*.36,-size*.08);ctx.lineTo(size*.36,-size*.08);ctx.moveTo(-size*.36,size*.18);ctx.lineTo(size*.36,size*.18);}
 else if(type==="live"){ctx.arc(0,0,size*.25,0,Math.PI*2);ctx.fill();}
 else if(type==="check"){ctx.moveTo(-size*.35,0);ctx.lineTo(-size*.08,size*.27);ctx.lineTo(size*.38,-size*.3);}
 ctx.stroke();ctx.restore();
}
function getStats(d={}){
 const s=d.sctools||{},f=d.freewebtools||{},e=f.estimation||{};
 return{
  name:d.channel?.name||s.name||"Channel",handle:d.channel?.handle||"",avatar:d.channel?.avatar||s.avatar||f.thumbnail||"",
  linear:num(s,"linearSubscribers","linearCount","estSubscribers","estCount"),est:num(s,"estSubscribers","estCount"),api:num(s,"apiSubscribers","apiCount"),
  views:num(s,"estViews","viewCount"),apiViews:num(s,"apiViews"),videos:num(s,"estVideos"),apiVideos:num(s,"apiVideos","videoCount"),
  hourly:num(s,"hourly")??num(s.averages,"hourly")??num(f,"hourly"),daily:num(s,"daily")??num(s.averages,"daily")??num(f,"daily"),
  freeEst:num(f,"estimatedSubscribers")??num(e,"estimated_count"),freeApi:num(f,"apiSubscribers","subscriberCount"),
  freeEstViews:num(f,"estimatedViews"),freeApiViews:num(f,"viewCount"),freeEstVideos:num(f,"estimatedVideos"),freeApiVideos:num(f,"videoCount")
 };
}
function preloadAvatar(url){
 if(!url||avatars[url])return avatars[url];
 avatars[url]=loadImage(url).then(img=>(loadedAvatars[url]=img)).catch(()=>null);
 return avatars[url];
}
function avatar(url,x,y,size,border=C.blue){
 const img=loadedAvatars[url];if(!img)return;
 ctx.save();ctx.shadowColor=border;ctx.shadowBlur=15;ctx.beginPath();ctx.arc(x+size/2,y+size/2,size/2,0,Math.PI*2);ctx.fillStyle=C.panel;ctx.fill();ctx.shadowBlur=0;
 ctx.beginPath();ctx.arc(x+size/2,y+size/2,size/2-2,0,Math.PI*2);ctx.clip();ctx.drawImage(img,x,y,size,size);ctx.restore();
 ctx.beginPath();ctx.arc(x+size/2,y+size/2,size/2-1,0,Math.PI*2);ctx.strokeStyle=border;ctx.lineWidth=2;ctx.stroke();
}
function buildBackground(){
 bgCtx.fillStyle=C.bg;bgCtx.fillRect(0,0,W,H);
 const g=bgCtx.createRadialGradient(W/2,-80,10,W/2,H,850);g.addColorStop(0,"#19265a");g.addColorStop(.5,"#080b1b");g.addColorStop(1,"#040610");
 bgCtx.fillStyle=g;bgCtx.fillRect(0,0,W,H);
}
buildBackground();

function header(){
 rect(8,8,1264,48,10,C.panel2,null);txt("LUCAN PEVIDOR",22,32,19,C.white,900,180);txt("| ROAD TO 60M",198,32,19,C.purple,900,230);
 icon("live",1212,32,12,C.red);txt("LIVE",1225,32,15,C.red,900,50);
}
function profile(d){
 rect(8,66,420,136,19,"#0b1024","#743dff");avatar(d.avatar,20,74,120);
 txt(d.name,154,102,21,C.white,900,258);txt(d.handle||"@LucanPevidor",154,126,11,C.muted,800,255);
 txt("Jesus loves you! I hope every",154,148,12,"#dce5ff",800,258);txt("video makes you smile!",154,164,12,"#dce5ff",800,258);
 rect(154,176,96,18,7,"#5423c5",null);txt("ROAD TO 60M",202,185,9,C.white,900,90,"center");
}
function miniStats(d){
 rect(8,214,420,240,19,"#0b1024","#245caa");txt("MY CHANNEL",22,242,15,"#d7e5ff",900,120);
 avatar(d.avatar,248,226,66);txt(d.name||"VYStats",326,246,15,C.white,900,90);txt(d.handle||"@vystatsyt",326,268,10,C.muted,800,90);line(22,294,414,294);
 [["SUBSCRIBERS",d.freeEst,d.freeApi],["VIEWS",d.freeEstViews,d.freeApiViews],["VIDEOS",d.freeEstVideos,d.freeApiVideos]].forEach((c,i)=>{
  const x=22+i*132;if(i)line(x-8,306,x-8,440);
  txt(c[0],x+58,324,10,"#b8caff",900,116,"center");txt("EST.",x,354,10,C.muted,900);txt(fmt(c[1]),x+116,354,15,C.white,900,100,"right");
  txt("API",x,389,10,C.muted,900);txt(fmt(c[2]),x+116,389,15,C.white,900,100,"right");
 });
}
function mainCard(x,title,accent,type){
 rect(x,66,267,388,19,"#0b1024",accent);
 const g=gradient(`card-${x}`,()=>{const v=ctx.createLinearGradient(x,66,x+267,454);v.addColorStop(0,"#ffffff08");v.addColorStop(1,"#00000000");return v;});
 rect(x+1,67,265,386,18,g,null);icon(type,x+24,112,15,accent);txt(title,x+38,112,14,"#d7e3ff",900,210);
}
function chart(values,x,y,w,h){
 const n=values.length;if(n<2)return;let min=Infinity,max=-Infinity;
 for(let i=0;i<n;i++){const v=values[i];if(v<min)min=v;if(v>max)max=v;}
 const range=max-min||1,px=i=>x+i/(n-1)*w,py=v=>y+h-(v-min)/range*h;
 const g=gradient("chart-fill",()=>{const v=ctx.createLinearGradient(0,y,0,y+h);v.addColorStop(0,"#18e9d944");v.addColorStop(1,"#18e9d900");return v;});
 ctx.beginPath();ctx.moveTo(x,y+h);for(let i=0;i<n;i++)ctx.lineTo(px(i),py(values[i]));ctx.lineTo(x+w,y+h);ctx.closePath();ctx.fillStyle=g;ctx.fill();
 ctx.beginPath();for(let i=0;i<n;i++){const xx=px(i),yy=py(values[i]);if(i)ctx.lineTo(xx,yy);else ctx.moveTo(xx,yy);}
 ctx.strokeStyle=C.teal;ctx.lineWidth=3;ctx.lineJoin="round";ctx.lineCap="round";ctx.shadowColor=C.teal;ctx.shadowBlur=7;ctx.stroke();ctx.shadowBlur=0;
}
function bars(values,x,y,w,h){
 const n=Math.min(values.length,14);if(!n)return;const gap=6,bw=Math.min(20,(w-gap*(n-1))/n),total=n*bw+(n-1)*gap,start=x+(w-total)/2;let max=.01;
 for(let i=values.length-n;i<values.length;i++)max=Math.max(max,Math.abs(values[i]));
 for(let i=0;i<n;i++){
  const bh=Math.max(8,Math.abs(values[values.length-n+i])/max*h);
  const g=gradient(`bar-${Math.round(bh)}`,()=>{const v=ctx.createLinearGradient(0,y+h-bh,0,y+h);v.addColorStop(0,"#a63cff");v.addColorStop(1,"#5420c7");return v;});
  ctx.fillStyle=g;ctx.globalAlpha=.65+.35*i/n;ctx.beginPath();ctx.roundRect(start+i*(bw+gap),y+h-bh,bw,bh,4);ctx.fill();
 }
 ctx.globalAlpha=1;
}
function subscriberCard(x,current,hourly,daily){
 mainCard(x,"LUCAN · LIVE SUBSCRIBERS",C.blue,"arrow");txt("(LINEAR ESTIMATE)",x+133.5,139,13,"#d7e3ff",900,237,"center");
 txt(fmt(current),x+133.5,202,55,C.white,900,239,"center");chart(history.subs.slice(-18),x+18,250,231,66);line(x+15,330,x+252,330);
 const cols=[["LINEAR ESTIMATE",fmt(current)],["HOURLY GAIN",fmt(hourly)],["DAILY GAIN",fmt(daily)]],widths=[105,77,85];let at=x+8;
 cols.forEach((c,i)=>{if(i)line(at-4,343,at-4,438);txt(c[0],at+widths[i]/2,361,10,"#b9caff",900,widths[i],"center");txt(c[1],at+widths[i]/2,397,17,C.teal,900,widths[i],"center");at+=widths[i];});
}
function rateCard(x,rate){
 mainCard(x,"SUBS GAINED PER SEC","#2869c9","bolt");txt(rate<0?"−":"+ ",x+67,213,64,C.white,900,65,"center");txt(Math.abs(rate).toFixed(2),x+168,213,64,C.white,900,175,"center");
 bars(history.rates,x+25,280,217,84);txt("LIVE AVERAGE",x+133.5,401,13,C.teal,900,235,"center");
}
function goalCard(x,remaining,progress){
 mainCard(x,"SUBSCRIBERS REMAINING",C.purple,"flag");txt("TO 60,000,000",x+133.5,139,13,"#d7e3ff",900,237,"center");
 txt(fmt(remaining),x+133.5,207,55,C.white,900,239,"center");rect(x+20,275,227,15,10,"#111f43",null);rect(x+20,275,227*progress,15,10,"#8b36ff",null);
 txt("ROAD TO 60M",x+20,309,10,"#b9caff",900,120);txt((progress*100).toFixed(1)+"%",x+247,309,10,"#b9caff",900,65,"right");
 txt("SUBSCRIBERS LEFT",x+133.5,401,13,C.teal,900,235,"center");
}
function sources(a,b){
 rect(8,464,1264,210,19,"#0b1024","#4268a8");icon("data",29,485,13,"#d6e3ff");txt("DATA SOURCES",43,485,15,"#d6e3ff",900,250);
 icon("live",1129,485,9,C.teal);txt("LIVE · BOTH PROVIDERS",1141,485,10,C.teal,900,114);line(22,503,1258,503);
 const left=22,labelW=130,gap=9,colW=(1236-labelW-gap*4)/4,xs=[left+labelW+gap,left+labelW+gap*2+colW,left+labelW+gap*3+colW*2,left+labelW+gap*4+colW*3];
 ["SCTools Est.","SCTools API","FreeWebTools Est.","FreeWebTools API"].forEach((v,i)=>txt(v,xs[i]+colW/2,522,12,"#d6e3ff",900,colW,"center"));
 [["SUBSCRIBERS",a.est,a.api,b.freeEst,b.freeApi],["TOTAL VIEWS",a.views,a.apiViews,b.freeEstViews,b.freeApiViews],["VIDEOS",a.videos,a.apiVideos,b.freeEstVideos,b.freeApiVideos]].forEach((r,i)=>{
  const y=536+i*43;txt(r[0],left,y+17,11,"#799bff",900,labelW);
  for(let j=0;j<4;j++){rect(xs[j],y,colW,36,7,"#080d1b","#26375b");txt(fmt(r[j+1]),xs[j]+11,y+18,17,j===0||j===2?C.teal:"#c4d1ff",900,colW-20);}
 });
}

async function renderInternal(data={},mode="png"){
 const totalStart=process.hrtime.bigint(),a=getStats(data.lucan||{}),b=getStats(data.mine||{}),jobs=[];
 if(a.avatar&&!loadedAvatars[a.avatar]&&!avatars[a.avatar])jobs.push(preloadAvatar(a.avatar));
 if(b.avatar&&!loadedAvatars[b.avatar]&&!avatars[b.avatar])jobs.push(preloadAvatar(b.avatar));
 if(jobs.length)await Promise.all(jobs);

 const current=a.linear??a.est,now=Date.now();
 if(current!=null&&now-history.last>=3000){
  if(history.previous!=null&&history.last){const seconds=(now-history.last)/1000;if(seconds>0)history.rates.push((current-history.previous)/seconds);}
  history.subs.push(current);history.previous=current;history.last=now;
  if(history.subs.length>60)history.subs.shift();
  if(history.rates.length>14)history.rates.shift();
 }

 const rate=history.rates.length?history.rates[history.rates.length-1]:0;
 const remaining=current==null?null:Math.max(0,60000000-current);
 const progress=current==null?0:Math.min(1,current/60000000);
 const drawStart=process.hrtime.bigint();

 ctx.drawImage(bgCanvas,0,0);
 header();profile(a);miniStats(b);
 subscriberCard(442,current,a.hourly,a.daily);
 rateCard(723,rate);
 goalCard(1004,remaining,progress);
 sources(a,b);
 line(8,686,1272,686,"#ffffff18");
 txt("UPDATED "+new Date().toLocaleTimeString(),22,702,11,"#b9caff",900,300);
 icon("live",1179,702,9,C.teal);
 txt("CONNECTED",1192,702,11,C.teal,900,80);

 const drawMs=ms(drawStart),outputStart=process.hrtime.bigint();
 const output=mode==="raw"?canvas.data():canvas.toBuffer("image/png");
 const outputMs=ms(outputStart);
 lastTiming={drawMs,outputMs,totalMs:ms(totalStart)};
 return output;
}

function renderDashboard(data={}){
 const job=renderQueue.then(()=>renderInternal(data,"png"));
 renderQueue=job.catch(()=>{});
 return job;
}
function renderRawFrame(data={}){
 const job=renderQueue.then(()=>renderInternal(data,"raw"));
 renderQueue=job.catch(()=>{});
 return job;
}

function stats(values){
 if(!values.length)return{averageMs:0,medianMs:0,p95Ms:0,minMs:0,maxMs:0};
 const a=[...values].sort((x,y)=>x-y),avg=values.reduce((s,n)=>s+n,0)/values.length,p=q=>a[Math.min(a.length-1,Math.ceil(a.length*q)-1)],r=n=>Number(n.toFixed(2));
 return{averageMs:r(avg),medianMs:r(p(.5)),p95Ms:r(p(.95)),minMs:r(a[0]),maxMs:r(a[a.length-1])};
}

function attach(app,getData){
 app.get("/api/renderer/preview.png",async(req,res)=>{
  if(benchmarkActive)return res.status(503).send("Benchmark running; retry shortly");
  try{
   const png=await renderDashboard(getData());
   res.set("Content-Type","image/png");
   res.set("Cache-Control","no-store, no-cache, must-revalidate");
   res.send(png);
  }catch(e){
   console.error("Renderer error:",e.stack||e.message);
   res.status(500).send("Renderer failed");
  }
 });

 app.get("/api/renderer/benchmark",async(req,res)=>{
  if(benchmarkActive)return res.status(409).json({error:"A renderer benchmark is already running"});
  benchmarkActive=true;
  let frame=null;

  try{
   const data=getData(),times=[],drawTimes=[],rawTimes=[];

   for(let i=0;i<3;i++){
    frame=await renderRawFrame(data);
    frame=null;
   }

   const memoryBefore=process.memoryUsage();

   for(let i=0;i<10;i++){
    const start=process.hrtime.bigint();
    frame=await renderRawFrame(data);
    times.push(ms(start));
    drawTimes.push(lastTiming.drawMs);
    rawTimes.push(lastTiming.outputMs);
    const frameBytes=frame.byteLength;
    frame=null;
    await yieldLoop();

    if(i===9){
     const memoryAfter=process.memoryUsage(),mib=n=>Number((n/1048576).toFixed(2));
     const average=times.reduce((a,b)=>a+b,0)/times.length;

     res.set("Cache-Control","no-store");
     res.json({
      renderer:"@napi-rs/canvas",
      mode:"raw-rgba-no-png",
      resolution:`${W}x${H}`,
      frames:times.length,
      warmupFrames:3,
      frameSizeBytes:frameBytes,
      frameSizeMiB:mib(frameBytes),
      ...stats(times),
      estimatedFPS:+(1000/average).toFixed(2),
      draw:stats(drawTimes),
      rawExtraction:stats(rawTimes),
      memory:{
       heapBeforeMiB:mib(memoryBefore.heapUsed),
       heapAfterMiB:mib(memoryAfter.heapUsed),
       externalBeforeMiB:mib(memoryBefore.external),
       externalAfterMiB:mib(memoryAfter.external),
       rssBeforeMiB:mib(memoryBefore.rss),
       rssAfterMiB:mib(memoryAfter.rss)
      }
     });
    }
   }
  }catch(e){
   console.error("Raw benchmark error:",e.stack||e.message);
   if(!res.headersSent)res.status(500).json({error:"Raw RGBA benchmark failed",message:e.message});
  }finally{
   frame=null;
   benchmarkActive=false;
  }
 });
}

module.exports={renderDashboard,renderRawFrame,attach};
