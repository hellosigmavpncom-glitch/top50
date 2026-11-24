
const {Resvg}=require("@resvg/resvg-js");
const W=1280,H=720,FPS=15,FRAME_MS=1000/FPS;
const C={bg:"#050713",panel:"#0b1024",panel2:"#101832",border:"#273a68",blue:"#27a9ff",purple:"#8b36ff",teal:"#25e5c0",white:"#f5f7ff",muted:"#aab8df"};
const FONT={loadSystemFonts:true,defaultFontFamily:"sans-serif"};
const nf=new Intl.NumberFormat("en-US"),avatars=new Map(),history={subs:[],rates:[],previous:null,last:0};
let queue=Promise.resolve(),benchmarkActive=false,lastTiming={};
const ms=t=>Number(process.hrtime.bigint()-t)/1e6;
const esc=s=>String(s??"—").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&apos;"}[c]));
const fmt=v=>v==null||!Number.isFinite(Number(v))?"—":nf.format(Math.round(Number(v)));
const num=(o,...keys)=>{for(const k of keys)if(o?.[k]!=null&&o[k]!==""&&Number.isFinite(Number(o[k])))return Number(o[k]);return null;};
const getStats=d=>{
 const s=d.sctools||{},f=d.freewebtools||{},e=f.estimation||{};
 return{name:d.channel?.name||s.name||"Channel",handle:d.channel?.handle||"",avatar:d.channel?.avatar||s.avatar||f.thumbnail||"",linear:num(s,"linearSubscribers","linearCount","estSubscribers","estCount"),est:num(s,"estSubscribers","estCount"),api:num(s,"apiSubscribers","apiCount"),views:num(s,"estViews","viewCount"),apiViews:num(s,"apiViews"),videos:num(s,"estVideos"),apiVideos:num(s,"apiVideos","videoCount"),hourly:num(s,"hourly")??num(s.averages,"hourly")??num(f,"hourly"),daily:num(s,"daily")??num(s.averages,"daily")??num(f,"daily"),freeEst:num(f,"estimatedSubscribers")??num(e,"estimated_count"),freeApi:num(f,"apiSubscribers","subscriberCount"),freeEstViews:num(f,"estimatedViews"),freeApiViews:num(f,"viewCount"),freeEstVideos:num(f,"estimatedVideos"),freeApiVideos:num(f,"videoCount")};
};
const rect=(x,y,w,h,r=12,fill=C.panel,stroke=C.border)=>`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}"${stroke?` stroke="${stroke}" stroke-width="1"`:""}/>`;
const line=(x,y,x2,y2,color="#ffffff20",width=1)=>`<path d="M${x} ${y}L${x2} ${y2}" fill="none" stroke="${color}" stroke-width="${width}"/>`;
function txt(v,x,y,size=16,color=C.white,weight=700,max=Infinity,anchor="start"){
 const s=esc(v),n=String(v??"—").length,fit=max===Infinity?size:Math.min(size,max/Math.max(1,n*.59));
 return`<text x="${x}" y="${y}" fill="${color}" font-family="sans-serif" font-size="${Math.max(8,fit)}" font-weight="${weight}" text-anchor="${anchor}" dominant-baseline="middle">${s}</text>`;
}
const wheelState=new Map();
function wheel(v,x,y,size=20,color=C.white,max=Infinity,anchor="start",key=""){
 const s=String(v??"—"),cw=size*.61,total=s.length*cw,start=anchor==="center"?x-total/2:anchor==="right"?x-total:x;
 let out=`<g font-family="sans-serif" font-size="${size}" font-weight="900" fill="${color}">`;
 for(let i=0;i<s.length;i++){
  const ch=s[i],px=start+i*cw;
  if(!/\d/.test(ch)){out+=`<text x="${px}" y="${y}" dominant-baseline="middle">${esc(ch)}</text>`;continue;}
  const id=`${key}-${i}`,prev=wheelState.get(id),now=Date.now();
  if(prev&&prev.to!==ch&&now-prev.time<650){
   const p=Math.min(1,(now-prev.time)/650),e=1-Math.pow(1-p,3),shift=e*size;
   out+=`<svg x="${px}" y="${y-size*.72}" width="${cw}" height="${size*1.45}" viewBox="0 0 ${cw} ${size*1.45}"><g transform="translate(0 ${shift})"><text x="${cw/2}" y="${size*.72}" text-anchor="middle" dominant-baseline="middle">${esc(prev.to)}</text><text x="${cw/2}" y="${size*1.72}" text-anchor="middle" dominant-baseline="middle">${esc(ch)}</text></g></svg>`;
  }else out+=`<text x="${px}" y="${y}" dominant-baseline="middle">${esc(ch)}</text>`;
  if(!prev||prev.to!==ch)wheelState.set(id,{to:ch,time:now});
 }
 return out+"</g>";
}
async function avatar(url){
 if(!url)return"";
 if(avatars.has(url))return avatars.get(url);
 const p=(async()=>{
  try{
   const r=await fetch(url,{signal:AbortSignal.timeout(5000)});
   if(!r.ok)throw Error("Avatar HTTP "+r.status);
   const b=Buffer.from(await r.arrayBuffer());
   if(b.length>2e6)throw Error("Avatar too large");
   return`data:${r.headers.get("content-type")||"image/jpeg"};base64,${b.toString("base64")}`;
  }catch{return"";}
 })();
 avatars.set(url,p);return p;
}
function profile(d){
 const a=d.avatar?`<image href="${d.avatar}" x="28" y="83" width="94" height="94" preserveAspectRatio="xMidYMid slice" clip-path="url(#avatarClip)"/>`:"";
 return rect(8,66,420,136,16,C.panel,C.blue)+`<circle cx="75" cy="130" r="48" fill="#14213d"/>`+a+txt(d.name,145,112,25,C.white,900,260)+txt(d.handle,145,147,14,C.muted,400,250)+txt("CHANNEL PROFILE",145,176,10,C.teal,700,220);
}
function miniStats(d){
 let o=rect(8,214,420,240,16,C.panel,C.border)+txt("SECOND CHANNEL · STATISTICS",22,239,14,"#d7e3ff",700,370);
 o+=line(22,258,414,258);
 [["SUBSCRIBERS",d.freeEst,d.freeApi],["VIEWS",d.freeEstViews,d.freeApiViews],["VIDEOS",d.freeEstVideos,d.freeApiVideos]].forEach((v,i)=>{
  const x=22+i*132;
  if(i)o+=line(x-8,276,x-8,440);
  o+=txt(v[0],x+58,290,10,"#b8caff",700,116,"middle");
  o+=txt("ESTIMATED",x+58,324,9,C.muted,400,110,"middle")+wheel(fmt(v[1]),x+58,354,15,C.white,100,"center",`mini-${i}-est`);
  o+=txt("API",x+58,380,9,C.muted,400,110,"middle")+wheel(fmt(v[2]),x+58,411,15,C.white,100,"center",`mini-${i}-api`);
 });
 return o;
}
function mainCard(x,title,accent){
 return rect(x,66,267,388,18,C.panel,accent)+txt(title,x+22,112,14,"#d7e3ff",700,220);
}
function chart(values,x,y,w,h){
 if(values.length<2)return"";
 const lo=Math.min(...values),hi=Math.max(...values),range=hi-lo||1;
 const pts=values.map((v,i)=>`${x+i/(values.length-1)*w},${y+h-(v-lo)/range*h}`).join(" ");
 return`<polyline points="${pts}" fill="none" stroke="${C.teal}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`;
}
function bars(values,x,y,w,h){
 const a=values.slice(-14),max=Math.max(.01,...a.map(Math.abs)),gap=6,bw=Math.min(20,(w-gap*(a.length-1))/a.length);
 return a.map((v,i)=>{const bh=Math.max(5,Math.abs(v)/max*h);return`<rect x="${x+i*(bw+gap)}" y="${y+h-bh}" width="${bw}" height="${bh}" rx="4" fill="#8b36ff" opacity="${.65+.35*i/a.length}"/>`;}).join("");
}
function sources(a,b){
 let o=rect(8,464,1264,210,18,C.panel,"#4268a8")+txt("DATA SOURCES",29,485,15,"#d6e3ff",700,250)+txt("LIVE · BOTH PROVIDERS",1250,485,10,C.teal,700,150,"end")+line(22,503,1258,503);
 const left=22,labelW=130,gap=9,colW=(1236-labelW-gap*4)/4,xs=Array.from({length:4},(_,i)=>left+labelW+gap*(i+1)+colW*i);
 ["SCTools Est.","SCTools API","FreeWebTools Est.","FreeWebTools API"].forEach((v,i)=>o+=txt(v,xs[i]+colW/2,522,12,"#d6e3ff",700,colW,"middle"));
 [["SUBSCRIBERS",a.est,a.api,b.freeEst,b.freeApi],["TOTAL VIEWS",a.views,a.apiViews,b.freeEstViews,b.freeApiViews],["VIDEOS",a.videos,a.apiVideos,b.freeEstVideos,b.freeApiVideos]].forEach((r,i)=>{
  const y=536+i*43;o+=txt(r[0],left,y+18,11,"#799bff",700,labelW);
  for(let j=0;j<4;j++)o+=rect(xs[j],y,colW,36,7,"#080d1b","#26375b")+wheel(fmt(r[j+1]),xs[j]+11,y+18,17,j%2?"#c4d1ff":C.teal,colW-20,"start",`source-${i}-${j}`);
 });
 return o;
}
async function buildSVG(data={}){
 const a=getStats(data.lucan||{}),b=getStats(data.mine||{}),[aa]=await Promise.all([avatar(a.avatar),avatar(b.avatar)]);
 const current=a.linear??a.est,now=Date.now();
 if(current!=null&&now-history.last>=3000){
  if(history.previous!=null&&history.last){const sec=(now-history.last)/1000;if(sec>0)history.rates.push((current-history.previous)/sec);}
  history.subs.push(current);history.previous=current;history.last=now;
  if(history.subs.length>60)history.subs.shift();
  if(history.rates.length>14)history.rates.shift();
 }
 const rate=history.rates.at(-1)||0,goal=60000000,remaining=current==null?null:Math.max(0,goal-current),progress=current==null?0:Math.min(1,current/goal);
 let s=`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><defs><clipPath id="avatarClip"><circle cx="75" cy="130" r="47"/></clipPath></defs><rect width="${W}" height="${H}" fill="${C.bg}"/>`;
 s+=rect(8,8,1264,48,12,C.panel,C.border)+txt("LUCAN PEVIDOR | ROAD TO 60M",26,32,18,C.white,900,600)+txt("LIVE TRACKER",1250,32,12,C.teal,700,180,"end");
 s+=profile({...a,avatar:aa})+miniStats(b);
 s+=mainCard(442,"LUCAN · LIVE SUBSCRIBERS",C.blue)+txt("(LINEAR ESTIMATE)",575.5,139,13,"#d7e3ff",700,237,"middle");
 s+=wheel(fmt(current),575.5,202,55,C.white,239,"center","lucan-subs")+chart(history.subs.slice(-18),460,250,231,66)+line(457,330,694,330);
 [["LINEAR ESTIMATE",fmt(current)],["HOURLY GAIN",fmt(a.hourly)],["DAILY GAIN",fmt(a.daily)]].forEach((v,i)=>{
  const widths=[105,77,85],x=450+widths.slice(0,i).reduce((p,n)=>p+n,0);
  if(i)s+=line(x-4,343,x-4,438);
  s+=txt(v[0],x+widths[i]/2,361,10,"#b9caff",700,widths[i],"middle")+wheel(v[1],x+widths[i]/2,397,17,C.teal,widths[i],"center",`subscriber-info-${i}`);
 });
 s+=mainCard(723,"SUBS GAINED PER SEC","#2869c9")+txt(rate<0?"−":"+ ",790,213,64,C.white,900,65,"middle")+wheel(Math.abs(rate).toFixed(2),891,213,64,C.white,175,"center","gain-rate")+bars(history.rates,748,280,217,84)+txt("LIVE AVERAGE",856.5,401,13,C.teal,700,235,"middle");
 s+=mainCard(1004,"SUBSCRIBERS REMAINING",C.purple)+txt("TO 60,000,000",1137.5,139,13,"#d7e3ff",700,237,"middle")+wheel(fmt(remaining),1137.5,207,55,C.white,239,"center","remaining-subs");
 s+=rect(1024,275,227,15,10,"#111f43",null)+rect(1024,275,227*progress,15,10,C.purple,null)+txt("ROAD TO 60M",1024,309,10,"#b9caff",700,120)+wheel((progress*100).toFixed(1)+"%",1251,309,10,"#b9caff",65,"right","goal-progress")+txt("SUBSCRIBERS LEFT",1137.5,401,13,C.teal,700,235,"middle");
 s+=sources(a,b)+line(8,686,1272,686,"#ffffff18")+txt("UPDATED "+new Date().toLocaleTimeString(),22,702,11,"#b9caff",700,300)+txt("● CONNECTED",1250,702,11,C.teal,700,120,"end");
 return s+"</svg>";
}
async function renderInternal(data={},mode="raw"){
 const start=process.hrtime.bigint(),svg=await buildSVG(data),drawStart=process.hrtime.bigint();
 const img=new Resvg(svg,{fitTo:{mode:"original"},font:FONT});
 const rendered=img.render(),drawMs=ms(drawStart),outStart=process.hrtime.bigint();
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
 const s=[...a].sort((x,y)=>x-y),avg=a.reduce((x,y)=>x+y,0)/a.length,p=q=>s[Math.min(s.length-1,Math.ceil(s.length*q)-1)],r=n=>+n.toFixed(2);
 return{averageMs:r(avg),medianMs:r(p(.5)),p95Ms:r(p(.95)),minMs:r(s[0]),maxMs:r(s.at(-1))};
}
async function freshBenchmark(getData){
 const duration=10000,interval=BigInt(Math.round(FRAME_MS*1e6)),start=process.hrtime.bigint(),before=process.memoryUsage(),times=[];
 let frames=0,missed=0,maxLate=0,checksum=0,firstSize=0,next=start+interval;
 const cpu=process.cpuUsage();
 while(Number(process.hrtime.bigint()-start)/1e6<duration){
  const t=process.hrtime.bigint(),data=await getData(),frame=await renderRawFrame(data),done=process.hrtime.bigint();
  times.push(Number(done-t)/1e6);frames++;firstSize=frame.length;
  checksum=(checksum+frame[(frames*997)%frame.length])>>>0;
  if(done>next){
   const late=done-next,slots=Number(late/interval)+1;
   missed+=slots;maxLate=Math.max(maxLate,Number(late)/1e6);
   next+=BigInt(slots+1)*interval;
  }else next+=interval;
 }
 const after=process.memoryUsage(),cpuUsed=process.cpuUsage(cpu),elapsed=ms(start),mib=n=>+(n/1048576).toFixed(2);
 return{renderer:"@resvg/resvg-js",mode:"fresh-render-each-frame",resolution:`${W}x${H}`,fpsTarget:FPS,frameIntervalMs:+FRAME_MS.toFixed(3),durationMs:+elapsed.toFixed(2),frames,frameSizeBytes:firstSize,frameSizeMiB:mib(firstSize),freshRenderFPS:+(frames/(elapsed/1000)).toFixed(2),renderTime:stats(times),missedDeadlines:missed,missedDeadlinePercent:+(missed/Math.max(1,frames+missed)*100).toFixed(2),maxLatenessMs:+maxLate.toFixed(2),cpu:{userMs:+(cpuUsed.user/1000).toFixed(2),systemMs:+(cpuUsed.system/1000).toFixed(2)},memory:{heapBeforeMiB:mib(before.heapUsed),heapAfterMiB:mib(after.heapUsed),externalBeforeMiB:mib(before.external),externalAfterMiB:mib(after.external),rssBeforeMiB:mib(before.rss),rssAfterMiB:mib(after.rss)},checksum};
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
   res.set("Cache-Control","no-store");res.json(result);
  }catch(e){
   console.error("Fresh renderer benchmark:",e.stack||e.message);
   if(!res.headersSent)res.status(500).json({error:"Benchmark failed",message:e.message});
  }finally{benchmarkActive=false;}
 });
}
module.exports={renderDashboard,renderRawFrame,attach};
