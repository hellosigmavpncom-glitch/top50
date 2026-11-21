
const puppeteer=require("puppeteer");
const fs=require("node:fs/promises");
const path=require("node:path");
const os=require("node:os");

const WIDTH=1600,HEIGHT=900,FPS=30,MAX_BYTES=16*1024*1024;
const URL=process.env.DASHBOARD_URL||"https://zhong-vs-fede.onrender.com/";
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const now=()=>new Date().toLocaleTimeString();
const log=(s,d)=>console.log(`[CAPTURE ${now()}] ${s}`,d===undefined?"":JSON.stringify(d));
const memory=()=>{const m=process.memoryUsage();return {rssMB:+(m.rss/1048576).toFixed(1),heapMB:+(m.heapUsed/1048576).toFixed(1),externalMB:+(m.external/1048576).toFixed(1)};};
const timeout=(promise,ms,label)=>Promise.race([promise,new Promise((_,reject)=>setTimeout(()=>reject(Error(`${label} timed out after ${ms}ms`)),ms))]);

let browser,dashboard,recorder,recordPath,recordingActive=false,started=0,outputBytes=0,error=null,statusTimer=null,lastStats=null,initializing=null;

process.on("uncaughtExceptionMonitor",e=>log("UNCAUGHT EXCEPTION",{message:e.message,stack:e.stack,memory:memory()}));
process.on("unhandledRejection",e=>log("UNHANDLED REJECTION",{message:e?.message||String(e),stack:e?.stack,memory:memory()}));
process.on("exit",code=>console.log(`[CAPTURE ${now()}] PROCESS EXIT | code=${code}`));

async function initialize(){
  if(browser&&browser.connected)return;
  if(initializing)return initializing;
  initializing=(async()=>{
    try{
      log("INIT 1/6: BEFORE PUPPETEER.LAUNCH",{version:puppeteer.version||"unknown",memory:memory()});
      const executablePath=await puppeteer.executablePath();
      log("CHROME EXECUTABLE PATH",executablePath);
      browser=await timeout(puppeteer.launch({headless:true,executablePath,args:["--no-sandbox","--disable-setuid-sandbox","--disable-dev-shm-usage","--disable-background-timer-throttling","--disable-renderer-backgrounding","--disable-backgrounding-occluded-windows","--renderer-process-limit=2","--disable-extensions","--window-size=1600,900","--force-device-scale-factor=1"]}),60000,"Chrome launch");
      log("INIT 2/6: CHROME LAUNCHED",{connected:browser.connected,memory:memory()});
      browser.on("disconnected",()=>{log("BROWSER DISCONNECTED",{memory:memory()});browser=null;dashboard=null;});
      dashboard=await timeout(browser.newPage(),30000,"Page creation");
      log("INIT 3/6: PAGE CREATED");
      dashboard.on("error",e=>log("PAGE ERROR",e.message));
      dashboard.on("pageerror",e=>log("PAGE JAVASCRIPT ERROR",e.message));
      dashboard.on("requestfailed",r=>log("PAGE REQUEST FAILED",{url:r.url(),error:r.failure()?.errorText}));
      dashboard.on("console",m=>{if(m.type()==="error")log("BROWSER CONSOLE ERROR",m.text());});
      await timeout(dashboard.setViewport({width:WIDTH,height:HEIGHT,deviceScaleFactor:1}),15000,"Initial viewport");
      log("INIT 4/6: VIEWPORT SET",{width:WIDTH,height:HEIGHT,deviceScaleFactor:1,memory:memory()});
      log("NAVIGATION START",{url:URL});
      await timeout(dashboard.goto(URL,{waitUntil:"domcontentloaded",timeout:60000}),65000,"Dashboard navigation");
      log("INIT 5/6: DASHBOARD NAVIGATED",{url:dashboard.url(),title:await dashboard.title(),memory:memory()});
      await sleep(3000);
      const available=typeof dashboard.record==="function";
      log("INIT 6/6: PAGE.RECORD CHECK",{available,memory:memory()});
      if(!available)throw Error("Puppeteer page.record() is unavailable");
      log("INITIALIZATION COMPLETE");
    }catch(e){
      error=e.message;
      log("INITIALIZATION FAILED",{message:e.message,stack:e.stack,memory:memory()});
      if(browser){await browser.close().catch(()=>{});browser=null;dashboard=null;}
      throw e;
    }finally{
      initializing=null;
    }
  })();
  return initializing;
}

async function diagnostics(){
  log("DIAGNOSTICS START");
  try{
    const result=await timeout(dashboard.evaluate(()=>({visibility:document.visibilityState,hidden:document.hidden,width:innerWidth,height:innerHeight,screenWidth:screen.width,screenHeight:screen.height,title:document.title,url:location.href})),10000,"Page diagnostics");
    log("DIAGNOSTICS COMPLETE",result);
    return result;
  }catch(e){
    log("DIAGNOSTICS FAILED",{message:e.message,stack:e.stack});
    return {diagnosticError:e.message};
  }
}

function getStatus(){
  return {running:recordingActive,method:"Puppeteer page.record() → native Chrome MP4",width:WIDTH,height:HEIGHT,targetFps:FPS,actualFps:null,elapsed:started?Date.now()-started:0,outputBytes,container:"MP4",error};
}

async function startRecording(){
  log("START RECORDING ENTERED",{running:recordingActive,memory:memory()});
  if(recordingActive)throw Error("Recording is already running");
  await initialize();
  if(!dashboard||!browser?.connected)throw Error("Chrome browser is not connected");
  const d=await diagnostics();
  log("CAPTURE PAGE",d);
  recordPath=path.join(os.tmpdir(),`dashboard-${process.pid}-${Date.now()}.mp4`);
  try{
    log("RECORD: BEFORE DASHBOARD.RECORD",{width:WIDTH,height:HEIGHT,frameRate:FPS,memory:memory()});
    recorder=await timeout(dashboard.record({path:recordPath,maxWidth:WIDTH,maxHeight:HEIGHT,frameRate:FPS}),30000,"Native recording startup");
    if(!recorder)throw Error("Chrome returned no recorder");
    recordingActive=true;
    started=Date.now();
    outputBytes=0;
    error=null;
    lastStats=null;
    log("RECORDING STARTED",{width:WIDTH,height:HEIGHT,fps:FPS,memory:memory()});
    return getStatus();
  }catch(e){
    recorder=null;
    recordingActive=false;
    error=e.message;
    log("RECORD START FAILED",{message:e.message,stack:e.stack,memory:memory()});
    if(recordPath)await fs.unlink(recordPath).catch(()=>{});
    recordPath=null;
    throw Error(`Native MP4 recording failed: ${e.message}`);
  }
}

async function stopRecording(){
  log("STOP RECORDING ENTERED",{running:recordingActive,hasRecorder:!!recorder,memory:memory()});
  if(!recordingActive||!recorder)throw Error("No recording is active");
  recordingActive=false;
  const activeRecorder=recorder;
  recorder=null;
  try{
    log("STOP: BEFORE RECORDER.STOP");
    await timeout(activeRecorder.stop(),30000,"Recorder stop");
    log("STOP: RECORDER.STOP COMPLETE");
    const info=await fs.stat(recordPath);
    outputBytes=info.size;
    log("STOP: FILE STAT",{bytes:outputBytes,megabytes:+(outputBytes/1048576).toFixed(2)});
    if(!outputBytes)throw Error("Chrome produced an empty MP4");
    if(outputBytes>MAX_BYTES)throw Error(`Recording exceeded 16 MB (${(outputBytes/1048576).toFixed(2)} MB)`);
    log("STOP: BEFORE READING MP4");
    const buffer=await fs.readFile(recordPath);
    lastStats={elapsed:Date.now()-started,outputBytes};
    log("RECORDING COMPLETE",{seconds:+(lastStats.elapsed/1000).toFixed(2),bytes:outputBytes,memory:memory()});
    return buffer;
  }catch(e){
    error=e.message;
    log("RECORDING STOP FAILED",{message:e.message,stack:e.stack,memory:memory()});
    throw e;
  }finally{
    if(recordPath){
      log("CLEANUP: DELETING TEMP FILE",recordPath);
      await fs.unlink(recordPath).catch(e=>log("TEMP FILE DELETE FAILED",e.message));
    }
    recordPath=null;
  }
}

function captureSummary(buffer){
  return {...getStatus(),elapsed:lastStats?.elapsed||0,recordingBytes:buffer.length,container:"MP4"};
}

async function runBenchmark(seconds=15){
  log("BENCHMARK ENTERED",{seconds,width:WIDTH,height:HEIGHT,fps:FPS,memory:memory()});
  if(recordingActive)throw Error("Stop recording before benchmarking");
  try{
    await initialize();
    const before=await diagnostics();
    log("BENCHMARK: BEFORE RECORDING",before);
    await startRecording();
    log("BENCHMARK: RECORDING STARTED; WAITING",{seconds});
    await sleep(seconds*1000);
    log("BENCHMARK: WAIT COMPLETE");
    const after=await diagnostics();
    log("BENCHMARK: AFTER RECORDING",after);
    const buffer=await stopRecording();
    const result={before,after,capture:captureSummary(buffer)};
    log("BENCHMARK RESULT",result);
    return result;
  }catch(e){
    error=e.message;
    log("BENCHMARK FAILED",{message:e.message,stack:e.stack,memory:memory()});
    throw e;
  }
}

async function close(){
  log("CLOSE ENTERED",{recordingActive,memory:memory()});
  if(recordingActive){try{await stopRecording();}catch(e){log("CLOSE STOP ERROR",e.message);}}
  if(statusTimer){clearInterval(statusTimer);statusTimer=null;}
  if(recordPath)await fs.unlink(recordPath).catch(()=>{});
  if(browser){
    log("CLOSE: BEFORE BROWSER.CLOSE");
    await browser.close().catch(e=>log("BROWSER CLOSE ERROR",e.message));
    browser=null;
    dashboard=null;
    log("CLOSE: BROWSER CLOSED");
  }
}

module.exports={initialize,startRecording,stopRecording,getStatus,diagnostics,close,runBenchmark};
