
const {chromium}=require("playwright");
const URL="https://zhong-vs-fede.onrender.com/";
const WIDTH=1600,HEIGHT=900,FPS=15,BITRATE=2500000,BENCHMARK_MS=30000;
let browser=null,context=null,page=null,starting=false,closed=false,capturing=false;
let status={running:false,connected:false,url:URL,browser:null,title:null,width:WIDTH,height:HEIGHT,h264:null,error:null,started:null,metrics:null,benchmark:null};
const delay=ms=>new Promise(r=>setTimeout(r,ms));

async function start(){
if(starting||browser||closed)return;
starting=true;status.error=null;
try{
browser=await chromium.launch({headless:true,args:["--no-sandbox","--disable-dev-shm-usage","--disable-gpu","--autoplay-policy=no-user-gesture-required"]});
context=await browser.newContext({viewport:{width:WIDTH,height:HEIGHT},deviceScaleFactor:1});
page=await context.newPage();
page.setDefaultNavigationTimeout(60000);
page.on("crash",()=>{status.connected=false;status.running=false;status.error="Browser page crashed";});
browser.on("disconnected",()=>{status.connected=false;status.running=false;status.error="Chromium disconnected";browser=null;context=null;page=null;capturing=false;});
await page.goto(URL,{waitUntil:"domcontentloaded",timeout:60000});
await page.waitForTimeout(5000);
const info=await page.evaluate(async()=>{
if(typeof VideoEncoder==="undefined")throw new Error("VideoEncoder unavailable");
const config={codec:"avc1.42002a",width:1600,height:900,bitrate:2500000,framerate:15,latencyMode:"realtime"};
const support=await VideoEncoder.isConfigSupported(config);
if(!support.supported)throw new Error("H.264 configuration is not supported");
const canvas=document.createElement("canvas");
canvas.width=1600;canvas.height=900;
const ctx=canvas.getContext("2d",{alpha:false});
const stats={frames:0,chunks:0,bytes:0,latencyTotal:0,latencyCount:0,queueMax:0,errors:0,lastError:null};
const pending=new Map();
const encoder=new VideoEncoder({
output(chunk){
stats.chunks++;
stats.bytes+=chunk.byteLength;
const start=pending.get(chunk.timestamp);
if(start!==undefined){stats.latencyTotal+=performance.now()-start;stats.latencyCount++;pending.delete(chunk.timestamp);}
},
error(e){stats.errors++;stats.lastError=e.message;}
});
encoder.configure(config);
window.__captureEncoder={encoder,canvas,ctx,stats,pending};
return{title:document.title,url:location.href,width:innerWidth,height:innerHeight,videoEncoder:true,h264:true};
});
status={...status,running:true,connected:true,browser:browser.version(),title:info.title,width:info.width,height:info.height,h264:true,encoderInfo:info,started:new Date().toISOString(),error:null};
console.log("[CAPTURE] Chromium ready:",JSON.stringify(status));
captureLoop();
}catch(e){
status.running=false;status.connected=false;status.error=e.message||String(e);
console.error("[CAPTURE]",status.error);
if(browser){try{await browser.close()}catch(x){}}
browser=null;context=null;page=null;
}finally{starting=false;}
}

async function captureLoop(){
if(capturing||!page||closed)return;
capturing=true;
const started=Date.now();
let index=0,nextFrame=started,nextStats=started+1000,benchmarkDone=false;
status.metrics={frames:0,fps:0,bitrateKbps:0,averageLatencyMs:0,queueSize:0,droppedFrames:0,encodedChunks:0,encodedBytes:0,errors:0};
while(!closed&&browser&&page&&!page.isClosed()){
const cycleStart=Date.now();
try{
const shot=await page.screenshot({type:"jpeg",quality:75});
const b64=shot.toString("base64");
const timestamp=Math.round(index*1000000/FPS);
await page.evaluate(async({b64,timestamp,keyFrame})=>{
const s=window.__captureEncoder;
const binary=atob(b64),bytes=new Uint8Array(binary.length);
for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
const bitmap=await createImageBitmap(new Blob([bytes],{type:"image/jpeg"}));
s.ctx.drawImage(bitmap,0,0,1600,900);
bitmap.close();
const frame=new VideoFrame(s.canvas,{timestamp});
s.pending.set(timestamp,performance.now());
s.encoder.encode(frame,{keyFrame});
frame.close();
s.stats.frames++;
s.stats.queueMax=Math.max(s.stats.queueMax,s.encoder.encodeQueueSize);
},{b64,timestamp,keyFrame:index%30===0});
index++;
}catch(e){
status.error="Capture/encode error: "+e.message;
console.error("[CAPTURE]",status.error);
await delay(500);
}
const now=Date.now();
if(now>=nextStats){
try{
const s=await page.evaluate(()=>{
const x=window.__captureEncoder.stats;
return{...x,queueSize:window.__captureEncoder.encoder.encodeQueueSize,state:window.__captureEncoder.encoder.state};
});
const elapsed=(now-started)/1000;
status.metrics={
frames:s.frames,
fps:Number((s.frames/elapsed).toFixed(2)),
bitrateKbps:Number((s.bytes*8/elapsed/1000).toFixed(1)),
averageLatencyMs:s.latencyCount?Number((s.latencyTotal/s.latencyCount).toFixed(1)):0,
queueSize:s.queueSize,
maxQueueSize:s.queueMax,
droppedFrames:Math.max(0,Math.floor(elapsed*FPS)-s.frames),
encodedChunks:s.chunks,
encodedBytes:s.bytes,
errors:s.errors,
encoderState:s.state,
lastError:s.lastError
};
if(!benchmarkDone&&now-started>=BENCHMARK_MS){
benchmarkDone=true;
status.benchmark={durationSeconds:Math.round(elapsed),...status.metrics};
console.log("[CAPTURE] 30-second benchmark:",JSON.stringify(status.benchmark));
}
}catch(e){status.error="Metrics error: "+e.message;}
nextStats=now+1000;
}
nextFrame+=1000/FPS;
const wait=nextFrame-Date.now();
if(wait>0)await delay(wait);
else nextFrame=Date.now();
}
capturing=false;
}

function attach(app,express){
app.get("/api/capture/status",(req,res)=>res.set("Cache-Control","no-store").json(status));
app.get("/api/capture/screenshot.jpg",async(req,res)=>{
try{
if(!page||page.isClosed())return res.status(503).json({error:"Capture browser is not ready",status});
const shot=await page.screenshot({type:"jpeg",quality:70});
res.set({"Content-Type":"image/jpeg","Cache-Control":"no-store"}).send(shot);
}catch(e){res.status(500).json({error:e.message});}
});
start();
}

async function close(){
closed=true;
if(page&&!page.isClosed()){
try{await page.evaluate(()=>window.__captureEncoder?.encoder.close())}catch(e){}
}
if(browser){try{await browser.close()}catch(e){}}
browser=null;context=null;page=null;
status.running=false;status.connected=false;
}
module.exports={attach,close};
