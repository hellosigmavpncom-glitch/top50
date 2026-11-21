
const puppeteer=require("puppeteer");
const {performance}=require("node:perf_hooks");
const WIDTH=640,HEIGHT=360,FPS=30,FRAME_MS=1000/FPS,MAX_BYTES=16*1024*1024;
let browser,dashboard,cdp,running=false,recordingActive=false,started=0,outputBytes=0,error=null,container="unknown",loopPromise=null,diagnosticsBefore=null;
let stats={frames:0,damageFrames:0,drawnFrames:0,missedDeadlines:0,screenshotBytes:0,frameTimes:[],intervals:[],drawTimes:[]};

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const average=a=>a.length?+(a.reduce((x,y)=>x+y,0)/a.length).toFixed(2):0;
const percentile=(a,p)=>a.length?[...a].sort((x,y)=>x-y)[Math.min(a.length-1,Math.floor(a.length*p))]:0;

function summary(a){
  return {count:a.length,avg:average(a),min:a.length?+Math.min(...a).toFixed(2):0,max:a.length?+Math.max(...a).toFixed(2):0,p95:+percentile(a,.95).toFixed(2)};
}

async function initialize(){
  if(browser)return;
  browser=await puppeteer.launch({
    headless:true,
    executablePath:puppeteer.executablePath(),
    args:[
      "--no-sandbox","--disable-setuid-sandbox","--disable-dev-shm-usage",
      "--disable-background-timer-throttling","--disable-renderer-backgrounding",
      "--disable-backgrounding-occluded-windows","--renderer-process-limit=2",
      "--disable-extensions","--enable-begin-frame-control",
      "--run-all-compositor-stages-before-draw",
      "--disable-new-content-rendering-timeout",
      "--disable-threaded-animation","--disable-checker-imaging",
      "--disable-image-animation-resync"
    ]
  });
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
  if(buffer.length>=4&&buffer.subarray(0,4).toString("hex")==="1a45dfa3")return "WebM";
  if(buffer.length>=8&&buffer.toString("ascii",4,8)==="ftyp")return "MP4";
  return "unknown";
}

function getStatus(){
  return {
    running:recordingActive,
    method:"HeadlessExperimental.beginFrame + MediaRecorder",
    width:WIDTH,height:HEIGHT,targetFps:FPS,
    actualFps:started?+(stats.frames/((Date.now()-started)/1000)).toFixed(2):0,
    elapsed:started?Date.now()-started:0,
    frames:stats.frames,damageFrames:stats.damageFrames,
    drawnFrames:stats.drawnFrames,missedDeadlines:stats.missedDeadlines,
    outputBytes,container,error
  };
}

async function setupRecorder(){
  return dashboard.evaluate(({width,height,fps,maxBytes})=>{
    if(!window.MediaRecorder)throw Error("MediaRecorder is unavailable");
    const types=["video/webm;codecs=vp8","video/webm;codecs=vp9","video/webm"];
    const mimeType=types.find(t=>MediaRecorder.isTypeSupported(t));
    if(!mimeType)throw Error("No supported WebM MediaRecorder format");
    const canvas=document.createElement("canvas");
    canvas.width=width;canvas.height=height;
    canvas.style.cssText="position:fixed;left:-10000px;top:0;pointer-events:none";
    document.documentElement.appendChild(canvas);
    const ctx=canvas.getContext("2d",{alpha:false,desynchronized:true});
    if(!ctx)throw Error("Canvas 2D context unavailable");
    const stream=canvas.captureStream(fps);
    const recorder=new MediaRecorder(stream,{mimeType,videoBitsPerSecond:900000});
    const chunks=[];
    let total=0,limitReached=false;
    recorder.ondataavailable=e=>{
      if(!e.data.size)return;
      total+=e.data.size;
      if(total>maxBytes){
        limitReached=true;
        if(recorder.state==="recording")recorder.stop();
      }else chunks.push(e.data);
    };
    recorder.start(1000);
    window.__capture={
      mimeType,
      draw:async data=>{
        const t=performance.now();
        const blob=await (await fetch("data:image/jpeg;base64,"+data)).blob();
        const bitmap=await createImageBitmap(blob);
        ctx.drawImage(bitmap,0,0,width,height);
        bitmap.close();
        return {ms:performance.now()-t,limitReached};
      },
      stop:async()=>{
        if(recorder.state!=="inactive"){
          await new Promise(resolve=>{
            recorder.addEventListener("stop",resolve,{once:true});
            recorder.stop();
          });
        }
        stream.getTracks().forEach(t=>t.stop());
        const blob=new Blob(chunks,{type:mimeType});
        if(!blob.size)return {base64:"",size:0,mimeType,limitReached};
        const base64=await new Promise((resolve,reject)=>{
          const reader=new FileReader();
          reader.onload=()=>resolve(reader.result.split(",")[1]);
          reader.onerror=reject;
          reader.readAsDataURL(blob);
        });
        return {base64,size:blob.size,mimeType,limitReached};
      }
    };
    return {mimeType,recorderState:recorder.state};
  },{width:WIDTH,height:HEIGHT,fps:FPS,maxBytes:MAX_BYTES});
}

async function frameLoop(){
  let nextAt=performance.now(),lastAt=0;
  while(running){
    const frameStart=performance.now();
    if(lastAt)stats.intervals.push(frameStart-lastAt);
    lastAt=frameStart;
    try{
      const result=await cdp.send("HeadlessExperimental.beginFrame",{
        interval:FRAME_MS,
        screenshot:{format:"jpeg",quality:60,optimizeForSpeed:true}
      });
      stats.frames++;
      if(result.hasDamage)stats.damageFrames++;
      if(result.screenshotData){
        stats.screenshotBytes+=Buffer.byteLength(result.screenshotData,"base64");
        const draw=await dashboard.evaluate(data=>window.__capture.draw(data),result.screenshotData);
        stats.drawnFrames++;
        stats.drawTimes.push(draw.ms);
        if(draw.limitReached){error="Recording reached the 16 MB safety limit";running=false;}
      }
    }catch(e){
      error=e.message;
      running=false;
      console.error("[BEGIN FRAME ERROR]",e.message);
      break;
    }
    const elapsed=performance.now()-frameStart;
    stats.frameTimes.push(elapsed);
    if(elapsed>FRAME_MS)stats.missedDeadlines++;
    nextAt+=FRAME_MS;
    const wait=nextAt-performance.now();
    if(wait>0)await sleep(wait);
    else if(wait<-FRAME_MS)nextAt=performance.now();
  }
}

async function startRecording(){
  if(recordingActive)throw Error("Recording is already running");
  await initialize();
  await dashboard.bringToFront();
  console.log("[CAPTURE PAGE]",JSON.stringify(await dashboard.evaluate(()=>({visibility:document.visibilityState,hidden:document.hidden}))));
  cdp=await dashboard.createCDPSession();
  await cdp.send("Page.enable");
  try{
    await cdp.send("HeadlessExperimental.enable");
    const setup=await setupRecorder();
    console.log("[MEDIA RECORDER]",JSON.stringify(setup));
    stats={frames:0,damageFrames:0,drawnFrames:0,missedDeadlines:0,screenshotBytes:0,frameTimes:[],intervals:[],drawTimes:[]};
    outputBytes=0;container="recording";error=null;
    started=Date.now();recordingActive=true;running=true;
    loopPromise=frameLoop();
    console.log(`[CAPTURE] BeginFrame recording started | ${WIDTH}x${HEIGHT} | ${FPS} FPS target`);
    return getStatus();
  }catch(e){
    error=e.message;
    recordingActive=false;running=false;
    try{await cdp.detach()}catch{}
    cdp=null;
    throw Error("BeginFrame recording could not start: "+e.message);
  }
}

async function stopRecording(){
  if(!recordingActive)throw Error("No recording is active");
  running=false;
  if(loopPromise)await loopPromise;
  try{
    const result=await dashboard.evaluate(()=>window.__capture.stop());
    const buffer=Buffer.from(result.base64||"","base64");
    outputBytes=buffer.length;
    container=detectContainer(buffer);
    if(!buffer.length)throw Error("MediaRecorder returned an empty recording");
    if(buffer.length>MAX_BYTES)throw Error("Recording exceeded the 16 MB safety limit");
    console.log(`[CAPTURE] Stopped | ${((Date.now()-started)/1000).toFixed(1)}s | ${stats.frames} frames | ${(buffer.length/1024/1024).toFixed(2)} MB | ${container}`);
    recordingActive=false;
    return buffer;
  }catch(e){
    error=e.message;
    recordingActive=false;
    throw e;
  }finally{
    if(cdp){try{await cdp.detach()}catch{}cdp=null;}
  }
}

async function runBenchmark(seconds=15){
  console.log(`[DIAGNOSTIC] BeginFrame test starting | ${seconds}s`);
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
    capture:{
      ...getStatus(),
      recordingBytes:buffer.length,
      signature:buffer.subarray(0,32).toString("hex"),
      container:detectContainer(buffer),
      frameTime:summary(stats.frameTimes),
      frameInterval:summary(stats.intervals),
      drawTime:summary(stats.drawTimes),
      screenshotBytes:stats.screenshotBytes
    },
    benchmarkSeconds:seconds
  };
  console.log("[BEGIN FRAME RESULT]",JSON.stringify(result));
  return result;
}

async function close(){
  try{if(recordingActive)await stopRecording()}catch(e){console.error("[CAPTURE STOP]",e.message)}
  if(cdp){try{await cdp.detach()}catch{}cdp=null;}
  if(browser){await browser.close();browser=null;dashboard=null;}
}

module.exports={initialize,startRecording,stopRecording,getStatus,diagnostics,close,runBenchmark};
