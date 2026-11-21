
const puppeteer=require("puppeteer");
const fs=require("node:fs/promises");
const path=require("node:path");
const os=require("node:os");

const WIDTH=640,HEIGHT=360,FPS=30,MAX_BYTES=16*1024*1024;
const URL=process.env.DASHBOARD_URL||"https://zhong-vs-fede.onrender.com/";
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let browser,dashboard,recorder,recordPath,recordingActive=false,started=0,rafStart=0,rafTicks=0,outputBytes=0,error=null,statusTimer=null,polling=false,lastStats=null;

async function instrumentPage(page){
  await page.evaluateOnNewDocument(()=>{
    window.__probe={raf:0,timers:0,mutations:0};
    const raf=requestAnimationFrame.bind(window);
    window.requestAnimationFrame=cb=>raf(t=>{window.__probe.raf++;cb(t)});
    const interval=setInterval.bind(window);
    window.setInterval=(cb,ms,...args)=>interval(()=>{window.__probe.timers++;cb(...args)},ms);
    new MutationObserver(list=>window.__probe.mutations+=list.length).observe(document,{subtree:true,childList:true,attributes:true,characterData:true});
  });
}

async function initialize(){
  if(browser)return;
  browser=await puppeteer.launch({headless:true,executablePath:puppeteer.executablePath(),args:["--no-sandbox","--disable-setuid-sandbox","--disable-dev-shm-usage","--disable-background-timer-throttling","--disable-renderer-backgrounding","--disable-backgrounding-occluded-windows","--renderer-process-limit=2","--disable-extensions"]});
  dashboard=await browser.newPage();
  await dashboard.setViewport({width:WIDTH,height:HEIGHT,deviceScaleFactor:1});
  await instrumentPage(dashboard);
  await dashboard.goto(URL,{waitUntil:"domcontentloaded",timeout:60000});
  await sleep(3000);
  if(typeof dashboard.record!=="function")throw Error("page.record() is unavailable. Check the installed Puppeteer version.");
}

async function diagnostics(){
  try{return await dashboard.evaluate(()=>{
    const p=window.__probe||{};
    return {visibility:document.visibilityState,hidden:document.hidden,hasFocus:document.hasFocus(),rafTicks:p.raf||0,timerTicks:p.timers||0,domMutations:p.mutations||0,title:document.title,url:location.href};
  });}catch(e){return {diagnosticError:e.message};}
}

function getStatus(){
  const elapsed=started?Math.max(1,Date.now()-started):0;
  return {running:recordingActive,method:"Puppeteer page.record() → native Chrome MP4",width:WIDTH,height:HEIGHT,targetFps:FPS,actualFps:null,pageRafFps:elapsed?+((rafTicks-rafStart)/(elapsed/1000)).toFixed(2):0,elapsed,frames:null,encodedFrames:null,droppedFrames:null,maxQueue:null,outputBytes,container:"MP4",error};
}

async function refreshStatus(){
  if(!recordingActive||polling)return;
  polling=true;
  try{
    const d=await diagnostics();
    if(Number.isFinite(d.rafTicks))rafTicks=d.rafTicks;
  }catch(e){error=e.message;}
  finally{polling=false;}
}

async function startRecording(){
  if(recordingActive)throw Error("Recording is already running");
  await initialize();
  await dashboard.bringToFront();
  const d=await diagnostics();
  rafStart=d.rafTicks||0;
  rafTicks=rafStart;
  console.log("[CAPTURE PAGE]",JSON.stringify({visibility:d.visibility,hidden:d.hidden,secure:await dashboard.evaluate(()=>isSecureContext),title:d.title}));
  recordPath=path.join(os.tmpdir(),`dashboard-${process.pid}-${Date.now()}.mp4`);
  try{
    recorder=await dashboard.record({path:recordPath,maxWidth:WIDTH,maxHeight:HEIGHT,frameRate:FPS});
  }catch(e){
    recorder=null;
    await fs.unlink(recordPath).catch(()=>{});
    recordPath=null;
    throw Error(`Native Chrome recording failed: ${e.message}`);
  }
  recordingActive=true;
  started=Date.now();
  outputBytes=0;
  error=null;
  lastStats=null;
  statusTimer=setInterval(refreshStatus,1000);
  console.log(`[CAPTURE] Native MP4 recording started | ${WIDTH}x${HEIGHT} | ${FPS} FPS maximum`);
  return getStatus();
}

async function stopRecording(){
  if(!recordingActive||!recorder)throw Error("No recording is active");
  recordingActive=false;
  if(statusTimer){clearInterval(statusTimer);statusTimer=null;}
  const activeRecorder=recorder;
  recorder=null;
  try{
    await activeRecorder.stop();
    const info=await fs.stat(recordPath);
    outputBytes=info.size;
    if(!outputBytes)throw Error("Chrome produced an empty MP4");
    if(outputBytes>MAX_BYTES)throw Error(`Recording exceeded the 16 MB limit (${(outputBytes/1048576).toFixed(2)} MB)`);
    const buffer=await fs.readFile(recordPath);
    lastStats={elapsed:Date.now()-started,rafTicks,rafStart,outputBytes};
    console.log(`[CAPTURE] Stopped | ${(lastStats.elapsed/1000).toFixed(1)}s | ${outputBytes} bytes | ${(outputBytes/1048576).toFixed(2)} MB | MP4`);
    return buffer;
  }catch(e){error=e.message;throw e;}
  finally{
    if(recordPath)await fs.unlink(recordPath).catch(()=>{});
    recordPath=null;
  }
}

function captureSummary(buffer){
  const s=lastStats||{};
  return {...getStatus(),elapsed:s.elapsed||0,pageRafFps:s.elapsed?+((s.rafTicks-s.rafStart)/(s.elapsed/1000)).toFixed(2):0,recordingBytes:buffer.length,container:"MP4"};
}

async function runCase(name,seconds){
  const before=await diagnostics();
  console.log(`[TEST] ${name} starting`);
  await startRecording();
  await sleep(seconds*1000);
  const after=await diagnostics();
  const buffer=await stopRecording();
  const result={name,before,after,capture:captureSummary(buffer)};
  console.log(`[TEST RESULT] ${name}`,JSON.stringify(result));
  return result;
}

async function runBenchmark(seconds=15){
  if(recordingActive)throw Error("Stop recording before benchmarking");
  console.log(`[DIAGNOSTIC] Native Chrome MP4 capture | ${seconds}s`);
  await initialize();
  await dashboard.goto(URL,{waitUntil:"domcontentloaded",timeout:60000});
  await sleep(3000);
  const result=await runCase("REAL DASHBOARD",seconds);
  console.log("[NATIVE CAPTURE RESULT]",JSON.stringify(result));
  return result;
}

async function close(){
  if(recordingActive){try{await stopRecording();}catch(e){console.error("[CAPTURE STOP]",e.message);}}
  if(statusTimer){clearInterval(statusTimer);statusTimer=null;}
  if(recordPath)await fs.unlink(recordPath).catch(()=>{});
  if(browser){await browser.close();browser=null;dashboard=null;}
}

module.exports={initialize,startRecording,stopRecording,getStatus,diagnostics,close,runBenchmark};
