
const fs=require("fs"),path=require("path"),{createCanvas,loadImage}=require("@napi-rs/canvas");
const W=1280,H=720,FPS=10,FRAME_MS=1000/FPS,DIR=__dirname,nf=new Intl.NumberFormat("en-US");
const images=new Map(),rollStates=new Map(),history={subs:[],rates:[],samples:[],lastSample:0},timing={buildMs:0,renderMs:0,bufferMs:0,totalMs:0};
let queue=Promise.resolve(),benchmarkActive=false,latestMain=null,sampleTimer=null,staticCanvas=null,staticCtx=null,staticReady=false;
const COLORS={bg:"#050713",panel:"#0b1024",panel2:"#101832",border:"#273a68",blue:"#27a9ff",purple:"#8b36ff",teal:"#25e5c0",white:"#f5f7ff",muted:"#aab8df",red:"#ff4267"};
const font="Inter,Arial,sans-serif";
const elapsed=(a,b=process.hrtime.bigint())=>Number(b-a)/1e6;
const mib=n=>+(n/1048576).toFixed(2);
function numeric(v){if(v==null||v==="")return null;if(typeof v==="number")return Number.isFinite(v)?v:null;const s=String(v).trim().replace(/,/g,""),m=s.match(/^([-+]?\d*\.?\d+)\s*([KMB])?$/i);if(!m)return null;const n=Number(m[1]),f=({K:1e3,M:1e6,B:1e9})[String(m[2]||"").toUpperCase()]||1;return Number.isFinite(n)?n*f:null;}
function fmt(v,d=0){const n=numeric(v);if(n===null)return"—";return d?Number(n).toFixed(d):nf.format(Math.round(n));}
function esc(v){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function rr(c,x,y,w,h,r,fill,stroke=null,lw=1){c.beginPath();c.roundRect(x,y,w,h,r);if(fill){c.fillStyle=fill;c.fill();}if(stroke){c.lineWidth=lw;c.strokeStyle=stroke;c.stroke();}}
function gradient(c,x,y,w,h,stops,vertical=true){const g=vertical?c.createLinearGradient(x,y,x,y+h):c.createLinearGradient(x,y,x+w,y);for(const s of stops)g.addColorStop(s[0],s[1]);return g;}
function shadow(c,color="#0008",blur=24,oy=8){c.shadowColor=color;c.shadowBlur=blur;c.shadowOffsetX=0;c.shadowOffsetY=oy;}
function resetShadow(c){c.shadowColor="transparent";c.shadowBlur=0;c.shadowOffsetX=0;c.shadowOffsetY=0;}
function text(c,str,x,y,size=14,color=COLORS.white,weight=900,align="left",baseline="middle"){c.font=`${weight} ${size}px ${font}`;c.fillStyle=color;c.textAlign=align;c.textBaseline=baseline;c.fillText(String(str??""),x,y);}
function fitText(c,str,x,y,maxW,size=50,min=10,color=COLORS.white,weight=900,align="center"){let s=size;c.font=`${weight} ${s}px ${font}`;while(c.measureText(String(str)).width>maxW&&s>min){s-=1;c.font=`${weight} ${s}px ${font}`;}c.fillStyle=color;c.textAlign=align;c.textBaseline="middle";c.fillText(String(str),x,y);return s;}
function line(c,x1,y1,x2,y2,color="#ffffff20",width=1){c.beginPath();c.moveTo(x1,y1);c.lineTo(x2,y2);c.strokeStyle=color;c.lineWidth=width;c.stroke();}
function dot(c,x,y,r,color){c.beginPath();c.arc(x,y,r,0,Math.PI*2);c.fillStyle=color;c.fill();}
function panel(c,x,y,w,h,border=COLORS.border,r=19,glow=null){c.save();shadow(c,"#0008",24,8);rr(c,x,y,w,h,r,gradient(c,x,y,w,h,[[0,"#111a35ed"],[1,"#070b19f5"]]),border,1);resetShadow(c);if(glow){c.shadowColor=glow;c.shadowBlur=18;rr(c,x+1,y+1,w-2,h-2,r,null,glow,1);resetShadow(c);}c.restore();}
function staticLayer(){if(staticReady&&staticCanvas)return;staticCanvas=createCanvas(W,H);staticCtx=staticCanvas.getContext("2d");const c=staticCtx;
c.fillStyle=gradient(c,0,0,W,H,[[0,"#19265a"],[.48,"#080b1b"],[1,"#040610"]]);c.fillRect(0,0,W,H);
const left=6,top=66,heroH=388,sideW=420,gap=14,mainX=left+sideW+gap,mainW=W-6-mainX,cardGap=14,cardW=(mainW-cardGap*2)/3;
panel(c,left,top,sideW,136,"#743dff",19,"#6e29ff28");
panel(c,left,top+148,sideW,240,"#245caa",19,"#167bff20");
for(let i=0;i<3;i++){const x=mainX+i*(cardW+cardGap),col=["#287bff","#2869c9","#793dff"][i];panel(c,x,top,cardW,heroH,col,19,i===2?"#8b36ff25":"#168fff22");c.save();c.beginPath();c.roundRect(x+1,top+1,cardW-2,heroH-2,18);c.clip();c.fillStyle=gradient(c,x,top,cardW,heroH,[[0,"#873aff12"],[.42,"#00000000"],[1,"#148bff0b"]]);c.fillRect(x,top,cardW,heroH);c.restore();}
panel(c,6,464,1268,210,"#4268a8",19,"#1a6bff20");
line(c,18,504,1262,504,"#ffffff20",1);
line(c,18,684,1262,684,"#ffffff18",1);
const lx=6,ly=66;
text(c,"MY CHANNEL",lx+14,ly+166,16,"#d7e5ff",900);
for(let i=0;i<3;i++){const x=lx+14+i*130;text(c,["SUBSCRIBERS","VIEWS","VIDEOS"][i],x+54,ly+260,10,"#b8caff",900,"center");}
const mx=mainX;
text(c,"LUCAN · LIVE SUBSCRIBERS",mx+cardW/2,ly+31,16,"#d7e3ff",900,"center");
text(c,"(LINEAR ESTIMATE)",mx+cardW/2,ly+52,12,"#d7e3ff",900,"center");
text(c,"SUBS GAINED PER SEC",mx+cardW+cardGap+cardW/2,ly+40,16,"#d7e3ff",900,"center");
text(c,"SUBSCRIBERS REMAINING",mx+2*(cardW+cardGap)+cardW/2,ly+28,15,"#d7e3ff",900,"center");
text(c,"TO 60,000,000",mx+2*(cardW+cardGap)+cardW/2,ly+49,13,"#d7e3ff",900,"center");
text(c,"LINEAR ESTIMATE",mx+55,ly+345,11,"#b9caff",900,"center");
text(c,"HOURLY GAIN",mx+145,ly+345,11,"#b9caff",900,"center");
text(c,"DAILY GAIN",mx+225,ly+345,11,"#b9caff",900,"center");
text(c,"LIVE AVERAGE",mx+cardW+cardGap+cardW/2,ly+360,12,COLORS.teal,900,"center");
text(c,"SUBSCRIBERS LEFT",mx+2*(cardW+cardGap)+cardW/2,ly+360,12,COLORS.teal,900,"center");
text(c,"DATA SOURCES",20,486,16,"#d6e3ff",900);
text(c,"LIVE · BOTH PROVIDERS",1255,486,11,COLORS.teal,900,"right");
const sx=20,sy=520,cols=[130,277.5,277.5,277.5,277.5],heads=["","SCTOOLS EST.","SCTOOLS API","FREEWEBTOOLS EST.","FREEWEBTOOLS API"];
let xx=sx;for(let i=0;i<5;i++){text(c,heads[i],xx+(i?cols[i]/2:0),sy,i?13:11,"#e1eaff",900,i?"center":"left");xx+=cols[i];}
staticReady=true;}
function avatarSource(url){const s=String(url||"");if(!/googleusercontent\.com|ggpht\.com/i.test(s))return s;return /=s\d+[^?]*/i.test(s)?s.replace(/=s\d+[^?]*/i,"=s160-c"):(s.includes("?")?s+"&sz=160":s+"=s160-c");}
async function avatar(url){if(!url)return null;const src=avatarSource(url);if(images.has(src))return images.get(src);const task=(async()=>{try{const r=await fetch(src,{signal:AbortSignal.timeout(9000)});if(!r.ok)throw Error("HTTP "+r.status);const b=Buffer.from(await r.arrayBuffer());if(b.length>2e6)throw Error("Avatar too large");return await loadImage(b);}catch(e){console.error("[CANVAS AVATAR]",e.message);return null;}})();images.set(src,task);if(images.size>32)images.delete(images.keys().next().value);return task;}
function drawAvatar(c,img,x,y,size,border=COLORS.blue){c.save();c.beginPath();c.arc(x+size/2,y+size/2,size/2,0,Math.PI*2);c.clip();if(img){const scale=Math.max(size/img.width,size/img.height),w=img.width*scale,h=img.height*scale;c.drawImage(img,x+(size-w)/2,y+(size-h)/2,w,h);}else{c.fillStyle="#182544";c.fillRect(x,y,size,size);text(c,"?",x+size/2,y+size/2,size*.48,"#9cb9ee",900,"center");}c.restore();c.save();c.shadowColor="#168fff77";c.shadowBlur=15;c.beginPath();c.arc(x+size/2,y+size/2,size/2-1.5,0,Math.PI*2);c.lineWidth=3;c.strokeStyle=border;c.stroke();resetShadow(c);c.restore();}
function drawRolling(c,id,value,x,y,maxW,size=50,color="#fff",decimals=0,align="center"){const n=numeric(value),target=n===null?"—":(decimals?Number(n).toFixed(decimals):nf.format(Math.round(n)));const now=Date.now();let s=rollStates.get(id);if(!s){s={target,previous:target,changed:now};rollStates.set(id,s);}else if(s.target!==target){s.previous=s.target;s.target=target;s.changed=now;}
const progress=Math.max(0,Math.min(1,(now-s.changed)/650)),fontSize=fitFont(c,target,maxW,size,10);c.save();c.font=`900 ${fontSize}px ${font}`;const width=c.measureText(target).width,scale=Math.min(1,maxW/Math.max(1,width)),drawW=width*scale;let start=align==="right"?x+maxW-drawW:align==="left"?x:x+(maxW-drawW)/2;c.translate(start,y);c.scale(scale,1);c.textBaseline="middle";c.textAlign="left";c.fillStyle=color;
const chars=[...target],old=[...s.previous];let digit=0,oldDigit=old.length-1;
for(let i=chars.length-1;i>=0;i--)if(/\d/.test(chars[i])){while(oldDigit>=0&&!/\d/.test(old[oldDigit]))oldDigit--;oldDigit--;}
let cursor=0,oldDigits=old.filter(ch=>/\d/.test(ch)),newDigits=chars.filter(ch=>/\d/.test(ch)),offset=oldDigits.length-newDigits.length;
for(let i=0;i<chars.length;i++){const ch=chars[i],cw=c.measureText(ch).width;if(/\d/.test(ch)){const di=digit++,oi=di+offset,from=oldDigits[oi]??ch,changed=from!==ch&&progress<1;if(changed){c.save();c.beginPath();c.rect(cursor,-fontSize*.58,cw,fontSize*1.2);c.clip();c.fillText(from,cursor,-fontSize*progress);c.fillText(ch,cursor,fontSize*(1-progress));c.restore();}else c.fillText(ch,cursor,0);}else c.fillText(ch,cursor,0);cursor+=cw;}
c.restore();if(progress>=1)s.previous=s.target;}
function fitFont(c,str,maxW,size,min){let z=size;c.font=`900 ${z}px ${font}`;while(c.measureText(String(str)).width>maxW&&z>min){z-=1;c.font=`900 ${z}px ${font}`;}return z;}
function drawChart(c,x,y,w,h){const a=history.subs;if(a.length<2)return;const min=Math.min(...a),max=Math.max(...a),range=Math.max(1,max-min),pts=a.map((v,i)=>({x:x+i/(a.length-1)*w,y:y+h-5-(v-min)/range*(h-13)}));c.save();const g=c.createLinearGradient(0,y,0,y+h);g.addColorStop(0,"#18e9d959");g.addColorStop(1,"#18e9d900");c.beginPath();c.moveTo(pts[0].x,y+h);for(const p of pts)c.lineTo(p.x,p.y);c.lineTo(pts.at(-1).x,y+h);c.closePath();c.fillStyle=g;c.fill();c.beginPath();pts.forEach((p,i)=>i?c.lineTo(p.x,p.y):c.moveTo(p.x,p.y));c.lineWidth=10;c.strokeStyle="#168fff29";c.lineCap="round";c.lineJoin="round";c.stroke();c.beginPath();pts.forEach((p,i)=>i?c.lineTo(p.x,p.y):c.moveTo(p.x,p.y));c.lineWidth=3;c.strokeStyle=COLORS.teal;c.shadowColor="#18e9d9";c.shadowBlur=5;c.stroke();resetShadow(c);c.restore();}
function takeSample(){if(latestMain==null||!Number.isFinite(latestMain))return;const now=Date.now(),n=latestMain;history.subs.push(n);if(history.subs.length>18)history.subs.shift();history.samples.push({t:now,n});if(history.samples.length>6)history.samples.shift();if(history.samples.length>1){const a=history.samples[0],b=history.samples.at(-1),sec=(b.t-a.t)/1000;if(sec>0){history.rates.push((b.n-a.n)/sec);if(history.rates.length>14)history.rates.shift();}}history.lastSample=now;}
function record(v){const n=numeric(v);if(n!==null)latestMain=n;if(!sampleTimer&&latestMain!==null){takeSample();sampleTimer=setInterval(takeSample,2000);sampleTimer.unref?.();}}
function drawBars(c,x,y,w,h){const a=history.rates.slice(-14);if(!a.length)return;const gap=6,bw=Math.min(20,(w-gap*(a.length-1))/a.length);a.forEach((v,i)=>{const n=Math.min(12,Math.max(1,Math.round(Math.abs(v)*4))),bh=Math.max(12,n*7),xx=x+i*(bw+gap),yy=y+h-bh;c.save();c.globalAlpha=.55+i/Math.max(1,a.length)*.45;rr(c,xx,yy,bw,bh,5,gradient(c,xx,yy,bw,bh,[[0,"#a63cff"],[1,"#5420c7"]]));c.shadowColor="#8b36ff55";c.shadowBlur=8;c.restore();});}
function drawMain(data={}){staticLayer();const l=data.lucan||{},m=data.mine||{},st=l.sctools||{},fw=l.freewebtools||{},mst=m.sctools||{},mfw=m.freewebtools||{},lc=l.channel||{},mc=m.channel||{};
const main=st.linearSubscribers??st.estSubscribers??fw.estimatedSubscribers??st.apiSubscribers??fw.apiSubscribers,mainN=numeric(main),remaining=mainN===null?null:Math.max(0,60000000-mainN),progress=mainN===null?0:Math.min(100,mainN/60000000*100),rate=history.rates.at(-1)??null;
record(main);const c=createCanvas(W,H).getContext("2d");c.drawImage(staticCanvas,0,0);
const left=6,top=66,sideW=420,mainX=440,mainW=834,gap=14,cardW=(mainW-gap*2)/3;
const avatar1=drawMain.avatar1,avatar2=drawMain.avatar2;
drawAvatar(c,avatar1,left+12,top+8,120);
text(c,lc.name||"Lucan Pevidor",left+144,top+43,22,COLORS.white,900);
text(c,lc.handle||"@LucanPevidor",left+144,top+68,11,COLORS.muted,800);
const desc=String(lc.descriptionEnglish||lc.englishDescription||lc.descriptionEn||"Jesus loves you! I hope every video makes you smile!").replace(/\s+/g," ");
fitText(c,desc.slice(0,62),left+144,top+91,250,12,9,"#dce5ff",800,"left");
rr(c,left+144,top+107,100,20,7,gradient(c,left+144,top+107,100,20,[[0,"#6423d9"],[1,"#2549bc"]]));text(c,"ROAD TO 60M",left+194,top+117,10,"#fff",900,"center");
text(c,"MY CHANNEL",left+14,top+166,16,"#d7e5ff",900);
drawAvatar(c,avatar2,left+270,top+157,66);
text(c,mc.name||"VYStats",left+344,top+178,15,COLORS.white,900);
text(c,mc.handle||"@vystatsyt",left+344,top+199,10,COLORS.muted,800);
line(c,left+14,top+226,left+406,top+226,"#ffffff20");
const mineCols=[{title:"SUBSCRIBERS",a:mst.estSubscribers??mfw.estimatedSubscribers,b:mst.apiSubscribers??mfw.apiSubscribers},{title:"VIEWS",a:mst.estViews??mfw.estimatedViews,b:mst.apiViews??mfw.viewCount},{title:"VIDEOS",a:mst.estVideos??mfw.estimatedVideos,b:mst.apiVideos??mfw.videoCount}];
mineCols.forEach((v,i)=>{const x=left+14+i*130;text(c,v.title,x+58,top+248,10,"#b8caff",900,"center");text(c,"EST.",x,top+282,9,COLORS.muted,900);drawRolling(c,"mine-est-"+i,v.a,x+25,top+282,100,15,COLORS.white);text(c,"API",x,top+318,9,COLORS.muted,900);drawRolling(c,"mine-api-"+i,v.b,x+25,top+318,100,15,COLORS.white);if(i)line(c,x-7,top+238,x-7,top+365,"#ffffff20");});
for(let i=0;i<3;i++){const x=mainX+i*(cardW+gap);if(i===0){text(c,"↗",x+cardW/2-110,top+39,25,COLORS.blue,900);drawRolling(c,"lucanCount",main,x+12,top+142,cardW-24,50,"#fff");drawChart(c,x+18,top+192,cardW-36,72);const values=[["LINEAR ESTIMATE",st.linearSubscribers??st.estSubscribers],["HOURLY GAIN",st.hourly??fw.hourly],["DAILY GAIN",st.daily??fw.daily]];values.forEach((v,j)=>{const xx=x+cardW*(j+.5)/3;text(c,v[0],xx,top+326,10,"#b9caff",900,"center");drawRolling(c,"lucan-metric-"+j,v[1],xx-cardW/6+2,top+357,cardW/3-4,17,COLORS.teal);});}
else if(i===1){text(c,"ϟ",x+cardW/2-120,top+40,27,COLORS.blue,900);text(c,"SUBS GAINED PER SEC",x+cardW/2+4,top+40,15,"#d7e3ff",900,"center");text(c,rate!==null&&rate<0?"−":"+",x+cardW/2-65,top+147,57,COLORS.white,900,"right");drawRolling(c,"lucanRate",rate===null?null:Math.abs(rate),x+cardW/2-60,top+147,cardW/2+75,48,COLORS.white,2,"left");drawBars(c,x+22,top+248,cardW-44,90);text(c,"LIVE AVERAGE",x+cardW/2,top+365,12,COLORS.teal,900,"center");}
else{text(c,"⚑",x+cardW/2-125,top+30,23,COLORS.blue,900);text(c,"SUBSCRIBERS REMAINING",x+cardW/2+5,top+30,14,"#d7e3ff",900,"center");drawRolling(c,"lucanRemaining",remaining,x+12,top+143,cardW-24,49,COLORS.white);const px=x+20,py=top+244,pw=cardW-40;rr(c,px,py,pw,15,10,"#111f43");rr(c,px,py,pw*progress/100,15,10,gradient(c,px,py,pw,15,[[0,COLORS.purple],[.5,COLORS.blue],[1,COLORS.teal]]));text(c,"ROAD TO 60M",px,py+31,10,"#b9caff",900);drawRolling(c,"goalPercent",progress,px+pw-65,py+31,65,11,COLORS.white,1,"right");text(c,"SUBSCRIBERS LEFT",x+cardW/2,top+365,12,COLORS.teal,900,"center");}}
drawSources(c,{st,fw});
const updated=Math.max(Number(l.updated)||0,Number(m.updated)||0),status=l.updated||m.updated?"● CONNECTED":"● CONNECTING";
text(c,updated?"↻ UPDATED "+new Date(updated).toLocaleTimeString():"WAITING FOR DATA",18,699,12,"#b9caff",900);
text(c,status,1260,699,12,l.updated||m.updated?COLORS.teal:COLORS.red,900,"right");
return c.canvas;}
function drawSources(c,{st,fw}){const x=20,y=520,cols=[130,277.5,277.5,277.5,277.5],rows=[["SUBSCRIBERS",st.estSubscribers,st.apiSubscribers,fw.estimatedSubscribers,fw.apiSubscribers],["TOTAL VIEWS",st.estViews,st.apiViews,fw.estimatedViews,fw.viewCount],["VIDEOS",st.estVideos,st.apiVideos,fw.estimatedVideos,fw.videoCount]];rows.forEach((row,r)=>{const yy=y+35+r*37;text(c,row[0],x,yy+12,12,"#799bff",900);let xx=x+cols[0];for(let j=1;j<5;j++){rr(c,xx+3,yy,cols[j]-7,30,7,"#080d1b","#26375b");drawRolling(c,"source-"+r+"-"+j,row[j],xx+8,yy+15,cols[j]-18,17,j%2?COLORS.teal:"#c4d1ff");xx+=cols[j];}});
const display=fw.displayCount??fw.estimation?.display_count??null,hourly=fw.hourly??fw.estimation?.growth_rate_per_hour,daily=fw.daily??fw.estimation?.growth_rate_per_day,confidence=String(fw.confidence||"—").toUpperCase(),items=[["FREEWEBTOOLS DISPLAY COUNT",display],["FREEWEBTOOLS HOURLY GROWTH",hourly],["FREEWEBTOOLS DAILY GROWTH",daily],["FREEWEBTOOLS CONFIDENCE",confidence]];
items.forEach((v,i)=>{const xx=20+i*310;rr(c,xx,665,300,1,1,"#26375b");text(c,v[0],xx+150,648,9,"#c4d2f3",900,"center");if(i===3)fitText(c,v[1],xx+150,665,285,15,10,COLORS.teal,900);else drawRolling(c,"source-meta-"+i,v[1],xx+8,665,284,16,COLORS.teal);});}
async function renderInternal(data={},mode="png"){const start=process.hrtime.bigint();const [a,b]=await Promise.all([avatar(data.lucan?.channel?.avatar),avatar(data.mine?.channel?.avatar)]);drawMain.avatar1=a;drawMain.avatar2=b;const built=process.hrtime.bigint(),canvas=drawMain(data),rendered=process.hrtime.bigint();let result;if(mode==="raw"){const im=canvas.getImageData(0,0,W,H);result=Buffer.from(im.data.buffer,im.data.byteOffset,im.data.byteLength);if(result.length!==W*H*4)throw Error("Invalid RGBA frame size: "+result.length);}else result=canvas.toBuffer("image/png");const done=process.hrtime.bigint();Object.assign(timing,{buildMs:elapsed(start,built),renderMs:elapsed(built,rendered),bufferMs:elapsed(rendered,done),totalMs:elapsed(start,done)});return result;}
function run(data,mode){const job=queue.then(()=>renderInternal(data,mode));queue=job.catch(e=>console.error("[CANVAS QUEUE]",e.message));return job;}
const renderDashboard=data=>run(data,"png"),renderRawFrame=data=>run(data,"raw");
function stats(a){if(!a.length)return{averageMs:0,medianMs:0,p95Ms:0,minMs:0,maxMs:0};const s=[...a].sort((x,y)=>x-y),avg=a.reduce((x,y)=>x+y,0)/a.length,p=q=>s[Math.min(s.length-1,Math.ceil(s.length*q)-1)],r=n=>+n.toFixed(2);return{averageMs:r(avg),medianMs:r(p(.5)),p95Ms:r(p(.95)),minMs:r(s[0]),maxMs:r(s.at(-1))};}
async function freshBenchmark(getData){const duration=10000,times=[],renders=[],builds=[],buffers=[];let frames=0,missed=0,maxLate=0,next=process.hrtime.bigint()+BigInt(Math.round(FRAME_MS*1e6));const start=process.hrtime.bigint(),cpu=process.cpuUsage(),mem=process.memoryUsage();while(elapsed(start)<duration){const data=await getData(),frame=await renderRawFrame(data),done=process.hrtime.bigint();if(!frame||frame.length!==W*H*4)throw Error("Invalid RGBA frame");times.push(timing.totalMs);renders.push(timing.renderMs);builds.push(timing.buildMs);buffers.push(timing.bufferMs);frames++;if(done>next){const late=done-next,slots=Number(late/BigInt(Math.round(FRAME_MS*1e6)))+1;missed+=slots;maxLate=Math.max(maxLate,Number(late)/1e6);next+=BigInt(slots*Math.round(FRAME_MS*1e6));}else next+=BigInt(Math.round(FRAME_MS*1e6));}
const total=elapsed(start),used=process.cpuUsage(cpu),after=process.memoryUsage(),t=stats(times);return{renderer:"@napi-rs/canvas",mode:"canvas-raw-rgba-benchmark",resolution:`${W}x${H}`,targetFPS:FPS,durationMs:+total.toFixed(2),frames,frameSizeBytes:W*H*4,frameSizeMiB:mib(W*H*4),estimatedFPS:+(frames/(total/1000)).toFixed(2),frameTime:t,stages:{canvasRender:stats(renders),preparation:stats(builds),rawBuffer:stats(buffers)},missedDeadlines:missed,missedDeadlinePercent:+(missed/Math.max(1,frames+missed)*100).toFixed(2),maxLatenessMs:+maxLate.toFixed(2),cpu:{userMs:+(used.user/1000).toFixed(2),systemMs:+(used.system/1000).toFixed(2)},memory:{rssBeforeMiB:mib(mem.rss),rssAfterMiB:mib(after.rss),heapBeforeMiB:mib(mem.heapUsed),heapAfterMiB:mib(after.heapUsed)}};}
function attach(app,getData){app.get("/api/renderer/preview.png",async(req,res)=>{if(benchmarkActive)return res.status(503).send("Benchmark running; retry shortly");try{const data=await getData(),png=await renderDashboard(data);res.set({"Content-Type":"image/png","Cache-Control":"no-store, no-cache, must-revalidate"}).send(png);}catch(e){console.error("[CANVAS PREVIEW]",e.stack||e);if(!res.headersSent)res.status(500).send(e.message);}});
app.get("/api/renderer/benchmark",async(req,res)=>{if(benchmarkActive)return res.status(409).json({error:"Benchmark already running"});benchmarkActive=true;try{res.set("Cache-Control","no-store");res.json(await freshBenchmark(getData));}catch(e){console.error("[CANVAS BENCHMARK]",e.stack||e);if(!res.headersSent)res.status(500).json({error:"Benchmark failed",message:e.message});}finally{benchmarkActive=false;}});
const diagnostics=async(req,res)=>{if(benchmarkActive)return res.status(409).json({error:"Another benchmark is running"});benchmarkActive=true;try{const data=await getData(),frame=await renderRawFrame(data);res.set("Cache-Control","no-store").json({renderer:"@napi-rs/canvas",resolution:`${W}x${H}`,frameBytes:frame.length,expectedBytes:W*H*4,valid:frame.length===W*H*4,timing:{...timing},note:"Single-frame diagnostic; use /benchmark for measured sustained FPS."});}catch(e){if(!res.headersSent)res.status(500).json({error:"Canvas diagnostics failed",message:e.message});}finally{benchmarkActive=false;}};
app.get("/api/renderer/diagnostics",diagnostics);app.get("/api/renderer/multi-diagnostics",diagnostics);app.get("/api/renderer/takumi-cost",diagnostics);}
module.exports={renderDashboard,renderRawFrame,attach};
