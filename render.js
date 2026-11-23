const {Resvg}=require("@resvg/resvg-js");
const https=require("https");
const W=1280,H=720;
const C={bg:"#050713",panel:"#0b1024",panel2:"#101832",border:"#273a68",blue:"#27a9ff",purple:"#8b36ff",teal:"#25e5c0",white:"#f5f7ff",muted:"#aab8df",red:"#ff4267"};
const fmt=new Intl.NumberFormat("en-US");
const history={subs:[],rates:[],last:0,previous:null};
const avatars={},odometer={};
let lastTiming={drawMs:0,outputMs:0,totalMs:0},benchmarkActive=false,queue=Promise.resolve(),rawCache=null;

const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&apos;"}[c]));
const num=(o,...keys)=>{for(const k of keys)if(o?.[k]!=null&&o[k]!==""&&Number.isFinite(Number(o[k])))return Number(o[k]);return null};
const ms=t=>Number(process.hrtime.bigint()-t)/1e6;
const fmtNum=v=>v==null||!Number.isFinite(Number(v))?"—":fmt.format(Math.round(Number(v)));
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const n=v=>Number(v)||0;

function getStats(d={}){
 const s=d.sctools||{},f=d.freewebtools||{},e=f.estimation||{};
 return{
  name:d.channel?.name||s.name||"Channel",handle:d.channel?.handle||"",
  avatar:d.channel?.avatar||s.avatar||f.thumbnail||"",
  linear:num(s,"linearSubscribers","linearCount","estSubscribers","estCount"),
  est:num(s,"estSubscribers","estCount"),api:num(s,"apiSubscribers","apiCount"),
  views:num(s,"estViews","viewCount"),apiViews:num(s,"apiViews"),
  videos:num(s,"estVideos"),apiVideos:num(s,"apiVideos","videoCount"),
  hourly:num(s,"hourly")??num(s.averages,"hourly")??num(f,"hourly"),
  daily:num(s,"daily")??num(s.averages,"daily")??num(f,"daily"),
  freeEst:num(f,"estimatedSubscribers")??num(e,"estimated_count"),
  freeApi:num(f,"apiSubscribers","subscriberCount"),
  freeEstViews:num(f,"estimatedViews"),freeApiViews:num(f,"viewCount"),
  freeEstVideos:num(f,"estimatedVideos"),freeApiVideos:num(f,"videoCount")
 };
}

async function getAvatar(url){
 if(!url)return "";
 if(avatars[url])return avatars[url];
 avatars[url]=fetch(url).then(async r=>{
  if(!r.ok)throw Error("Avatar HTTP "+r.status);
  const b=Buffer.from(await r.arrayBuffer()),type=r.headers.get("content-type")||"image/jpeg";
  return `data:${type};base64,${b.toString("base64")}`;
 }).catch(()=> "");
 return avatars[url];
}

const S=[];
const add=s=>S.push(s);
function rect(x,y,w,h,r=12,fill=C.panel,stroke=C.border){
 add(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}"${stroke?` stroke="${stroke}" stroke-width="1"`:""}/>`);
}
function line(x1,y1,x2,y2,color="#ffffff20",width=1){
 add(`<path d="M${x1} ${y1}L${x2} ${y2}" stroke="${color}" stroke-width="${width}" fill="none"/>`);
}
function text(v,x,y,size=16,color=C.white,weight=700,max=Infinity,align="start"){
 const s=esc(v??"—");
 add(`<text x="${x}" y="${y}" font-size="${size}" font-weight="${weight}" fill="${color}" text-anchor="${align}" dominant-baseline="middle"${Number.isFinite(max)?` textLength="${Math.max(8,max)}" lengthAdjust="spacingAndGlyphs"`:""}>${s}</text>`);
}
function odo(value,x,y,size=16,color=C.white,weight=900,max=Infinity,align="start",key=""){
 const s=String(value??"—");
 if(!/\d/.test(s)){text(s,x,y,size,color,weight,max,align);return;}
 const charW=size*.59,total=s.length*charW;
 let left=align==="center"?x-total/2:align==="right"?x-total:x;
 const now=Date.now(),duration=1050;
 let st=odometer[key];
 if(!st||st.to!==s){st={from:st&&st.to.length===s.length?st.to:s,to:s,start:now};odometer[key]=st;}
 const p=clamp((now-st.start)/duration,0,1),ease=1-Math.pow(1-p,3);
 let at=left;
 for(let i=0;i<s.length;i++){
  const ch=s[i],old=st.from[i]??ch;
  if(/\d/.test(ch)&&old!==ch&&p<1){
   let a=Number(old),b=Number(ch),delta=b-a;
   if(delta<0)delta+=10;
   if(delta>5)delta-=10;
   const offset=(a+delta*ease)*size;
   add(`<svg x="${at}" y="${y-size*.63}" width="${charW}" height="${size*1.26}" viewBox="0 0 ${charW} ${size*1.26}" overflow="hidden"><g transform="translate(0 ${size*.63-offset})">`);
   for(let j=-1;j<=11;j++)add(`<text x="${charW/2}" y="${j*size+size*.5}" font-size="${size}" font-weight="${weight}" fill="${color}" text-anchor="middle" dominant-baseline="middle">${((j%10)+10)%10}</text>`);
   add("</g></svg>");
  }else text(ch,at+charW/2,y,size,color,weight,charW,"center");
  at+=charW;
 }
}
function icon(type,x,y,size,color){
 const paths={arrow:`M${x-size*.35} ${y+size*.3}L${x+size*.3} ${y-size*.35}M${x} ${y-size*.35}H${x+size*.3}V${y}`,bolt:`M${x+size*.08} ${y-size*.45}L${x-size*.2} ${y+size*.04}H${x+size*.04}L${x-size*.08} ${y+size*.45}L${x+size*.28} ${y-size*.12}H${x+size*.04}Z`,flag:`M${x-size*.25} ${y+size*.43}V${y-size*.45}L${x+size*.3} ${y-size*.28}L${x-size*.02} ${y-size*.04}L${x-size*.25} ${y-size*.1}`,data:`M${x-size*.36} ${y-size*.36}H${x+size*.36}V${y+size*.36}H${x-size*.36}ZM${x-size*.36} ${y-size*.08}H${x+size*.36}M${x-size*.36} ${y+size*.18}H${x+size*.36}`};
 add(`<path d="${paths[type]||paths.arrow}" stroke="${color}" stroke-width="2.2" fill="${type==="bolt"?color:"none"}" stroke-linecap="round" stroke-linejoin="round"/>`);
}
function avatar(url,x,y,size,border=C.blue){
 if(url)add(`<defs><clipPath id="av${x}"><circle cx="${x+size/2}" cy="${y+size/2}" r="${size/2-2}"/></clipPath></defs><circle cx="${x+size/2}" cy="${y+size/2}" r="${size/2}" fill="${C.panel}" stroke="${border}" stroke-width="2"/><image href="${esc(url)}" x="${x}" y="${y}" width="${size}" height="${size}" preserveAspectRatio="xMidYMid slice" clip-path="url(#av${x})"/>`);
 else add(`<circle cx="${x+size/2}" cy="${y+size/2}" r="${size/2}" fill="${C.panel2}" stroke="${border}" stroke-width="2"/>`);
}
function header(){
 rect(8,8,1264,48,10,C.panel2,null);
 text("LUCAN PEVIDOR",22,32,19,C.white,900,180);
 text("| ROAD TO 60M",198,32,19,C.purple,900,230);
 add(`<circle cx="1212" cy="32" r="5" fill="${C.red}"/>`);
 text("LIVE",1225,32,15,C.red,900,50);
}
function profile(d){
 rect(8,66,420,136,19,"#0b1024","#743dff");
 avatar(d.avatar,20,74,120);
 text(d.name,154,102,21,C.white,900,258);
 text(d.handle||"@LucanPevidor",154,126,11,C.muted,800,255);
 text("Jesus loves you! I hope every",154,148,12,"#dce5ff",800,258);
 text("video makes you smile!",154,164,12,"#dce5ff",800,258);
 rect(154,176,96,18,7,"#5423c5",null);
 text("ROAD TO 60M",202,185,9,C.white,900,90,"center");
}
function miniStats(d){
 rect(8,214,420,240,19,"#0b1024","#245caa");
 text("MY CHANNEL",22,242,15,"#d7e5ff",900,120);
 avatar(d.avatar,248,226,66);
 text(d.name||"VYStats",326,246,15,C.white,900,90);
 text(d.handle||"@vystatsyt",326,268,10,C.muted,800,90);
 line(22,294,414,294);
 [["SUBSCRIBERS",d.freeEst,d.freeApi],["VIEWS",d.freeEstViews,d.freeApiViews],["VIDEOS",d.freeEstVideos,d.freeApiVideos]].forEach((c,i)=>{
  const x=22+i*132;if(i)line(x-8,306,x-8,440);
  text(c[0],x+58,324,10,"#b8caff",900,116,"center");
  odo(fmtNum(c[1]),x+116,354,15,C.white,900,100,"right",`mini-${i}-est`);
  odo(fmtNum(c[2]),x+116,389,15,C.white,900,100,"right",`mini-${i}-api`);
 });
}
function mainCard(x,title,accent,type){
 rect(x,66,267,388,19,"#0b1024",accent);
 add(`<rect x="${x+1}" y="67" width="265" height="386" rx="18" fill="url(#fade${x})"/>`);
 icon(type,x+24,112,15,accent);
 text(title,x+38,112,14,"#d7e3ff",900,210);
}
function chart(values,x,y,w,h){
 if(values.length<2)return;
 const min=Math.min(...values),max=Math.max(...values),range=max-min||1;
 const pts=values.map((v,i)=>`${x+i/(values.length-1)*w},${y+h-(v-min)/range*h}`).join(" ");
 add(`<polygon points="${x},${y+h} ${pts} ${x+w},${y+h}" fill="#18e9d933"/>`);
 add(`<polyline points="${pts}" fill="none" stroke="${C.teal}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>`);
}
function bars(values,x,y,w,h){
 const n=Math.min(values.length,14);if(!n)return;
 const gap=6,bw=Math.min(20,(w-gap*(n-1))/n),total=n*bw+(n-1)*gap,start=x+(w-total)/2;
 const max=Math.max(.01,...values.slice(-n).map(Math.abs));
 for(let i=0;i<n;i++){
  const bh=Math.max(8,Math.abs(values[values.length-n+i])/max*h);
  const xx=start+i*(bw+gap);
  add(`<rect x="${xx}" y="${y+h-bh}" width="${bw}" height="${bh}" rx="4" fill="#8b36ff" opacity="${.65+.35*i/n}"/>`);
 }
}
function subscriberCard(x,current,hourly,daily){
 mainCard(x,"LUCAN · LIVE SUBSCRIBERS",C.blue,"arrow");
 text("(LINEAR ESTIMATE)",x+133.5,139,13,"#d7e3ff",900,237,"center");
 odo(fmtNum(current),x+133.5,202,55,C.white,900,239,"center","lucan-subs");
 chart(history.subs.slice(-18),x+18,250,231,66);
 line(x+15,330,x+252,330);
 const cols=[["LINEAR ESTIMATE",fmtNum(current)],["HOURLY GAIN",fmtNum(hourly)],["DAILY GAIN",fmtNum(daily)]],widths=[105,77,85];
 let at=x+8;
 cols.forEach((c,i)=>{
  if(i)line(at-4,343,at-4,438);
  text(c[0],at+widths[i]/2,361,10,"#b9caff",900,widths[i],"center");
  odo(c[1],at+widths[i]/2,397,17,C.teal,900,widths[i],"center",`subscriber-info-${i}`);
  at+=widths[i];
 });
}
function rateCard(x,rate){
 mainCard(x,"SUBS GAINED PER SEC","#2869c9","bolt");
 text(rate<0?"−":"+ ",x+67,213,64,C.white,900,65,"center");
 odo(Math.abs(rate).toFixed(2),x+168,213,64,C.white,900,175,"center","gain-rate");
 bars(history.rates,x+25,280,217,84);
 text("LIVE AVERAGE",x+133.5,401,13,C.teal,900,235,"center");
}
function goalCard(x,remaining,progress){
 mainCard(x,"SUBSCRIBERS REMAINING",C.purple,"flag");
 text("TO 60,000,000",x+133.5,139,13,"#d7e3ff",900,237,"center");
 odo(fmtNum(remaining),x+133.5,207,55,C.white,900,239,"center","remaining-subs");
 rect(x+20,275,227,15,10,"#111f43",null);
 rect(x+20,275,227*progress,15,10,"#8b36ff",null);
 text("ROAD TO 60M",x+20,309,10,"#b9caff",900,120);
 odo((progress*100).toFixed(1)+"%",x+247,309,10,"#b9caff",900,65,"right","goal-progress");
 text("SUBSCRIBERS LEFT",x+133.5,401,13,C.teal,900,235,"center");
}
function sources(a,b){
 rect(8,464,1264,210,19,"#0b1024","#4268a8");
 icon("data",29,485,13,"#d6e3ff");text("DATA SOURCES",43,485,15,"#d6e3ff",900,250);
 add(`<circle cx="1129" cy="485" r="4.5" fill="${C.teal}"/>`);
 text("LIVE · BOTH PROVIDERS",1141,485,10,C.teal,900,114);
 line(22,503,1258,503);
 const left=22,labelW=130,gap=9,colW=(1236-labelW-gap*4)/4;
 const xs=[left+labelW+gap,left+labelW+gap*2+colW,left+labelW+gap*3+colW*2,left+labelW+gap*4+colW*3];
 ["SCTools Est.","SCTools API","FreeWebTools Est.","FreeWebTools API"].forEach((v,i)=>text(v,xs[i]+colW/2,522,12,"#d6e3ff",900,colW,"center"));
 [["SUBSCRIBERS",a.est,a.api,b.freeEst,b.freeApi],["TOTAL VIEWS",a.views,a.apiViews,b.freeEstViews,b.freeApiViews],["VIDEOS",a.videos,a.apiVideos,b.freeEstVideos,b.freeApiVideos]].forEach((r,i)=>{
  const y=536+i*43;text(r[0],left,y+17,11,"#799bff",900,labelW);
  for(let j=0;j<4;j++){rect(xs[j],y,colW,36,7,"#080d1b","#26375b");odo(fmtNum(r[j+1]),xs[j]+11,y+18,17,j===0||j===2?C.teal:"#c4d1ff",900,colW-20,"start",`source-${i}-${j}`);}
 });
}
async function buildSVG(data={}){
 const a=getStats(data.lucan||{}),b=getStats(data.mine||{});
 const jobs=[a.avatar?getAvatar(a.avatar):Promise.resolve(""),b.avatar?getAvatar(b.avatar):Promise.resolve("")];
 [a.avatar,b.avatar]=await Promise.all(jobs);
 const current=a.linear??a.est,now=Date.now();
 if(current!=null&&now-history.last>=3000){
  if(history.previous!=null&&history.last){const sec=(now-history.last)/1000;if(sec>0)history.rates.push((current-history.previous)/sec);}
  history.subs.push(current);history.previous=current;history.last=now;
  if(history.subs.length>60)history.subs.shift();if(history.rates.length>14)history.rates.shift();
 }
 const rate=history.rates.at(-1)||0,remaining=current==null?null:Math.max(0,60000000-current),progress=current==null?0:clamp(current/60000000,0,1);
 S.length=0;
 add(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><defs><radialGradient id="bg" cx="50%" cy="0%" r="100%"><stop offset="0%" stop-color="#19265a"/><stop offset="50%" stop-color="#080b1b"/><stop offset="100%" stop-color="#040610"/></radialGradient><linearGradient id="fade442" x1="0" y1="0" x2="1" y2="0"><stop stop-color="#ffffff" stop-opacity=".025"/><stop offset="1" stop-color="#000" stop-opacity="0"/></linearGradient><linearGradient id="fade723" x1="0" y1="0" x2="1" y2="0"><stop stop-color="#ffffff" stop-opacity=".025"/><stop offset="1" stop-color="#000" stop-opacity="0"/></linearGradient><linearGradient id="fade1004" x1="0" y1="0" x2="1" y2="0"><stop stop-color="#ffffff" stop-opacity=".025"/><stop offset="1" stop-color="#000" stop-opacity="0"/></linearGradient></defs><rect width="${W}" height="${H}" fill="url(#bg)"/>`);
 header();profile(a);miniStats(b);
 subscriberCard(442,current,a.hourly,a.daily);rateCard(723,rate);goalCard(1004,remaining,progress);sources(a,b);
 line(8,686,1272,686,"#ffffff18");
 text("UPDATED "+new Date().toLocaleTimeString(),22,702,11,"#b9caff",900,300);
 add(`<circle cx="1179" cy="702" r="4.5" fill="${C.teal}"/>`);
 text("CONNECTED",1192,702,11,C.teal,900,80);
 add("</svg>");
 return {svg:S.join(""),a,b};
}
async function renderInternal(data={},mode="png"){
 const start=process.hrtime.bigint(),{svg}=await buildSVG(data),drawStart=process.hrtime.bigint();
 const r=new Resvg(svg,{fitTo:{mode:"width",value:W},font:{loadSystemFonts:true,fontFiles:[require.resolve("@fontsource/inter/files/inter-latin-400-normal.woff2"),require.resolve("@fontsource/inter/files/inter-latin-700-normal.woff2")],defaultFontFamily:"Inter"}});
 const img=r.render(),drawMs=ms(drawStart),outStart=process.hrtime.bigint();
 const output=mode==="raw"?Buffer.from(img.pixels):img.asPng();
 const outputMs=ms(outStart);
 lastTiming={drawMs,outputMs,totalMs:ms(start)};
 if(mode==="raw")rawCache=output;
 return output;
}
function renderDashboard(data={}){const j=queue.then(()=>renderInternal(data,"png"));queue=j.catch(()=>{});return j;}
function renderRawFrame(data={}){const j=queue.then(()=>renderInternal(data,"raw"));queue=j.catch(()=>{});return j;}
const wait=ms=>new Promise(r=>setTimeout(r,ms));
function stats(v){
 if(!v.length)return{averageMs:0,medianMs:0,p95Ms:0,minMs:0,maxMs:0};
 const a=[...v].sort((x,y)=>x-y),avg=v.reduce((s,n)=>s+n,0)/v.length,p=q=>a[Math.min(a.length-1,Math.ceil(a.length*q)-1)],r=n=>+n.toFixed(2);
 return{averageMs:r(avg),medianMs:r(p(.5)),p95Ms:r(p(.95)),minMs:r(a[0]),maxMs:r(a.at(-1))};
}
async function runReuseBenchmark(){
 const FPS=15,FRAME_MS=1000/FPS,DURATION=10000,TOTAL=Math.round(DURATION/FRAME_MS),lateArr=[];
 const start=process.hrtime.bigint(),before=process.memoryUsage();let frame,frames=0,checksum=0,missed=0,maxLate=0;
 try{
  frame=await renderRawFrame();if(!frame||frame.byteLength!==W*H*4)throw Error("Invalid RGBA frame");
  const renderMs=lastTiming.totalMs,loopStart=process.hrtime.bigint();let next=loopStart;
  while(frames<TOTAL){
   next+=BigInt(Math.round(FRAME_MS*1e6));const tick=process.hrtime.bigint(),late=Math.max(0,Number(tick-next)/1e6);
   lateArr.push(late);if(late>FRAME_MS)missed++;maxLate=Math.max(maxLate,late);
   checksum=(checksum+frame[frames%frame.length])>>>0;frames++;
   const rem=Number(next-process.hrtime.bigint())/1e6;await wait(rem>0?rem:0);
  }
  const after=process.memoryUsage(),elapsed=ms(start),mib=n=>+(n/1048576).toFixed(2);
  return{renderer:"@resvg/resvg-js",mode:"single-render-reused-rgba-frame",resolution:`${W}x${H}`,fpsTarget:FPS,frameIntervalMs:+FRAME_MS.toFixed(3),durationMs:+elapsed.toFixed(2),frames,frameSizeBytes:frame.byteLength,frameSizeMiB:+(frame.byteLength/1048576).toFixed(2),achievedFPS:+(frames/(elapsed/1000)).toFixed(2),frameFeed:{lateness:stats(lateArr),maxLatenessMs:+maxLate.toFixed(2),missedDeadlines:missed,missedDeadlinePercent:+(missed/frames*100).toFixed(2)},renderOnce:{totalMs:+renderMs.toFixed(2),drawMs:+lastTiming.drawMs.toFixed(2),rawExtractionMs:+lastTiming.outputMs.toFixed(2)},memory:{heapBeforeMiB:mib(before.heapUsed),heapAfterMiB:mib(after.heapUsed),externalBeforeMiB:mib(before.external),externalAfterMiB:mib(after.external),rssBeforeMiB:mib(before.rss),rssAfterMiB:mib(after.rss)},checksum:checksum>>>0};
 }finally{frame=null;}
}
function attach(app,getData){
 app.get("/api/renderer/preview.png",async(req,res)=>{
  if(benchmarkActive)return res.status(503).send("Benchmark running; retry shortly");
  try{const png=await renderDashboard(getData());res.set("Content-Type","image/png").set("Cache-Control","no-store, no-cache, must-revalidate").send(png);}
  catch(e){console.error("Renderer error:",e.stack||e.message);res.status(500).send("Renderer failed");}
 });
 app.get("/api/renderer/benchmark",async(req,res)=>{
  if(benchmarkActive)return res.status(409).json({error:"Benchmark already running"});
  benchmarkActive=true;
  try{const result=await runReuseBenchmark();res.set("Cache-Control","no-store");res.json(result);}
  catch(e){console.error("Renderer benchmark error:",e.stack||e.message);if(!res.headersSent)res.status(500).json({error:"Benchmark failed",message:e.message});}
  finally{rawCache=null;benchmarkActive=false;}
 });
}
module.exports={renderDashboard,renderRawFrame,attach};
