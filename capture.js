
const {chromium}=require("playwright");
const URL="https://zhong-vs-fede.onrender.com/";
const WIDTH=1600,HEIGHT=900,FPS=15,WARMUP_MS=25000,BENCHMARK_MS=30000;
let browser=null,context=null,page=null,cdp=null,browserCdp=null;
let starting=false,closed=false,benchmarkDone=false,pageCrashed=false;
let monitor=null,restartTimer=null,recording=null,recordingBuffer=null;
let startedAt=0,processBefore=[],retryCount=0,runId=0;

let status={
 running:false,connected:false,url:URL,browser:null,title:null,
 width:WIDTH,height:HEIGHT,fps:FPS,codec:"AV1",
 error:null,lastError:null,started:null,metrics:null,
 benchmark:null,gpuDiagnostics:null,retries:0
};

const delay=ms=>new Promise(r=>setTimeout(r,ms));
const log=(event,data)=>{
 const time=new Date().toISOString().slice(11,19);
 console.log(`[CAPTURE ${time}] ${event}${data===undefined?"":" "+JSON.stringify(data)}`);
};
const errorInfo=e=>({error:String(e?.message||e).split("\n")[0]});
const phase=(name,extra={})=>{
 status.metrics={phase:name,...extra};
 log("PHASE",status.metrics);
};

function checkBrowser(){
 if(closed)throw Error("Capture is shutting down");
 if(!browser)throw Error("Chromium disconnected");
}
function checkPage(){
 checkBrowser();
 if(!page||page.isClosed())throw Error("Capture page closed");
 if(pageCrashed)throw Error("Capture page crashed");
}
function checkReady(){
 checkPage();
 if(!cdp)throw Error("Page CDP session unavailable");
}
async function timed(promise,ms,label){
 let timer;
 try{
  return await Promise.race([
   promise,
   new Promise((_,reject)=>timer=setTimeout(()=>reject(Error(`${label} timeout (${ms}ms)`)),ms))
  ]);
 }finally{clearTimeout(timer);}
}

async function readStream(session,handle){
 const chunks=[];
 let total=0,reads=0,lastLog=0;
 const began=Date.now();
 log("STREAM READ STARTED");
 try{
  for(;;){
   if(closed)throw Error("Shutdown during stream read");
   if(Date.now()-began>120000)throw Error("Stream read exceeded 120 seconds");
   const result=await timed(session.send("IO.read",{handle,size:1048576}),30000,"Stream read");
   if(!result||typeof result.data!=="string")throw Error("Invalid stream response");
   const chunk=Buffer.from(result.data,result.base64Encoded?"base64":"utf8");
   if(chunk.length){chunks.push(chunk);total+=chunk.length;}
   reads++;
   if(total-lastLog>=5*1048576||result.eof){
    lastLog=total;
    log("STREAM PROGRESS",{mb:+(total/1048576).toFixed(2),reads,eof:!!result.eof});
   }
   if(result.eof)break;
  }
  const buffer=Buffer.concat(chunks,total);
  log("STREAM COMPLETE",{bytes:total,mb:+(total/1048576).toFixed(2),reads});
  return{buffer,bytes:total};
 }finally{
  await session.send("IO.close",{handle}).catch(e=>log("STREAM CLOSE ERROR",errorInfo(e)));
 }
}

async function cleanup(){
 log("CLEANUP STARTED");
 clearInterval(monitor);
 monitor=null;
 const oldCdp=cdp,oldBrowserCdp=browserCdp,oldBrowser=browser;
 cdp=null;browserCdp=null;browser=null;context=null;page=null;recording=null;
 if(oldCdp)await oldCdp.detach().catch(e=>log("PAGE CDP CLEANUP ERROR",errorInfo(e)));
 if(oldBrowserCdp)await oldBrowserCdp.detach().catch(e=>log("BROWSER CDP CLEANUP ERROR",errorInfo(e)));
 if(oldBrowser){
  try{await timed(oldBrowser.close(),15000,"Browser cleanup");}
  catch(e){log("BROWSER CLEANUP ERROR",errorInfo(e));}
 }
 status.running=false;
 status.connected=false;
 status.browser=null;
 status.title=null;
 log("CLEANUP COMPLETE");
}

function scheduleRestart(){
 if(closed||benchmarkDone||restartTimer||starting||browser)return;
 const wait=Math.min(60000,5000*2**Math.min(retryCount,4));
 retryCount++;
 status.retries=retryCount;
 log("RETRY SCHEDULED",{attempt:retryCount,waitMs:wait,error:status.lastError});
 restartTimer=setTimeout(()=>{
  restartTimer=null;
  if(!closed&&!benchmarkDone)start();
 },wait);
}

async function start(){
 if(starting||browser||closed||benchmarkDone)return;
 starting=true;
 const run=++runId;
 let warmupLog=0,recordingLog=0;
 pageCrashed=false;
 status.error=null;
 status.running=false;
 status.connected=false;
 status.retries=retryCount;
 phase("Launching Chromium",{attempt:retryCount+1});
 log("START",{run,display:process.env.DISPLAY||":99"});

 try{
  browser=await chromium.launch({
   headless:false,timeout:60000,
   env:{...process.env,DISPLAY:process.env.DISPLAY||":99"},
   args:["--no-sandbox","--disable-dev-shm-usage","--ozone-platform=x11","--enable-gpu","--autoplay-policy=no-user-gesture-required"]
  });
  checkBrowser();
  const thisBrowser=browser;
  log("CHROMIUM READY",{version:browser.version(),display:process.env.DISPLAY||":99"});

  browser.on("disconnected",()=>{
   log("CHROMIUM DISCONNECTED",{run});
   if(browser===thisBrowser){
    browser=null;context=null;page=null;cdp=null;browserCdp=null;
   }
   status.connected=false;
   status.running=false;
   status.browser=null;
   if(!benchmarkDone){
    status.error="Chromium disconnected";
    status.lastError=status.error;
   }
   clearInterval(monitor);
   monitor=null;
  });

  phase("GPU diagnostics");
  browserCdp=await timed(browser.newBrowserCDPSession(),15000,"Browser CDP");
  try{
   const info=await timed(browserCdp.send("SystemInfo.getInfo"),15000,"GPU diagnostics");
   const g=info.gpu||{},a=g.auxAttributes||{},f=g.featureStatus||{};
   const devices=g.devices||[];
   status.gpuDiagnostics={
    display:process.env.DISPLAY||":99",
    renderer:devices[0]?.deviceString||"Unknown",
    vendor:devices[0]?.vendorString||"Unknown",
    gpuCompositing:f.gpu_compositing||"unknown",
    rasterization:f.rasterization||"unknown",
    videoEncode:f.video_encode||"unknown",
    videoDecode:f.video_decode||"unknown",
    vulkan:f.vulkan||"unknown",
    hardwareVulkan:!!a.hardwareSupportsVulkan
   };
   log("GPU",status.gpuDiagnostics);
  }catch(e){
   status.gpuDiagnostics={error:errorInfo(e).error};
   log("GPU DIAGNOSTICS FAILED",status.gpuDiagnostics);
  }

  checkBrowser();
  phase("Creating browser context");
  context=await timed(browser.newContext({
   viewport:{width:WIDTH,height:HEIGHT},deviceScaleFactor:1
  }),30000,"Browser context");
  checkBrowser();

  phase("Creating capture page");
  page=await timed(context.newPage(),30000,"New page");
  checkPage();
  page.setDefaultNavigationTimeout(60000);

  page.on("crash",()=>{
   pageCrashed=true;
   status.connected=false;
   status.running=false;
   status.error="Page crashed";
   status.lastError=status.error;
   log("PAGE CRASHED");
  });
  page.on("close",()=>log("PAGE CLOSED"));
  page.on("pageerror",e=>log("PAGE ERROR",{message:e.message.slice(0,250)}));
  page.on("console",msg=>{
   if(msg.type()==="error")log("CONSOLE ERROR",{message:msg.text().slice(0,250)});
  });
  page.on("requestfailed",req=>{
   log("REQUEST FAILED",{url:req.url().slice(0,160),error:req.failure()?.errorText});
  });
  page.on("response",res=>{
   if(res.status()>=400)log("HTTP ERROR",{status:res.status(),url:res.url().slice(0,160)});
  });

  phase("Loading dashboard");
  log("NAVIGATION STARTED",{url:URL});
  await timed(page.goto(URL,{waitUntil:"domcontentloaded",timeout:60000}),70000,"Dashboard navigation");
  checkPage();
  status.connected=true;
  status.browser=browser.version();
  const title=await page.title();
  log("DASHBOARD LOADED",{title,url:page.url(),width:WIDTH,height:HEIGHT});

  phase("Dashboard warm-up",{elapsedSeconds:0,targetSeconds:25});
  const warmupStarted=Date.now();
  while(Date.now()-warmupStarted<WARMUP_MS){
   checkPage();
   const elapsed=(Date.now()-warmupStarted)/1000;
   status.metrics={phase:"Dashboard warm-up",elapsedSeconds:+elapsed.toFixed(1),targetSeconds:25};
   const bucket=Math.floor(elapsed/5);
   if(bucket>warmupLog){warmupLog=bucket;log("WARM-UP",{seconds:+elapsed.toFixed(1)});}
   await delay(500);
  }

  checkPage();
  const info=await page.evaluate(()=>({
   title:document.title,url:location.href,width:innerWidth,height:innerHeight
  }));
  log("VIEWPORT",info);

  await page.evaluate(()=>{
   const p={frames:0,start:performance.now(),running:true};
   window.__renderProbe=p;
   const tick=()=>{if(p.running){p.frames++;requestAnimationFrame(tick);}};
   requestAnimationFrame(tick);
  });

  phase("CPU baseline");
  try{
   const p=await timed(browserCdp.send("SystemInfo.getProcessInfo"),15000,"CPU baseline");
   processBefore=p.processInfo||[];
   log("CPU BASELINE",{processes:processBefore.length});
  }catch(e){
   processBefore=[];
   log("CPU BASELINE ERROR",errorInfo(e));
  }

  checkPage();
  phase("Creating page CDP session");
  cdp=await timed(context.newCDPSession(page),15000,"Page CDP");
  checkReady();

  phase("Starting native recording");
  log("RECORDING REQUEST",{width:WIDTH,height:HEIGHT,fps:FPS,codec:"AV1"});
  const result=await timed(cdp.send("Page.startScreenRecording",{
   maxWidth:WIDTH,maxHeight:HEIGHT,frameRate:FPS,audio:false
  }),30000,"Start recording");
  checkReady();
  if(!result?.stream)throw Error("Native recorder returned no stream");
  recording=result.stream;
  startedAt=Date.now();

  status.running=true;
  status.connected=true;
  status.browser=browser.version();
  status.title=info.title;
  status.width=info.width;
  status.height=info.height;
  status.started=new Date().toISOString();
  status.error=null;
  status.metrics={phase:"Recording",elapsedSeconds:0,targetSeconds:30};
  status.benchmark=null;
  log("RECORDING STARTED",{run,stream:recording,title:info.title});

  monitor=setInterval(()=>{
   if(!status.running||!startedAt)return;
   const elapsed=(Date.now()-startedAt)/1000;
   status.metrics={phase:"Recording",elapsedSeconds:+elapsed.toFixed(1),targetSeconds:30};
   const bucket=Math.floor(elapsed/5);
   if(bucket>recordingLog){
    recordingLog=bucket;
    log("RECORDING PROGRESS",{seconds:+elapsed.toFixed(1)});
   }
  },1000);

  while(Date.now()-startedAt<BENCHMARK_MS){
   checkReady();
   await delay(500);
  }
  checkReady();

  const duration=(Date.now()-startedAt)/1000;
  status.running=false;
  phase("Finalizing recording");
  log("STOPPING RECORDING",{seconds:+duration.toFixed(1)});

  const stopped=await timed(cdp.send("Page.stopScreenRecording"),30000,"Stop recording");
  const stream=stopped?.stream||recording;
  if(!stream)throw Error("Recording stopped without a stream handle");
  const output=await readStream(cdp,stream);
  recording=null;
  recordingBuffer=output.buffer;
  if(!output.bytes)throw Error("Recording file is empty");

  let renderProbe=null,chromeCpu=null;
  try{
   renderProbe=await page.evaluate(()=>{
    const p=window.__renderProbe;
    if(!p)return null;
    p.running=false;
    const seconds=(performance.now()-p.start)/1000;
    return{frames:p.frames,durationSeconds:+seconds.toFixed(2),fps:+(p.frames/seconds).toFixed(2)};
   });
   log("RENDER PROBE",renderProbe);
  }catch(e){
   renderProbe={error:e.message};
   log("RENDER PROBE ERROR",errorInfo(e));
  }

  try{
   const p=await timed(browserCdp.send("SystemInfo.getProcessInfo"),15000,"CPU results");
   const after=p.processInfo||[];
   const before=new Map(processBefore.map(x=>[x.id,x.cpuTime]));
   const processes=after.map(x=>({
    type:x.type,
    cpuSeconds:+Math.max(0,x.cpuTime-(before.get(x.id)??x.cpuTime)).toFixed(2)
   }));
   const cpuSeconds=processes.reduce((sum,x)=>sum+x.cpuSeconds,0);
   chromeCpu={
    cpuSeconds:+cpuSeconds.toFixed(2),
    percentOfOneCore:+(cpuSeconds/duration*100).toFixed(1),
    processes
   };
   log("CHROME CPU",chromeCpu);
  }catch(e){
   chromeCpu={error:e.message};
   log("CPU RESULTS ERROR",errorInfo(e));
  }

  const header=recordingBuffer.subarray(0,32).toString("latin1");
  const hasMp4=header.includes("ftyp")&&recordingBuffer.length>1000;
  const hasAv1=recordingBuffer.includes(Buffer.from("av01"));

  status.benchmark={
   warmupSeconds:25,durationSeconds:+duration.toFixed(1),
   requestedWidth:WIDTH,requestedHeight:HEIGHT,requestedFps:FPS,
   renderProbe,chromeCpu,fileBytes:output.bytes,
   fileSizeMB:+(output.bytes/1048576).toFixed(2),
   bitrateKbps:+(output.bytes*8/duration/1000).toFixed(1),
   mp4Container:hasMp4,av1CodecMarker:hasAv1,
   recordingValid:hasMp4&&hasAv1,frameCount:null,
   downloadEndpoint:"/api/capture/recording.mp4"
  };

  if(!hasMp4)throw Error("Recording is not a valid MP4");
  if(!hasAv1)log("WARNING: AV1 marker not found");

  status.running=false;
  status.connected=true;
  status.error=null;
  status.metrics={phase:"Finished",...status.benchmark};
  benchmarkDone=true;
  retryCount=0;
  status.retries=0;
  log("BENCHMARK COMPLETE",status.benchmark);
  log("RECORDING READY",{url:"/api/capture/recording.mp4",bytes:output.bytes});

 }catch(e){
  status.running=false;
  status.error=e.message||String(e);
  status.lastError=status.error;
  status.metrics={phase:"Failed",error:status.error};
  log("CAPTURE FAILED",{run,...errorInfo(e)});
  await cleanup();
 }finally{
  clearInterval(monitor);
  monitor=null;
  starting=false;
  log("RUN ENDED",{run,finished:benchmarkDone,connected:status.connected,error:status.error});
  if(!closed&&!benchmarkDone)scheduleRestart();
 }
}

function attach(app){
 log("MODULE ATTACHED",{display:process.env.DISPLAY||":99"});
 app.get("/api/capture/status",(req,res)=>{
  res.set("Cache-Control","no-store").json(status);
 });
 app.get("/api/capture/screenshot.jpg",async(req,res)=>{
  try{
   if(!page||page.isClosed())return res.status(503).json({error:"Browser not ready"});
   const shot=await page.screenshot({type:"jpeg",quality:70,timeout:15000});
   res.set({"Content-Type":"image/jpeg","Cache-Control":"no-store"}).send(shot);
  }catch(e){
   log("SCREENSHOT ERROR",errorInfo(e));
   res.status(500).json({error:e.message});
  }
 });
 app.get("/api/capture/recording.mp4",(req,res)=>{
  if(!recordingBuffer)return res.status(404).json({error:"Recording not ready"});
  log("DOWNLOAD REQUESTED",{bytes:recordingBuffer.length});
  res.set({
   "Content-Type":"video/mp4",
   "Content-Length":recordingBuffer.length,
   "Content-Disposition":"attachment; filename=native-capture.mp4",
   "Cache-Control":"no-store"
  }).send(recordingBuffer);
 });
 if(!starting&&!browser&&!benchmarkDone&&!closed)start();
}

async function close(){
 if(closed)return;
 closed=true;
 log("SHUTDOWN REQUESTED");
 clearTimeout(restartTimer);
 restartTimer=null;
 clearInterval(monitor);
 monitor=null;

 const oldCdp=cdp,oldBrowserCdp=browserCdp,oldBrowser=browser;
 cdp=null;browserCdp=null;browser=null;context=null;page=null;

 if(oldCdp&&recording){
  try{
   log("SHUTDOWN STOPPING RECORDING");
   const stopped=await timed(oldCdp.send("Page.stopScreenRecording"),10000,"Shutdown stop");
   const output=await readStream(oldCdp,stopped?.stream||recording);
   recordingBuffer=output.buffer;
   log("SHUTDOWN RECORDING SAVED",{bytes:output.bytes});
  }catch(e){log("SHUTDOWN RECORDING ERROR",errorInfo(e));}
 }
 recording=null;
 if(oldCdp)await oldCdp.detach().catch(e=>log("CDP DETACH ERROR",errorInfo(e)));
 if(oldBrowserCdp)await oldBrowserCdp.detach().catch(e=>log("BROWSER CDP DETACH ERROR",errorInfo(e)));
 if(oldBrowser)await oldBrowser.close().catch(e=>log("BROWSER CLOSE ERROR",errorInfo(e)));
 status.running=false;
 status.connected=false;
 status.metrics={phase:"Closed"};
 log("SHUTDOWN COMPLETE");
}

module.exports={attach,close};
