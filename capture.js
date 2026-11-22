
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
const log=(event,data)=>console.log(`[CAPTURE ${new Date().toISOString()}] ${event}`,data===undefined?"":JSON.stringify(data));
const errorInfo=e=>({message:e?.message||String(e),stack:e?.stack||null});

function phase(name,extra={}){
 status.metrics={phase:name,...extra};
 log("PHASE",status.metrics);
}

function checkBrowser(){
 if(closed)throw Error("Capture is shutting down");
 if(!browser)throw Error("Chromium is disconnected");
}

function checkPage(){
 checkBrowser();
 if(!page||page.isClosed())throw Error("Capture page is closed");
 if(pageCrashed)throw Error("Capture page crashed");
}

function checkReady(){
 checkPage();
 if(!cdp)throw Error("Page CDP session is unavailable");
}

async function withTimeout(promise,ms,label){
 let timer;
 try{
  return await Promise.race([
   promise,
   new Promise((_,reject)=>{
    timer=setTimeout(()=>reject(Error(`${label} timed out after ${ms}ms`)),ms);
   })
  ]);
 }finally{
  clearTimeout(timer);
 }
}

async function readStream(session,handle){
 const chunks=[];
 let total=0,reads=0,lastLog=0;
 const readStarted=Date.now();
 log("STREAM READ STARTED",{handle});
 try{
  for(;;){
   if(closed)throw Error("Shutdown requested during stream read");
   if(Date.now()-readStarted>120000)throw Error("Recording stream read exceeded 120 seconds");
   const result=await withTimeout(session.send("IO.read",{handle,size:1048576}),30000,"CDP IO.read");
   if(!result||typeof result.data!=="string")throw Error("CDP IO.read returned invalid data");
   const chunk=Buffer.from(result.data,result.base64Encoded?"base64":"utf8");
   if(chunk.length){
    chunks.push(chunk);
    total+=chunk.length;
   }
   reads++;
   if(total-lastLog>=5*1048576||result.eof){
    lastLog=total;
    log("STREAM PROGRESS",{reads,bytes:total,megabytes:Number((total/1048576).toFixed(2)),eof:!!result.eof});
   }
   if(result.eof)break;
  }
  const buffer=Buffer.concat(chunks,total);
  log("STREAM READ COMPLETE",{reads,bytes:total});
  return{buffer,bytes:total};
 }finally{
  await session.send("IO.close",{handle}).catch(e=>log("STREAM CLOSE WARNING",errorInfo(e)));
 }
}

async function cleanupFailedRun(){
 log("CLEANUP STARTED");
 clearInterval(monitor);
 monitor=null;

 const oldCdp=cdp,oldBrowserCdp=browserCdp,oldBrowser=browser;

 cdp=null;
 browserCdp=null;
 browser=null;
 context=null;
 page=null;
 recording=null;

 if(oldCdp){
  try{await oldCdp.detach();}catch(e){log("PAGE CDP DETACH WARNING",errorInfo(e));}
 }
 if(oldBrowserCdp){
  try{await oldBrowserCdp.detach();}catch(e){log("BROWSER CDP DETACH WARNING",errorInfo(e));}
 }
 if(oldBrowser){
  try{
   await withTimeout(oldBrowser.close(),15000,"Chromium cleanup");
   log("CHROMIUM CLEANUP COMPLETE");
  }catch(e){
   log("CHROMIUM CLEANUP WARNING",errorInfo(e));
  }
 }
 status.running=false;
 status.connected=false;
 status.browser=null;
 status.title=null;
 log("CLEANUP FINISHED");
}

function scheduleRestart(){
 if(closed||benchmarkDone||restartTimer||starting||browser)return;
 const wait=Math.min(60000,5000*Math.pow(2,Math.min(retryCount,4)));
 retryCount++;
 status.retries=retryCount;
 log("RESTART SCHEDULED",{attempt:retryCount,delayMs:wait,lastError:status.lastError});
 restartTimer=setTimeout(()=>{
  restartTimer=null;
  if(!closed&&!benchmarkDone)start();
 },wait);
}

async function start(){
 if(starting||browser||closed||benchmarkDone)return;
 starting=true;
 const thisRun=++runId;
 let lastWarmupLog=0,lastRecordingLog=0;
 pageCrashed=false;
 status.error=null;
 status.running=false;
 status.connected=false;
 status.retries=retryCount;
 phase("Launching Chromium",{attempt:retryCount+1});
 log("STARTING",{run:thisRun,attempt:retryCount+1,display:process.env.DISPLAY||null,url:URL});

 try{
  browser=await chromium.launch({
   headless:false,
   timeout:60000,
   env:{...process.env,DISPLAY:process.env.DISPLAY||":99"},
   args:[
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--ozone-platform=x11",
    "--enable-gpu",
    "--autoplay-policy=no-user-gesture-required"
   ]
  });

  checkBrowser();
  const thisBrowser=browser;
  log("CHROMIUM LAUNCHED",{run:thisRun,version:browser.version(),display:process.env.DISPLAY||null});

  browser.on("disconnected",()=>{
   log("CHROMIUM DISCONNECTED",{run:thisRun,benchmarkDone});
   if(browser===thisBrowser){
    browser=null;
    context=null;
    page=null;
    cdp=null;
    browserCdp=null;
   }
   status.connected=false;
   status.running=false;
   status.browser=null;
   if(!benchmarkDone){
    status.error="Chromium disconnected unexpectedly";
    status.lastError=status.error;
   }
   clearInterval(monitor);
   monitor=null;
  });

  phase("Reading GPU diagnostics");
  browserCdp=await withTimeout(browser.newBrowserCDPSession(),15000,"Browser CDP session");
  checkBrowser();

  try{
   const info=await withTimeout(browserCdp.send("SystemInfo.getInfo"),15000,"GPU diagnostics");
   const g=info.gpu||{};
   status.gpuDiagnostics={
    display:process.env.DISPLAY||null,
    commandLine:info.commandLine||null,
    modelName:info.modelName||null,
    devices:g.devices||[],
    featureStatus:g.featureStatus||{},
    auxAttributes:g.auxAttributes||{},
    videoEncoding:g.videoEncoding||[]
   };
   log("GPU DIAGNOSTICS",status.gpuDiagnostics);
  }catch(e){
   status.gpuDiagnostics={error:e.message,display:process.env.DISPLAY||null};
   log("GPU DIAGNOSTICS FAILED",errorInfo(e));
  }

  checkBrowser();
  phase("Creating browser context");
  context=await withTimeout(
   browser.newContext({viewport:{width:WIDTH,height:HEIGHT},deviceScaleFactor:1}),
   30000,
   "Browser context creation"
  );
  checkBrowser();

  phase("Creating capture page");
  page=await withTimeout(context.newPage(),30000,"New page creation");
  checkPage();

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
  page.on("pageerror",e=>log("PAGE JAVASCRIPT ERROR",errorInfo(e)));
  page.on("console",msg=>{
   if(msg.type()==="error"||msg.type()==="warning"){
    log(`PAGE CONSOLE ${msg.type().toUpperCase()}`,{text:msg.text()});
   }
  });
  page.on("requestfailed",req=>{
   log("REQUEST FAILED",{url:req.url(),error:req.failure()?.errorText||"unknown"});
  });
  page.on("response",res=>{
   if(res.status()>=400)log("HTTP ERROR",{status:res.status(),url:res.url()});
  });

  phase("Loading dashboard");
  log("NAVIGATION STARTED",{url:URL});
  await withTimeout(
   page.goto(URL,{waitUntil:"domcontentloaded",timeout:60000}),
   70000,
   "Dashboard navigation"
  );
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
   status.metrics={
    phase:"Dashboard warm-up",
    elapsedSeconds:Number(elapsed.toFixed(1)),
    targetSeconds:25
   };
   if(Math.floor(elapsed/5)>lastWarmupLog){
    lastWarmupLog=Math.floor(elapsed/5);
    log("WARM-UP PROGRESS",{elapsedSeconds:Number(elapsed.toFixed(1))});
   }
   await delay(500);
  }

  checkPage();
  const info=await page.evaluate(()=>({
   title:document.title,
   url:location.href,
   width:innerWidth,
   height:innerHeight
  }));
  log("CAPTURE VIEWPORT",info);

  await page.evaluate(()=>{
   const p={frames:0,start:performance.now(),running:true};
   window.__renderProbe=p;
   const tick=()=>{
    if(!p.running)return;
    p.frames++;
    requestAnimationFrame(tick);
   };
   requestAnimationFrame(tick);
  });

  checkPage();
  phase("Reading CPU baseline");
  try{
   const p=await withTimeout(browserCdp.send("SystemInfo.getProcessInfo"),15000,"CPU baseline");
   processBefore=p.processInfo||[];
   log("CPU BASELINE",processBefore.map(x=>({type:x.type,id:x.id,cpuTime:x.cpuTime})));
  }catch(e){
   processBefore=[];
   log("CPU BASELINE FAILED",errorInfo(e));
  }

  checkPage();
  phase("Creating page CDP session");
  cdp=await withTimeout(context.newCDPSession(page),15000,"Page CDP session");
  checkReady();

  phase("Starting native recording");
  log("NATIVE RECORDING REQUESTED",{width:WIDTH,height:HEIGHT,fps:FPS,audio:false});
  const result=await withTimeout(
   cdp.send("Page.startScreenRecording",{
    maxWidth:WIDTH,
    maxHeight:HEIGHT,
    frameRate:FPS,
    audio:false
   }),
   30000,
   "Start screen recording"
  );

  checkReady();
  if(!result||!result.stream)throw Error("Native recorder did not return a stream handle");

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

  log("NATIVE RECORDING STARTED",{run:thisRun,stream:recording,title:info.title,url:info.url});

  monitor=setInterval(()=>{
   if(!status.running||!startedAt)return;
   const elapsed=(Date.now()-startedAt)/1000;
   status.metrics={
    phase:"Recording",
    elapsedSeconds:Number(elapsed.toFixed(1)),
    targetSeconds:30
   };
   const bucket=Math.floor(elapsed/5);
   if(bucket>lastRecordingLog){
    lastRecordingLog=bucket;
    log("RECORDING PROGRESS",{elapsedSeconds:Number(elapsed.toFixed(1)),targetSeconds:30});
   }
  },1000);

  while(Date.now()-startedAt<BENCHMARK_MS){
   checkReady();
   await delay(500);
  }

  checkReady();
  const recordingDuration=(Date.now()-startedAt)/1000;
  status.metrics={phase:"Finalizing"};
  status.running=false;

  log("STOPPING NATIVE RECORDING",{durationSeconds:Number(recordingDuration.toFixed(2)),stream:recording});

  const stopped=await withTimeout(
   cdp.send("Page.stopScreenRecording"),
   30000,
   "Stop screen recording"
  );

  const stream=stopped?.stream||recording;
  if(!stream)throw Error("Recorder stopped without a stream handle");
  log("NATIVE RECORDING STOPPED",{stream});

  const output=await readStream(cdp,stream);
  recording=null;
  recordingBuffer=output.buffer;

  if(!output.bytes)throw Error("Native recording returned an empty file");

  let renderProbe=null;
  let chromeCpu=null;

  try{
   renderProbe=await page.evaluate(()=>{
    const p=window.__renderProbe;
    if(!p)return null;
    p.running=false;
    const duration=(performance.now()-p.start)/1000;
    return{
     frames:p.frames,
     durationSeconds:Number(duration.toFixed(2)),
     fps:Number((p.frames/duration).toFixed(2))
    };
   });
   log("RENDER PROBE",renderProbe);
  }catch(e){
   renderProbe={error:e.message};
   log("RENDER PROBE FAILED",errorInfo(e));
  }

  try{
   const p=await withTimeout(browserCdp.send("SystemInfo.getProcessInfo"),15000,"CPU results");
   const after=p.processInfo||[];
   const before=new Map(processBefore.map(x=>[x.id,x.cpuTime]));
   const cpuSeconds=after.reduce(
    (sum,x)=>sum+Math.max(0,x.cpuTime-(before.get(x.id)??x.cpuTime)),
    0
   );
   chromeCpu={
    cpuSeconds:Number(cpuSeconds.toFixed(2)),
    percentOfOneCore:Number((cpuSeconds/recordingDuration*100).toFixed(1)),
    processes:after.map(x=>({
     type:x.type,
     id:x.id,
     cpuSeconds:Number(Math.max(0,x.cpuTime-(before.get(x.id)??x.cpuTime)).toFixed(2))
    }))
   };
   log("CHROME CPU RESULTS",chromeCpu);
  }catch(e){
   chromeCpu={error:e.message};
   log("CHROME CPU MEASUREMENT FAILED",errorInfo(e));
  }

  const header=recordingBuffer.subarray(0,32).toString("latin1");
  const hasFtyp=header.includes("ftyp");
  const hasAv1=recordingBuffer.includes(Buffer.from("av01"));
  const hasMp4=hasFtyp&&recordingBuffer.length>1000;

  status.benchmark={
   warmupSeconds:25,
   durationSeconds:Number(recordingDuration.toFixed(1)),
   requestedWidth:WIDTH,
   requestedHeight:HEIGHT,
   requestedFps:FPS,
   renderProbe,
   chromeCpu,
   fileBytes:output.bytes,
   fileSizeMB:Number((output.bytes/1048576).toFixed(2)),
   bitrateKbps:Number((output.bytes*8/recordingDuration/1000).toFixed(1)),
   mp4Container:hasMp4,
   av1CodecMarker:hasAv1,
   recordingValid:hasMp4&&hasAv1,
   frameCount:null,
   downloadEndpoint:"/api/capture/recording.mp4"
  };

  if(!hasMp4)throw Error("Recording file does not contain a valid MP4 container");
  if(!hasAv1)log("WARNING: AV1 codec marker was not found in the recording");

  status.running=false;
  status.connected=true;
  status.error=null;
  status.metrics={phase:"Finished",...status.benchmark};
  benchmarkDone=true;
  retryCount=0;
  status.retries=0;

  log("NATIVE BENCHMARK COMPLETE",status.benchmark);
  log("RECORDING AVAILABLE","/api/capture/recording.mp4");

 }catch(e){
  status.running=false;
  status.error=e.message||String(e);
  status.lastError=status.error;
  status.metrics={phase:"Failed",error:status.error};
  log("CAPTURE RUN FAILED",{run:thisRun,...errorInfo(e)});
  await cleanupFailedRun();
 }finally{
  clearInterval(monitor);
  monitor=null;
  starting=false;
  log("CAPTURE RUN ENDED",{
   run:thisRun,
   benchmarkDone,
   closed,
   connected:status.connected,
   error:status.error
  });
  if(!closed&&!benchmarkDone)scheduleRestart();
 }
}

function attach(app,express){
 log("CAPTURE MODULE ATTACHED",{url:URL,display:process.env.DISPLAY||null});

 app.get("/api/capture/status",(req,res)=>{
  res.set("Cache-Control","no-store").json(status);
 });

 app.get("/api/capture/screenshot.jpg",async(req,res)=>{
  try{
   if(!page||page.isClosed()){
    return res.status(503).json({error:"Capture browser is not ready",status});
   }
   const shot=await page.screenshot({type:"jpeg",quality:70,timeout:15000});
   res.set({
    "Content-Type":"image/jpeg",
    "Cache-Control":"no-store"
   }).send(shot);
  }catch(e){
   log("SCREENSHOT FAILED",errorInfo(e));
   res.status(500).json({error:e.message});
  }
 });

 app.get("/api/capture/recording.mp4",(req,res)=>{
  if(!recordingBuffer){
   return res.status(404).json({error:"Native recording is not ready yet",status});
  }
  log("RECORDING DOWNLOAD REQUESTED",{bytes:recordingBuffer.length});
  res.set({
   "Content-Type":"video/mp4",
   "Content-Length":recordingBuffer.length,
   "Content-Disposition":"attachment; filename=native-capture.mp4",
   "Cache-Control":"no-store"
  });
  res.send(recordingBuffer);
 });

 if(!starting&&!browser&&!benchmarkDone&&!closed)start();
}

async function close(){
 if(closed)return;
 closed=true;
 log("CAPTURE SHUTDOWN REQUESTED");

 clearTimeout(restartTimer);
 restartTimer=null;
 clearInterval(monitor);
 monitor=null;

 const oldCdp=cdp;
 const oldBrowserCdp=browserCdp;
 const oldBrowser=browser;

 cdp=null;
 browserCdp=null;
 browser=null;
 context=null;
 page=null;

 if(oldCdp&&recording){
  try{
   log("SHUTDOWN STOPPING RECORDING",{stream:recording});
   const stopped=await withTimeout(
    oldCdp.send("Page.stopScreenRecording"),
    10000,
    "Shutdown stop recording"
   );
   const stream=stopped?.stream||recording;
   const output=await readStream(oldCdp,stream);
   recordingBuffer=output.buffer;
   log("SHUTDOWN RECORDING SAVED",{bytes:output.bytes});
  }catch(e){
   log("SHUTDOWN RECORDING FINALIZATION FAILED",errorInfo(e));
  }
 }
 recording=null;

 if(oldCdp){
  try{await oldCdp.detach();}catch(e){log("CDP DETACH WARNING",errorInfo(e));}
 }
 if(oldBrowserCdp){
  try{await oldBrowserCdp.detach();}catch(e){log("BROWSER CDP DETACH WARNING",errorInfo(e));}
 }
 if(oldBrowser){
  try{await oldBrowser.close();}catch(e){log("BROWSER CLOSE WARNING",errorInfo(e));}
 }

 status.running=false;
 status.connected=false;
 status.metrics={phase:"Closed"};
 log("CAPTURE SHUTDOWN COMPLETE");
}

module.exports={attach,close};
