"use strict";
const fs=require("fs"),path=require("path");
const {Worker,isMainThread,parentPort}=require("worker_threads");
const {createCanvas,loadImage,GlobalFonts}=require("@napi-rs/canvas");
const {monitorEventLoopDelay}=require("perf_hooks");

const W=1280,H=720,FPS=10,FRAME_MS=1000/FPS;
const FRAME_NS=BigInt(Math.round(FRAME_MS*1e6)),FRAME_BYTES=W*H*4;
const nf=new Intl.NumberFormat("en-US"),MAX_RSS=440*1048576,IS_WORKER=!isMainThread;
const FONT="Inter",elapsed=(a,b=process.hrtime.bigint())=>Number(b-a)/1e6;
const mib=n=>+(n/1048576).toFixed(2),round=n=>+Number(n||0).toFixed(2);
const sleep=ms=>new Promise(r=>setTimeout(r,Math.max(1,ms)));
const C={bg:"#050713",panel:"#0b1024",panel2:"#101832",border:"#273a68",blue:"#27a9ff",purple:"#8b36ff",teal:"#25e5c0",white:"#f5f7ff",muted:"#aab8df",red:"#ff4267"};
const images=new Map(),rollStates=new Map(),measureCache=new Map();
const history={subs:[],rates:[],samples:[],lastSample:0};
const timing={dataFetchMs:0,avatarWaitMs:0,queueWaitMs:0,buildMs:0,renderMs:0,bufferMs:0,rawBufferMs:0,pipelineTotalMs:0,totalMs:0,transferCopyMs:0,transferPrepareMs:0,roundTripMs:0};
let benchmarkActive=false,latestMain=null,sampleTimer=null,staticCanvas=null,staticReady=false;
let mainCanvas=null,mainContext=null,chartCanvas=null,chartContext=null,chartCacheKey="";
let chartX=null,chartY=null,renderQueue=Promise.resolve(),rawPixelMethod="canvas.data()";

function registerFonts(){
 const root=path.join(__dirname,"node_modules","@fontsource","inter","files");
 const files=["inter-latin-700-normal.woff2","inter-latin-800-normal.woff2","inter-latin-900-normal.woff2"];
 let count=0;
 for(const f of files){const p=path.join(root,f);if(fs.existsSync(p))try{GlobalFonts.registerFromPath(p,FONT);count++;}catch(e){console.error("[FONT]",e.message);}}
 for(const f of ["Inter-Bold.ttf","Inter-ExtraBold.ttf","Inter-Black.ttf"]){
  const p=path.join(__dirname,"assets","fonts",f);
  if(fs.existsSync(p))try{GlobalFonts.registerFromPath(p,FONT);count++;}catch(e){console.error("[FONT]",e.message);}
 }
 if(!IS_WORKER)console.log(count?"[FONT] Inter registered":"[FONT] Inter files not found");
}
registerFonts();

function numeric(v){
 if(v==null||v==="")return null;
 if(typeof v==="number")return Number.isFinite(v)?v:null;
 const m=String(v).trim().replace(/,/g,"").match(/^([-+]?(?:\d+\.?\d*|\.\d+))\s*([KMB])?$/i);
 if(!m)return null;
 const n=Number(m[1]),f=({K:1e3,M:1e6,B:1e9})[String(m[2]||"").toUpperCase()]||1;
 return Number.isFinite(n)?n*f:null;
}
function measured(c,s){
 const text=String(s??""),key=c.font+"\0"+text;
 let width=measureCache.get(key);
 if(width===undefined){
  width=c.measureText(text).width;measureCache.set(key,width);
  if(measureCache.size>4096)measureCache.delete(measureCache.keys().next().value);
 }
 return width;
}
function rr(c,x,y,w,h,r,fill,stroke=null,lw=1){
 c.beginPath();c.roundRect(x,y,w,h,r);
 if(fill){c.fillStyle=fill;c.fill();}
 if(stroke){c.lineWidth=lw;c.strokeStyle=stroke;c.stroke();}
}
function grad(c,x,y,w,h,stops,vertical=true){
 const g=vertical?c.createLinearGradient(x,y,x,y+h):c.createLinearGradient(x,y,x+w,y);
 for(const s of stops)g.addColorStop(s[0],s[1]);
 return g;
}
function resetShadow(c){c.shadowColor="transparent";c.shadowBlur=0;c.shadowOffsetX=0;c.shadowOffsetY=0;}
function line(c,x1,y1,x2,y2,color="#ffffff20",width=1){
 c.beginPath();c.moveTo(x1,y1);c.lineTo(x2,y2);c.strokeStyle=color;c.lineWidth=width;c.stroke();
}
function dot(c,x,y,r,color){c.beginPath();c.arc(x,y,r,0,Math.PI*2);c.fillStyle=color;c.fill();}
function txt(c,s,x,y,size=14,color=C.white,weight=800,align="left"){
 c.font=`${weight} ${size}px "${FONT}"`;c.fillStyle=color;c.textAlign=align;c.textBaseline="middle";c.fillText(String(s??""),x,y);
}
function fit(c,s,x,y,maxW,size=50,min=9,color=C.white,weight=900,align="center"){
 let z=size;c.font=`${weight} ${z}px "${FONT}"`;
 while(measured(c,s)>maxW&&z>min){z--;c.font=`${weight} ${z}px "${FONT}"`;}
 txt(c,s,x,y,z,color,weight,align);return z;
}
function wrapText(c,value,x,y,maxW,lineH,size,color,weight=800,maxLines=2){
 const words=String(value||"").trim().split(/\s+/),lines=[];
 let current="";c.font=`${weight} ${size}px "${FONT}"`;
 for(const word of words){
  const test=current?current+" "+word:word;
  if(measured(c,test)>maxW&&current){lines.push(current);current=word;}else current=test;
 }
 if(current)lines.push(current);
 const shown=lines.slice(0,maxLines);
 if(lines.length>maxLines&&shown.length){
  let last=shown[shown.length-1];
  while(last.length&&measured(c,last+"…")>maxW)last=last.slice(0,-1);
  shown[shown.length-1]=last+"…";
 }
 for(let i=0;i<shown.length;i++)txt(c,shown[i],x,y+i*lineH,size,color,weight,"left");
 return shown.length;
}
function panel(c,x,y,w,h,border=C.border,r=18,glow=null){
 c.save();c.shadowColor="#0009";c.shadowBlur=22;c.shadowOffsetY=7;
 rr(c,x,y,w,h,r,grad(c,x,y,w,h,[[0,"#111a35f5"],[.55,"#0b1024fa"],[1,"#070b19f8"]]),border);
 resetShadow(c);
 if(glow){c.shadowColor=glow;c.shadowBlur=15;rr(c,x+1,y+1,w-2,h-2,r,null,glow);}
 resetShadow(c);c.restore();
}
function icon(c,type,x,y,size,color=C.blue){
 c.save();c.translate(x,y);c.scale(size/24,size/24);
 c.strokeStyle=color;c.fillStyle=color;c.lineWidth=2.2;c.lineCap="round";c.lineJoin="round";c.beginPath();
 if(type==="trend"){c.moveTo(4,17);c.lineTo(17,4);c.moveTo(8,4);c.lineTo(17,4);c.lineTo(17,13);}
 else if(type==="bolt"){c.moveTo(13,2);c.lineTo(6,13);c.lineTo(11,13);c.lineTo(9,22);c.lineTo(18,9);c.lineTo(13,9);c.closePath();}
 else if(type==="flag"){c.moveTo(6,22);c.lineTo(6,3);c.lineTo(19,5);c.lineTo(16,10);c.lineTo(19,15);c.lineTo(6,13);c.stroke();c.restore();return;}
 else if(type==="refresh"){c.arc(12,12,8,Math.PI*.15,Math.PI*1.75);c.moveTo(18,3);c.lineTo(19,9);c.lineTo(13,8);}
 else if(type==="chart"){c.moveTo(3,19);c.lineTo(3,5);c.moveTo(3,19);c.lineTo(21,19);c.moveTo(6,15);c.lineTo(10,11);c.lineTo(14,13);c.lineTo(20,6);}
 c.stroke();c.restore();
}
function staticLayer(){
 if(staticReady&&staticCanvas)return;
 staticCanvas=createCanvas(W,H);const c=staticCanvas.getContext("2d");
 c.fillStyle=grad(c,0,0,W,H,[[0,"#172451"],[.25,"#0b1022"],[.7,"#070a17"],[1,"#040610"]]);c.fillRect(0,0,W,H);
 const bg=c.createRadialGradient(640,100,20,640,100,800);
 bg.addColorStop(0,"#15285a44");bg.addColorStop(1,"#05071300");c.fillStyle=bg;c.fillRect(0,0,W,H);
 const top=48,left=10,sideW=330,mainX=352,gap=12,cardW=(918-gap*2)/3;
 panel(c,left,top,sideW,138,"#743dff",17,"#6e29ff28");
 panel(c,left,top+150,sideW,256,"#245caa",17,"#167bff20");
 for(let i=0;i<3;i++){
  const x=mainX+i*(cardW+gap),border=["#287bff","#2869c9","#793dff"][i];
  panel(c,x,top,cardW,406,border,19,i===2?"#8b36ff25":"#168fff22");
 }
 panel(c,10,466,1260,214,"#4268a8",17,"#1a6bff20");
 line(c,22,506,1258,506);line(c,22,680,1258,680);staticReady=true;
}
function avatarSource(url){
 const s=String(url||"");if(!/googleusercontent\.com|ggpht\.com/i.test(s))return s;
 return /=s\d+[^?]*/i.test(s)?s.replace(/=s\d+[^?]*/i,"=s160-c"):(s.includes("?")?s+"&sz=160":s+"=s160-c");
}
async function avatar(url){
 if(!url)return null;
 const src=avatarSource(url);if(images.has(src))return images.get(src);
 const task=(async()=>{try{
  const r=await fetch(src,{signal:AbortSignal.timeout(9000)});
  if(!r.ok)throw Error("HTTP "+r.status);
  const len=Number(r.headers.get("content-length")||0);if(len>2e6)throw Error("Avatar too large");
  const b=Buffer.from(await r.arrayBuffer());if(b.length>2e6)throw Error("Avatar too large");
  return await loadImage(b);
 }catch(e){console.error("[AVATAR]",e.message);return null;}})();
 images.set(src,task);while(images.size>8)images.delete(images.keys().next().value);
 return task;
}
function drawAvatar(c,img,x,y,size,border=C.blue){
 c.save();c.beginPath();c.arc(x+size/2,y+size/2,size/2,0,Math.PI*2);c.clip();
 if(img){
  const scale=Math.max(size/img.width,size/img.height),w=img.width*scale,h=img.height*scale;
  c.drawImage(img,x+(size-w)/2,y+(size-h)/2,w,h);
 }else{c.fillStyle="#182544";c.fillRect(x,y,size,size);txt(c,"?",x+size/2,y+size/2,size*.48,"#9cb9ee",900,"center");}
 c.restore();c.save();c.shadowColor="#168fff77";c.shadowBlur=13;
 c.beginPath();c.arc(x+size/2,y+size/2,size/2-1.5,0,Math.PI*2);
 c.lineWidth=2.5;c.strokeStyle=border;c.stroke();resetShadow(c);c.restore();
}
function digits(v){
 let out="";for(let i=0;i<v.length;i++){const q=v.charCodeAt(i);if(q>=48&&q<=57)out+=v[i];}
 return out;
}
function drawRolling(c,id,value,x,y,maxW,size=50,color=C.white,decimals=0,align="center"){
 const n=numeric(value),target=n===null?"—":decimals?Number(n).toFixed(decimals):nf.format(Math.round(n)),now=Date.now();
 let s=rollStates.get(id);
 if(!s){
  s={target,previous:target,previousDigits:digits(target),targetDigits:digits(target),changed:now,layoutKey:""};
  rollStates.set(id,s);if(rollStates.size>128)rollStates.delete(rollStates.keys().next().value);
 }else if(s.target!==target){
  s.previous=s.target;s.previousDigits=s.targetDigits;s.target=target;s.targetDigits=digits(target);s.changed=now;s.layoutKey="";
 }
 const layoutKey=size+":"+maxW;
 if(s.layoutKey!==layoutKey){
  let fs=size;c.font=`900 ${fs}px "${FONT}"`;
  while(measured(c,target)>maxW&&fs>9){fs--;c.font=`900 ${fs}px "${FONT}"`;}
  s.fontSize=fs;c.font=`900 ${fs}px "${FONT}"`;
  const widths=new Float64Array(target.length);let width=0;
  for(let i=0;i<target.length;i++){widths[i]=c.measureText(target[i]).width;width+=widths[i];}
  s.widths=widths;s.width=width;s.layoutKey=layoutKey;
 }
 const progress=Math.max(0,Math.min(1,(now-s.changed)/450));
 const fs=s.fontSize,width=s.width,scale=Math.min(1,maxW/Math.max(1,width)),drawW=width*scale;
 const start=align==="right"?x+maxW-drawW:align==="left"?x:x+(maxW-drawW)/2;
 c.save();c.font=`900 ${fs}px "${FONT}"`;c.translate(start,y);c.scale(scale,1);
 c.textBaseline="middle";c.textAlign="left";c.fillStyle=color;
 const old=s.previousDigits,newD=s.targetDigits,offset=old.length-newD.length;
 let digit=0,cursor=0;
 for(let i=0;i<target.length;i++){
  const ch=target[i],code=target.charCodeAt(i),isDigit=code>=48&&code<=57,cw=s.widths[i];
  if(isDigit){
   const oi=digit+offset,from=oi>=0&&oi<old.length?old[oi]:ch,changed=from!==ch&&progress<1;digit++;
   if(changed){
    c.save();c.beginPath();c.rect(cursor,-fs*.58,cw,fs*1.16);c.clip();
    c.fillText(from,cursor,-fs*progress);c.fillText(ch,cursor,fs*(1-progress));c.restore();
   }else c.fillText(ch,cursor,0);
  }else c.fillText(ch,cursor,0);
  cursor+=cw;
 }
 c.restore();if(progress>=1)s.previous=s.target;
}
function drawChart(c,x,y,w,h){
 const a=history.subs;if(a.length<2)return;
 const key=history.lastSample+":"+w+":"+h;
 if(chartCanvas&&chartCacheKey===key){c.drawImage(chartCanvas,x,y,w,h);return;}
 if(!chartCanvas){chartCanvas=createCanvas(Math.ceil(w),Math.ceil(h));chartContext=chartCanvas.getContext("2d");}
 else if(chartCanvas.width!==Math.ceil(w)||chartCanvas.height!==Math.ceil(h)){chartCanvas.width=Math.ceil(w);chartCanvas.height=Math.ceil(h);}
 chartCacheKey=key;const d=chartContext;
 d.clearRect(0,0,chartCanvas.width,chartCanvas.height);
 let min=Infinity,max=-Infinity;
 for(let i=0;i<a.length;i++){if(a[i]<min)min=a[i];if(a[i]>max)max=a[i];}
 const range=Math.max(1,max-min);
 if(!chartX||chartX.length!==a.length){chartX=new Float64Array(a.length);chartY=new Float64Array(a.length);}
 for(let i=0;i<a.length;i++){chartX[i]=i/(a.length-1)*w;chartY[i]=h-5-(a[i]-min)/range*(h-13);}
 d.save();const g=d.createLinearGradient(0,0,0,h);g.addColorStop(0,"#18e9d959");g.addColorStop(1,"#18e9d900");
 d.beginPath();d.moveTo(chartX[0],h);
 for(let i=0;i<chartX.length;i++)d.lineTo(chartX[i],chartY[i]);
 d.lineTo(chartX[chartX.length-1],h);d.closePath();d.fillStyle=g;d.fill();
 d.beginPath();for(let i=0;i<chartX.length;i++){if(i)d.lineTo(chartX[i],chartY[i]);else d.moveTo(chartX[i],chartY[i]);}
 d.lineWidth=8;d.strokeStyle="#168fff29";d.lineCap="round";d.lineJoin="round";d.stroke();
 d.beginPath();for(let i=0;i<chartX.length;i++){if(i)d.lineTo(chartX[i],chartY[i]);else d.moveTo(chartX[i],chartY[i]);}
 d.lineWidth=2.5;d.strokeStyle=C.teal;d.shadowColor=C.teal;d.shadowBlur=7;d.stroke();resetShadow(d);d.restore();
 c.drawImage(chartCanvas,x,y,w,h);
}
function takeSample(){
 if(!Number.isFinite(latestMain))return;
 const now=Date.now(),n=latestMain;history.subs.push(n);if(history.subs.length>18)history.subs.shift();
 history.samples.push({t:now,n});if(history.samples.length>6)history.samples.shift();
 if(history.samples.length>1){
  const a=history.samples[0],b=history.samples[history.samples.length-1],sec=(b.t-a.t)/1000;
  if(sec>0){history.rates.push((b.n-a.n)/sec);if(history.rates.length>14)history.rates.shift();}
 }
 history.lastSample=now;
}
function record(v){
 const n=numeric(v);if(n!==null)latestMain=n;
 if(!sampleTimer&&latestMain!==null){takeSample();sampleTimer=setInterval(takeSample,2000);sampleTimer.unref?.();}
}
function drawBars(c,x,y,w,h){
 const a=history.rates,len=Math.min(14,a.length);if(!len)return;
 const start=a.length-len,gap=5,bw=Math.min(17,(w-gap*(len-1))/len);let max=1;
 for(let i=start;i<a.length;i++){const v=Math.abs(a[i]);if(v>max)max=v;}
 c.save();c.shadowColor="#8b36ff88";c.shadowBlur=10;
 for(let i=0;i<len;i++){
  const v=a[start+i],bh=14+Math.min(1,Math.abs(v)/max)*Math.max(0,h-18),xx=x+i*(bw+gap),yy=y+h-bh;
  c.globalAlpha=.65+i/Math.max(1,len)*.35;
  rr(c,xx,yy,bw,bh,4,grad(c,xx,yy,bw,bh,[[0,"#b34cff"],[1,"#5420c7"]]));
 }
 resetShadow(c);c.restore();
}
function drawSources(c,st,fw){
 txt(c,"DATA SOURCES",24,486,15,"#d6e3ff",900);txt(c,"LIVE · BOTH PROVIDERS",1252,486,10,C.teal,900,"right");
 const x=24,y=545,cols=[142,270,270,270,270],heads=["","SCTOOLS EST.","SCTOOLS API","FREEWEBTOOLS EST.","FREEWEBTOOLS API"];
 let xx=x;
 for(let i=0;i<5;i++){txt(c,heads[i],xx+(i?cols[i]/2:0),526,11,"#e1eaff",900,i?"center":"left");xx+=cols[i];}
 const rows=[
  ["SUBSCRIBERS",st.estSubscribers,st.apiSubscribers,fw.estimatedSubscribers,fw.apiSubscribers],
  ["TOTAL VIEWS",st.estViews,st.apiViews,fw.estimatedViews,fw.viewCount],
  ["VIDEOS",st.estVideos,st.apiVideos,fw.estimatedVideos,fw.videoCount]
 ];
 rows.forEach((row,r)=>{
  const yy=y+r*29;txt(c,row[0],x,yy+13,10,"#799bff",900);let xx=x+cols[0];
  for(let j=1;j<5;j++){
   rr(c,xx+3,yy,cols[j]-7,25,6,"#080d1b","#26375b");
   drawRolling(c,"source-"+r+"-"+j,row[j],xx+8,yy+13,cols[j]-18,14,j%2?C.teal:"#c4d1ff");xx+=cols[j];
  }
 });
 const display=fw.displayCount??fw.estimation?.display_count??null;
 const hourly=fw.hourly??fw.estimation?.growth_rate_per_hour,daily=fw.daily??fw.estimation?.growth_rate_per_day;
 const confidence=String(fw.confidence||"—").toUpperCase();
 const items=[["DISPLAY COUNT",display],["HOURLY GROWTH",hourly],["DAILY GROWTH",daily],["CONFIDENCE",confidence]];
 items.forEach((v,i)=>{
  const xx=24+i*310;line(c,xx,644,xx+292,644,"#26375b");
  txt(c,v[0],xx+146,654,8,"#c4d2f3",900,"center");
  if(i===3)fit(c,v[1],xx+146,670,280,13,9,C.teal,900);
  else drawRolling(c,"source-meta-"+i,v[1],xx+5,670,282,13,C.teal);
 });
}
function drawMain(data={}){
 staticLayer();
 if(!mainCanvas){mainCanvas=createCanvas(W,H);mainContext=mainCanvas.getContext("2d");}
 const l=data.lucan||{},m=data.mine||{},st=l.sctools||{},fw=l.freewebtools||{};
 const mst=m.sctools||{},mfw=m.freewebtools||{},lc=l.channel||{},mc=m.channel||{};
 const main=st.linearSubscribers??st.estSubscribers??fw.estimatedSubscribers??st.apiSubscribers??fw.apiSubscribers;
 const mainN=numeric(main),remaining=mainN===null?null:Math.max(0,60000000-mainN);
 const progress=mainN===null?0:Math.min(100,mainN/60000000*100),rate=history.rates.at(-1)??null;
 record(main);const c=mainContext;

 // Static background is opaque, so clearing the full frame first is unnecessary.
 c.drawImage(staticCanvas,0,0);

 txt(c,"LUCAN PEVIDOR",14,19,18,C.white,900);txt(c,"| ROAD TO 60M",169,19,17,"#a9c8ff",800);
 dot(c,1190,19,4,C.teal);txt(c,"LIVE",1202,19,11,C.teal,900);line(c,12,37,1268,37,"#ffffff20");
 const left=10,top=48,mainX=352,gap=12,cardW=298;
 drawAvatar(c,drawMain.avatar1,left+12,top+9,112);
 txt(c,lc.name||"Lucan Pevidor",left+137,top+38,20,C.white,900);
 txt(c,lc.handle||"@lucanpevidor",left+137,top+61,10,C.muted,800);
 const desc=lc.descriptionEnglish||lc.englishDescription||lc.descriptionEn||"Jesus loves you! I hope every video makes you smile!";
 wrapText(c,desc,left+137,top+86,180,14,11,"#dce5ff",800,2);
 rr(c,left+137,top+112,96,18,6,grad(c,left+137,top+112,96,18,[[0,"#6423d9"],[1,"#2549bc"]]));
 txt(c,"ROAD TO 60M",left+185,top+121,9,C.white,900,"center");
 txt(c,"MY CHANNEL",22,216,15,"#d7e5ff",900);drawAvatar(c,drawMain.avatar2,left+226,top+164,58);
 txt(c,mc.name||"VYStats",left+14,top+184,14,C.white,900);txt(c,mc.handle||"@vystatsyt",left+14,top+205,10,C.muted,800);
 line(c,left+14,top+226,left+316,top+226,"#ffffff20");
 const mineCols=[
  {title:"SUBSCRIBERS",a:mst.estSubscribers??mfw.estimatedSubscribers,b:mst.apiSubscribers??mfw.apiSubscribers},
  {title:"VIEWS",a:mst.estViews??mfw.estimatedViews,b:mst.apiViews??mfw.viewCount},
  {title:"VIDEOS",a:mst.estVideos??mfw.estimatedVideos,b:mst.apiVideos??mfw.videoCount}
 ];
 mineCols.forEach((v,i)=>{
  const x=left+14+i*101;txt(c,v.title,x+42,top+249,9,"#b8caff",900,"center");
  txt(c,"EST.",x,top+277,8,C.muted,900);drawRolling(c,"mine-est-"+i,v.a,x+2,top+294,94,14,C.white);
  txt(c,"API",x,top+327,8,C.muted,900);drawRolling(c,"mine-api-"+i,v.b,x+2,top+344,94,14,C.white);
  if(i)line(c,x-7,top+237,x-7,top+375,"#ffffff20");
 });
 for(let i=0;i<3;i++){
  const x=mainX+i*(cardW+gap),center=x+cardW/2;
  if(i===0){
   icon(c,"trend",center-12,top+66,22,C.blue);
   txt(c,"LUCAN · LIVE SUBSCRIBERS",center,top+29,15,"#d7e3ff",900,"center");
   txt(c,"(LINEAR ESTIMATE)",center,top+49,10,"#d7e3ff",800,"center");
   drawRolling(c,"lucanCount",main,x+12,top+169,cardW-24,47,C.white);
   drawChart(c,x+18,top+211,cardW-36,88);
   const values=[["LINEAR ESTIMATE",st.linearSubscribers??st.estSubscribers],["HOURLY GAIN",st.hourly??fw.hourly],["DAILY GAIN",st.daily??fw.daily]];
   values.forEach((v,j)=>{
    const xx=x+cardW*(j+.5)/3;txt(c,v[0],xx,top+337,8,"#b9caff",900,"center");
    drawRolling(c,"lucan-metric-"+j,v[1],xx-cardW/6+2,top+365,cardW/3-4,15,C.teal);
   });
  }else if(i===1){
   icon(c,"bolt",x+cardW/2-103,top+28,21,C.blue);
   txt(c,"SUBS GAINED PER SEC",center+8,top+40,13,"#d7e3ff",900,"center");
   txt(c,rate!==null&&rate<0?"−":"+",center-57,top+165,48,C.white,900,"right");
   drawRolling(c,"lucanRate",rate===null?null:Math.abs(rate),center-50,top+165,cardW/2+54,43,C.white,2,"left");
   drawBars(c,x+22,top+250,cardW-44,82);txt(c,"LIVE AVERAGE",center,top+365,11,C.teal,900,"center");
  }else{
   icon(c,"flag",x+cardW/2-105,top+27,22,C.blue);
   txt(c,"SUBSCRIBERS REMAINING",center+8,top+31,12,"#d7e3ff",900,"center");
   txt(c,"TO 60,000,000",center,top+51,11,"#d7e3ff",800,"center");
   drawRolling(c,"lucanRemaining",remaining,x+12,top+174,cardW-24,44,C.white);
   const px=x+20,py=top+255,pw=cardW-40;rr(c,px,py,pw,13,9,"#111f43");
   if(progress>0)rr(c,px,py,pw*progress/100,13,9,grad(c,px,py,pw,13,[[0,C.purple],[.5,C.blue],[1,C.teal]]));
   txt(c,"ROAD TO 60M",px,py+29,9,"#b9caff",900);
   drawRolling(c,"goalPercent",progress,px+pw-59,py+29,59,10,C.white,1,"right");
   txt(c,"SUBSCRIBERS LEFT",center,top+365,11,C.teal,900,"center");
  }
 }
 drawSources(c,st,fw);
 const updated=Math.max(Number(l.updated)||0,Number(m.updated)||0);
 icon(c,"refresh",18,700,11,"#b9caff");
 txt(c,updated?"UPDATED "+new Date(updated).toLocaleTimeString():"WAITING FOR DATA",31,700,10,"#b9caff",900);
 dot(c,1240,700,3,l.updated||m.updated?C.teal:C.red);
 txt(c,l.updated||m.updated?"CONNECTED":"CONNECTING",1260,700,10,l.updated||m.updated?C.teal:C.red,900,"right");
 return mainCanvas;
}
function extractRawFrame(canvas){
 const start=process.hrtime.bigint();let result;
 if(typeof canvas.data==="function"){rawPixelMethod="canvas.data()";result=canvas.data();}
 else{
  rawPixelMethod="getImageData fallback";
  const im=mainContext.getImageData(0,0,W,H);
  result=Buffer.from(im.data.buffer,im.data.byteOffset,im.data.byteLength);
 }
 const extractMs=elapsed(start);
 if(!Buffer.isBuffer(result))throw Error("Raw canvas API did not return a Buffer");
 if(result.length!==FRAME_BYTES)throw Error("Invalid RGBA frame size: "+result.length+" expected "+FRAME_BYTES);
 return{result,extractMs};
}
async function renderInternalUnlocked(data={},mode="png",avatarPair,metrics){
 const start=process.hrtime.bigint();
 drawMain.avatar1=avatarPair[0];drawMain.avatar2=avatarPair[1];
 const canvas=drawMain(data),rendered=process.hrtime.bigint();
 let result,extractMs=0;
 if(mode==="raw"){const raw=extractRawFrame(canvas);result=raw.result;extractMs=raw.extractMs;}
 else result=canvas.toBuffer("image/png");
 const done=process.hrtime.bigint();
 Object.assign(timing,{
  avatarWaitMs:metrics.avatarWaitMs,queueWaitMs:metrics.queueWaitMs,
  renderMs:elapsed(start,rendered),bufferMs:elapsed(rendered,done),
  rawBufferMs:extractMs,pipelineTotalMs:elapsed(start,done),totalMs:elapsed(metrics.requestStart,done)
 });
 return result;
}
function renderInternal(data={},mode="png"){
 const requestStart=process.hrtime.bigint(),avatarStart=process.hrtime.bigint();
 const avatarTask=Promise.all([avatar(data.lucan?.channel?.avatar),avatar(data.mine?.channel?.avatar)]);
 return avatarTask.then(pair=>{
  const queueStart=process.hrtime.bigint(),metrics={requestStart,avatarWaitMs:elapsed(avatarStart,queueStart),queueWaitMs:0};
  const task=renderQueue.then(()=>{
   metrics.queueWaitMs=elapsed(queueStart);return renderInternalUnlocked(data,mode,pair,metrics);
  },()=>{
   metrics.queueWaitMs=elapsed(queueStart);return renderInternalUnlocked(data,mode,pair,metrics);
  });
  renderQueue=task.then(()=>undefined,()=>undefined);return task;
 });
}
function stats(a){
 if(!a.length)return{averageMs:0,medianMs:0,p95Ms:0,minMs:0,maxMs:0};
 const s=[...a].sort((x,y)=>x-y),avg=a.reduce((x,y)=>x+y,0)/a.length;
 const p=q=>s[Math.min(s.length-1,Math.ceil(s.length*q)-1)],r=n=>+n.toFixed(2);
 return{averageMs:r(avg),medianMs:r(p(.5)),p95Ms:r(p(.95)),minMs:r(s[0]),maxMs:r(s[s.length-1])};
}
function memorySnapshot(){
 const m=process.memoryUsage();
 return{rssMiB:mib(m.rss),heapUsedMiB:mib(m.heapUsed),heapTotalMiB:mib(m.heapTotal),externalMiB:mib(m.external),arrayBuffersMiB:mib(m.arrayBuffers||0)};
}

if(IS_WORKER){
 parentPort.on("message",async msg=>{
  const{id,mode,data}=msg;
  try{
   const started=process.hrtime.bigint(),result=await renderInternal(data,mode);
   const renderedMs=elapsed(started),length=result.byteLength,prepStart=process.hrtime.bigint();
   let transfer=null,byteOffset=0,transferCopyMs=0,zeroCopy=false;

   // Preserve zero-copy transfer when the Buffer owns its entire ArrayBuffer.
   if(result.buffer instanceof ArrayBuffer&&result.byteOffset===0&&result.byteLength===result.buffer.byteLength){
    transfer=result.buffer;zeroCopy=true;
   }else{
    const copyStart=process.hrtime.bigint();
    transfer=new ArrayBuffer(length);
    new Uint8Array(transfer).set(new Uint8Array(result.buffer,result.byteOffset,length));
    transferCopyMs=elapsed(copyStart);
   }
   const transferPrepareMs=elapsed(prepStart);
   const meta={...timing,workerMs:renderedMs,transferCopyMs,transferPrepareMs,zeroCopyTransfer:zeroCopy,rawPixelMethod,memory:memorySnapshot()};
   try{
    parentPort.postMessage({id,ok:true,buffer:transfer,byteOffset,byteLength:length,meta},[transfer]);
   }catch(firstError){
    if(!zeroCopy)throw firstError;
    const copyStart=process.hrtime.bigint(),fallback=new ArrayBuffer(length);
    new Uint8Array(fallback).set(result);
    meta.transferCopyMs=elapsed(copyStart);meta.zeroCopyTransfer=false;
    meta.transferPrepareMs+=meta.transferCopyMs;
    parentPort.postMessage({id,ok:true,buffer:fallback,byteOffset:0,byteLength:length,meta},[fallback]);
   }
  }catch(e){parentPort.postMessage({id,ok:false,error:e.stack||e.message});}
 });
}else{
 let worker=null,nextId=0;
 const pending=new Map(),eventLoop=monitorEventLoopDelay({resolution:20});
 eventLoop.enable();

 function failWorker(error){
  for(const [id,p] of pending){p.reject(error);pending.delete(id);}
  console.error("[RENDER WORKER]",error?.stack||error);
 }
 function startWorker(){
  if(worker)return;
  worker=new Worker(__filename);
  worker.on("message",msg=>{
   const p=pending.get(msg.id);if(!p)return;pending.delete(msg.id);
   if(!msg.ok){p.reject(Error(msg.error));return;}
   const arrived=process.hrtime.bigint();
   const buffer=Buffer.from(msg.buffer,msg.byteOffset||0,msg.byteLength||msg.buffer.byteLength);
   p.resolve({buffer,meta:{...msg.meta,roundTripMs:elapsed(p.started,arrived)}});
  });
  worker.on("error",e=>{failWorker(e);worker=null;});
  worker.on("exit",code=>{
   worker=null;if(code!==0)failWorker(Error("Renderer worker exited with code "+code));
  });
  console.log("[RENDER WORKER] Started embedded canvas worker");
 }
 function workerRequest(data,mode="png"){
  startWorker();const id=++nextId,started=process.hrtime.bigint();
  return new Promise((resolve,reject)=>{
   pending.set(id,{resolve,reject,started});
   try{worker.postMessage({id,data,mode});}
   catch(e){pending.delete(id);reject(e);}
  });
 }
 async function renderDashboard(data){const r=await workerRequest(data,"png");Object.assign(timing,r.meta);return r.buffer;}
 async function renderRawFrame(data){const r=await workerRequest(data,"raw");Object.assign(timing,r.meta);return r.buffer;}
 async function warmWorker(data){for(let i=0;i<8;i++)await renderRawFrame(data);}

 async function freshBenchmark(getData){
  const duration=10000,times=[],fetches=[],queues=[],avatars=[],renders=[],buffers=[],raws=[],pipelines=[],workerTimes=[],copies=[],prepares=[],roundTrips=[];
  let frames=0,missed=0,maxLate=0,maxRss=0,stopReason=null,next=process.hrtime.bigint();
  const initial=await getData();await warmWorker(initial);
  const start=process.hrtime.bigint(),cpu=process.cpuUsage(),mem=process.memoryUsage();next=start;

  while(elapsed(start)<duration){
   if(process.memoryUsage().rss>MAX_RSS){stopReason="Main-process memory safety limit reached";break;}
   const frameStart=process.hrtime.bigint(),data=await getData(),dataDone=process.hrtime.bigint();
   const fetchMs=elapsed(frameStart,dataDone);
   timing.dataFetchMs=fetchMs;
   const frame=await renderRawFrame(data),done=process.hrtime.bigint();
   if(!frame||frame.length!==FRAME_BYTES)throw Error("Invalid RGBA frame");
   times.push(elapsed(frameStart,done));fetches.push(fetchMs);
   queues.push(timing.queueWaitMs);avatars.push(timing.avatarWaitMs);
   renders.push(timing.renderMs);buffers.push(timing.bufferMs);raws.push(timing.rawBufferMs);
   pipelines.push(timing.pipelineTotalMs);workerTimes.push(timing.workerMs||0);
   copies.push(timing.transferCopyMs||0);prepares.push(timing.transferPrepareMs||0);
   roundTrips.push(timing.roundTripMs||0);frames++;
   maxRss=Math.max(maxRss,process.memoryUsage().rss);
   next+=FRAME_NS;
   if(done>next){
    const late=done-next,slots=late/FRAME_NS+1n;
    missed+=Number(slots);maxLate=Math.max(maxLate,Number(late)/1e6);next+=slots*FRAME_NS;
   }else{
    const wait=Number(next-done)/1e6;
    if(wait>0&&elapsed(start)+wait<duration)await sleep(wait);
    else if(elapsed(start)+wait>=duration)break;
   }
  }
  const total=elapsed(start),used=process.cpuUsage(cpu),after=process.memoryUsage();
  const delay={meanMs:round(eventLoop.mean/1e6),p95Ms:round(eventLoop.percentile(95)/1e6),p99Ms:round(eventLoop.percentile(99)/1e6),maxMs:round(eventLoop.max/1e6)};
  eventLoop.reset();
  return{
   renderer:"@napi-rs/canvas",mode:"worker-raw-rgba-stall-instrumented",worker:"worker_threads",
   resolution:`${W}x${H}`,targetFPS:FPS,durationMs:round(total),frames,frameSizeBytes:FRAME_BYTES,
   frameSizeMiB:mib(FRAME_BYTES),estimatedFPS:round(frames/Math.max(.001,total/1000)),
   frameTime:stats(times),
   stages:{
    dataFetch:stats(fetches),queueWait:stats(queues),avatarWait:stats(avatars),
    canvasRender:stats(renders),canvasDataExtraction:stats(raws),
    postRenderToBuffer:stats(buffers),rawBufferTotal:stats(raws),
    transferCopy:stats(copies),transferPreparation:stats(prepares),
    workerRender:stats(workerTimes),workerRoundTrip:stats(roundTrips),renderPipeline:stats(pipelines)
   },
   missedDeadlines:missed,missedDeadlinePercent:round(missed/Math.max(1,frames+missed)*100),
   maxLatenessMs:round(maxLate),mainThreadEventLoopDelay:delay,
   cpu:{userMs:round(used.user/1000),systemMs:round(used.system/1000)},
   memory:{
    rssBeforeMiB:mib(mem.rss),rssAfterMiB:mib(after.rss),rssPeakMiB:mib(maxRss),
    heapBeforeMiB:mib(mem.heapUsed),heapAfterMiB:mib(after.heapUsed),
    externalBeforeMiB:mib(mem.external),externalAfterMiB:mib(after.external),
    arrayBuffersBeforeMiB:mib(mem.arrayBuffers||0),arrayBuffersAfterMiB:mib(after.arrayBuffers||0)
   },
   stopReason
  };
 }

 function attach(app,getData){
  app.get("/api/renderer/preview.png",async(req,res)=>{
   if(benchmarkActive)return res.status(503).send("Benchmark running; retry shortly");
   try{
    const png=await renderDashboard(await getData());
    res.set({"Content-Type":"image/png","Cache-Control":"no-store, no-cache, must-revalidate"}).send(png);
   }catch(e){console.error("[CANVAS PREVIEW]",e.stack||e);if(!res.headersSent)res.status(500).send(e.message);}
  });
  app.get("/api/renderer/benchmark",async(req,res)=>{
   if(benchmarkActive)return res.status(409).json({error:"Benchmark already running"});
   benchmarkActive=true;
   try{res.set("Cache-Control","no-store");res.json(await freshBenchmark(getData));}
   catch(e){console.error("[CANVAS BENCHMARK]",e.stack||e);if(!res.headersSent)res.status(500).json({error:"Benchmark failed",message:e.message});}
   finally{benchmarkActive=false;}
  });
  const diagnostics=async(req,res)=>{
   if(benchmarkActive)return res.status(409).json({error:"Another benchmark is running"});
   benchmarkActive=true;
   try{
    const frame=await renderRawFrame(await getData()),mem=memorySnapshot();
    res.set("Cache-Control","no-store").json({
     renderer:"@napi-rs/canvas",worker:"worker_threads",rawPixelMethod:timing.rawPixelMethod,
     resolution:`${W}x${H}`,frameBytes:frame.length,expectedBytes:FRAME_BYTES,
     valid:frame.length===FRAME_BYTES,fontRegistered:GlobalFonts.has(FONT),
     timing:{...timing},memory:mem,
     mainThreadEventLoopDelay:{
      meanMs:round(eventLoop.mean/1e6),p95Ms:round(eventLoop.percentile(95)/1e6),
      p99Ms:round(eventLoop.percentile(99)/1e6),maxMs:round(eventLoop.max/1e6)
     }
    });
   }catch(e){console.error("[CANVAS DIAGNOSTICS]",e.stack||e);if(!res.headersSent)res.status(500).json({error:"Canvas diagnostics failed",message:e.message});}
   finally{benchmarkActive=false;eventLoop.reset();}
  };
  app.get("/api/renderer/diagnostics",diagnostics);
  app.get("/api/renderer/multi-diagnostics",diagnostics);
  app.get("/api/renderer/takumi-cost",diagnostics);
 }
 startWorker();
 module.exports={renderDashboard,renderRawFrame,attach};
}
