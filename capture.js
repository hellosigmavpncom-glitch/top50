
const puppeteer=require("puppeteer");
const fs=require("node:fs/promises");
const path=require("node:path");
const os=require("node:os");

const WIDTH=1600,HEIGHT=900,FPS=30,MAX_BYTES=16*1024*1024;
const URL=process.env.DASHBOARD_URL||"https://zhong-vs-fede.onrender.com/";
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let browser,dashboard,recorder,recordPath,recordingActive=false,started=0,outputBytes=0,error=null,statusTimer=null,lastStats=null;

async function initialize(){
  if(browser)return;
  browser=await puppeteer.launch({headless:true,executablePath:await puppeteer.executablePath(),args:["--no-sandbox","--disable-setuid-sandbox","--disable-dev-shm-usage","--disable-background-timer-throttling","--disable-renderer-backgrounding","--disable-backgrounding-occluded-windows","--renderer-process-limit=2","--disable-extensions","--window-size=1600,900","--force-device-scale-factor=1"]});
  dashboard=await browser.newPage();
  await dashboard.setViewport({width:WIDTH,height:HEIGHT,deviceScaleFactor:1});
  await dashboard.goto(URL,{waitUntil:"domcontentloaded",timeout:60000});
  await sleep(3000);
  if(typeof dashboard.record!=="function")throw Error("Puppeteer page.record() is unavailable");
}

async function diagnostics(){
  try{return await dashboard.evaluate(()=>({visibility:document.visibilityState,hidden:document.hidden,width:innerWidth,height:innerHeight,screenWidth:screen.width,screenHeight:screen.height,title:document.title,url:location.href}));}
  catch(e){return {diagnosticError:e.message};}
}

function getStatus(){
  return {running:recordingActive,method:"Puppeteer page.record() → native Chrome MP4",width:WIDTH,height:HEIGHT,targetFps:FPS,actualFps:null,elapsed:started?Date.now()-started:0,outputBytes,container:"MP4",error};
}

async function startRecording(){
  if(recordingActive)throw Error("Recording is already running");
  await initialize();
  await dashboard.setViewport({width:WIDTH,height:HEIGHT,deviceScaleFactor:1});
  await dashboard.bringToFront();
  const d=await diagnostics();
  console.log("[CAPTURE PAGE]",JSON.stringify(d));
  recordPath=path.join(os.tmpdir(),`dashboard-${process.pid}-${Date.now()}.mp4`);
  try{
    recorder=await dashboard.record({path:recordPath,maxWidth:WIDTH,maxHeight:HEIGHT,frameRate:FPS});
  }catch(e){
    recorder=null;
    await fs.unlink(recordPath).catch(()=>{});
    recordPath=null;
    throw Error(`Native MP4 recording failed: ${e.message}`);
  }
  recordingActive=true;
  started=Date.now();
  outputBytes=0;
  error=null;
  lastStats=null;
  console.log(`[CAPTURE] Started | ${WIDTH}x${HEIGHT} | ${FPS} FPS requested`);
  return getStatus();
}

async function stopRecording(){
  if(!recordingActive||!recorder)throw Error("No recording is active");
  recordingActive=false;
  const activeRecorder=recorder;
  recorder=null;
  try{
    await activeRecorder.stop();
    const info=await fs.stat(recordPath);
    outputBytes=info.size;
    if(!outputBytes)throw Error("Chrome produced an empty MP4");
    if(outputBytes>MAX_BYTES)throw Error(`Recording exceeded 16 MB (${(outputBytes/1048576).toFixed(2)} MB)`);
    const buffer=await fs.readFile(recordPath);
    lastStats={elapsed:Date.now()-started,outputBytes};
    console.log(`[CAPTURE] Stopped | ${(lastStats.elapsed/1000).toFixed(1)}s | ${outputBytes} bytes | ${WIDTH}x${HEIGHT} | MP4`);
    return buffer;
  }catch(e){error=e.message;throw e;}
  finally{
    if(recordPath)await fs.unlink(recordPath).catch(()=>{});
    recordPath=null;
  }
}

function captureSummary(buffer){
  return {...getStatus(),elapsed:lastStats?.elapsed||0,recordingBytes:buffer.length,container:"MP4"};
}

async function runBenchmark(seconds=15){
  if(recordingActive)throw Error("Stop recording before benchmarking");
  console.log(`[BENCHMARK] ${seconds}s | ${WIDTH}x${HEIGHT} | ${FPS} FPS requested`);
  await initialize();
  await dashboard.setViewport({width:WIDTH,height:HEIGHT,deviceScaleFactor:1});
  const before=await diagnostics();
  await startRecording();
  await sleep(seconds*1000);
  const after=await diagnostics();
  const buffer=await stopRecording();
  const result={before,after,capture:captureSummary(buffer)};
  console.log("[BENCHMARK RESULT]",JSON.stringify(result));
  return result;
}

async function close(){
  if(recordingActive){try{await stopRecording();}catch(e){console.error("[CAPTURE STOP]",e.message);}}
  if(statusTimer){clearInterval(statusTimer);statusTimer=null;}
  if(recordPath)await fs.unlink(recordPath).catch(()=>{});
  if(browser){await browser.close();browser=null;dashboard=null;}
}

module.exports={initialize,startRecording,stopRecording,getStatus,diagnostics,close,runBenchmark};
