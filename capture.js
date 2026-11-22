
const {chromium}=require("playwright");
const URL="https://zhong-vs-fede.onrender.com/";
const WIDTH=1600,HEIGHT=900,FPS=15,BITRATE=2500000,BENCHMARK_MS=30000;
let browser=null,context=null,page=null,cdp=null,starting=false,closed=false,processing=false,monitor=null;
let received=0,dropped=0,startedAt=0,benchmarkDone=false,lastTimestamp=0;
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
browser.on("disconnected",()=>{status.connected=false;status.running=false;status.error="Chromium disconnected";browser=null;context=null;page=null;cdp=null;clearInterval(monitor);monitor=null;});
await page.goto(URL,{waitUntil:"domcontentloaded",timeout:60000});
await page.waitForTimeout(5000);
const info=await page.evaluate(async()=>{
if(typeof VideoEncoder==="undefined")throw Error("VideoEncoder unavailable");
const config={codec:"avc1.42002a",width:1600,height:900,bitrate:2500000,framerate:15,latencyMode:"realtime"};
const support=await VideoEncoder.isConfigSupported(config);
if(!support.supported)throw Error("H.264 configuration unsupported");
const canvas=document.createElement("canvas");
canvas.width=1600;canvas.height=900;
const ctx=canvas.getContext("2d",{alpha:false});
const stats={frames:0,chunks:0,bytes:0,latencyTotal:0,latencyCount:0,queueMax:0,errors:0,lastError:null};
const pending=new Map();
const encoder=new VideoEncoder({
output(chunk){
stats.chunks++;
stats.bytes+=chunk.byteLength;
const t=pending.get(chunk.timestamp);
if(t!==undefined){stats.latencyTotal+=performance.now()-t;stats.latencyCount++;pending.delete(chunk.timestamp);}
},
error(e){stats.errors++;stats.lastError=e.message;}
});
encoder.configure(config);
window.__capture={encoder,canvas,ctx,stats,pending};
window.__captureFrame=async(data,timestamp)=>{
const s=window.__capture;
if(s.encoder.state!=="configured")return false;
if(s.encoder.encodeQueueSize>=3)return false;
const binary=atob(data),bytes=new Uint8Array(binary.length);
for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
const bitmap=await createImageBitmap(new Blob([bytes],{type:"image/jpeg"}));
s.ctx.drawImage(bitmap,0,0,1600,900);
bitmap.close();
const frame=new VideoFrame(s.canvas,{timestamp});
s.pending.set(timestamp,performance.now());
s.encoder.encode(frame,{keyFrame:s.stats.frames%30===0});
frame.close();
s.stats.frames++;
s.stats.queueMax=Math.max(s.stats.queueMax,s.encoder.encodeQueueSize);
return true;
};
return{title:document.title,url:location.href,width:innerWidth,height:innerHeight,videoEncoder:true,h264:true};
});
cdp=await context.newCDPSession(page);
cdp.on("Page.screencastFrame",event=>{
received++;
cdp.send("Page.screencastFrameAck",{sessionId:event.sessionId}).catch(()=>{});
if(processing){dropped++;return;}
processing=true;
let timestamp=Math.round((event.metadata?.timestamp||Date.now()/1000)*1000000);
timestamp=Math.max(timestamp,lastTimestamp+1);
lastTimestamp=timestamp;
page.evaluate(({data,timestamp})=>window.__captureFrame(data,timestamp),{data:event.data,timestamp})
.then(ok=>{if(!ok)dropped++;})
.catch(e=>{status.error="Frame processing: "+e.message;dropped++;})
.finally(()=>{processing=false;});
});
await cdp.send("Page.startScreencast",{format:"jpeg",quality:70,maxWidth:WIDTH,maxHeight:HEIGHT,everyNthFrame:1});
startedAt=Date.now();
status={...status,running:true,connected:true,browser:browser.version(),title:info.title,width:WIDTH,height:HEIGHT,h264:true,encoderInfo:info,started:new Date().toISOString(),error:null,metrics:null,benchmark:null};
console.log("[CAPTURE] CDP screencast started:",JSON.stringify(status));
monitor=setInterval(updateMetrics,1000);
}catch(e){
status.running=false;status.connected=false;status.error=e.message||String(e);
console.error("[CAPTURE]",status.error);
if(cdp){try{await cdp.detach()}catch(x){}}
if(browser){try{await browser.close()}catch(x){}}
browser=null;context=null;page=null;cdp=null;
}finally{starting=false;}
}

async function updateMetrics(){
if(!page||page.isClosed()||closed)return;
try{
const s=await page.evaluate(()=>{
const x=window.__capture?.stats,e=window.__capture?.encoder;
if(!x||!e)return null;
return{...x,queueSize:e.encodeQueueSize,state:e.state};
});
if(!s)return;
const elapsed=(Date.now()-startedAt)/1000;
status.metrics={
frames:s.frames,
receivedFrames:received,
fps:Number((s.frames/elapsed).toFixed(2)),
captureFps:Number((received/elapsed).toFixed(2)),
bitrateKbps:Number((s.bytes*8/elapsed/1000).toFixed(1)),
averageLatencyMs:s.latencyCount?Number((s.latencyTotal/s.latencyCount).toFixed(1)):0,
queueSize:s.queueSize,
maxQueueSize:s.queueMax,
droppedFrames:dropped,
encodedChunks:s.chunks,
encodedBytes:s.bytes,
errors:s.errors,
encoderState:s.state,
lastError:s.lastError
};
if(!benchmarkDone&&Date.now()-startedAt>=BENCHMARK_MS){
benchmarkDone=true;
status.benchmark={durationSeconds:Number(elapsed.toFixed(1)),...status.metrics};
console.log("[CAPTURE] 30-second benchmark:",JSON.stringify(status.benchmark));
}
}catch(e){status.error="Metrics error: "+e.message;}
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
clearInterval(monitor);monitor=null;
if(cdp){try{await cdp.send("Page.stopScreencast")}catch(e){}}
if(page&&!page.isClosed()){try{await page.evaluate(()=>window.__capture?.encoder.close())}catch(e){}}
if(cdp){try{await cdp.detach()}catch(e){}}
if(browser){try{await browser.close()}catch(e){}}
browser=null;context=null;page=null;cdp=null;
status.running=false;status.connected=false;
}
module.exports={attach,close};
