
const puppeteer=require("puppeteer");
const WIDTH=640,HEIGHT=360,FPS=30,MAX_BYTES=16*1024*1024;
let browser,dashboard,cdp,running=false,started=0,outputBytes=0,error=null,recordingHandle=null,container="unknown",diagnosticsBefore=null;

const sleep=ms=>new Promise(r=>setTimeout(r,ms));

async function initialize(){
  if(browser)return;
  browser=await puppeteer.launch({headless:true,executablePath:puppeteer.executablePath(),args:["--no-sandbox","--disable-setuid-sandbox","--disable-dev-shm-usage","--disable-gpu","--disable-background-timer-throttling","--disable-renderer-backgrounding","--disable-backgrounding-occluded-windows","--renderer-process-limit=2","--disable-extensions"]});
  dashboard=await browser.newPage();
  await dashboard.setViewport({width:WIDTH,height:HEIGHT,deviceScaleFactor:1});
  await dashboard.evaluateOnNewDocument(()=>{
    window.__probe={raf:0,timers:0,mutations:0};
    const raf=requestAnimationFrame.bind(window);
    window.requestAnimationFrame=cb=>raf(t=>{window.__probe.raf++;cb(t)});
    const interval=setInterval.bind(window);
    window.setInterval=(cb,ms,...args)=>interval(()=>{window.__probe.timers++;cb(...args)},ms);
    new MutationObserver(list=>window.__probe.mutations+=list.length).observe(document,{subtree:true,childList:true,attributes:true,characterData:true});
  });
  await dashboard.goto(process.env.DASHBOARD_URL||"https://zhong-vs-fede.onrender.com/",{waitUntil:"domcontentloaded",timeout:60000});
  await sleep(3000);
}

async function diagnostics(){
  try{
    return await dashboard.evaluate(()=>{
      const p=window.__probe||{};
      return {visibility:document.visibilityState,hidden:document.hidden,hasFocus:document.hasFocus(),rafTicks:p.raf||0,timerTicks:p.timers||0,domMutations:p.mutations||0,title:document.title,url:location.href};
    });
  }catch(e){return {diagnosticError:e.message};}
}

function detectContainer(buffer){
  if(buffer.length>=4&&buffer.subarray(0,4).toString("hex")==="1a45dfa3")return "WebM/Matroska";
  if(buffer.length>=8&&buffer.toString("ascii",4,8)==="ftyp")return "MP4";
  return "unknown";
}

function getStatus(){
  return {running,method:"Native CDP Page.startScreenRecording",width:WIDTH,height:HEIGHT,targetFps:FPS,elapsed:started?Date.now()-started:0,outputBytes,container,error};
}

async function readStream(handle){
  const chunks=[];
  let total=0,eof=false;
  try{
    while(!eof){
      const result=await cdp.send("IO.read",{handle,size:1024*1024});
      const chunk=result.base64Encoded?Buffer.from(result.data,"base64"):Buffer.from(result.data,"utf8");
      if(chunk.length){
        total+=chunk.length;
        if(total>MAX_BYTES)throw Error("Recording reached the 16 MB safety limit");
        chunks.push(chunk);
      }
      eof=result.eof;
    }
    return Buffer.concat(chunks,total);
  }finally{
    try{await cdp.send("IO.close",{handle})}catch{}
  }
}

async function startRecording(){
  if(running)throw Error("Recording is already running");
  await initialize();
  await dashboard.bringToFront();
  const visibility=await dashboard.evaluate(()=>({visibility:document.visibilityState,hidden:document.hidden}));
  console.log("[CAPTURE PAGE]",JSON.stringify(visibility));
  cdp=await dashboard.createCDPSession();
  await cdp.send("Page.enable");
  try{
    const result=await cdp.send("Page.startScreenRecording",{frameRate:FPS,maxWidth:WIDTH,maxHeight:HEIGHT,audio:false});
    recordingHandle=result.stream||null;
    console.log("[NATIVE CDP START]",JSON.stringify({hasStream:!!recordingHandle,resultKeys:Object.keys(result)}));
    running=true;started=Date.now();outputBytes=0;container="recording";error=null;
    console.log(`[CAPTURE] Native recording started | ${WIDTH}x${HEIGHT} | ${FPS} FPS target`);
    return getStatus();
  }catch(e){
    error=e.message;
    try{await cdp.detach()}catch{}
    cdp=null;
    throw Error("Native CDP recording could not start: "+e.message);
  }
}

async function stopRecording(){
  if(!running)throw Error("No recording is active");
  running=false;
  let handle=null;
  try{
    const result=await cdp.send("Page.stopScreenRecording");
    handle=result.stream||recordingHandle;
    console.log("[NATIVE CDP STOP]",JSON.stringify({hasStream:!!result.stream,resultKeys:Object.keys(result)}));
    if(!handle)throw Error("Chrome did not return an IO stream handle");
    const buffer=await readStream(handle);
    outputBytes=buffer.length;
    container=detectContainer(buffer);
    if(!buffer.length)throw Error("Chrome returned an empty recording");
    console.log(`[CAPTURE] Stopped | ${((Date.now()-started)/1000).toFixed(1)}s | ${(buffer.length/1024/1024).toFixed(2)} MB | ${container} | ${buffer.subarray(0,16).toString("hex")}`);
    return buffer;
  }catch(e){
    error=e.message;
    throw e;
  }finally{
    if(recordingHandle&&recordingHandle!==handle){
      try{await cdp.send("IO.close",{handle:recordingHandle})}catch{}
    }
    recordingHandle=null;
  }
}

async function runBenchmark(seconds=15){
  console.log(`[DIAGNOSTIC] Native CDP test starting | ${seconds}s`);
  await initialize();
  diagnosticsBefore=await diagnostics();
  console.log("[PAGE BEFORE]",JSON.stringify(diagnosticsBefore));
  await startRecording();
  await sleep(seconds*1000);
  const after=await diagnostics();
  console.log("[PAGE AFTER]",JSON.stringify(after));
  const buffer=await stopRecording();
  const result={
    before:diagnosticsBefore,after,
    capture:{...getStatus(),recordingBytes:buffer.length,signature:buffer.subarray(0,32).toString("hex"),firstBytes:buffer.subarray(0,16).toString("ascii")},
    benchmarkSeconds:seconds
  };
  console.log("[NATIVE CDP RESULT]",JSON.stringify(result));
  return result;
}

async function close(){
  try{if(running)await stopRecording()}catch(e){console.error("[CAPTURE STOP]",e.message)}
  if(cdp){try{await cdp.detach()}catch{}cdp=null;}
  if(browser){await browser.close();browser=null;dashboard=null;}
}

module.exports={initialize,startRecording,stopRecording,getStatus,diagnostics,close,runBenchmark};
