
const fs=require("fs"),path=require("path"),{render}=require("takumi-js"),{googleFonts}=require("takumi-js/helpers");
const W=1280,H=720,FPS=15,FRAME_MS=1000/FPS,DIR=__dirname;
const nf=new Intl.NumberFormat("en-US"),images=new Map(),history={subs:[],rates:[],samples:[],previous:null,last:0,lastSample:0};
let queue=Promise.resolve(),benchmarkActive=false,lastTiming={},fontPromise=null,htmlPromise=null;
const ms=t=>Number(process.hrtime.bigint()-t)/1e6;
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const fmt=v=>v==null||v===""||!Number.isFinite(Number(v))?"—":nf.format(Math.round(Number(v)));
const decimal=v=>v==null||!Number.isFinite(Number(v))?"—":Number(v).toFixed(2);

function setText(html,id,v){
 const re=new RegExp(`(<([a-z][\\w:-]*)\\b(?=[^>]*\\bid=["']${id}["'])[^>]*>)[\\s\\S]*?(</\\2>)`,"i");
 return html.replace(re,(_,a,b,c)=>a+esc(v??"—")+c);
}
function setAttr(html,id,name,v){
 const re=new RegExp(`<([a-z][\\w:-]*)\\b([^>]*\\bid=["']${id}["'][^>]*)>`,"i");
 return html.replace(re,(_,tag,attrs)=>{
  const ra=new RegExp(`\\s${name}=["'][^"']*["']`,"i");
  attrs=ra.test(attrs)?attrs.replace(ra,` ${name}="${esc(v)}"`):attrs+` ${name}="${esc(v)}"`;
  return `<${tag}${attrs}>`;
 });
}
function setInner(html,id,inner){
 const re=new RegExp(`(<([a-z][\\w:-]*)\\b(?=[^>]*\\bid=["']${id}["'])[^>]*>)[\\s\\S]*?(</\\2>)`,"i");
 return html.replace(re,(_,a,b,c)=>a+inner+c);
}
function getFonts(){
 if(!fontPromise)fontPromise=googleFonts([{name:"Inter",weight:"700..900"}]).catch(e=>{fontPromise=null;throw e;});
 return fontPromise;
}
async function getHtml(){
 if(!htmlPromise)htmlPromise=fs.promises.readFile(path.join(DIR,"index.html"),"utf8");
 return htmlPromise;
}
async function avatar(url){
 if(!url)return"";
 if(images.has(url))return images.get(url);
 const task=(async()=>{
  try{
   const r=await fetch(url,{signal:AbortSignal.timeout(10000)});
   if(!r.ok)throw Error(`HTTP ${r.status}`);
   const b=Buffer.from(await r.arrayBuffer());
   if(b.length>2e6)throw Error("Avatar too large");
   return `data:${r.headers.get("content-type")||"image/jpeg"};base64,${b.toString("base64")}`;
  }catch(e){console.error("[TAKUMI AVATAR]",e.message);return"";}
 })();
 images.set(url,task);
 return task;
}

/* SVG icons: preserve the original symbols without relying on Unicode fonts. */
function svgIcon(name,color="#27a9ff"){
 const paths={
  arrow:'<path d="M4 16 10 10 14 14 21 5"/><path d="M15 5h6v6"/>',
  bolt:'<path d="m13 2-9 12h7l-1 8 10-13h-7z"/>',
  flag:'<path d="M5 22V3"/><path d="M5 4c6-4 9 4 15 0v11c-6 4-9-4-15 0"/>',
  grid:'<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/>',
  refresh:'<path d="M20 7v5h-5"/><path d="M4 17v-5h5"/><path d="M5.5 9A7 7 0 0 1 18 6l2 6M4 12l2 6a7 7 0 0 0 12.5-3"/>',
  target:'<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/>',
  live:'<circle cx="12" cy="12" r="7"/>',
  average:'<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/>',
  left:'<circle cx="12" cy="12" r="9"/><path d="M12 7v10M8 13l4 4 4-4"/>'
 };
 return `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;flex-shrink:0">${paths[name]||paths.grid}</svg>`;
}
function replaceSymbols(html){
 let i=0;
 const names=["arrow","bolt","flag"];
 html=html.replace(/(<span class="stat-icon">)[\s\S]*?(<\/span>)/g,(_,a,b)=>a+svgIcon(names[i++]||"grid")+b);
 html=html.replace(/<div class="lv">[\s\S]*?<\/div>/,`<div class="lv">${svgIcon("live","#ff4267")} LIVE</div>`);
 html=html.replace(/<div class="stat-bottom">◉ LIVE AVERAGE<\/div>/,`<div class="stat-bottom">${svgIcon("average","#25e5c0")} LIVE AVERAGE</div>`);
 html=html.replace(/<div class="stat-bottom">◎ SUBSCRIBERS LEFT<\/div>/,`<div class="stat-bottom">${svgIcon("left","#25e5c0")} SUBSCRIBERS LEFT</div>`);
 return html;
}
function chartPoints(a){
 if(a.length<2)return"0,65 60,55 120,52 180,45 240,38 300,30 360,22 400,15";
 const min=Math.min(...a),max=Math.max(...a),range=Math.max(1,max-min);
 return a.map((v,i)=>`${(i/(a.length-1)*400).toFixed(1)},${(68-(v-min)/range*52).toFixed(1)}`).join(" ");
}
function rateBars(){
 return history.rates.slice(-14).map((v,i,a)=>{
  const n=Math.min(12,Math.max(1,Math.round(Math.abs(v)*4)));
  return `<span style="height:${Math.max(12,n*7)}px;opacity:${.55+i/a.length*.45}"></span>`;
 }).join("");
}

/* All four provider columns plus the actual FreeWebTools metadata. */
function sourceCard(a){
 const rows=[
  ["SUBSCRIBERS",a.st.estSubscribers,a.st.apiSubscribers,a.fw.estimatedSubscribers,a.fw.apiSubscribers],
  ["TOTAL VIEWS",a.st.estViews,a.st.apiViews,a.fw.estimatedViews,a.fw.viewCount],
  ["VIDEOS",a.st.estVideos,a.st.apiVideos,a.fw.estimatedVideos,a.fw.videoCount]
 ];
 return `
 <div class="src-h"><span>${svgIcon("grid","#b9caff")} &nbsp; DATA SOURCES</span><span class="src-status">${svgIcon("live","#25e5c0")} LIVE · BOTH PROVIDERS</span></div>
 <div class="mtx">
  <div></div><div class="mh">SCTools Est.</div><div class="mh">SCTools API</div><div class="mh">FreeWebTools Est.</div><div class="mh">FreeWebTools API</div>
  ${rows.map(row=>`<div class="mg">${row[0]}</div>`+row.slice(1).map((v,i)=>`<div class="cell"><span class="vl odometer ${i%2?"api":"fw"}">${fmt(v)}</span></div>`).join("")).join("")}
 </div>
 <div class="src-meta">
  <div><span>FREEWEBTOOLS HOURLY GROWTH</span><b>${fmt(a.fw.hourly)}</b></div>
  <div><span>FREEWEBTOOLS DAILY GROWTH</span><b>${fmt(a.fw.daily)}</b></div>
  <div><span>FREEWEBTOOLS CONFIDENCE</span><b>${esc(a.fw.confidence||"—").toUpperCase()}</b></div>
 </div>`;
}
function record(a){
 const current=a.main,now=Date.now();
 if(current!=null&&now-history.lastSample>=1000){
  history.samples.push({t:now,n:current});
  if(history.samples.length>6)history.samples.shift();
  history.subs.push(current);
  if(history.subs.length>18)history.subs.shift();
  if(history.samples.length>1){
   const first=history.samples[0],last=history.samples.at(-1),seconds=(last.t-first.t)/1000;
   const rate=seconds>0?(last.n-first.n)/seconds:0;
   history.rates.push(rate);
   if(history.rates.length>14)history.rates.shift();
  }
  history.lastSample=now;
 }
}
async function buildHtml(data={}){
 const l=data.lucan||{},m=data.mine||{},st=l.sctools||{},fw=l.freewebtools||{},mst=m.sctools||{},mfw=m.freewebtools||{},lc=l.channel||{},mc=m.channel||{};
 const main=st.linearSubscribers??st.estSubscribers??fw.estimatedSubscribers??st.apiSubscribers??fw.apiSubscribers;
 const remaining=main==null?null:Math.max(0,60000000-Number(main));
 const progress=main==null?0:Math.min(100,Number(main)/60000000*100);
 const hourly=st.hourly??fw.hourly,daily=st.daily??fw.daily,rate=history.rates.at(-1)??null;
 const [la,ma]=await Promise.all([avatar(lc.avatar),avatar(mc.avatar)]);
 record({main});
 let html=await getHtml();

 html=html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,"").replace(/<link\b[^>]*>/gi,"");
 html=html.replace("</head>",`<style>
 html,body{width:1280px!important;height:720px!important;min-width:1280px!important;min-height:720px!important;overflow:hidden!important}
 .pg{width:99%!important;height:720px!important;min-height:720px!important}
 #lucanCount{font-size:50px!important;letter-spacing:-3.5px!important;white-space:nowrap!important;width:100%!important;max-width:100%!important;display:block!important;text-align:center!important;transform:scaleX(.82)!important;transform-origin:center center!important}
 .stat-icon{display:flex!important;align-items:center!important;justify-content:center!important}
 .lv{display:flex!important;align-items:center!important;gap:5px!important}
 .src-h{display:flex!important;align-items:center!important}
 .src-h>span{display:flex!important;align-items:center!important;gap:5px!important}
 .src-status{display:flex!important;align-items:center!important;gap:4px!important}
 .stat-bottom{display:flex!important;align-items:center!important;justify-content:center!important;gap:5px!important}
 .chart .chart-fill{fill:#18e9d9!important;fill-opacity:.20!important;stroke:none!important}
 .chart polyline{fill:none!important;stroke:#25e5c0!important;stroke-width:3!important;stroke-linecap:round!important;stroke-linejoin:round!important;filter:none!important}
 .sources-panel{padding:8px 12px!important;gap:5px!important}
 .src-h{font-size:15px!important;padding-bottom:6px!important;flex-shrink:0!important;min-height:24px!important}
 .src-status{font-size:10px!important;white-space:nowrap!important}
 .mtx{grid-template-columns:130px repeat(4,minmax(0,1fr))!important;gap:3px 8px!important;flex:1!important;min-height:0!important}
 .mh{font-size:12px!important;line-height:1.1!important}
 .mg{font-size:11px!important}
 .cell{padding:5px 9px!important;min-height:31px!important}
 .vl{font-size:clamp(15px,1.3vw,21px)!important;line-height:1.1!important}
 .src-meta{display:grid!important;grid-template-columns:repeat(3,minmax(0,1fr))!important;gap:7px!important;margin-top:0!important;flex-shrink:0!important}
 .src-meta>div{display:flex!important;align-items:center!important;justify-content:space-between!important;gap:7px!important;background:#080d1b!important;border:1px solid #26375b!important;border-radius:8px!important;padding:4px 8px!important;min-width:0!important;min-height:27px!important}
 .src-meta span{font-size:9px!important;font-weight:900!important;color:#aab8df!important;white-space:nowrap!important}
 .src-meta b{font-size:13px!important;font-weight:900!important;color:#25e5c0!important;white-space:nowrap!important}
 footer{display:flex!important;align-items:center!important}
 </style></head>`);

 html=setAttr(html,"lucanAvatar","src",la||"data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=");
 html=setAttr(html,"mineAvatar","src",ma||"data:image/gif;base64,R0lGODlhAQABAAAAACw=");

 const fields={
  lucanName:lc.name||"Lucan Pevidor",
  lucanHandle:lc.handle||"@LucanPevidor",
  lucanDescription:lc.description||"Jesus loves you! I hope every video makes you smile!",
  mineName:mc.name||"VYStats",
  mineHandle:mc.handle||"@vystatsyt",
  lucanCount:fmt(main),
  lucanRemaining:fmt(remaining),
  lucanRate:rate==null?"—":decimal(Math.abs(rate)),
  lucanRateSign:rate!=null&&rate<0?"−":"+",
  stLinearText:fmt(st.linearSubscribers??st.estSubscribers),
  stHourlyText:fmt(hourly),
  stDailyText:fmt(daily),
  mineEstSubs:fmt(mst.estSubscribers??mfw.estimatedSubscribers),
  mineApiSubs:fmt(mst.apiSubscribers??mfw.apiSubscribers),
  mineEstViews:fmt(mst.estViews??mfw.estimatedViews),
  mineApiViews:fmt(mst.apiViews??mfw.viewCount),
  mineEstVideos:fmt(mst.estVideos??mfw.estimatedVideos),
  mineApiVideos:fmt(mst.apiVideos??mfw.videoCount),
  goalPercent:main==null?"—":progress.toFixed(1)+"%",
  updated:(l.updated||m.updated)?"UPDATED "+new Date(Math.max(l.updated||0,m.updated||0)).toLocaleTimeString():"WAITING FOR DATA",
  status:l.updated||m.updated?"CONNECTED":"CONNECTING"
 };
 for(const [id,v] of Object.entries(fields))html=setText(html,id,v);

 html=html.replace(/id=["']goalProgress["']([^>]*)/i,(_,a)=>`id="goalProgress"${a.replace(/\sstyle=["'][^"]*["']/i,"")} style="width:${progress}%;"`);
 html=setInner(html,"srcCard",sourceCard({st,fw}));
 const points=chartPoints(history.subs);
 html=setAttr(html,"chartLine","points",points);
 html=setAttr(html,"chartLine","fill","none");
 html=setAttr(html,"chartLine","stroke","#25e5c0");
 html=setAttr(html,"chartFill","points",`0,80 ${points} 400,80`);
 html=setAttr(html,"chartFill","fill","#18e9d9");
 html=setAttr(html,"chartFill","fill-opacity",".20");
 html=setInner(html,"rateBars",rateBars());
 html=replaceSymbols(html);

 /* SVG symbols in the footer are inserted after text fields are populated. */
 html=setInner(html,"updated",`${svgIcon("refresh","#b9caff")} UPDATED ${esc((l.updated||m.updated)?new Date(Math.max(l.updated||0,m.updated||0)).toLocaleTimeString():"WAITING FOR DATA")}`);
 html=setInner(html,"status",`${svgIcon("live","#25e5c0")} ${l.updated||m.updated?"CONNECTED":"CONNECTING"}`);
 return html;
}
async function renderInternal(data={},mode="png"){
 const start=process.hrtime.bigint(),html=await buildHtml(data),draw=process.hrtime.bigint();
 const output=await render(html,{width:W,height:H,format:mode==="raw"?"raw":"png",fonts:getFonts()}),result=Buffer.from(output);
 lastTiming={renderMs:ms(draw),totalMs:ms(start)};
 if(mode==="raw"&&result.length!==W*H*4)throw Error(`Bad RGBA frame: ${result.length}; expected ${W*H*4}`);
 return result;
}
function run(data,mode){
 const job=queue.then(()=>renderInternal(data,mode));
 queue=job.catch(()=>{});
 return job;
}
const renderDashboard=data=>run(data,"png"),renderRawFrame=data=>run(data,"raw");
function stats(a){
 if(!a.length)return{averageMs:0,medianMs:0,p95Ms:0,minMs:0,maxMs:0};
 const s=[...a].sort((x,y)=>x-y),avg=a.reduce((x,y)=>x+y,0)/a.length;
 const p=q=>s[Math.min(s.length-1,Math.ceil(s.length*q)-1)],r=n=>+n.toFixed(2);
 return{averageMs:r(avg),medianMs:r(p(.5)),p95Ms:r(p(.95)),minMs:r(s[0]),maxMs:r(s.at(-1))};
}
async function freshBenchmark(getData){
 const duration=10000,interval=BigInt(Math.round(FRAME_MS*1e6)),start=process.hrtime.bigint(),before=process.memoryUsage(),times=[];
 let frames=0,missed=0,maxLate=0,checksum=0,firstSize=0,next=start+interval;
 const cpu=process.cpuUsage();
 while(ms(start)<duration){
  const t=process.hrtime.bigint(),frame=await renderRawFrame(await getData()),done=process.hrtime.bigint();
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
 const after=process.memoryUsage(),used=process.cpuUsage(cpu),elapsed=ms(start),mib=n=>+(n/1048576).toFixed(2);
 return{
  renderer:"takumi-js",mode:"fresh-render-each-frame",resolution:`${W}x${H}`,
  fpsTarget:FPS,frameIntervalMs:+FRAME_MS.toFixed(3),durationMs:+elapsed.toFixed(2),
  frames,frameSizeBytes:firstSize,frameSizeMiB:mib(firstSize),
  freshRenderFPS:+(frames/(elapsed/1000)).toFixed(2),renderTime:stats(times),
  missedDeadlines:missed,missedDeadlinePercent:+(missed/Math.max(1,frames+missed)*100).toFixed(2),
  maxLatenessMs:+maxLate.toFixed(2),
  cpu:{userMs:+(used.user/1000).toFixed(2),systemMs:+(used.system/1000).toFixed(2)},
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
   res.set({"Content-Type":"image/png","Cache-Control":"no-store, no-cache, must-revalidate"}).send(png);
  }catch(e){
   console.error("[TAKUMI RENDER]",e.stack||e.message);
   res.status(500).send(e.message);
  }
 });
 app.get("/api/renderer/benchmark",async(req,res)=>{
  if(benchmarkActive)return res.status(409).json({error:"Benchmark already running"});
  benchmarkActive=true;
  try{
   res.set("Cache-Control","no-store").json(await freshBenchmark(getData));
  }catch(e){
   console.error("[TAKUMI BENCHMARK]",e.stack||e.message);
   if(!res.headersSent)res.status(500).json({error:"Benchmark failed",message:e.message});
  }finally{benchmarkActive=false;}
 });
}
module.exports={renderDashboard,renderRawFrame,attach};
