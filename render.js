"use strict";
const fs=require("fs"),path=require("path"),{Worker,isMainThread,parentPort}=require("worker_threads");
console.log("[CANVAS VERSION]",require("@napi-rs/canvas/package.json").version);
const {createCanvas,loadImage,GlobalFonts}=require("@napi-rs/canvas"),{monitorEventLoopDelay,PerformanceObserver,performance}=require("perf_hooks");
const W=1280,H=720,FPS=10,FRAME_MS=1000/FPS,FRAME_NS=BigInt(Math.round(FRAME_MS*1e6)),FRAME_BYTES=W*H*4;
const nf=new Intl.NumberFormat("en-US"),MAX_RSS=440*1048576,IS_WORKER=!isMainThread,FONT="Inter";
const elapsed=(a,b=process.hrtime.bigint())=>Number(b-a)/1e6,mib=n=>+(n/1048576).toFixed(2),round=n=>+Number(n||0).toFixed(2);
const sleep=ms=>new Promise(r=>setTimeout(r,Math.max(1,ms)));
const C={bg:"#050713",panel:"#0b1024",panel2:"#101832",border:"#273a68",blue:"#27a9ff",purple:"#8b36ff",teal:"#25e5c0",white:"#f5f7ff",muted:"#aab8df",red:"#ff4267"};
const images=new Map(),rollStates=new Map(),measureCache=new Map(),fontCache=new Map(),wrapCache=new Map(),avatarSprites=new WeakMap(),fallbackSprites=new Map();
const history={subs:[],rates:[],samples:[],lastSample:0};
const timing={dataFetchMs:0,avatarWaitMs:0,queueWaitMs:0,buildMs:0,renderMs:0,bufferMs:0,rawBufferMs:0,pipelineTotalMs:0,totalMs:0,transferCopyMs:0,transferPrepareMs:0,roundTripMs:0};
let benchmarkActive=false,latestMain=null,sampleTimer=null,staticCanvas=null,staticReady=false,mainCanvas=null,mainContext=null;
let chartCanvas=null,chartContext=null,chartCacheKey="",chartX=null,chartY=null,barSprite=null,barsCanvas=null,barsContext=null,barsKey="",goalGradient=null,profileGradient=null,lastUpdated=-1,lastUpdatedText="",renderQueue=Promise.resolve(),rawPixelMethod="canvas.data()",lastDrawMetrics=null;
let lastExtractProbe=null,gcStats={count:0,durationMs:0},gcEvents=[],workerLoop=null,gcObserver=null;

function collectGc(entries){for(const e of entries||[]){gcStats.count++;gcStats.durationMs+=e.duration;gcEvents.push({startTimeMs:round(e.startTime),durationMs:round(e.duration),kind:e.kind,flags:e.flags});if(gcEvents.length>128)gcEvents.shift();}}
function font(size,weight=800){const key=weight+":"+size;let v=fontCache.get(key);if(!v){v=`${weight} ${size}px "${FONT}"`;fontCache.set(key,v);}return v;}
function registerFonts(){const root=path.join(__dirname,"node_modules","@fontsource","inter","files"),files=["inter-latin-700-normal.woff2","inter-latin-800-normal.woff2","inter-latin-900-normal.woff2"];let count=0;for(const f of files){const p=path.join(root,f);if(fs.existsSync(p))try{GlobalFonts.registerFromPath(p,FONT);count++;}catch(e){console.error("[FONT]",e.message);}}for(const f of ["Inter-Bold.ttf","Inter-ExtraBold.ttf","Inter-Black.ttf"]){const p=path.join(__dirname,"assets","fonts",f);if(fs.existsSync(p))try{GlobalFonts.registerFromPath(p,FONT);count++;}catch(e){console.error("[FONT]",e.message);}}if(!IS_WORKER)console.log(count?"[FONT] Inter registered":"[FONT] Inter files not found");}
registerFonts();
function numeric(v){if(v==null||v==="")return null;if(typeof v==="number")return Number.isFinite(v)?v:null;const m=String(v).trim().replace(/,/g,"").match(/^([-+]?(?:\d+\.?\d*|\.\d+))\s*([KMB])?$/i);if(!m)return null;const n=Number(m[1]),f=({K:1e3,M:1e6,B:1e9})[String(m[2]||"").toUpperCase()]||1;return Number.isFinite(n)?n*f:null;}
function measured(c,s){const text=String(s??""),key=c.font+"\0"+text;let width=measureCache.get(key);if(width===undefined){width=c.measureText(text).width;measureCache.set(key,width);if(measureCache.size>4096)measureCache.delete(measureCache.keys().next().value);}return width;}
function rr(c,x,y,w,h,r,fill,stroke=null,lw=1){c.beginPath();c.roundRect(x,y,w,h,r);if(fill){c.fillStyle=fill;c.fill();}if(stroke){c.lineWidth=lw;c.strokeStyle=stroke;c.stroke();}}
function grad(c,x,y,w,h,stops,vertical=true){const g=vertical?c.createLinearGradient(x,y,x,y+h):c.createLinearGradient(x,y,x+w,y);for(const s of stops)g.addColorStop(s[0],s[1]);return g;}
function resetShadow(c){c.shadowColor="transparent";c.shadowBlur=0;c.shadowOffsetX=0;c.shadowOffsetY=0;}
function line(c,x1,y1,x2,y2,color="#ffffff20",width=1){c.beginPath();c.moveTo(x1,y1);c.lineTo(x2,y2);c.strokeStyle=color;c.lineWidth=width;c.stroke();}
function dot(c,x,y,r,color){c.beginPath();c.arc(x,y,r,0,Math.PI*2);c.fillStyle=color;c.fill();}
function txt(c,s,x,y,size=14,color=C.white,weight=800,align="left"){c.font=font(size,weight);c.fillStyle=color;c.textAlign=align;c.textBaseline="middle";c.fillText(String(s??""),x,y);}
function fit(c,s,x,y,maxW,size=50,min=9,color=C.white,weight=900,align="center"){let z=size;c.font=font(z,weight);while(measured(c,s)>maxW&&z>min){z--;c.font=font(z,weight);}txt(c,s,x,y,z,color,weight,align);return z;}
function wrapText(c,value,x,y,maxW,lineH,size,color,weight=800,maxLines=2){const text=String(value||"").trim(),key=text+"|"+maxW+"|"+size+"|"+weight+"|"+maxLines;let shown=wrapCache.get(key);if(!shown){const words=text.split(/\s+/),lines=[];let current="";c.font=font(size,weight);for(const word of words){const test=current?current+" "+word:word;if(measured(c,test)>maxW&&current){lines.push(current);current=word;}else current=test;}if(current)lines.push(current);shown=lines.slice(0,maxLines);if(lines.length>maxLines&&shown.length){let last=shown[shown.length-1];while(last.length&&measured(c,last+"…")>maxW)last=last.slice(0,-1);shown[shown.length-1]=last+"…";}wrapCache.set(key,shown);if(wrapCache.size>128)wrapCache.delete(wrapCache.keys().next().value);}for(let i=0;i<shown.length;i++)txt(c,shown[i],x,y+i*lineH,size,color,weight,"left");return shown.length;}
function panel(c,x,y,w,h,border=C.border,r=18,glow=null){c.save();c.shadowColor="#0009";c.shadowBlur=22;c.shadowOffsetY=7;rr(c,x,y,w,h,r,grad(c,x,y,w,h,[[0,"#111a35f5"],[.55,"#0b1024fa"],[1,"#070b19f8"]]),border);resetShadow(c);if(glow){c.shadowColor=glow;c.shadowBlur=15;rr(c,x+1,y+1,w-2,h-2,r,null,glow);}resetShadow(c);c.restore();}
function icon(c,type,x,y,size,color=C.blue){c.save();c.translate(x,y);c.scale(size/24,size/24);c.strokeStyle=color;c.fillStyle=color;c.lineWidth=2.2;c.lineCap="round";c.lineJoin="round";c.beginPath();if(type==="trend"){c.moveTo(4,17);c.lineTo(17,4);c.moveTo(8,4);c.lineTo(17,4);c.lineTo(17,13);}else if(type==="bolt"){c.moveTo(13,2);c.lineTo(6,13);c.lineTo(11,13);c.lineTo(9,22);c.lineTo(18,9);c.lineTo(13,9);c.closePath();}else if(type==="flag"){c.moveTo(6,22);c.lineTo(6,3);c.lineTo(19,5);c.lineTo(16,10);c.lineTo(19,15);c.lineTo(6,13);c.stroke();c.restore();return;}else if(type==="refresh"){c.arc(12,12,8,Math.PI*.15,Math.PI*1.75);c.moveTo(18,3);c.lineTo(19,9);c.lineTo(13,8);}else if(type==="chart"){c.moveTo(3,19);c.lineTo(3,5);c.moveTo(3,19);c.lineTo(21,19);c.moveTo(6,15);c.lineTo(10,11);c.lineTo(14,13);c.lineTo(20,6);}c.stroke();c.restore();}
function staticLayer(){if(staticReady&&staticCanvas)return;staticCanvas=createCanvas(W,H);const c=staticCanvas.getContext("2d");c.fillStyle=grad(c,0,0,W,H,[[0,"#172451"],[.25,"#0b1022"],[.7,"#070a17"],[1,"#040610"]]);c.fillRect(0,0,W,H);const bg=c.createRadialGradient(640,100,20,640,100,800);bg.addColorStop(0,"#15285a44");bg.addColorStop(1,"#05071300");c.fillStyle=bg;c.fillRect(0,0,W,H);const top=48,left=10,sideW=330,mainX=352,gap=12,cardW=(918-gap*2)/3;panel(c,left,top,sideW,138,"#743dff",17,"#6e29ff28");panel(c,left,top+150,sideW,256,"#245caa",17,"#167bff20");for(let i=0;i<3;i++){const x=mainX+i*(cardW+gap),border=i===0?"#287bff":i===1?"#2869c9":"#793dff";panel(c,x,top,cardW,406,border,19,i===2?"#8b36ff25":"#168fff22");}panel(c,10,466,1260,214,"#4268a8",17,"#1a6bff20");line(c,22,506,1258,506);line(c,22,680,1258,680);line(c,12,37,1268,37,"#ffffff20");txt(c,"LUCAN PEVIDOR",14,19,18,C.white,900);txt(c,"| ROAD TO 60M",169,19,17,"#a9c8ff",800);dot(c,1190,19,4,C.teal);txt(c,"LIVE",1202,19,11,C.teal,900);txt(c,"MY CHANNEL",22,216,15,"#d7e5ff",900);line(c,24,274,326,274,"#ffffff20");const colsX=left+14;for(let i=0;i<3;i++){const x=colsX+i*101;txt(c,i===0?"SUBSCRIBERS":i===1?"VIEWS":"VIDEOS",x+42,top+249,9,"#b8caff",900,"center");txt(c,"EST.",x,top+277,8,C.muted,900);txt(c,"API",x,top+327,8,C.muted,900);if(i)line(c,x-7,top+237,x-7,top+375,"#ffffff20");}const mainX2=352,gap2=12,cardW2=298;for(let i=0;i<3;i++){const x=mainX2+i*(cardW2+gap2),center=x+cardW2/2;if(i===0){icon(c,"trend",center-12,top+66,22,C.blue);txt(c,"LUCAN · LIVE SUBSCRIBERS",center,top+29,15,"#d7e3ff",900,"center");txt(c,"(LINEAR ESTIMATE)",center,top+49,10,"#d7e3ff",800,"center");txt(c,"LINEAR ESTIMATE",x+cardW2*.5/3,top+337,8,"#b9caff",900,"center");txt(c,"HOURLY GAIN",x+cardW2*1.5/3,top+337,8,"#b9caff",900,"center");txt(c,"DAILY GAIN",x+cardW2*2.5/3,top+337,8,"#b9caff",900,"center");}else if(i===1){icon(c,"bolt",x+cardW2/2-103,top+28,21,C.blue);txt(c,"SUBS GAINED PER SEC",center+8,top+40,13,"#d7e3ff",900,"center");txt(c,"LIVE AVERAGE",center,top+365,11,C.teal,900,"center");}else{icon(c,"flag",x+cardW2/2-105,top+27,22,C.blue);txt(c,"SUBSCRIBERS REMAINING",center+8,top+31,12,"#d7e3ff",900,"center");txt(c,"TO 60,000,000",center,top+51,11,"#d7e3ff",800,"center");txt(c,"ROAD TO 60M",x+20,top+284,9,"#b9caff",900);txt(c,"SUBSCRIBERS LEFT",center,top+365,11,C.teal,900,"center");}}txt(c,"DATA SOURCES",24,486,15,"#d6e3ff",900);txt(c,"LIVE · BOTH PROVIDERS",1252,486,10,C.teal,900,"right");const sx=24,cols=[142,270,270,270,270],heads=["","SCTOOLS EST.","SCTOOLS API","FREEWEBTOOLS EST.","FREEWEBTOOLS API"];let xx=sx;for(let i=0;i<5;i++){txt(c,heads[i],xx+(i?cols[i]/2:0),526,11,"#e1eaff",900,i?"center":"left");xx+=cols[i];}const rowNames=["SUBSCRIBERS","TOTAL VIEWS","VIDEOS"];for(let r=0;r<3;r++){const yy=545+r*29;txt(c,rowNames[r],sx,yy+13,10,"#799bff",900);let cellX=sx+cols[0];for(let j=1;j<5;j++){rr(c,cellX+3,yy,cols[j]-7,25,6,"#080d1b","#26375b");cellX+=cols[j];}}const metaNames=["DISPLAY COUNT","HOURLY GROWTH","DAILY GROWTH","CONFIDENCE"];for(let i=0;i<4;i++){const x=24+i*310;line(c,x,644,x+292,644,"#26375b");txt(c,metaNames[i],x+146,654,8,"#c4d2f3",900,"center");}staticReady=true;}
function avatarSource(url){const s=String(url||"");if(!/googleusercontent\.com|ggpht\.com/i.test(s))return s;return /=s\d+[^?]*/i.test(s)?s.replace(/=s\d+[^?]*/i,"=s160-c"):(s.includes("?")?s+"&sz=160":s+"=s160-c");}
function avatar(url){if(!url)return null;const src=avatarSource(url);let entry=images.get(src);if(entry){entry.used=Date.now();return entry.image||null;}entry={image:null,used:Date.now()};images.set(src,entry);entry.promise=(async()=>{try{const r=await fetch(src,{signal:AbortSignal.timeout(9000)});if(!r.ok)throw Error("HTTP "+r.status);const len=Number(r.headers.get("content-length")||0);if(len>2e6)throw Error("Avatar too large");const b=Buffer.from(await r.arrayBuffer());if(b.length>2e6)throw Error("Avatar too large");entry.image=await loadImage(b);}catch(e){console.error("[AVATAR]",e.message);if(images.get(src)===entry)images.delete(src);}finally{entry.promise=null;while(images.size>8){const oldest=[...images].filter(([,v])=>!v.promise).sort((a,b)=>a[1].used-b[1].used)[0];if(!oldest)break;images.delete(oldest[0]);}}})();return null;}
function getAvatarSprite(img,size,border){const pad=16,key=size+":"+border;let cache,sprite;if(img){cache=avatarSprites.get(img);if(!cache)avatarSprites.set(img,cache=new Map());sprite=cache.get(key);}else sprite=fallbackSprites.get(key);if(sprite)return sprite;sprite=createCanvas(size+pad*2,size+pad*2);const c=sprite.getContext("2d"),x=pad,y=pad;c.save();c.beginPath();c.arc(x+size/2,y+size/2,size/2,0,Math.PI*2);c.clip();if(img){const scale=Math.max(size/img.width,size/img.height),w=img.width*scale,h=img.height*scale;c.drawImage(img,x+(size-w)/2,y+(size-h)/2,w,h);}else{c.fillStyle="#182544";c.fillRect(x,y,size,size);txt(c,"?",x+size/2,y+size/2,size*.48,"#9cb9ee",900,"center");}c.restore();c.save();c.shadowColor="#168fff77";c.shadowBlur=13;c.beginPath();c.arc(x+size/2,y+size/2,size/2-1.5,0,Math.PI*2);c.lineWidth=2.5;c.strokeStyle=border;c.stroke();resetShadow(c);c.restore();if(img)cache.set(key,sprite);else fallbackSprites.set(key,sprite);return sprite;}
function drawAvatar(c,img,x,y,size,border=C.blue){c.drawImage(getAvatarSprite(img,size,border),x-16,y-16);}
function digits(v){let out="";for(let i=0;i<v.length;i++){const q=v.charCodeAt(i);if(q>=48&&q<=57)out+=v[i];}return out;}

/* Classic rolling digit wheels: each place rolls through 0–9 with a short cascade. */
function drawRolling(c,id,value,x,y,maxW,size=50,color=C.white,decimals=0,align="center"){const n=numeric(value),target=n===null?"—":decimals?Number(n).toFixed(decimals):nf.format(Math.round(n)),now=Date.now();let s=rollStates.get(id);if(!s){s={value,target,number:n,previousDigits:digits(target),targetDigits:digits(target),changed:now,layoutKey:"",direction:1};rollStates.set(id,s);if(rollStates.size>128)rollStates.delete(rollStates.keys().next().value);}else if(s.target!==target){s.previousDigits=s.targetDigits||digits(s.target);s.target=target;s.targetDigits=digits(target);s.direction=n===null||s.number===null||n>=s.number?1:-1;s.number=n;s.value=value;s.changed=now;s.layoutKey="";}else{s.value=value;s.number=n;}const layoutKey=size+":"+maxW+":"+target;if(s.layoutKey!==layoutKey){let fs=size;c.font=font(fs,900);while(measured(c,target)>maxW&&fs>9){fs--;c.font=font(fs,900);}s.fontSize=fs;c.font=font(fs,900);s.widths=new Float64Array(target.length);s.width=0;for(let i=0;i<target.length;i++){s.widths[i]=c.measureText(target[i]).width;s.width+=s.widths[i];}s.layoutKey=layoutKey;}const fs=s.fontSize,scale=Math.min(1,maxW/Math.max(1,s.width)),drawW=s.width*scale,start=align==="right"?x+maxW-drawW:align==="left"?x:x+(maxW-drawW)/2,elapsedMs=now-s.changed,duration=1250,old=s.previousDigits||s.targetDigits,newD=s.targetDigits,oldCount=old.length;c.save();c.font=font(fs,900);c.translate(start,y);c.scale(scale,1);c.textBaseline="middle";c.textAlign="left";c.fillStyle=color;let digitIndex=0,cursor=0;for(let i=0;i<target.length;i++){const ch=target[i],code=target.charCodeAt(i),isDigit=code>=48&&code<=57,cw=s.widths[i];if(!isDigit){c.fillText(ch,cursor,0);cursor+=cw;continue;}const place=newD.length-1-digitIndex,oldIndex=oldCount-1-place,from=oldIndex>=0?Number(old[oldIndex]):0,to=Number(ch),steps=s.direction>0?(to-from+10)%10:(from-to+10)%10,delay=place*32,progress=Math.max(0,Math.min(1,(elapsedMs-delay)/duration)),ease=1-Math.pow(1-progress,3);if(!steps||progress>=1){c.fillText(ch,cursor,0);}else{const position=from+s.direction*steps*ease,base=Math.floor(position),fraction=position-base;c.save();c.beginPath();c.rect(cursor,-fs*.57,cw,fs*1.14);c.clip();for(let k=-1;k<=2;k++){const d=((base+k)%10+10)%10;c.fillText(String(d),cursor,(k-fraction)*fs);}c.restore();}cursor+=cw;digitIndex++;}c.restore();if(elapsedMs>=duration+Math.max(0,newD.length-1)*32)s.previousDigits=s.targetDigits;}

function drawChart(c,x,y,w,h){const a=history.subs;if(a.length<2)return;const key=history.lastSample+":"+w+":"+h;if(chartCanvas&&chartCacheKey===key){c.drawImage(chartCanvas,x,y,w,h);return;}if(!chartCanvas){chartCanvas=createCanvas(Math.ceil(w),Math.ceil(h));chartContext=chartCanvas.getContext("2d");}else if(chartCanvas.width!==Math.ceil(w)||chartCanvas.height!==Math.ceil(h)){chartCanvas.width=Math.ceil(w);chartCanvas.height=Math.ceil(h);}chartCacheKey=key;const d=chartContext;d.clearRect(0,0,chartCanvas.width,chartCanvas.height);let min=Infinity,max=-Infinity;for(let i=0;i<a.length;i++){if(a[i]<min)min=a[i];if(a[i]>max)max=a[i];}const range=Math.max(1,max-min);if(!chartX||chartX.length!==a.length){chartX=new Float64Array(a.length);chartY=new Float64Array(a.length);}for(let i=0;i<a.length;i++){chartX[i]=i/(a.length-1)*w;chartY[i]=h-5-(a[i]-min)/range*(h-13);}d.save();const g=d.createLinearGradient(0,0,0,h);g.addColorStop(0,"#18e9d959");g.addColorStop(1,"#18e9d900");d.beginPath();d.moveTo(chartX[0],h);for(let i=0;i<chartX.length;i++)d.lineTo(chartX[i],chartY[i]);d.lineTo(chartX[chartX.length-1],h);d.closePath();d.fillStyle=g;d.fill();d.beginPath();for(let i=0;i<chartX.length;i++){if(i)d.lineTo(chartX[i],chartY[i]);else d.moveTo(chartX[i],chartY[i]);}d.lineWidth=8;d.strokeStyle="#168fff29";d.lineCap="round";d.lineJoin="round";d.stroke();d.beginPath();for(let i=0;i<chartX.length;i++){if(i)d.lineTo(chartX[i],chartY[i]);else d.moveTo(chartX[i],chartY[i]);}d.lineWidth=2.5;d.strokeStyle=C.teal;d.shadowColor=C.teal;d.shadowBlur=7;d.stroke();resetShadow(d);d.restore();c.drawImage(chartCanvas,x,y,w,h);}
function takeSample(){if(!Number.isFinite(latestMain))return;const now=Date.now(),n=latestMain;history.subs.push(n);if(history.subs.length>18)history.subs.shift();history.samples.push({t:now,n});if(history.samples.length>6)history.samples.shift();if(history.samples.length>1){const a=history.samples[0],b=history.samples[history.samples.length-1],sec=(b.t-a.t)/1000;if(sec>0){history.rates.push((b.n-a.n)/sec);if(history.rates.length>14)history.rates.shift();}}history.lastSample=now;}
function record(v){const n=numeric(v);if(n!==null)latestMain=n;if(!sampleTimer&&latestMain!==null){takeSample();sampleTimer=setInterval(takeSample,2000);sampleTimer.unref?.();}}
function initBarSprite(){if(barSprite)return;barSprite=createCanvas(17,128);const c=barSprite.getContext("2d");rr(c,0,0,17,128,4,grad(c,0,0,17,128,[[0,"#b34cff"],[1,"#5420c7"]]));}
function drawBars(c,x,y,w,h){const a=history.rates,len=Math.min(14,a.length);if(!len)return;const key=history.lastSample+":"+w+":"+h;if(!barsCanvas){barsCanvas=createCanvas(Math.ceil(w),Math.ceil(h));barsContext=barsCanvas.getContext("2d");}if(barsKey!==key){barsKey=key;initBarSprite();barsContext.clearRect(0,0,barsCanvas.width,barsCanvas.height);const start=a.length-len,gap=5,bw=Math.min(17,(w-gap*(len-1))/len);let max=1;for(let i=start;i<a.length;i++)max=Math.max(max,Math.abs(a[i]));const d=barsContext;d.save();d.shadowColor="#8b36ff88";d.shadowBlur=10;for(let i=0;i<len;i++){const bh=14+Math.min(1,Math.abs(a[start+i])/max)*Math.max(0,h-18);d.globalAlpha=.65+i/Math.max(1,len)*.35;d.drawImage(barSprite,i*(bw+gap),h-bh,bw,bh);}resetShadow(d);d.restore();}c.drawImage(barsCanvas,x,y);}
function drawSources(c,st,fw){const x=24,y=545;for(let r=0;r<3;r++)for(let j=1;j<5;j++){let value;if(r===0)value=j===1?st.estSubscribers:j===2?st.apiSubscribers:j===3?fw.estimatedSubscribers:fw.apiSubscribers;else if(r===1)value=j===1?st.estViews:j===2?st.apiViews:j===3?fw.estimatedViews:fw.viewCount;else value=j===1?st.estVideos:j===2?st.apiVideos:j===3?fw.estimatedVideos:fw.videoCount;const xx=x+142+(j-1)*270;drawRolling(c,"source-"+r+"-"+j,value,xx+8,y+r*29+13,252,14,j%2?C.teal:"#c4d1ff");}const display=fw.displayCount??fw.estimation?.display_count??null,hourly=fw.hourly??fw.estimation?.growth_rate_per_hour,daily=fw.daily??fw.estimation?.growth_rate_per_day,confidence=String(fw.confidence||"—").toUpperCase();drawRolling(c,"source-meta-0",display,29,670,282,13,C.teal);drawRolling(c,"source-meta-1",hourly,339,670,282,13,C.teal);drawRolling(c,"source-meta-2",daily,649,670,282,13,C.teal);fit(c,confidence,1090,670,280,13,9,C.teal,900);}
function drawMain(data={}){staticLayer();if(!mainCanvas){mainCanvas=createCanvas(W,H);mainContext=mainCanvas.getContext("2d",{alpha:false});}const drawStart=process.hrtime.bigint(),parts={};let t=drawStart;const l=data.lucan||{},m=data.mine||{},st=l.sctools||{},fw=l.freewebtools||{},mst=m.sctools||{},mfw=m.freewebtools||{},lc=l.channel||{},mc=m.channel||{},main=st.linearSubscribers??st.estSubscribers??fw.estimatedSubscribers??st.apiSubscribers??fw.apiSubscribers,mainN=numeric(main),remaining=mainN===null?null:Math.max(0,60000000-mainN),progress=mainN===null?0:Math.min(100,mainN/60000000*100),rate=history.rates.length?history.rates[history.rates.length-1]:null;record(main);const c=mainContext;c.drawImage(staticCanvas,0,0);parts.backgroundMs=elapsed(t);t=process.hrtime.bigint();const left=10,top=48,mainX=352,gap=12,cardW=298;drawAvatar(c,drawMain.avatar1,left+12,top+9,112);txt(c,lc.name||"Lucan Pevidor",left+137,top+38,20,C.white,900);txt(c,lc.handle||"@lucanpevidor",left+137,top+61,10,C.muted,800);const desc=lc.descriptionEnglish||lc.englishDescription||lc.descriptionEn||"Jesus loves you! I hope every video makes you smile!";wrapText(c,desc,left+137,top+86,180,14,11,"#dce5ff",800,2);if(!profileGradient)profileGradient=grad(c,left+137,top+112,96,18,[[0,"#6423d9"],[1,"#2549bc"]]);rr(c,left+137,top+112,96,18,6,profileGradient);txt(c,"ROAD TO 60M",left+185,top+121,9,C.white,900,"center");drawAvatar(c,drawMain.avatar2,left+226,top+164,58);txt(c,mc.name||"VYStats",left+14,top+184,14,C.white,900);txt(c,mc.handle||"@vystatsyt",left+14,top+205,10,C.muted,800);for(let i=0;i<3;i++){const x=left+14+i*101,a=i===0?mst.estSubscribers??mfw.estimatedSubscribers:i===1?mst.estViews??mfw.estimatedViews:mst.estVideos??mfw.estimatedVideos,b=i===0?mst.apiSubscribers??mfw.apiSubscribers:i===1?mst.apiViews??mfw.viewCount:mst.apiVideos??mfw.videoCount;drawRolling(c,"mine-est-"+i,a,x+2,top+294,94,14,C.white);drawRolling(c,"mine-api-"+i,b,x+2,top+344,94,14,C.white);}parts.profileMs=elapsed(t);t=process.hrtime.bigint();for(let i=0;i<3;i++){const x=mainX+i*(cardW+gap),center=x+cardW/2;if(i===0){drawRolling(c,"lucanCount",main,x+12,top+169,cardW-24,47,C.white);drawChart(c,x+18,top+211,cardW-36,88);drawRolling(c,"lucan-metric-0",st.linearSubscribers??st.estSubscribers,x+2,top+365,cardW/3-4,15,C.teal);drawRolling(c,"lucan-metric-1",st.hourly??fw.hourly,x+cardW/3+2,top+365,cardW/3-4,15,C.teal);drawRolling(c,"lucan-metric-2",st.daily??fw.daily,x+cardW*2/3+2,top+365,cardW/3-4,15,C.teal);}else if(i===1){txt(c,rate!==null&&rate<0?"−":"+",center-57,top+165,48,C.white,900,"right");drawRolling(c,"lucanRate",rate===null?null:Math.abs(rate),center-50,top+165,cardW/2+54,43,C.white,2,"left");drawBars(c,x+22,top+250,cardW-44,82);}else{drawRolling(c,"lucanRemaining",remaining,x+12,top+174,cardW-24,44,C.white);const px=x+20,py=top+255,pw=cardW-40;rr(c,px,py,pw,13,9,"#111f43");if(progress>0){if(!goalGradient)goalGradient=grad(c,px,py,pw,13,[[0,C.purple],[.5,C.blue],[1,C.teal]]);rr(c,px,py,pw*progress/100,13,9,goalGradient);}drawRolling(c,"goalPercent",progress,px+pw-59,py+29,59,10,C.white,1,"right");}}parts.mainCardsMs=elapsed(t);t=process.hrtime.bigint();drawSources(c,st,fw);parts.sourcesMs=elapsed(t);t=process.hrtime.bigint();const updated=Math.max(Number(l.updated)||0,Number(m.updated)||0);if(updated!==lastUpdated){lastUpdated=updated;lastUpdatedText=updated?"UPDATED "+new Date(updated).toLocaleTimeString():"WAITING FOR DATA";}icon(c,"refresh",18,700,11,"#b9caff");txt(c,lastUpdatedText,31,700,10,"#b9caff",900);dot(c,1240,700,3,l.updated||m.updated?C.teal:C.red);txt(c,l.updated||m.updated?"CONNECTED":"CONNECTING",1260,700,10,l.updated||m.updated?C.teal:C.red,900,"right");parts.footerMs=elapsed(t);parts.totalMs=elapsed(drawStart);lastDrawMetrics=parts;return mainCanvas;}

/* Production raw frames perform exactly ONE canvas.data() extraction per frame. */
function extractRawFrame(canvas){const before=process.memoryUsage(),threadCpu=typeof process.threadCpuUsage==="function",cpu=threadCpu?process.threadCpuUsage():process.cpuUsage(),start=process.hrtime.bigint();let result;if(typeof canvas.data==="function"){rawPixelMethod="canvas.data()";result=canvas.data();}else{rawPixelMethod="getImageData fallback";const im=canvas.getContext("2d").getImageData(0,0,W,H);result=Buffer.from(im.data.buffer,im.data.byteOffset,im.data.byteLength);}const extractMs=elapsed(start),used=threadCpu?process.threadCpuUsage(cpu):process.cpuUsage(cpu),after=process.memoryUsage();if(!Buffer.isBuffer(result))throw Error("Raw canvas API did not return a Buffer");if(result.length!==FRAME_BYTES)throw Error("Invalid RGBA frame size: "+result.length+" expected "+FRAME_BYTES);lastExtractProbe={cpuSource:threadCpu?"threadCpuUsage":"processCpuUsageFallback",wallMs:round(extractMs),cpuMs:round((used.user+used.system)/1000),cpuWallRatio:round((used.user+used.system)/1000/Math.max(.001,extractMs)),rssDeltaMiB:round(mib(after.rss-before.rss)),externalDeltaMiB:round(mib(after.external-before.external)),arrayBuffersDeltaMiB:round(mib((after.arrayBuffers||0)-(before.arrayBuffers||0)))};const bufferInfo={byteLength:result.byteLength,byteOffset:result.byteOffset,backingBytes:result.buffer.byteLength,zeroCopyEligible:result.byteOffset===0&&result.byteLength===result.buffer.byteLength};return{result,extractMs,bufferInfo};}
function stats(a){if(!a.length)return{averageMs:0,medianMs:0,p95Ms:0,minMs:0,maxMs:0};const s=[...a].sort((x,y)=>x-y),avg=a.reduce((x,y)=>x+y,0)/a.length,p=q=>s[Math.min(s.length-1,Math.ceil(s.length*q)-1)],r=n=>+n.toFixed(2);return{averageMs:r(avg),medianMs:r(p(.5)),p95Ms:r(p(.95)),minMs:r(s[0]),maxMs:r(s[s.length-1])};}
function memorySnapshot(){const m=process.memoryUsage();return{rssMiB:mib(m.rss),heapUsedMiB:mib(m.heapUsed),heapTotalMiB:mib(m.heapTotal),externalMiB:mib(m.external),arrayBuffersMiB:mib(m.arrayBuffers||0)};}

function renderInternalUnlocked(data={},mode="png",avatarPair,metrics,options={}){const start=process.hrtime.bigint();drawMain.avatar1=avatarPair[0];drawMain.avatar2=avatarPair[1];const canvas=drawMain(data),rendered=process.hrtime.bigint();let result=Buffer.alloc(0),extractMs=0,extractSamples=[];if(mode==="raw"){const raw=extractRawFrame(canvas);result=raw.result;extractMs=raw.extractMs;timing.rawBufferInfo=raw.bufferInfo;}else if(mode==="extract-batch"){const iterations=Math.max(1,Math.min(32,Number(options.iterations)||12));for(let i=0;i<iterations;i++){const raw=extractRawFrame(canvas);extractSamples.push({wallMs:round(raw.extractMs),cpuMs:lastExtractProbe?.cpuMs||0,cpuWallRatio:lastExtractProbe?.cpuWallRatio||0});}timing.extractBatch={iterations,samples:extractSamples,wall:stats(extractSamples.map(x=>x.wallMs)),cpu:stats(extractSamples.map(x=>x.cpuMs))};}else if(mode==="png")result=canvas.toBuffer("image/png");const done=process.hrtime.bigint();Object.assign(timing,{avatarWaitMs:metrics.avatarWaitMs,queueWaitMs:metrics.queueWaitMs,renderMs:elapsed(start,rendered),drawMainMs:lastDrawMetrics?.totalMs||0,drawParts:lastDrawMetrics,bufferMs:mode==="raw"?0:mode==="png"?elapsed(rendered,done):0,rawBufferMs:extractMs,pipelineTotalMs:elapsed(start,done),totalMs:elapsed(metrics.requestStart,done)});return result;}
function renderInternal(data={},mode="png",options={}){const requestStart=process.hrtime.bigint(),pair=mode==="ping"?[null,null]:[avatar(data.lucan?.channel?.avatar),avatar(data.mine?.channel?.avatar)],queueStart=process.hrtime.bigint(),metrics={requestStart,avatarWaitMs:0,queueWaitMs:0},run=()=>{metrics.queueWaitMs=elapsed(queueStart);return renderInternalUnlocked(data,mode,pair,metrics,options);},task=renderQueue.then(run,run);renderQueue=task.then(()=>undefined,()=>undefined);return task;}

/*
 * FIX: Do not transfer Buffer backing ArrayBuffers.
 * Some Node.js Buffer backing stores are marked untransferable.
 * Sending the Buffer without a transfer list uses structured cloning.
 * The receiver gets a Uint8Array, which is converted back to Buffer.
 */
if(IS_WORKER){
 workerLoop=monitorEventLoopDelay({resolution:10});workerLoop.enable();
 try{gcObserver=new PerformanceObserver(list=>collectGc(list.getEntries()));gcObserver.observe({entryTypes:["gc"]});}catch{}
 parentPort.on("message",async msg=>{
  const{id,mode,data,sentNs,options}=msg,workerReceivedNs=process.hrtime.bigint();
  try{
   let result=Buffer.alloc(0);
   if(mode!=="ping")result=await renderInternal(data,mode,options||{});
   const workerDoneNs=process.hrtime.bigint();
   const workerExecutionMs=elapsed(workerReceivedNs,workerDoneNs);
   collectGc(gcObserver?.takeRecords()||[]);
   const loop=workerLoop?{meanMs:round(workerLoop.mean/1e6),p95Ms:round(workerLoop.percentile(95)/1e6),maxMs:round(workerLoop.max/1e6)}:null;
   const meta={
    ...timing,
    workerExecutionMs,
    workerDispatchMs:elapsed(BigInt(sentNs),workerReceivedNs),
    workerToMainDeliveryMs:0,
    transferCopyMs:0,
    transferPrepareMs:0,
    zeroCopyTransfer:false,
    transferMode:"structured-clone",
    rawPixelMethod,
    workerMemory:memorySnapshot(),
    extractProbe:lastExtractProbe,
    workerEventLoopDelay:loop,
    gc:{...gcStats},
    gcEvents:gcEvents.slice(-128)
   };
   const workerPostNs=process.hrtime.bigint();
   /*
    * IMPORTANT: No transfer list here.
    * Node structured-clones the Buffer as a Uint8Array.
    */
   parentPort.postMessage({
    id,
    ok:true,
    buffer:result,
    meta,
    workerReceivedNs:String(workerReceivedNs),
    workerDoneNs:String(workerDoneNs),
    workerPostNs:String(workerPostNs)
   });
  }catch(e){
   try{
    parentPort.postMessage({
     id,
     ok:false,
     error:e.stack||e.message,
     workerReceivedNs:String(workerReceivedNs),
     workerPostNs:String(process.hrtime.bigint())
    });
   }catch(postError){
    console.error("[WORKER RESPONSE ERROR]",postError.stack||postError);
   }
  }
 });
}else{
 let worker=null,nextId=0;
 const pending=new Map(),eventLoop=monitorEventLoopDelay({resolution:20});
 eventLoop.enable();
 try{gcObserver=new PerformanceObserver(list=>collectGc(list.getEntries()));gcObserver.observe({entryTypes:["gc"]});}catch{}
 function failWorker(error){for(const[id,p]of pending){p.reject(error);pending.delete(id);}console.error("[RENDER WORKER]",error?.stack||error);}
 function startWorker(){
  if(worker)return;
  worker=new Worker(__filename);
  worker.on("message",msg=>{
   const mainReceiveNs=process.hrtime.bigint(),p=pending.get(msg.id);
   if(!p)return;
   pending.delete(msg.id);
   if(!msg.ok){p.reject(Error(msg.error));return;}
   /*
    * Buffer messages arrive as Uint8Array after structured cloning.
    * Create a Buffer view over the received bytes without another copy.
    */
   let buffer=Buffer.alloc(0);
   if(msg.buffer){
    if(Buffer.isBuffer(msg.buffer))buffer=msg.buffer;
    else if(ArrayBuffer.isView(msg.buffer))buffer=Buffer.from(msg.buffer.buffer,msg.buffer.byteOffset,msg.buffer.byteLength);
    else if(msg.buffer instanceof ArrayBuffer)buffer=Buffer.from(msg.buffer);
    else buffer=Buffer.from(msg.buffer);
   }
   const mainHandlingDoneNs=process.hrtime.bigint();
   const workerReceivedNs=BigInt(msg.workerReceivedNs);
   const workerPostNs=BigInt(msg.workerPostNs);
   p.resolve({
    buffer,
    meta:{
     ...msg.meta,
     mainToWorkerMessageMs:elapsed(p.sentNs,workerReceivedNs),
     workerToMainDeliveryMs:elapsed(workerPostNs,mainReceiveNs),
     mainMessageHandlingMs:elapsed(mainReceiveNs,mainHandlingDoneNs),
     roundTripMs:elapsed(p.sentNs,mainReceiveNs),
     mainReceiveNs:String(mainReceiveNs),
     workerReceivedNs:msg.workerReceivedNs,
     workerPostNs:msg.workerPostNs
    }
   });
  });
  worker.on("error",e=>{failWorker(e);worker=null;});
  worker.on("exit",code=>{worker=null;if(code!==0)failWorker(Error("Renderer worker exited with code "+code));});
  console.log("[RENDER WORKER] Started embedded canvas worker");
 }
 function workerRequest(data,mode="png",options={}){
  startWorker();
  const id=++nextId,sentNs=process.hrtime.bigint();
  return new Promise((resolve,reject)=>{
   pending.set(id,{resolve,reject,sentNs});
   try{worker.postMessage({id,data,mode,options,sentNs:String(sentNs)});}
   catch(e){pending.delete(id);reject(e);}
  });
 }
 async function renderDashboard(data){const r=await workerRequest(data,"png"),resumed=process.hrtime.bigint();r.meta.mainResponseDelayMs=elapsed(BigInt(r.meta.mainReceiveNs),resumed);Object.assign(timing,r.meta);return r.buffer;}
 async function renderRawFrameDetailed(data){const r=await workerRequest(data,"raw"),resumed=process.hrtime.bigint();r.meta.mainResponseDelayMs=elapsed(BigInt(r.meta.mainReceiveNs),resumed);Object.assign(timing,r.meta);return r;}
 async function renderRawFrame(data){return(await renderRawFrameDetailed(data)).buffer;}
 async function warmWorker(data){for(let i=0;i<8;i++)await renderRawFrame(data);}
 function stageStats(samples,key){return stats(samples.map(x=>Number(x[key])||0));}
 function rankBottlenecks(stages){return Object.entries(stages).map(([name,value])=>({stage:name,...value})).filter(x=>x.samples>0).sort((a,b)=>b.p95Ms-a.p95Ms).map((x,i)=>({...x,rank:i+1}));}
 async function runEndToEnd(getData){
  const duration=10000,times=[],fetches=[],draws=[],extractions=[],extractionCpu=[],transfers=[],mainToWorker=[],workerToMain=[],mainResume=[],roundTrips=[],workerExecutions=[],frameSamples=[],drawParts={backgroundMs:[],profileMs:[],mainCardsMs:[],sourcesMs:[],footerMs:[]};
  let frames=0,missed=0,zeroCopyFrames=0,maxLate=0,maxRss=0,stopReason=null,next,start,cpu,mem;
  const initial=await getData();
  await warmWorker(initial);
  collectGc(gcObserver?.takeRecords()||[]);
  eventLoop.reset();
  const gcBase=gcStats.count,gcDurationBase=gcStats.durationMs;
  start=process.hrtime.bigint();cpu=process.cpuUsage();mem=process.memoryUsage();next=start;
  while(elapsed(start)<duration){
   if(process.memoryUsage().rss>MAX_RSS){stopReason="Main-process memory safety limit reached";break;}
   const frameStart=process.hrtime.bigint(),frameStartPerf=performance.now(),data=await getData(),dataDone=process.hrtime.bigint(),fetchMs=elapsed(frameStart,dataDone),r=await renderRawFrameDetailed(data),done=process.hrtime.bigint(),meta=r.meta,totalFrameMs=elapsed(frameStart,done);
   if(!r.buffer||r.buffer.length!==FRAME_BYTES)throw Error("Invalid RGBA frame: "+r.buffer.length+" expected "+FRAME_BYTES);
   times.push(totalFrameMs);fetches.push(fetchMs);draws.push(meta.drawMainMs||meta.renderMs||0);extractions.push(meta.rawBufferMs||0);extractionCpu.push(meta.extractProbe?.cpuMs||0);transfers.push(meta.transferPrepareMs||0);mainToWorker.push(meta.mainToWorkerMessageMs||0);workerToMain.push(meta.workerToMainDeliveryMs||0);mainResume.push(meta.mainResponseDelayMs||0);roundTrips.push(meta.roundTripMs||0);workerExecutions.push(meta.workerExecutionMs||0);
   if(meta.rawBufferInfo?.zeroCopyEligible)zeroCopyFrames++;
   for(const k in drawParts)drawParts[k].push(meta.drawParts?.[k]||0);
   const sample={frame:frames+1,totalFrameMs:round(totalFrameMs),dataFetchMs:round(fetchMs),mainToWorkerMessageMs:round(meta.mainToWorkerMessageMs),drawMainMs:round(meta.drawMainMs),rawExtractionWallMs:round(meta.rawBufferMs),rawExtractionCpuMs:meta.extractProbe?.cpuMs??null,rawExtractionCpuWallRatio:meta.extractProbe?.cpuWallRatio??null,transferPreparationMs:round(meta.transferPrepareMs),workerToMainDeliveryMs:round(meta.workerToMainDeliveryMs),mainMessageHandlingMs:round(meta.mainMessageHandlingMs),mainResponseResumeMs:round(meta.mainResponseDelayMs),roundTripMs:round(meta.roundTripMs),over100ms:totalFrameMs>FRAME_MS};
   frameSamples.push(sample);frames++;maxRss=Math.max(maxRss,process.memoryUsage().rss);next+=FRAME_NS;
   if(done>next){const late=done-next,slots=late/FRAME_NS+1n;sample.scheduleLateMs=round(Number(late)/1e6);missed+=Number(slots);maxLate=Math.max(maxLate,Number(late)/1e6);next+=slots*FRAME_NS;}
   else{const wait=Number(next-done)/1e6;if(wait>0&&elapsed(start)+wait<duration)await sleep(wait);else if(elapsed(start)+wait>=duration)break;}
  }
  collectGc(gcObserver?.takeRecords()||[]);
  const total=elapsed(start),used=process.cpuUsage(cpu),after=process.memoryUsage(),delay={meanMs:round(eventLoop.mean/1e6),p95Ms:round(eventLoop.percentile(95)/1e6),maxMs:round(eventLoop.max/1e6)},actualFPS=frames/Math.max(.001,total/1000),frameStats=stats(times);
  const stages={"data fetch":stats(fetches),"main to worker message arrival":stats(mainToWorker),"drawing":stats(draws),"canvas.data wall time":stats(extractions),"canvas.data CPU time":stats(extractionCpu),"transfer preparation":stats(transfers),"worker to main message arrival":stats(workerToMain),"main response resume delay":stats(mainResume)};
  const ranking=rankBottlenecks(Object.fromEntries(Object.entries(stages).map(([k,v])=>[k,{...v,samples:frames}]))),slow=[...frameSamples].sort((a,b)=>b.totalFrameMs-a.totalFrameMs).slice(0,8);
  eventLoop.reset();
  return{test:"paced end-to-end production pipeline",durationMs:round(total),targetFPS:FPS,frameBudgetMs:FRAME_MS,frames,actualFPS:round(actualFPS),fpsGoalMet:actualFPS>=FPS,consistentGoalMet:frameStats.p95Ms<=FRAME_MS&&missed===0,frameMs:frameStats,deadlineMisses:missed,deadlineMissPercent:round(missed/Math.max(1,frames+missed)*100),frameCountOver100ms:frameSamples.filter(x=>x.over100ms).length,maxLatenessMs:round(maxLate),stages,drawParts:Object.fromEntries(Object.entries(drawParts).map(([k,v])=>[k,stats(v)])),bottleneckRanking:ranking,dominantBottleneck:ranking[0]?.stage||null,slowestFrames:slow,eventLoopDelay:delay,gc:{eventCount:gcStats.count-gcBase,durationMs:round(gcStats.durationMs-gcDurationBase)},cpu:{userMs:round(used.user/1000),systemMs:round(used.system/1000)},memory:{rssBeforeMiB:mib(mem.rss),rssAfterMiB:mib(after.rss),rssPeakMiB:mib(maxRss),heapBeforeMiB:mib(mem.heapUsed),heapAfterMiB:mib(after.heapUsed),externalBeforeMiB:mib(mem.external),externalAfterMiB:mib(after.external)},frameBytes:FRAME_BYTES,rawPixelMethod,zeroCopyEligibleFrames:zeroCopyFrames,stopReason};
 }
 async function runDrawOnly(data){const count=20,times=[],draws=[],messageArrival=[],workerTimes=[],started=process.hrtime.bigint();for(let i=0;i<count;i++){const r=await workerRequest(data,"draw"),m=r.meta;times.push(r.meta.roundTripMs||0);draws.push(m.drawMainMs||0);messageArrival.push(m.mainToWorkerMessageMs||0);workerTimes.push(m.workerExecutionMs||0);}const duration=elapsed(started);return{test:"draw-only; no canvas.data() and no frame transfer",iterations:count,durationMs:round(duration),throughputFPS:round(count/Math.max(.001,duration/1000)),drawMain:stats(draws),mainToWorkerMessageArrival:stats(messageArrival),workerExecution:stats(workerTimes),roundTrip:stats(times)};}
 async function runExtractionOnly(data){const r=await workerRequest(data,"extract-batch",{iterations:12}),batch=r.meta.extractBatch;if(!batch)throw Error("Extraction-only test did not return extraction measurements");return{test:"extraction-only; one draw followed by separate diagnostic readbacks",iterations:batch.iterations,extractionWallTime:batch.wall,extractionCpuTime:batch.cpu,samples:batch.samples,important:"These diagnostic readbacks are isolated from production frames. Production raw frames still perform exactly one canvas.data() call."};}
 async function runWorkerPing(data){const count=30,roundTrips=[],mainToWorker=[],workerToMain=[],started=process.hrtime.bigint();for(let i=0;i<count;i++){const r=await workerRequest(data,"ping");roundTrips.push(r.meta.roundTripMs||0);mainToWorker.push(r.meta.mainToWorkerMessageMs||0);workerToMain.push(r.meta.workerToMainDeliveryMs||0);}const duration=elapsed(started);return{test:"worker ping; no drawing, extraction, or pixel transfer",iterations:count,durationMs:round(duration),roundTrip:stats(roundTrips),mainToWorkerMessageArrival:stats(mainToWorker),workerToMainMessageArrival:stats(workerToMain)};}
 async function freshBenchmark(getData){
  const initial=await getData(),endToEnd=await runEndToEnd(getData),drawOnly=await runDrawOnly(initial),extractOnly=await runExtractionOnly(initial),workerPing=await runWorkerPing(initial),tests={endToEnd,drawOnly,extractOnly,workerPing};
  return{renderer:"@napi-rs/canvas",worker:"worker_threads",resolution:`${W}x${H}`,targetFPS:FPS,frameBudgetMs:FRAME_MS,primaryTest:"endToEnd",goal:{targetFPS:FPS,actualFPS:endToEnd.actualFPS,fpsGoalMet:endToEnd.fpsGoalMet,consistentGoalMet:endToEnd.consistentGoalMet,deadlineMisses:endToEnd.deadlineMisses,deadlineMissPercent:endToEnd.deadlineMissPercent,p95FrameMs:endToEnd.frameMs.p95Ms,p95Within100ms:endToEnd.frameMs.p95Ms<=FRAME_MS},dominantBottleneck:endToEnd.dominantBottleneck,bottleneckRanking:endToEnd.bottleneckRanking,tests,diagnosticNotes:{fpsGoal:"fpsGoalMet means the measured average FPS reached 10. consistentGoalMet additionally requires p95 frame time at or below 100ms and zero missed deadlines.",messageTiming:"Worker message arrival values are wall-clock scheduling and transport latency, not CPU execution time.",extraction:"Production frames perform one canvas.data() call. Only the isolated extraction-only test performs additional readbacks.",transfer:"Pixel data uses structured cloning. No ArrayBuffer transfer list is used because Buffer backing stores may be marked untransferable.",ranking:"Bottlenecks are ranked by p95 wall time. Stage measurements can overlap and should not be added together.",testOrder:"Tests run sequentially so the diagnostic tests do not compete with the primary 10 FPS measurement."},memoryAfterAllTests:memorySnapshot()};
 }
 function attach(app,getData){
  app.get("/api/renderer/preview.png",async(req,res)=>{
   if(benchmarkActive)return res.status(503).send("Benchmark running; retry shortly");
   try{const png=await renderDashboard(await getData());res.set({"Content-Type":"image/png","Cache-Control":"no-store, no-cache, must-revalidate"}).send(png);}
   catch(e){console.error("[CANVAS PREVIEW]",e.stack||e);if(!res.headersSent)res.status(500).send(e.message);}
  });
  app.get("/api/renderer/benchmark",async(req,res)=>{
   if(benchmarkActive)return res.status(409).json({error:"Benchmark already running"});
   benchmarkActive=true;
   try{res.set("Cache-Control","no-store");res.json(await freshBenchmark(getData));}
   catch(e){console.error("[CANVAS BENCHMARK]",e.stack||e);if(!res.headersSent)res.status(500).json({error:"Benchmark failed",message:e.message});}
   finally{benchmarkActive=false;}
  });
 }
 startWorker();
 module.exports={renderDashboard,renderRawFrame,attach};
}
