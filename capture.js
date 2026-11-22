
const {chromium}=require("playwright");
const URL="https://zhong-vs-fede.onrender.com/";
const WIDTH=1600,HEIGHT=900,FPS=15,WARMUP_MS=25000,BENCHMARK_MS=30000;
let browser=null,context=null,page=null,cdp=null,browserCdp=null,starting=false,closed=false,monitor=null,restartTimer=null,recording=null;
let startedAt=0,benchmarkDone=false,recordingBuffer=null,processBefore=[],retryCount=0,pageCrashed=false,runId=0;
let status={running:false,connected:false,url:URL,browser:null,title:null,width:WIDTH,height:HEIGHT,fps:FPS,codec:"AV1",error:null,lastError:null,started:null,metrics:null,benchmark:null,gpuDiagnostics:null,retries:0};

const delay=ms=>new Promise(r=>setTimeout(r,ms));
const log=(event,data)=>console.log(`[CAPTURE ${new Date().toISOString()}] ${event}`,data===undefined?"":JSON.stringify(data));
const errorInfo=e=>({message:e?.message||String(e),stack:e?.stack||null});
const alive=()=>{
 if(closed)throw Error("Capture was closed");
 if(!browser||!page||!cdp||page.isClosed()||pageCrashed)throw Error("Chromium or capture page disconnected");
};
async function timed(promise,ms,label){
 let timer;
 try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(`${label} timed out after ${ms}ms`)),ms);})]);}
 finally{clearTimeout(timer);}
}
function scheduleRestart(){
 if(closed||benchmarkDone||restartTimer||starting)return;
 const wait=Math.min(60000,5000*Math.pow(2,Math.min(retryCount,4)));
 retryCount++;
 status.retries=retryCount;
 log("RESTART SCHEDULED",{attempt:retryCount,delayMs:wait,error:status.error});
 restartTimer=setTimeout(()=>{
  restartTimer=null;
  if(!closed&&!benchmarkDone)start();
 },wait);
}
async function readStream(session,handle){
 const chunks=[];
 let total=0,lastLog=0,reads=0;
 log("STREAM READ STARTED",{handle});
 for(;;){
  if(closed)throw Error("Capture closed while reading recording stream");
  const result=await timed(session.send("IO.read",{handle,size:1048576}),30000,"CDP IO.read");
  if(!result||typeof result.data!=="string")throw Error("CDP IO.read returned invalid data");
  const chunk=Buffer.from(result.data,result.base64Encoded?"base64":"utf8");
  if(chunk.length){chunks.push(chunk);total+=chunk.length;}
  reads++;
  if(total-lastLog>=5*1048576||result.eof){
   lastLog=total;
   log("STREAM READ PROGRESS",{reads,bytes:total,megabytes:Number((total/1048576).toFixed(2)),eof:!!result.eof});
  }
  if(result.eof)break;
 }
 await session.send("IO.close",{handle}).catch(e=>log("STREAM CLOSE WARNING",errorInfo(e)));
 const buffer=Buffer.concat(chunks,total);
 log("STREAM READ COMPLETE",{reads,bytes:total,megabytes:Number((total/1048576).toFixed(2))});
 return{buffer,bytes:total};
}
async function start(){
 if(starting||browser||closed||benchmarkDone)return;
 starting=true;
 const thisRun=++runId;
 pageCrashed=false;
 status.error=null;
 status.running=false;
 status.metrics={phase:"Starting Chromium",attempt:retryCount+1};
 log("STARTING",{run:thisRun,attempt:retryCount+1,display:process.env.DISPLAY||null,url:URL});
 try{
  browser=await chromium.launch({
   headless:false,
   env:{...process.env,DISPLAY:process.env.DISPLAY||":99"},
   args:["--no-sandbox","--disable-dev-shm-usage","--ozone-platform=x11","--enable-gpu","--autoplay-policy=no-user-gesture-required"]
  });
  log("CHROMIUM LAUNCHED",{run:thisRun,version:browser.version(),display:process.env.DISPLAY||null});
  browser.on("disconnected",()=>{
   log("CHROMIUM DISCONNECTED",{run:thisRun,benchmarkDone,error:status.error});
   status.connected=false;
   status.running=false;
   if(!benchmarkDone)status.error="Chromium disconnected unexpectedly";
   status.lastError=status.error;
   clearInterval(monitor);monitor=null;
   browser=null;context=null;page=null;cdp=null;browserCdp=null;
  });
  browserCdp=await browser.newBrowserCDPSession();
  try{
   const info=await timed(browserCdp.send("SystemInfo.getInfo"),15000,"GPU diagnostics");
   const g=info.gpu||{};
   status.gpuDiagnostics={display:process.env.DISPLAY||null,commandLine:info.commandLine||null,modelName:info.modelName||null,devices:g.devices||[],featureStatus:g.featureStatus||{},auxAttributes:g.auxAttributes||{},videoEncoding:g.videoEncoding||[]};
   log("GPU DIAGNOSTICS",status.gpuDiagnostics);
  }catch(e){
   status.gpuDiagnostics={error:e.message,display:process.env.DISPLAY||null};
   log("GPU DIAGNOSTICS FAILED",errorInfo(e));
  }
  aliveBrowser();
  context=await browser.newContext({viewport:{width:WIDTH,height:HEIGHT},deviceScaleFactor:1});
  page=await context.newPage();
  page.setDefaultNavigationTimeout(60000);
  page.on("crash",()=>{
   pageCrashed=true;
   status.connected=false;
   status.running=false;
   status.error="Browser page crashed";
   status.lastError=status.error;
   log("PAGE CRASHED",{run:thisRun});
  });
  page.on("close",()=>log("PAGE CLOSED",{run:thisRun}));
  page.on("pageerror",e=>log("PAGE JAVASCRIPT ERROR",{message:e.message,stack:e.stack}));
  page.on("console",msg=>{
   if(msg.type()==="error"||msg.type()==="warning")log(`PAGE CONSOLE ${msg.type().toUpperCase()}`,{text:msg.text()});
  });
  page.on("requestfailed",req=>log("REQUEST FAILED",{url:req.url(),error:req.failure()?.errorText||"unknown"}));
  page.on("response",res=>{
   if(res.status()>=400)log("HTTP ERROR",{status:res.status(),url:res.url()});
  });
  log("NAVIGATION STARTED",{url:URL});
  await timed(page.goto(URL,{waitUntil:"domcontentloaded",timeout:60000}),70000,"Dashboard navigation");
  alive();
  status.connected=true;
  status.browser=browser.version();
  status.metrics={phase:"Dashboard warm-up",elapsedSeconds:0,targetSeconds:25};
  log("DASHBOARD LOADED",{title:await page.title(),url:page.url(),width:WIDTH,height:HEIGHT});
  const warmupStarted=Date.now();
  while(Date.now()-warmupStarted<WARMUP_MS){
   alive();
   const elapsed=(Date.now()-warmupStarted)/1000;
   status.metrics={phase:"Dashboard warm-up",elapsedSeconds:Number(elapsed.toFixed(1)),targetSeconds:25};
   if(Math.floor(elapsed)%5===0&&Math.floor(elapsed)!==0)log("WARM-UP PROGRESS",{elapsedSeconds:Number(elapsed.toFixed(1))});
   await delay(1000);
  }
  alive();
  const info=await page.evaluate(()=>({title:document.title,url:location.href,width:innerWidth,height:innerHeight}));
  await page.evaluate(()=>{
   const p={frames:0,start:performance.now(),running:true};
   window.__renderProbe=p;
   const tick=()=>{if(!p.running)return;p.frames++;requestAnimationFrame(tick);};
   requestAnimationFrame(tick);
  });
  try{
   const p=await browserCdp.send("SystemInfo.getProcessInfo");
   processBefore=p.processInfo||[];
   log("CPU BASELINE",processBefore.map(x=>({type:x.type,id:x.id,cpuTime:x.cpuTime})));
  }catch(e){
   processBefore=[];
   log("CPU BASELINE FAILED",errorInfo(e));
  }
  alive();
  cdp=await context.newCDPSession(page);
  log("NATIVE RECORDING REQUESTED",{width:WIDTH,height:HEIGHT,fps:FPS,audio:false});
  const result=await timed(cdp.send("Page.startScreenRecording",{maxWidth:WIDTH,maxHeight:HEIGHT,frameRate:FPS,audio:false}),20000,"Start screen recording");
  if(!result?.stream)throw Error("Native recorder did not return a stream handle");
  recording=result.stream;
  startedAt=Date.now();
  status={...status,running:true,connected:true,browser:browser.version(),title:info.title,width:info.width,height:info.height,started:new Date().toISOString(),error:null,metrics:{phase:"Recording",elapsedSeconds:0,targetSeconds:30},benchmark:null};
  log("NATIVE RECORDING STARTED",{run:thisRun,stream:recording,title:info.title,url:info.url});
  monitor=setInterval(()=>{
   if(!status.running||!startedAt)return;
   const elapsed=(Date.now()-startedAt)/1000;
   status.metrics={phase:"Recording",elapsedSeconds:Number(elapsed.toFixed(1)),targetSeconds:30};
   if(Math.floor(elapsed)%5===0&&Math.floor(elapsed)!==0)log("RECORDING PROGRESS",{elapsedSeconds:Number(elapsed.toFixed(1)),targetSeconds:30});
  },1000);
  while(Date.now()-startedAt<BENCHMARK_MS){
   alive();
   await delay(500);
  }
  alive();
  status.metrics={phase:"Finalizing"};
  log("STOPPING NATIVE RECORDING",{elapsedSeconds:Number(((Date.now()-startedAt)/1000).toFixed(1)),stream:recording});
  const stopped=await timed(cdp.send("Page.stopScreenRecording"),30000,"Stop screen recording");
  const stream=stopped?.stream||recording;
  if(!stream)throw Error("Recorder stopped without a stream handle");
  log("NATIVE RECORDING STOPPED",{stream});
  const output=await readStream(cdp,stream);
  recording=null;
  recordingBuffer=output.buffer;
  const elapsed=(Date.now()-startedAt)/1000;
  let renderProbe=null,chromeCpu=null;
  try{
   renderProbe=await page.evaluate(()=>{
    const p=window.__renderProbe;
    if(!p)return null;
    p.running=false;
    const duration=(performance.now()-p.start)/1000;
    return{frames:p.frames,durationSeconds:Number(duration.toFixed(2)),fps:Number((p.frames/duration).toFixed(2))};
   });
   log("RENDER PROBE",renderProbe);
  }catch(e){
   renderProbe={error:e.message};
   log("RENDER PROBE FAILED",errorInfo(e));
  }
  try{
   const p=await browserCdp.send("SystemInfo.getProcessInfo");
   const after=p.processInfo||[];
   const before=new Map(processBefore.map(x=>[x.id,x.cpuTime]));
   const cpuSeconds=after.reduce((sum,x)=>sum+Math.max(0,x.cpuTime-(before.get(x.id)??x.cpuTime)),0);
   chromeCpu={cpuSeconds:Number(cpuSeconds.toFixed(2)),percentOfOneCore:Number((cpuSeconds/elapsed*100).toFixed(1)),processes:after.map(x=>({type:x.type,id:x.id,cpuSeconds:Number(Math.max(0,x.cpuTime-(before.get(x.id)??x.cpuTime)).toFixed(2))}))};
   log("CHROME CPU RESULTS",chromeCpu);
  }catch(e){
   chromeCpu={error:e.message};
   log("CHROME CPU MEASUREMENT FAILED",errorInfo(e));
  }
  const header=recordingBuffer.subarray(0,32).toString("latin1");
  const hasFtyp=header.includes("ftyp");
  const hasAv1=recordingBuffer.includes(Buffer.from("av01"));
  const hasMp4=hasFtyp&&recordingBuffer.length>1000;
  status.running=false;
  status.benchmark={
   warmupSeconds:25,durationSeconds:Number(elapsed.toFixed(1)),
   requestedWidth:WIDTH,requestedHeight:HEIGHT,requestedFps:FPS,
   renderProbe,chromeCpu,fileBytes:output.bytes,
   fileSizeMB:Number((output.bytes/1048576).toFixed(2)),
   bitrateKbps:Number((output.bytes*8/elapsed/1000).toFixed(1)),
   mp4Container:hasMp4,av1CodecMarker:hasAv1,
   recordingValid:hasMp4&&hasAv1,frameCount:null,
   downloadEndpoint:"/api/capture/recording.mp4"
  };
  status.metrics={phase:"Finished",...status.benchmark};
  status.error=null;
  benchmarkDone=true;
  retryCount=0;
  log("NATIVE BENCHMARK COMPLETE",status.benchmark);
  log("RECORDING AVAILABLE","/api/capture/recording.mp4");
 }catch(e){
  status.running=false;
  status.error=e.message||String(e);
  status.lastError=status.error;
  status.metrics={phase:"Failed",error:status.error};
  log("CAPTURE RUN FAILED",{run:thisRun,...errorInfo(e)});
 }finally{
  clearInterval(monitor);monitor=null;
  starting=false;
  log("CAPTURE RUN ENDED",{run:thisRun,benchmarkDone,closed,error:status.error});
  if(!closed&&!benchmarkDone)scheduleRestart();
 }
}
function aliveBrowser(){
 if(closed||!browser)throw Error("Chromium disconnected during startup");
}
function attach(app,express){
 log("CAPTURE MODULE ATTACHED",{url:URL,display:process.env.DISPLAY||null});
 app.get("/api/capture/status",(req,res)=>res.set("Cache-Control","no-store").json(status));
 app.get("/api/capture/screenshot.jpg",async(req,res)=>{
  try{
   if(!page||page.isClosed())return res.status(503).json({error:"Capture browser is not ready",status});
   const shot=await page.screenshot({type:"jpeg",quality:70,timeout:15000});
   res.set({"Content-Type":"image/jpeg","Cache-Control":"no-store"}).send(shot);
  }catch(e){
   log("SCREENSHOT FAILED",errorInfo(e));
   res.status(500).json({error:e.message});
  }
 });
 app.get("/api/capture/recording.mp4",(req,res)=>{
  if(!recordingBuffer)return res.status(404).json({error:"Native recording is not ready yet",status});
  log("RECORDING DOWNLOAD REQUESTED",{bytes:recordingBuffer.length});
  res.set({"Content-Type":"video/mp4","Content-Length":recordingBuffer.length,"Content-Disposition":"attachment; filename=native-capture.mp4","Cache-Control":"no-store"});
  res.send(recordingBuffer);
 });
 if(!starting&&!browser&&!benchmarkDone)start();
}
async function close(){
 if(closed)return;
 closed=true;
 log("CAPTURE SHUTDOWN REQUESTED");
 clearTimeout(restartTimer);restartTimer=null;
 clearInterval(monitor);monitor=null;
 if(cdp&&recording){
  try{
   log("SHUTDOWN STOPPING RECORDING",{stream:recording});
   const stopped=await timed(cdp.send("Page.stopScreenRecording"),10000,"Shutdown stop recording");
   const stream=stopped?.stream||recording;
   const output=await readStream(cdp,stream);
   recordingBuffer=output.buffer;
   log("SHUTDOWN RECORDING SAVED",{bytes:output.bytes});
  }catch(e){log("SHUTDOWN RECORDING FINALIZATION FAILED",errorInfo(e));}
  recording=null;
 }
 if(cdp){try{await cdp.detach();}catch(e){log("CDP DETACH WARNING",errorInfo(e));}}
 if(browserCdp){try{await browserCdp.detach();}catch(e){log("BROWSER CDP DETACH WARNING",errorInfo(e));}}
 if(browser){try{await browser.close();}catch(e){log("BROWSER CLOSE WARNING",errorInfo(e));}}
 browser=null;context=null;page=null;cdp=null;browserCdp=null;
 status.running=false;status.connected=false;
 status.metrics={phase:"Closed"};
 log("CAPTURE SHUTDOWN COMPLETE");
}
module.exports={attach,close};
