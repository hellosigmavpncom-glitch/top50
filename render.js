
const {Resvg}=require("@resvg/resvg-js");
const fs=require("fs"),path=require("path");
const W=1280,H=720,FPS=15,FRAME_MS=1000/FPS;
const C={bg:"#050713",blue:"#27a9ff",purple:"#8b36ff",teal:"#25e5c0",white:"#f5f7ff",muted:"#aab8df",border:"#273a68",red:"#ff4267"};
const DIR="/tmp/inter-static",WEIGHTS=["Regular","Medium","SemiBold","Bold","ExtraBold","Black"];
const FONT={loadSystemFonts:false,fontFiles:WEIGHTS.map(n=>path.join(DIR,`Inter-${n}.ttf`)),defaultFontFamily:"Inter"};
const nf=new Intl.NumberFormat("en-US"),avatars=new Map(),numberState=new Map();
const history={subs:[],rates:[],previous:null,last:0};
let queue=Promise.resolve(),benchmarkActive=false,lastTiming={};

const ms=t=>Number(process.hrtime.bigint()-t)/1e6;
const esc=s=>String(s??"—").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&apos;"}[c]));
const fmt=v=>v==null||!Number.isFinite(Number(v))?"—":nf.format(Math.round(Number(v)));
const num=(o,...keys)=>{for(const k of keys)if(o?.[k]!=null&&o[k]!==""&&Number.isFinite(Number(o[k])))return Number(o[k]);return null;};

// Approximate Inter glyph advances, used only to fit text without stretching it.
function units(s){
 return [...String(s??"—")].reduce((n,c)=>n+(
  /[0-9]/.test(c)?.62:
  /[A-Z]/.test(c)?.66:
  /[a-z]/.test(c)?({i:.25,l:.28,j:.3,f:.34,r:.37,t:.37,m:.83,w:.75}. [c]??.53):
  c===","||c==="."||c===":"? .25:
  c===" "?.28:c==="%"?.82:c==="+"?.62:c==="−"||c==="-"?.4:.58
 ),0);
}
function fitSize(s,size,max){return max===Infinity?size:Math.min(size,max/Math.max(.1,units(s)));}
function txt(v,x,y,size=16,color=C.white,weight=700,max=Infinity,anchor="start",extra=""){
 const s=esc(v),fs=Math.max(7,fitSize(v,size,max));
 return `<text x="${x}" y="${y}" fill="${color}" font-family="Inter" font-size="${fs}" font-weight="${weight}" text-anchor="${anchor}" dominant-baseline="middle" font-variant-numeric="tabular-nums" ${extra}>${s}</text>`;
}

// Single-string number animation: no duplicate old digits, guessed digit positions or stretched glyphs.
function wheel(v,x,y,size=20,color=C.white,max=Infinity,anchor="start",key=""){
 const s=String(v??"—"),fs=Math.max(7,fitSize(s,size,max)),now=Date.now();
 let st=numberState.get(key);
 if(!st||st.value!==s){st={value:s,time:now};numberState.set(key,st);}
 const p=Math.min(1,(now-st.time)/190),dy=(1-(1-Math.pow(1-p,3)))*fs*.35;
 const cw=max===Infinity?1800:max,cx=anchor==="center"?x-cw/2:anchor==="right"?x-cw:x;
 const id="clip-"+String(key).replace(/[^a-z0-9]/gi,"");
 return `<defs><clipPath id="${id}"><rect x="${cx}" y="${y-fs*1.2}" width="${cw}" height="${fs*2.4}"/></clipPath></defs><g clip-path="url(#${id})"><text x="${x}" y="${y+dy}" fill="${color}" font-family="Inter" font-size="${fs}" font-weight="900" text-anchor="${anchor}" dominant-baseline="middle" font-variant-numeric="tabular-nums" opacity="${.55+.45*p}">${esc(s)}</text></g>`;
}

async function ensureFont(){
 await fs.promises.mkdir(DIR,{recursive:true});
 for(const n of WEIGHTS){
  const file=path.join(DIR,`Inter-${n}.ttf`);
  try{if((await fs.promises.stat(file)).size>100000)continue;}catch{}
  const r=await fetch(`https://unpkg.com/inter-font@3.19.0/ttf/Inter-${n}.ttf`,{signal:AbortSignal.timeout(30000)});
  if(!r.ok)throw Error(`Inter ${n} download failed: HTTP ${r.status}`);
  const b=Buffer.from(await r.arrayBuffer());
  if(b.length<100000)throw Error(`Invalid Inter ${n} font`);
  await fs.promises.writeFile(file,b);
 }
}

function getStats(d={}){
 const s=d.sctools||{},f=d.freewebtools||{},e=f.estimation||{},api=f.api||{},ch=d.channel||{};
 return{
  name:ch.name||s.name||f.name||"Lucan Pevidor",
  handle:ch.handle||"@LucanPevidor",
  avatar:ch.avatar||s.avatar||f.avatar||f.thumbnail||"",
  linear:num(s,"linearSubscribers","linearCount","estSubscribers","estCount"),
  est:num(s,"estSubscribers","estCount"),api:num(s,"apiSubscribers","apiCount"),
  views:num(s,"estViews","estimatedViews","viewCount"),apiViews:num(s,"apiViews","apiViewCount"),
  videos:num(s,"estVideos","estimatedVideos"),apiVideos:num(s,"apiVideos","apiVideoCount","videoCount"),
  hourly:num(s,"hourly")??num(s.averages,"hourly"),
  daily:num(s,"daily")??num(s.averages,"daily"),
  freeEst:num(f,"estimatedSubscribers","estimatedCount","estSubscribers","estCount")??num(e,"estimated_count","estimatedCount","subscribers"),
  freeApi:num(f,"apiSubscribers","apiCount","subscriberCount")??num(api,"subscribers","subscriberCount"),
  freeEstViews:num(f,"estimatedViews","estViews","viewCount")??num(e,"views","viewCount"),
  freeApiViews:num(f,"apiViews","apiViewCount")??num(api,"views","viewCount"),
  freeEstVideos:num(f,"estimatedVideos","estVideos")??num(e,"videos","videoCount"),
  freeApiVideos:num(f,"apiVideos","apiVideoCount","videoCount")??num(api,"videos","videoCount")
 };
}

const rect=(x,y,w,h,r=12,fill="#111a35",stroke=C.border,sw=1)=>
 `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}"${stroke?` stroke="${stroke}" stroke-width="${sw}"`:""}/>`;
const line=(x,y,x2,y2,color="#ffffff20",width=1)=>
 `<path d="M${x} ${y}L${x2} ${y2}" fill="none" stroke="${color}" stroke-width="${width}"/>`;

async function avatar(url){
 if(!url)return"";
 if(avatars.has(url))return avatars.get(url);
 const task=(async()=>{
  try{
   const r=await fetch(url,{signal:AbortSignal.timeout(7000)});
   if(!r.ok)throw Error(`HTTP ${r.status}`);
   const b=Buffer.from(await r.arrayBuffer());
   if(b.length>2e6)throw Error("Image too large");
   return `data:${r.headers.get("content-type")||"image/jpeg"};base64,${b.toString("base64")}`;
  }catch(e){console.error("Avatar:",e.message);return"";}
 })();
 avatars.set(url,task);return task;
}

function icon(type,x,y,color=C.blue,size=22){
 const s=size;
 if(type==="arrow")return `<path d="M${x-s*.4} ${y+s*.35}L${x+s*.35} ${y-s*.4}M${x-s*.35} ${y-s*.4}H${x+s*.35}V${y+s*.3}" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`;
 if(type==="bolt")return `<path d="M${x+s*.1} ${y-s*.5}L${x-s*.3} ${y+s*.05}H${x}L${x-s*.12} ${y+s*.5}L${x+s*.35} ${y-s*.12}H${x+s*.08}Z" fill="${color}"/>`;
 if(type==="flag")return `<path d="M${x-s*.32} ${y-s*.48}V${y+s*.5}" stroke="${color}" stroke-width="3"/><path d="M${x-s*.28} ${y-s*.43}L${x+s*.4} ${y-s*.3}L${x-s*.28} ${y+s*.02}Z" fill="${color}"/>`;
 if(type==="bars")return [0,1,2,3].map(i=>`<rect x="${x-s*.45}" y="${y-s*.4+i*s*.24}" width="${s*.9}" height="${s*.13}" rx="1" fill="${color}"/>`).join("");
 if(type==="table")return `<rect x="${x-s*.42}" y="${y-s*.42}" width="${s*.84}" height="${s*.84}" rx="1" fill="none" stroke="${color}" stroke-width="2"/><path d="M${x-s*.2} ${y-s*.25}H${x+s*.25}M${x-s*.2} ${y}H${x+s*.25}M${x-s*.2} ${y+s*.25}H${x+s*.25}" stroke="${color}" stroke-width="2"/>`;
 return"";
}

function defs(){
 return `<defs>
 <radialGradient id="pageBackground" cx="50%" cy="-20%" r="100%"><stop offset="0%" stop-color="#19265a"/><stop offset="48%" stop-color="#080b1b"/><stop offset="100%" stop-color="#040610"/></radialGradient>
 <linearGradient id="background" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#111a35" stop-opacity=".93"/><stop offset="80%" stop-color="#070b19" stop-opacity=".96"/></linearGradient>
 <linearGradient id="cardGlow" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#873aff" stop-opacity=".07"/><stop offset=".45" stop-color="#873aff" stop-opacity="0"/><stop offset="100%" stop-color="#148bff" stop-opacity=".045"/></linearGradient>
 <linearGradient id="progress"><stop offset="0%" stop-color="#8b36ff"/><stop offset="55%" stop-color="#267bff"/><stop offset="100%" stop-color="#20dfd0"/></linearGradient>
 <linearGradient id="bar" x1="0" y1="1" x2="0" y2="0"><stop offset="0%" stop-color="#5420c7"/><stop offset="100%" stop-color="#a63cff"/></linearGradient>
 <linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#18e9d9" stop-opacity=".35"/><stop offset="100%" stop-color="#18e9d9" stop-opacity="0"/></linearGradient>
 <filter id="shadow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="8"/></filter>
 <clipPath id="lucanClip"><circle cx="79.4" cy="134" r="57"/></clipPath>
 <clipPath id="mineClip"><circle cx="279.4" cy="261" r="31"/></clipPath>
 </defs>`;
}
function panel(x,y,w,h,r=19,border=C.border){
 return rect(x,y,w,h,r,"url(#background)",border)+`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="url(#cardGlow)"/>`;
}

function profile(d){
 let o=panel(6.4,66,420,136,19,"#743dff");
 o+=`<circle cx="79.4" cy="134" r="62" fill="#168fff" opacity=".2" filter="url(#shadow)"/>`;
 if(d.avatar)o+=`<image href="${d.avatar}" x="19.4" y="74" width="120" height="120" preserveAspectRatio="xMidYMid slice" clip-path="url(#lucanClip)"/>`;
 o+=`<circle cx="79.4" cy="134" r="58.5" fill="none" stroke="${C.blue}" stroke-width="3"/>`;
 o+=txt(d.name,153.4,96,22,C.white,900,245);
 o+=txt(d.handle,153.4,119,11,C.muted,800,245);
 o+=txt("Jesus loves you! I hope every",153.4,143,13,"#dce5ff",700,245);
 o+=txt("video makes you smile!",153.4,159,13,"#dce5ff",700,245);
 o+=rect(153.4,174,102,24,8,"url(#progress)",null);
 o+=txt("ROAD TO 60M",204.4,186,10,C.white,900,95,"middle");
 return o;
}

function miniStats(d){
 let o=panel(6.4,214,420,240,19,"#245caa");
 o+=txt("MY CHANNEL",20.4,238,16,"#d7e5ff",900,140);
 if(d.avatar)o+=`<image href="${d.avatar}" x="246.4" y="228" width="66" height="66" preserveAspectRatio="xMidYMid slice" clip-path="url(#mineClip)"/>`;
 o+=`<circle cx="279.4" cy="261" r="32" fill="none" stroke="${C.blue}" stroke-width="2"/>`;
 o+=txt(d.name||"VYStats",322.4,249,16,C.white,900,90);
 o+=txt(d.handle||"@vystatsyt",322.4,270,11,C.muted,800,90);
 o+=line(20.4,304,412.4,304);
 const groups=[["SUBSCRIBERS",d.freeEst,d.freeApi],["VIEWS",d.freeEstViews,d.freeApiViews],["VIDEOS",d.freeEstVideos,d.freeApiVideos]];
 groups.forEach((g,i)=>{
  const left=20.4+i*130.67,center=left+65.33,right=left+124;
  if(i)o+=line(left,315,left,440);
  o+=txt(g[0],center,327,11,"#b8caff",900,120,"middle");
  o+=txt("EST.",left+2,362,10,C.muted,900,35);
  o+=wheel(fmt(g[1]),right,362,15,C.white,87,"right",`mine-${i}-est`);
  o+=txt("API",left+2,395,10,C.muted,900,35);
  o+=wheel(fmt(g[2]),right,395,15,C.white,87,"right",`mine-${i}-api`);
 });
 return o;
}

function chart(values,x,y,w,h){
 if(values.length<2)return"";
 const lo=Math.min(...values),range=Math.max(...values)-lo||1;
 const pts=values.map((v,i)=>`${x+i/(values.length-1)*w},${y+h-(v-lo)/range*h}`).join(" ");
 return `<polygon points="${x},${y+h} ${pts} ${x+w},${y+h}" fill="url(#chartGradient)"/><polyline points="${pts}" fill="none" stroke="${C.teal}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`;
}
function bars(values,x,y,w,h){
 const a=values.slice(-14);if(!a.length)return"";
 const max=Math.max(1,...a.map(Math.abs)),gap=6,bw=Math.min(20,(w-gap*(a.length-1))/a.length);
 return a.map((v,i)=>{const bh=Math.max(8,Math.abs(v)/max*h);return `<rect x="${x+i*(bw+gap)}" y="${y+h-bh}" width="${bw}" height="${bh}" rx="5" fill="url(#bar)" opacity="${.55+.45*i/a.length}"/>`;}).join("");
}

function mainStats(a){
 const current=a.linear??a.est,goal=60000000,remaining=current==null?null:Math.max(0,goal-current);
 const progress=current==null?0:Math.min(1,current/goal),rate=history.rates.at(-1)||0;
 const x=[440.4,722.8,1005.2],w=268.4,y=66,h=388;
 let o="";

 // Subscriber count and chart.
 o+=panel(x[0],y,w,h,19,"#287bff");
 o+=icon("arrow",x[0]+43,117,C.blue,23);
 o+=txt("LUCAN · LIVE SUBSCRIBERS",x[0]+w/2+8,108,14,"#d7e3ff",900,230,"middle");
 o+=txt("(LINEAR ESTIMATE)",x[0]+w/2+8,128,14,"#d7e3ff",900,210,"middle");
 o+=wheel(fmt(current),x[0]+w/2,194,52,C.white,w-30,"center","lucan-count");
 o+=chart(history.subs.slice(-18),x[0]+15,228,w-30,75);
 o+=line(x[0]+15,322,x[0]+w-15,322);
 const inner=x[0]+15,usable=w-30,tracks=[usable*1.3/3,usable*.85/3,usable*.85/3];
 const centers=[inner+tracks[0]/2,inner+tracks[0]+tracks[1]/2,inner+tracks[0]+tracks[1]+tracks[2]/2];
 o+=line(inner+tracks[0],334,inner+tracks[0],438);
 o+=line(inner+tracks[0]+tracks[1],334,inner+tracks[0]+tracks[1],438);
 ["LINEAR ESTIMATE","HOURLY GAIN","DAILY GAIN"].forEach((v,i)=>o+=txt(v,centers[i],348,9,"#b9caff",800,tracks[i]-3,"middle"));
 [current,a.hourly,a.daily].forEach((v,i)=>o+=wheel(fmt(v),centers[i],390,16,C.teal,tracks[i]-5,"center",`metric-${i}`));

 // Rate card: render the sign and value as one fitted string.
 o+=panel(x[1],y,w,h,19,"#2869c9");
 o+=icon("bolt",x[1]+48,117,C.blue,24);
 o+=txt("SUBS GAINED PER SEC",x[1]+w/2+8,117,15,"#d7e3ff",900,225,"middle");
 o+=wheel(`${rate<0?"−":"+"} ${Math.abs(rate).toFixed(2)}`,x[1]+w/2,226,57,C.white,w-36,"center","rate-value");
 o+=bars(history.rates,x[1]+18,290,w-36,55);
 o+=icon("bars",x[1]+88,416,C.teal,13);
 o+=txt("LIVE AVERAGE",x[1]+w/2+8,416,12,C.teal,900,145,"middle");

 // Goal card.
 o+=panel(x[2],y,w,h,19,"#793dff");
 o+=icon("flag",x[2]+43,117,C.blue,25);
 o+=txt("SUBSCRIBERS REMAINING",x[2]+w/2+8,108,14,"#d7e3ff",900,230,"middle");
 o+=txt("TO 60,000,000",x[2]+w/2+8,128,14,"#d7e3ff",900,210,"middle");
 o+=wheel(fmt(remaining),x[2]+w/2,194,52,C.white,w-30,"center","remaining");
 o+=rect(x[2]+15,275,w-30,15,9,"#111f43",null);
 o+=rect(x[2]+15,275,(w-30)*progress,15,9,"url(#progress)",null);
 o+=txt("ROAD TO 60M",x[2]+15,306,10,"#b9caff",900,110);
 o+=wheel((progress*100).toFixed(1)+"%",x[2]+w-15,306,10,"#b9caff",70,"right","goal-percent");
 o+=icon("bars",x[2]+85,416,C.teal,13);
 o+=txt("SUBSCRIBERS LEFT",x[2]+w/2+8,416,12,C.teal,900,165,"middle");
 return o;
}

function sources(a,b){
 const left=20.4,labelW=130,gap=9,colW=(1239.2-labelW-gap*4)/4;
 const xs=Array.from({length:4},(_,i)=>left+labelW+gap*(i+1)+colW*i);
 let o=panel(6.4,464,1267.2,210,19,"#4268a8");
 o+=icon("table",29,488,"#d6e3ff",14);
 o+=txt("DATA SOURCES",42,488,16,"#d6e3ff",900,240);
 o+=txt("● LIVE · BOTH PROVIDERS",1259.6,488,11,C.teal,900,180,"end");
 o+=line(20.4,504,1259.6,504);
 ["SCTools Est.","SCTools API","FreeWebTools Est.","FreeWebTools API"].forEach((v,i)=>o+=txt(v,xs[i]+colW/2,524,13,"#d6e3ff",900,colW,"middle"));
 const rows=[["SUBSCRIBERS",a.est,a.api,b.freeEst,b.freeApi],["TOTAL VIEWS",a.views,a.apiViews,b.freeEstViews,b.freeApiViews],["VIDEOS",a.videos,a.apiVideos,b.freeEstVideos,b.freeApiVideos]];
 rows.forEach((r,i)=>{
  const yy=535+i*42;
  o+=txt(r[0],left,yy+19,10,"#799bff",900,labelW);
  for(let j=0;j<4;j++){
   o+=rect(xs[j],yy,colW,38,8,"#080d1b","#26375b");
   o+=wheel(fmt(r[j+1]),xs[j]+10,yy+19,19,j%2?"#c4d1ff":C.teal,colW-20,"start",`source-${i}-${j}`);
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
  history.subs.push(current);history.previous=current;history.last=now;
  if(history.subs.length>60)history.subs.shift();
  if(history.rates.length>14)history.rates.shift();
 }

 let s=`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`;
 s+=defs()+`<rect width="${W}" height="${H}" fill="url(#pageBackground)"/>`;
 s+=txt("LUCAN PEVIDOR",18.4,32,23,C.white,900,180);
 s+=txt("|",199,32,23,C.purple,900,12);
 s+=txt("ROAD TO 60M",214,32,23,C.purple,900,220);
 s+=txt("● LIVE",1259.6,32,17,C.red,900,100,"end");
 s+=profile({...a,avatar:aa})+miniStats({...b,avatar:bb})+mainStats(a)+sources(a,b);
 s+=line(6.4,684,1273.6,684,"#ffffff18");
 s+=txt("↻ UPDATED "+new Date().toLocaleTimeString(),18.4,698,12,"#b9caff",800,300);
 s+=txt("● CONNECTED",1259.6,698,12,C.teal,900,120,"end");
 return s+"</svg>";
}

async function renderInternal(data={},mode="raw"){
 const start=process.hrtime.bigint(),svg=await buildSVG(data),drawStart=process.hrtime.bigint();
 const rendered=new Resvg(svg,{fitTo:{mode:"original"},font:FONT}).render();
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
 const s=[...a].sort((x,y)=>x-y),avg=a.reduce((x,y)=>x+y,0)/a.length;
 const p=q=>s[Math.min(s.length-1,Math.ceil(s.length*q)-1)],r=n=>+n.toFixed(2);
 return{averageMs:r(avg),medianMs:r(p(.5)),p95Ms:r(p(.95)),minMs:r(s[0]),maxMs:r(s.at(-1))};
}
async function freshBenchmark(getData){
 const duration=10000,interval=BigInt(Math.round(FRAME_MS*1e6));
 const start=process.hrtime.bigint(),before=process.memoryUsage(),times=[];
 let frames=0,missed=0,maxLate=0,checksum=0,firstSize=0,next=start+interval;
 const cpu=process.cpuUsage();
 while(Number(process.hrtime.bigint()-start)/1e6<duration){
  const t=process.hrtime.bigint(),data=await getData(),frame=await renderRawFrame(data),done=process.hrtime.bigint();
  times.push(Number(done-t)/1e6);frames++;firstSize=frame.length;
  checksum=(checksum+frame[(frames*997)%frame.length])>>>0;
  if(done>next){
   const late=done-next,slots=Number(late/interval)+1;
   missed+=slots;maxLate=Math.max(maxLate,Number(late)/1e6);next+=BigInt(slots+1)*interval;
  }else next+=interval;
 }
 const after=process.memoryUsage(),used=process.cpuUsage(cpu),elapsed=ms(start),mib=n=>+(n/1048576).toFixed(2);
 return{
  renderer:"@resvg/resvg-js",mode:"fresh-render-each-frame",resolution:`${W}x${H}`,fpsTarget:FPS,
  frameIntervalMs:+FRAME_MS.toFixed(3),durationMs:+elapsed.toFixed(2),frames,
  frameSizeBytes:firstSize,frameSizeMiB:mib(firstSize),freshRenderFPS:+(frames/(elapsed/1000)).toFixed(2),
  renderTime:stats(times),missedDeadlines:missed,missedDeadlinePercent:+(missed/Math.max(1,frames+missed)*100).toFixed(2),
  maxLatenessMs:+maxLate.toFixed(2),
  cpu:{userMs:+(used.user/1000).toFixed(2),systemMs:+(used.system/1000).toFixed(2)},
  memory:{heapBeforeMiB:mib(before.heapUsed),heapAfterMiB:mib(after.heapUsed),externalBeforeMiB:mib(before.external),externalAfterMiB:mib(after.external),rssBeforeMiB:mib(before.rss),rssAfterMiB:mib(after.rss)},
  checksum
 };
}
function attach(app,getData){
 app.get("/api/renderer/preview.png",async(req,res)=>{
  if(benchmarkActive)return res.status(503).send("Benchmark running; retry shortly");
  try{
   const png=await renderDashboard(await getData());
   res.set({"Content-Type":"image/png","Cache-Control":"no-store, no-cache, must-revalidate"}).send(png);
  }catch(e){console.error("Renderer error:",e.stack||e.message);res.status(500).send("Renderer failed");}
 });
 app.get("/api/renderer/benchmark",async(req,res)=>{
  if(benchmarkActive)return res.status(409).json({error:"Benchmark already running"});
  benchmarkActive=true;
  try{res.set("Cache-Control","no-store").json(await freshBenchmark(getData));}
  catch(e){console.error("Fresh renderer benchmark:",e.stack||e.message);if(!res.headersSent)res.status(500).json({error:"Benchmark failed",message:e.message});}
  finally{benchmarkActive=false;}
 });
}
module.exports={renderDashboard,renderRawFrame,attach};
