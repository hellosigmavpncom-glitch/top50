
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
 const bold=weight>=800?Math.max(.35,fit*.025):0;
 return `<text x="${x}" y="${y}" fill="${color}" stroke="${color}" stroke-width="${bold}" stroke-linejoin="round" paint-order="stroke" font-family="Inter" font-size="${Math.max(8,fit)}" font-weight="${weight}" text-anchor="${anchor}" dominant-baseline="middle" ${extra}>${s}</text>`;
}

function wheel(v,x,y,size=20,color=C.white,max=Infinity,anchor="start",key=""){
 const chars=[...String(v??"—")];
 const widths=chars.map(ch=>/\d/.test(ch)?.535:ch===","?.25:ch==="."?.27:.55);
 const unit=widths.reduce((a,b)=>a+b,0);
 const fs=size*(max===Infinity?1:Math.min(1,max/(unit*size)));
 const cw=widths.map(n=>n*fs),total=cw.reduce((a,b)=>a+b,0);
 let px=anchor==="center"?x-total/2:anchor==="right"?x-total:x;
 let out="";
 const now=Date.now();

 chars.forEach((ch,i)=>{
  const w=cw[i],id=`${key}-${i}`;
  if(!/\d/.test(ch)){
   out+=txt(ch,px+w/2,y,fs,color,900,w,"middle",`textLength="${w}" lengthAdjust="spacingAndGlyphs"`);
   px+=w;return;
  }

  let old=digits.get(id);
  if(!old||old.value!==ch){
   old={value:ch,previous:old?.value,time:now};
   digits.set(id,old);
  }

  const p=Math.min(1,(now-old.time)/550);
  const ease=1-Math.pow(1-p,3);
  const stroke=Math.max(.4,fs*.025);

  if(old.previous!==undefined&&p<1){
   const clip=`clip-${String(key).replace(/[^a-z0-9]/gi,"")}-${i}`;
   out+=`<svg x="${px}" y="${y-fs*.8}" width="${w}" height="${fs*1.6}" viewBox="0 0 ${w} ${fs*1.6}"><defs><clipPath id="${clip}"><rect width="${w}" height="${fs*1.6}"/></clipPath></defs><g clip-path="url(#${clip})">`;
   out+=`<text x="${w/2}" y="${fs*.8+ease*fs}" fill="${color}" stroke="${color}" stroke-width="${stroke}" paint-order="stroke" font-family="Inter" font-size="${fs}" font-weight="900" text-anchor="middle" dominant-baseline="middle" textLength="${w}" lengthAdjust="spacingAndGlyphs">${old.previous}</text>`;
   out+=`<text x="${w/2}" y="${fs*.8-(1-ease)*fs}" fill="${color}" stroke="${color}" stroke-width="${stroke}" paint-order="stroke" font-family="Inter" font-size="${fs}" font-weight="900" text-anchor="middle" dominant-baseline="middle" textLength="${w}" lengthAdjust="spacingAndGlyphs">${ch}</text></g></svg>`;
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
  }catch(e){console.error("Avatar load:",e.message);return"";}
 })();
 avatars.set(url,p);
 return p;
}

function defs(){
 return `<defs>
 <linearGradient id="background" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#111a35ed"/><stop offset=".8" stop-color="#070b19f5"/></linearGradient>
 <linearGradient id="cardGlow" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#873aff" stop-opacity=".09"/><stop offset=".5" stop-color="#873aff" stop-opacity="0"/><stop offset="1" stop-color="#148bff" stop-opacity=".05"/></linearGradient>
 <linearGradient id="progress"><stop offset="0" stop-color="#8b36ff"/><stop offset=".55" stop-color="#267bff"/><stop offset="1" stop-color="#20dfd0"/></linearGradient>
 <linearGradient id="bar" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#5420c7"/><stop offset="1" stop-color="#a63cff"/></linearGradient>
 <linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#18e9d9" stop-opacity=".35"/><stop offset="1" stop-color="#18e9d9" stop-opacity="0"/></linearGradient>
 <filter id="shadow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="8"/></filter>
 <clipPath id="lucanClip"><circle cx="78" cy="134" r="57"/></clipPath>
 </defs>`;
}

function panel(x,y,w,h,r=19,border=C.border){
 return rect(x,y,w,h,r,"url(#background)",border)+
 `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="url(#cardGlow)"/>`;
}

function profile(d){
 let o=panel(6,66,420,136,19,"#743dff");
 o+=`<circle cx="78" cy="134" r="59" fill="#168fff" opacity=".2" filter="url(#shadow)"/>`;
 if(d.avatar)o+=`<image href="${d.avatar}" x="21" y="77" width="114" height="114" preserveAspectRatio="xMidYMid slice" clip-path="url(#lucanClip)"/>`;
 o+=`<circle cx="78" cy="134" r="58" fill="none" stroke="${C.blue}" stroke-width="3"/>`;
 o+=txt(d.name,157,94,22,C.white,900,250);
 o+=txt(d.handle,158,119,11,C.muted,800,250);
 o+=txt("Jesus loves you! I hope every",158,142,13,"#dce5ff",800,245);
 o+=txt("video makes you smile!",158,158,13,"#dce5ff",800,245);
 o+=rect(157,174,102,24,8,"url(#progress)",null);
 o+=txt("ROAD TO 60M",208,186,10,C.white,900,95,"middle");
 return o;
}

function miniStats(d){
 let o=panel(6,214,420,240,19,"#245caa");
 o+=txt("MY CHANNEL",21,236,16,"#d7e5ff",900,140);
 o+=`<circle cx="309" cy="249" r="33" fill="#06102a" stroke="${C.blue}" stroke-width="2"/>`;
 o+=`<circle cx="309" cy="249" r="28" fill="none" stroke="#8b36ff" stroke-width="1"/>`;
 o+=txt("VY",309,245,23,C.white,900,48,"middle");
 o+=txt("STATS",309,262,8,C.teal,900,42,"middle");
 o+=txt(d.name||"VYStats",350,244,16,C.white,900,110);
 o+=txt(d.handle||"@vystatsyt",350,264,11,C.muted,800,110);
 o+=line(21,282,411,282);
 const groups=[["SUBSCRIBERS",d.freeEst,d.freeApi],["VIEWS",d.freeEstViews,d.freeApiViews],["VIDEOS",d.freeEstVideos,d.freeApiVideos]];
 groups.forEach((g,i)=>{
  const x=21+i*130;
  if(i)o+=line(x-9,292,x-9,440);
  o+=txt(g[0],x+55,307,11,"#b8caff",900,110,"middle");
  o+=txt("EST.",x,339,10,C.muted,900,35);
  o+=wheel(fmt(g[1]),x+112,339,17,C.white,78,"right",`mine-${i}-est`);
  o+=txt("API",x,372,10,C.muted,900,35);
  o+=wheel(fmt(g[2]),x+112,372,17,C.white,78,"right",`mine-${i}-api`);
 });
 return o;
}

function chart(values,x,y,w,h){
 if(values.length<2)return"";
 const lo=Math.min(...values),hi=Math.max(...values),range=hi-lo||1;
 const pts=values.map((v,i)=>`${x+i/(values.length-1)*w},${y+h-(v-lo)/range*h}`).join(" ");
 return `<polygon points="${x},${y+h} ${pts} ${x+w},${y+h}" fill="url(#chartGradient)"/>`+
 `<polyline points="${pts}" fill="none" stroke="${C.teal}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`;
}

function bars(values,x,y,w,h){
 const a=values.slice(-14),max=Math.max(1,...a.map(Math.abs)),gap=6,bw=Math.min(20,(w-gap*(a.length-1))/a.length);
 return a.map((v,i)=>{
  const bh=Math.max(8,Math.abs(v)/max*h);
  return `<rect x="${x+i*(bw+gap)}" y="${y+h-bh}" width="${bw}" height="${bh}" rx="5" fill="url(#bar)" opacity="${.55+.45*i/a.length}"/>`;
 }).join("");
}

function mainStats(a){
 const current=a.linear??a.est,goal=60000000;
 const remaining=current==null?null:Math.max(0,goal-current);
 const progress=current==null?0:Math.min(1,current/goal);
 const rate=history.rates.at(-1)||0;
 const x=[440,708.4,976.8],w=254.4,y=66,h=388;
 let o="";

 // Card 1: subscriber count
 o+=panel(x[0],y,w,h,19,"#287bff");
 o+=txt("↗",x[0]+42,106,27,C.blue,900,32,"middle");
 o+=txt("LUCAN · LIVE SUBSCRIBERS",x[0]+w/2+8,98,14,"#d7e3ff",900,225,"middle");
 o+=txt("(LINEAR ESTIMATE)",x[0]+w/2+8,119,14,"#d7e3ff",900,225,"middle");
 o+=wheel(fmt(current),x[0]+w/2,193,55,C.white,w-28,"center","lucan-count");
 o+=chart(history.subs.slice(-18),x[0]+15,225,w-30,67);
 o+=line(x[0]+15,322,x[0]+w-15,322);
 o+=line(x[0]+143,334,x[0]+143,438);
 o+=line(x[0]+207,334,x[0]+207,438);
 o+=txt("LINEAR ESTIMATE",x[0]+79,346,10,"#b9caff",900,125,"middle");
 o+=txt("HOURLY GAIN",x[0]+175,346,10,"#b9caff",900,85,"middle");
 o+=txt("DAILY GAIN",x[0]+230,346,10,"#b9caff",900,70,"middle");
 o+=wheel(fmt(current),x[0]+79,389,19,C.teal,125,"center","linear-stat");
 o+=wheel(fmt(a.hourly),x[0]+175,389,19,C.teal,85,"center","hourly-stat");
 o+=wheel(fmt(a.daily),x[0]+230,389,19,C.teal,70,"center","daily-stat");

 // Card 2: rate
 o+=panel(x[1],y,w,h,19,"#2869c9");
 o+=txt("ϟ",x[1]+48,106,29,C.blue,900,30,"middle");
 o+=txt("SUBS GAINED PER SEC",x[1]+w/2+7,106,15,"#d7e3ff",900,220,"middle");
 o+=txt(rate<0?"−":"+",x[1]+72,226,61,C.white,900,55,"middle");
 o+=wheel(Math.abs(rate).toFixed(2),x[1]+170,226,61,C.white,135,"center","rate-value");
 o+=bars(history.rates,x[1]+18,289,w-36,42);
 o+=txt("◉ LIVE AVERAGE",x[1]+w/2,416,12,C.teal,900,200,"middle");

 // Card 3: remaining
 o+=panel(x[2],y,w,h,19,"#793dff");
 o+=txt("⚑",x[2]+43,106,27,C.blue,900,30,"middle");
 o+=txt("SUBSCRIBERS REMAINING",x[2]+w/2+8,98,14,"#d7e3ff",900,225,"middle");
 o+=txt("TO 60,000,000",x[2]+w/2+8,119,14,"#d7e3ff",900,225,"middle");
 o+=wheel(fmt(remaining),x[2]+w/2,193,55,C.white,w-28,"center","remaining");
 o+=rect(x[2]+15,275,w-30,15,9,"#111f43",null);
 o+=rect(x[2]+15,275,(w-30)*progress,15,9,"url(#progress)",null);
 o+=txt("ROAD TO 60M",x[2]+15,306,10,"#b9caff",900,110);
 o+=wheel((progress*100).toFixed(1)+"%",x[2]+w-15,306,10,"#b9caff",65,"right","goal-percent");
 o+=txt("◎ SUBSCRIBERS LEFT",x[2]+w/2,416,12,C.teal,900,220,"middle");
 return o;
}

function sources(a,b){
 const left=21,labelW=130,gap=9,colW=(1238-labelW-gap*4)/4;
 const xs=Array.from({length:4},(_,i)=>left+labelW+gap*(i+1)+colW*i);
 let o=panel(6,464,1268,210,19,"#4268a8");
 o+=txt("▤  DATA SOURCES",23,493,16,"#d6e3ff",900,260);
 o+=txt("● LIVE · BOTH PROVIDERS",1257,493,11,C.teal,900,180,"end");
 o+=line(21,516,1259,516);
 ["SCTools Est.","SCTools API","FreeWebTools Est.","FreeWebTools API"].forEach((v,i)=>o+=txt(v,xs[i]+colW/2,536,13,"#d6e3ff",900,colW,"middle"));
 const rows=[
  ["SUBSCRIBERS",a.est,a.api,b.freeEst,b.freeApi],
  ["TOTAL VIEWS",a.views,a.apiViews,b.freeEstViews,b.freeApiViews],
  ["VIDEOS",a.videos,a.apiVideos,b.freeEstVideos,b.freeApiVideos]
 ];
 rows.forEach((r,i)=>{
  const yy=545+i*42;
  o+=txt(r[0],left,yy+19,10,"#799bff",900,labelW);
  for(let j=0;j<4;j++){
   o+=rect(xs[j],yy,colW,38,8,"#080d1b","#26375b");
   o+=wheel(fmt(r[j+1]),xs[j]+10,yy+19,20,j%2?"#c4d1ff":C.teal,colW-20,"start",`source-${i}-${j}`);
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
 s+=txt("LUCAN PEVIDOR",19,25,23,C.white,900,260);
 s+=txt("| ROAD TO 60M",194,25,23,C.purple,900,250);
 s+=txt("● LIVE",1258,25,17,C.red,900,100,"end");

 s+=profile({...a,avatar:aa});
 s+=miniStats({...b,avatar:bb});
 s+=mainStats(a);
 s+=sources(a,b);

 s+=line(6,684,1274,684,"#ffffff18");
 s+=txt("↻ UPDATED "+new Date().toLocaleTimeString(),18,706,12,"#b9caff",900,300);
 s+=txt("● CONNECTED",1258,706,12,C.teal,900,120,"end");
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
  }finally{benchmarkActive=false;}
 });
}

module.exports={renderDashboard,renderRawFrame,attach};
