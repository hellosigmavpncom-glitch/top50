
const {Resvg}=require("@resvg/resvg-js");
const fs=require("fs");
const path=require("path");

const W=1280,H=720,FPS=15,FRAME_MS=1000/FPS;
const C={bg:"#050713",panel:"#111a35ed",panel2:"#070b19f5",border:"#273a68",blue:"#27a9ff",purple:"#8b36ff",teal:"#25e5c0",white:"#f5f7ff",muted:"#aab8df",red:"#ff4267"};
const FONT_FILE=path.join("/tmp","inter-variable.ttf");
const FONT_URL="https://raw.githubusercontent.com/google/fonts/main/ofl/inter/Inter%5Bopsz%2Cwght%5D.ttf";
const FONT={loadSystemFonts:false,fontFiles:[FONT_FILE],defaultFontFamily:"Inter"};
const nf=new Intl.NumberFormat("en-US");
const avatars=new Map(),digits=new Map();
const history={subs:[],rates:[],previous:null,last:0};
let queue=Promise.resolve(),benchmarkActive=false,lastTiming={};

const ms=t=>Number(process.hrtime.bigint()-t)/1e6;
const esc=s=>String(s??"—").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&apos;"}[c]));
const fmt=v=>v==null||!Number.isFinite(Number(v))?"—":nf.format(Math.round(Number(v)));
const num=(o,...keys)=>{for(const k of keys)if(o?.[k]!=null&&o[k]!==""&&Number.isFinite(Number(o[k])))return Number(o[k]);return null;};

async function ensureFont(){
 try{await fs.promises.access(FONT_FILE);return;}
 catch{}
 const r=await fetch(FONT_URL,{signal:AbortSignal.timeout(20000)});
 if(!r.ok)throw Error("Inter font download failed: HTTP "+r.status);
 const b=Buffer.from(await r.arrayBuffer());
 if(b.length<10000)throw Error("Inter font file is invalid");
 await fs.promises.writeFile(FONT_FILE,b);
}

const getStats=d=>{
 const s=d.sctools||{},f=d.freewebtools||{},e=f.estimation||{};
 return{
  name:d.channel?.name||s.name||"Lucan Pevidor",
  handle:d.channel?.handle||"@LucanPevidor",
  avatar:d.channel?.avatar||s.avatar||f.thumbnail||"",
  linear:num(s,"linearSubscribers","linearCount","estSubscribers","estCount"),
  est:num(s,"estSubscribers","estCount"),
  api:num(s,"apiSubscribers","apiCount"),
  views:num(s,"estViews","viewCount"),
  apiViews:num(s,"apiViews"),
  videos:num(s,"estVideos"),
  apiVideos:num(s,"apiVideos","videoCount"),
  hourly:num(s,"hourly")??num(s.averages,"hourly")??num(f,"hourly"),
  daily:num(s,"daily")??num(s.averages,"daily")??num(f,"daily"),
  freeEst:num(f,"estimatedSubscribers")??num(e,"estimated_count"),
  freeApi:num(f,"apiSubscribers","subscriberCount"),
  freeEstViews:num(f,"estimatedViews"),
  freeApiViews:num(f,"viewCount"),
  freeEstVideos:num(f,"estimatedVideos"),
  freeApiVideos:num(f,"videoCount")
 };
};

const rect=(x,y,w,h,r=12,fill=C.panel,stroke=C.border,sw=1)=>
 `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}"${stroke?` stroke="${stroke}" stroke-width="${sw}"`:""}/>`;
const line=(x,y,x2,y2,color="#ffffff20",width=1)=>
 `<path d="M${x} ${y}L${x2} ${y2}" fill="none" stroke="${color}" stroke-width="${width}"/>`;

function txt(v,x,y,size=16,color=C.white,weight=700,max=Infinity,anchor="start",extra=""){
 const s=esc(v),n=String(v??"—").length;
 const fit=max===Infinity?size:Math.min(size,max/Math.max(1,n*.55));
 return `<text x="${x}" y="${y}" fill="${color}" font-family="Inter" font-size="${Math.max(8,fit)}" font-weight="${weight}" text-anchor="${anchor}" dominant-baseline="middle" ${extra}>${s}</text>`;
}

function wheel(v,x,y,size=20,color=C.white,max=Infinity,anchor="start",key=""){
 const s=String(v??"—");
 const chars=[...s];
 const widths=chars.map(ch=>ch===","||ch==="."?.29:ch===" "?.3:.55);
 let unit=widths.reduce((a,b)=>a+b,0);
 let scale=max===Infinity?1:Math.min(1,max/(unit*size));
 const fs=size*scale,cw=widths.map(n=>n*fs),total=cw.reduce((a,b)=>a+b,0);
 let px=anchor==="center"?x-total/2:anchor==="right"?x-total:x;
 let out="";
 const now=Date.now();

 chars.forEach((ch,i)=>{
  const w=cw[i],id=`${key}-${i}`;
  if(!/\d/.test(ch)){
   out+=txt(ch,px,y,fs,color,900,w,"start",`textLength="${w}" lengthAdjust="spacingAndGlyphs"`);
   px+=w;return;
  }

  let old=digits.get(id);
  if(!old||old.value!==ch){
   digits.set(id,{value:ch,time:now});
   old=digits.get(id);
  }

  const p=Math.min(1,(now-old.time)/520),ease=1-Math.pow(1-p,3);
  if(old.previous!==undefined&&p<1){
   const clip=`clip-${digits.size}-${i}-${String(key).replace(/[^a-z0-9]/gi,"")}`;
   out+=`<svg x="${px}" y="${y-fs*.78}" width="${w}" height="${fs*1.56}" viewBox="0 0 ${w} ${fs*1.56}"><defs><clipPath id="${clip}"><rect width="${w}" height="${fs*1.56}"/></clipPath></defs><g clip-path="url(#${clip})">`;
   out+=`<text x="${w/2}" y="${fs*.78+ease*fs}" fill="${color}" font-family="Inter" font-size="${fs}" font-weight="900" text-anchor="middle" dominant-baseline="middle" textLength="${w}" lengthAdjust="spacingAndGlyphs">${old.previous}</text>`;
   out+=`<text x="${w/2}" y="${fs*.78-(1-ease)*fs}" fill="${color}" font-family="Inter" font-size="${fs}" font-weight="900" text-anchor="middle" dominant-baseline="middle" textLength="${w}" lengthAdjust="spacingAndGlyphs">${ch}</text></g></svg>`;
  }else{
   out+=txt(ch,px+w/2,y,fs,color,900,w,"middle",`textLength="${w}" lengthAdjust="spacingAndGlyphs"`);
  }

  px+=w;
 });

 return out;
}

async function avatar(url){
 if(!url)return"";
 if(avatars.has(url))return avatars.get(url);
 const p=(async()=>{
  try{
   const r=await fetch(url,{signal:AbortSignal.timeout(6000)});
   if(!r.ok)throw Error("Avatar HTTP "+r.status);
   const b=Buffer.from(await r.arrayBuffer());
   if(b.length>2e6)throw Error("Avatar too large");
   return `data:${r.headers.get("content-type")||"image/jpeg"};base64,${b.toString("base64")}`;
  }catch(e){
   console.error("Avatar load:",e.message);
   return "";
  }
 })();
 avatars.set(url,p);
 return p;
}

function defs(){
 return `<defs>
 <linearGradient id="background" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#111a35"/><stop offset=".8" stop-color="#070b19"/></linearGradient>
 <linearGradient id="cardGlow" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#873aff" stop-opacity=".09"/><stop offset=".5" stop-color="#873aff" stop-opacity="0"/><stop offset="1" stop-color="#148bff" stop-opacity=".05"/></linearGradient>
 <linearGradient id="progress" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#8b36ff"/><stop offset=".55" stop-color="#267bff"/><stop offset="1" stop-color="#20dfd0"/></linearGradient>
 <linearGradient id="bar" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#5420c7"/><stop offset="1" stop-color="#a63cff"/></linearGradient>
 <linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#18e9d9" stop-opacity=".35"/><stop offset="1" stop-color="#18e9d9" stop-opacity="0"/></linearGradient>
 <filter id="shadow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="8"/></filter>
 <clipPath id="lucanClip"><circle cx="59" cy="104" r="46"/></clipPath>
 </defs>`;
}

function panel(x,y,w,h,r=18,border=C.border,glow=false){
 return rect(x,y,w,h,r,"url(#background)",border)+
 `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="url(#cardGlow)"/>`;
}

function profile(d){
 let o=panel(10,41,336,126,16,"#743dff",true);
 o+=`<circle cx="60" cy="104" r="48" fill="#168fff" opacity=".2" filter="url(#shadow)"/>`;
 if(d.avatar)o+=`<image href="${d.avatar}" x="13" y="58" width="92" height="92" preserveAspectRatio="xMidYMid slice" clip-path="url(#lucanClip)"/>`;
 o+=`<circle cx="59" cy="104" r="47" fill="none" stroke="${C.blue}" stroke-width="2.4"/>`;
 o+=txt(d.name,126,83,22,C.white,900,205);
 o+=txt(d.handle,127,108,11,C.muted,800,205);
 o+=txt("Jesus loves you! I hope every",127,128,10,"#dce5ff",800,205);
 o+=txt("video makes you smile!",127,141,10,"#dce5ff",800,205);
 o+=rect(126,151,102,20,7,"#5426c9",null);
 o+=txt("ROAD TO 60M",177,161,9,C.white,900,90,"middle");
 return o;
}

function miniStats(d){
 let o=panel(10,177,336,192,16,"#245caa",true);
 o+=txt("MY CHANNEL",21,198,13,"#d7e5ff",900,115);
 o+=`<circle cx="244" cy="226" r="27" fill="#06102a" stroke="${C.blue}" stroke-width="2"/>`;
 o+=`<circle cx="244" cy="226" r="22" fill="none" stroke="#8b36ff" stroke-width="1"/>`;
 o+=txt("VY",244,220,20,C.white,900,40,"middle");
 o+=txt("STATS",244,234,7,C.teal,900,35,"middle");
 o+=txt(d.name||"VYStats",280,218,13,C.white,900,110);
 o+=txt(d.handle||"@vystatsyt",280,237,9,C.muted,800,110);
 o+=line(21,251,335,251);
 const groups=[["SUBSCRIBERS",d.freeEst,d.freeApi],["VIEWS",d.freeEstViews,d.freeApiViews],["VIDEOS",d.freeEstVideos,d.freeApiVideos]];
 groups.forEach((g,i)=>{
  const x=21+i*105;
  if(i)o+=line(x-7,260,x-7,352);
  o+=txt(g[0],x+43,278,8,"#b8caff",900,88,"middle");
  o+=txt("EST.",x,302,8,C.muted,900,30);
  o+=wheel(fmt(g[1]),x+96,302,13,C.white,61,"right",`mine-${i}-est`);
  o+=txt("API",x,327,8,C.muted,900,30);
  o+=wheel(fmt(g[2]),x+96,327,13,C.white,61,"right",`mine-${i}-api`);
 });
 return o;
}

function chart(values,x,y,w,h){
 if(values.length<2)return"";
 const lo=Math.min(...values),hi=Math.max(...values),range=hi-lo||1;
 const pts=values.map((v,i)=>`${x+i/(values.length-1)*w},${y+h-(v-lo)/range*h}`).join(" ");
 return `<polygon points="${x},${y+h} ${pts} ${x+w},${y+h}" fill="url(#chartGradient)"/>`+
 `<polyline points="${pts}" fill="none" stroke="${C.teal}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>`;
}

function bars(values,x,y,w,h){
 const a=values.slice(-14),max=Math.max(1,...a.map(Math.abs)),gap=5,bw=Math.min(15,(w-gap*(a.length-1))/a.length);
 return a.map((v,i)=>{
  const bh=Math.max(7,Math.abs(v)/max*h);
  return `<rect x="${x+i*(bw+gap)}" y="${y+h-bh}" width="${bw}" height="${bh}" rx="4" fill="url(#bar)" opacity="${.55+.45*i/a.length}"/>`;
 }).join("");
}

function mainStats(a){
 const current=a.linear??a.est;
 const goal=60000000,remaining=current==null?null:Math.max(0,goal-current);
 const progress=current==null?0:Math.min(1,current/goal);
 const rate=history.rates.at(-1)||0;
 let o="";

 // Subscriber card
 o+=panel(357,41,297,328,18,"#287bff",true);
 o+=txt("↗",388,75,22,C.blue,900,28,"middle");
 o+=txt("LUCAN · LIVE SUBSCRIBERS",506,70,13,"#d7e3ff",900,230,"middle");
 o+=txt("(LINEAR ESTIMATE)",506,89,12,"#d7e3ff",900,230,"middle");
 o+=wheel(fmt(current),506,158,55,C.white,275,"center","lucan-count");
 o+=chart(history.subs.slice(-18),369,201,272,62);
 o+=line(369,263,642,263);
 o+=line(487,272,487,350);
 o+=line(567,272,567,350);
 o+=txt("LINEAR ESTIMATE",428,280,9,"#b9caff",900,112,"middle");
 o+=txt("HOURLY GAIN",527,280,9,"#b9caff",900,75,"middle");
 o+=txt("DAILY GAIN",605,280,9,"#b9caff",900,73,"middle");
 o+=wheel(fmt(current),428,316,17,C.teal,112,"center","linear-stat");
 o+=wheel(fmt(a.hourly),527,316,17,C.teal,75,"center","hourly-stat");
 o+=wheel(fmt(a.daily),605,316,17,C.teal,73,"center","daily-stat");

 // Rate card
 o+=panel(666,41,297,328,18,"#2869c9",true);
 o+=txt("ϟ",707,75,24,C.blue,900,25,"middle");
 o+=txt("SUBS GAINED PER SEC",822,75,14,"#d7e3ff",900,230,"middle");
 o+=txt(rate<0?"−":"+",713,171,55,C.white,900,48,"middle");
 o+=wheel(Math.abs(rate).toFixed(2),847,171,58,C.white,175,"center","rate-value");
 o+=bars(history.rates,682,232,265,63);
 o+=txt("◉ LIVE AVERAGE",814,309,11,C.teal,900,200,"middle");

 // Remaining card
 o+=panel(975,41,295,328,18,"#793dff",true);
 o+=txt("⚑",1013,75,22,C.blue,900,25,"middle");
 o+=txt("SUBSCRIBERS REMAINING",1137,70,13,"#d7e3ff",900,240,"middle");
 o+=txt("TO 60,000,000",1137,90,13,"#d7e3ff",900,240,"middle");
 o+=wheel(fmt(remaining),1122,161,55,C.white,258,"center","remaining");
 o+=rect(987,209,271,12,8,"#111f43",null);
 o+=rect(987,209,271*progress,12,8,"url(#progress)",null);
 o+=txt("ROAD TO 60M",987,235,9,"#b9caff",900,110);
 o+=wheel((progress*100).toFixed(1)+"%",1258,235,9,"#b9caff",60,"right","goal-percent");
 o+=txt("◎ SUBSCRIBERS LEFT",1122,309,11,C.teal,900,220,"middle");
 return o;
}

function sources(a,b){
 const left=21,labelW=111,gap=7,colW=(1238-labelW-gap*4)/4;
 const xs=Array.from({length:4},(_,i)=>left+labelW+gap*(i+1)+colW*i);
 let o=panel(6,377,1268,168,18,"#4268a8",true);
 o+=txt("▤  DATA SOURCES",23,392,14,"#d6e3ff",900,250);
 o+=txt("● LIVE · BOTH PROVIDERS",1257,392,9,C.teal,900,170,"end");
 o+=line(21,412,1259,412);
 ["SCTools Est.","SCTools API","FreeWebTools Est.","FreeWebTools API"].forEach((v,i)=>o+=txt(v,xs[i]+colW/2,426,11,"#d6e3ff",900,colW,"middle"));
 const rows=[
  ["SUBSCRIBERS",a.est,a.api,b.freeEst,b.freeApi],
  ["TOTAL VIEWS",a.views,a.apiViews,b.freeEstViews,b.freeApiViews],
  ["VIDEOS",a.videos,a.apiVideos,b.freeEstVideos,b.freeApiVideos]
 ];
 rows.forEach((r,i)=>{
  const y=435+i*35;
  o+=txt(r[0],left,y+15,9,"#799bff",900,labelW);
  for(let j=0;j<4;j++){
   o+=rect(xs[j],y,colW,31,7,"#080d1b","#26375b");
   o+=wheel(fmt(r[j+1]),xs[j]+9,y+16,16,j%2?"#c4d1ff":C.teal,colW-18,"start",`source-${i}-${j}`);
  }
 });
 return o;
}

async function buildSVG(data={}){
 await ensureFont();
 const a=getStats(data.lucan||{}),b=getStats(data.mine||{});
 const [aa,bb]=await Promise.all([avatar(a.avatar),avatar(b.avatar)]);
 const current=a.linear??a.est,now=Date.now();

 if(current!=null&&now-history.last>=1000){
  if(history.previous!=null&&history.last){
   const seconds=(now-history.last)/1000;
   if(seconds>0)history.rates.push((current-history.previous)/seconds);
  }
  history.subs.push(current);
  history.previous=current;
  history.last=now;
  if(history.subs.length>60)history.subs.shift();
  if(history.rates.length>14)history.rates.shift();
 }

 let s=`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`;
 s+=defs();
 s+=`<rect width="${W}" height="${H}" fill="${C.bg}"/>`;
 s+=`<rect width="${W}" height="${H}" fill="url(#background)" opacity=".38"/>`;

 // Header
 s+=txt("LUCAN PEVIDOR",19,25,18,C.white,900,200);
 s+=txt("| ROAD TO 60M",193,25,18,C.purple,900,210);
 s+=txt("● LIVE",1258,25,14,C.red,900,100,"end");

 // Main layout
 s+=profile({...a,avatar:aa});
 s+=miniStats({...b,name:b.name||"VYStats",handle:b.handle||"@vystatsyt",avatar:bb});
 s+=mainStats(a);
 s+=sources(a,b);

 s+=line(6,553,1274,553,"#ffffff18");
 s+=txt("↻ UPDATED "+new Date().toLocaleTimeString(),18,567,10,"#b9caff",900,300);
 s+=txt("● CONNECTED",1258,567,10,C.teal,900,120,"end");
 return s+"</svg>";
}

async function renderInternal(data={},mode="raw"){
 const start=process.hrtime.bigint();
 const svg=await buildSVG(data);
 const drawStart=process.hrtime.bigint();
 const img=new Resvg(svg,{fitTo:{mode:"original"},font:FONT});
 const rendered=img.render();
 const drawMs=ms(drawStart),outStart=process.hrtime.bigint();
 const output=mode==="raw"?Buffer.from(rendered.pixels):rendered.asPng();
 lastTiming={drawMs,outputMs:ms(outStart),totalMs:ms(start)};
 if(mode==="raw"&&output.length!==W*H*4)throw Error(`Bad RGBA frame size: ${output.length}`);
 return output;
}

function run(data,mode){
 const job=queue.then(()=>renderInternal(data,mode));
 queue=job.catch(()=>{});
 return job;
}

const renderDashboard=data=>run(data,"png");
const renderRawFrame=data=>run(data,"raw");

function stats(a){
 if(!a.length)return{averageMs:0,medianMs:0,p95Ms:0,minMs:0,maxMs:0};
 const s=[...a].sort((x,y)=>x-y);
 const avg=a.reduce((x,y)=>x+y,0)/a.length;
 const p=q=>s[Math.min(s.length-1,Math.ceil(s.length*q)-1)];
 const r=n=>+n.toFixed(2);
 return{averageMs:r(avg),medianMs:r(p(.5)),p95Ms:r(p(.95)),minMs:r(s[0]),maxMs:r(s.at(-1))};
}

async function freshBenchmark(getData){
 const duration=10000,interval=BigInt(Math.round(FRAME_MS*1e6));
 const start=process.hrtime.bigint(),before=process.memoryUsage(),times=[];
 let frames=0,missed=0,maxLate=0,checksum=0,firstSize=0,next=start+interval;
 const cpu=process.cpuUsage();

 while(Number(process.hrtime.bigint()-start)/1e6<duration){
  const t=process.hrtime.bigint();
  const data=await getData();
  const frame=await renderRawFrame(data);
  const done=process.hrtime.bigint();
  times.push(Number(done-t)/1e6);
  frames++;
  firstSize=frame.length;
  checksum=(checksum+frame[(frames*997)%frame.length])>>>0;
  if(done>next){
   const late=done-next,slots=Number(late/interval)+1;
   missed+=slots;
   maxLate=Math.max(maxLate,Number(late)/1e6);
   next+=BigInt(slots+1)*interval;
  }else next+=interval;
 }

 const after=process.memoryUsage(),cpuUsed=process.cpuUsage(cpu),elapsed=ms(start);
 const mib=n=>+(n/1048576).toFixed(2);
 return{
  renderer:"@resvg/resvg-js",
  mode:"fresh-render-each-frame",
  resolution:`${W}x${H}`,
  fpsTarget:FPS,
  frameIntervalMs:+FRAME_MS.toFixed(3),
  durationMs:+elapsed.toFixed(2),
  frames,
  frameSizeBytes:firstSize,
  frameSizeMiB:mib(firstSize),
  freshRenderFPS:+(frames/(elapsed/1000)).toFixed(2),
  renderTime:stats(times),
  missedDeadlines:missed,
  missedDeadlinePercent:+(missed/Math.max(1,frames+missed)*100).toFixed(2),
  maxLatenessMs:+maxLate.toFixed(2),
  cpu:{userMs:+(cpuUsed.user/1000).toFixed(2),systemMs:+(cpuUsed.system/1000).toFixed(2)},
  memory:{
   heapBeforeMiB:mib(before.heapUsed),heapAfterMiB:mib(after.heapUsed),
   externalBeforeMiB:mib(before.external),externalAfterMiB:mib(after.external),
   rssBeforeMiB:mib(before.rss),rssAfterMiB:mib(after.rss)
  },
  checksum
 };
}

function attach(app,getData){
 app.get("/api/renderer/preview.png",async(req,res)=>{
  if(benchmarkActive)return res.status(503).send("Benchmark running; retry shortly");
  try{
   const png=await renderDashboard(await getData());
   res.set({"Content-Type":"image/png","Cache-Control":"no-store, no-cache, must-revalidate"});
   res.send(png);
  }catch(e){
   console.error("Renderer error:",e.stack||e.message);
   res.status(500).send("Renderer failed");
  }
 });

 app.get("/api/renderer/benchmark",async(req,res)=>{
  if(benchmarkActive)return res.status(409).json({error:"Benchmark already running"});
  benchmarkActive=true;
  try{
   const result=await freshBenchmark(getData);
   res.set("Cache-Control","no-store");
   res.json(result);
  }catch(e){
   console.error("Fresh renderer benchmark:",e.stack||e.message);
   if(!res.headersSent)res.status(500).json({error:"Benchmark failed",message:e.message});
  }finally{
   benchmarkActive=false;
  }
 });
}

module.exports={renderDashboard,renderRawFrame,attach};
