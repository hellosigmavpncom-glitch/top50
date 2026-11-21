
const puppeteer=require("puppeteer");
const {performance}=require("node:perf_hooks");

const WIDTH=640,HEIGHT=360,FPS=30,MAX_BYTES=16*1024*1024;
const URL=process.env.DASHBOARD_URL||"https://zhong-vs-fede.onrender.com/";
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const avg=a=>a.length?+(a.reduce((x,y)=>x+y,0)/a.length).toFixed(2):0;
const pct=(a,p)=>a.length?[...a].sort((x,y)=>x-y)[Math.min(a.length-1,Math.floor(a.length*p))]:0;
const summary=a=>({count:a.length,avg:avg(a),min:a.length?+Math.min(...a).toFixed(2):0,max:a.length?+Math.max(...a).toFixed(2):0,p95:+pct(a,.95).toFixed(2)});
let browser,dashboard,cdp,recordingActive=false,started=0,outputBytes=0,error=null,statusTimer=null,polling=false,frameBusy=false,droppedFrames=0,lastStats=null;
let stats={frames:0,encodedFrames:0,maxQueue:0};

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
}

async function diagnostics(){
  try{return await dashboard.evaluate(()=>{
    const p=window.__probe||{};
    return {visibility:document.visibilityState,hidden:document.hidden,hasFocus:document.hasFocus(),rafTicks:p.raf||0,timerTicks:p.timers||0,domMutations:p.mutations||0,title:document.title,url:location.href};
  });}catch(e){return {diagnosticError:e.message};}
}

function getStatus(){
  const elapsed=started?Math.max(1,Date.now()-started):0;
  return {running:recordingActive,method:"CDP actual-page screencast → WebCodecs VP8",width:WIDTH,height:HEIGHT,targetFps:FPS,actualFps:elapsed?+(stats.encodedFrames/(elapsed/1000)).toFixed(2):0,elapsed,frames:stats.frames,encodedFrames:stats.encodedFrames,droppedFrames,maxQueue:stats.maxQueue,outputBytes,container:"VP8 elementary stream (not WebM)",error};
}

async function setupEncoder(){
  return dashboard.evaluate(async({width,height,fps,maxBytes})=>{
    if(!("VideoEncoder" in window)||!("VideoFrame" in window))throw Error("WebCodecs unavailable");
    if(!isSecureContext)throw Error("WebCodecs requires a secure context");
    const config={codec:"vp8",width,height,bitrate:900000,framerate:fps,latencyMode:"realtime",hardwareAcceleration:"prefer-software"};
    const supported=await VideoEncoder.isConfigSupported(config);
    if(!supported.supported)throw Error("VP8 encoder configuration unsupported");

    const canvas=document.createElement("canvas");
    canvas.width=width;canvas.height=height;
    const ctx=canvas.getContext("2d",{alpha:false,desynchronized:true});
    if(!ctx)throw Error("Canvas unavailable");

    const chunks=[],data={frames:0,encodedFrames:0,maxQueue:0,outputBytes:0,error:null,frameTimes:[],decodeTimes:[],encodeTimes:[],intervals:[],queueSamples:[]};
    let total=0,active=false,lastAt=0,encoderError=null,limitReached=false;
    const record=(a,v)=>{a.push(v);if(a.length>900)a.shift();};

    const encoder=new VideoEncoder({
      output(chunk){
        const bytes=new Uint8Array(chunk.byteLength);
        chunk.copyTo(bytes);
        if(total+bytes.length>maxBytes){limitReached=true;active=false;return;}
        chunks.push(bytes);total+=bytes.length;
        data.encodedFrames++;data.outputBytes=total;
      },
      error(e){encoderError=e.message||String(e);data.error=encoderError;active=false;}
    });
    encoder.configure(supported.config);

    window.__capture={
      async push(base64){
        if(!active||encoderError||limitReached)return false;
        const begin=performance.now();
        try{
          const raw=Uint8Array.from(atob(base64),c=>c.charCodeAt(0));
          const bitmap=await createImageBitmap(new Blob([raw],{type:"image/jpeg"}));
          const decoded=performance.now();
          ctx.drawImage(bitmap,0,0,width,height);
          bitmap.close();
          const frame=new VideoFrame(canvas,{timestamp:Math.round(data.frames*1000000/fps)});
          const before=performance.now();
          encoder.encode(frame,{keyFrame:data.frames%(fps*2)===0});
          frame.close();
          record(data.decodeTimes,decoded-begin);
          record(data.encodeTimes,performance.now()-before);
          record(data.frameTimes,performance.now()-begin);
          if(lastAt)record(data.intervals,begin-lastAt);
          lastAt=begin;
          data.frames++;
          data.maxQueue=Math.max(data.maxQueue,encoder.encodeQueueSize);
          record(data.queueSamples,encoder.encodeQueueSize);
          if(encoder.encodeQueueSize>fps*2)throw Error("Encoder queue exceeded 2 seconds");
          return true;
        }catch(e){data.error=e.message||String(e);active=false;return false;}
      },
      start(){if(active)throw Error("Capture already running");active=true;lastAt=0;return true;},
      stats(){return {...data,encoderError,limitReached};},
      async stop(){
        active=false;
        try{
          await encoder.flush();
          const result={...data,encoderError,limitReached};
          const combined=new Uint8Array(chunks.reduce((n,c)=>n+c.length,0));
          let offset=0;
          for(const chunk of chunks){combined.set(chunk,offset);offset+=chunk.length;}
          const base64=await new Promise((resolve,reject)=>{
            const reader=new FileReader();
            reader.onload=()=>resolve(reader.result.split(",")[1]);
            reader.onerror=reject;
            reader.readAsDataURL(new Blob([combined]));
          });
          return {...result,base64,size:combined.length};
        }finally{encoder.close();canvas.remove();delete window.__capture;}
      }
    };
    return {supported:true,codec:supported.config.codec,bitrate:supported.config.bitrate,framerate:supported.config.framerate};
  },{width:WIDTH,height:HEIGHT,fps:FPS,maxBytes:MAX_BYTES});
}

async function refreshStatus(){
  if(!recordingActive||polling)return;
  polling=true;
  try{
    const s=await dashboard.evaluate(()=>window.__capture?.stats());
    if(s){stats={frames:s.frames,encodedFrames:s.encodedFrames,maxQueue:s.maxQueue};outputBytes=s.outputBytes;if(s.error)error=s.error;}
  }catch(e){error=e.message;}
  finally{polling=false;}
}

async function startRecording(){
  if(recordingActive)throw Error("Recording is already running");
  await initialize();
  await dashboard.bringToFront();
  console.log("[CAPTURE PAGE]",JSON.stringify(await dashboard.evaluate(()=>({visibility:document.visibilityState,hidden:document.hidden,secure:isSecureContext,title:document.title}))));
  const setup=await setupEncoder();
  console.log("[WEBCODECS]",JSON.stringify(setup));

  stats={frames:0,encodedFrames:0,maxQueue:0};
  droppedFrames=0;outputBytes=0;error=null;lastStats=null;frameBusy=false;
  started=Date.now();
  await dashboard.evaluate(()=>window.__capture.start());
  cdp=await dashboard.createCDPSession();

  const onFrame=async({data,sessionId})=>{
    if(!recordingActive||frameBusy){droppedFrames++;cdp.send("Page.screencastFrameAck",{sessionId}).catch(()=>{});return;}
    frameBusy=true;
    try{
      const accepted=await dashboard.evaluate(b=>window.__capture?.push(b),data);
      if(!accepted){const s=await dashboard.evaluate(()=>window.__capture?.stats());if(s?.error)error=s.error;}
    }catch(e){error=e.message;}
    finally{
      frameBusy=false;
      cdp.send("Page.screencastFrameAck",{sessionId}).catch(()=>{});
    }
  };

  cdp.on("Page.screencastFrame",onFrame);
  recordingActive=true;
  try{
    await cdp.send("Page.startScreencast",{format:"jpeg",quality:75,maxWidth:WIDTH,maxHeight:HEIGHT,everyNthFrame:1});
  }catch(e){recordingActive=false;cdp.off("Page.screencastFrame",onFrame);await cdp.detach();cdp=null;throw e;}
  statusTimer=setInterval(refreshStatus,1000);
  console.log(`[CAPTURE] Actual dashboard screencast started | ${WIDTH}x${HEIGHT} | ${FPS} FPS target`);
  return getStatus();
}

async function stopRecording(){
  if(!recordingActive)throw Error("No recording is active");
  recordingActive=false;
  if(statusTimer){clearInterval(statusTimer);statusTimer=null;}
  try{
    if(cdp){await cdp.send("Page.stopScreencast").catch(()=>{});await cdp.detach().catch(()=>{});cdp=null;}
    while(frameBusy)await sleep(5);
    const result=await dashboard.evaluate(()=>window.__capture.stop());
    const buffer=Buffer.from(result.base64||"","base64");
    lastStats=result;
    stats={frames:result.frames,encodedFrames:result.encodedFrames,maxQueue:result.maxQueue};
    outputBytes=buffer.length;
    if(result.encoderError)throw Error(result.encoderError);
    if(result.error)throw Error(result.error);
    if(result.limitReached||buffer.length>MAX_BYTES)throw Error("Recording exceeded the 16 MB limit");
    if(!buffer.length)throw Error("No encoded frames received");
    console.log(`[CAPTURE] Stopped | ${((Date.now()-started)/1000).toFixed(1)}s | ${stats.frames} captured | ${stats.encodedFrames} encoded | ${droppedFrames} dropped | ${(buffer.length/1048576).toFixed(2)} MB`);
    return buffer;
  }catch(e){error=e.message;throw e;}
}

function captureSummary(buffer){
  const s=lastStats||{};
  return {...getStatus(),recordingBytes:buffer.length,frameTime:summary(s.frameTimes||[]),decodeTime:summary(s.decodeTimes||[]),encodeTime:summary(s.encodeTimes||[]),frameInterval:summary(s.intervals||[]),queue:{max:s.maxQueue||0,avg:avg(s.queueSamples||[])}};
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
  console.log(`[DIAGNOSTIC] Actual screenshot capture | ${seconds}s per test`);
  await initialize();
  const realDashboard=dashboard;
  let blankPage,blank,actual;
  try{
    blankPage=await browser.newPage();
    await blankPage.setViewport({width:WIDTH,height:HEIGHT,deviceScaleFactor:1});
    await instrumentPage(blankPage);
    await blankPage.setRequestInterception(true);
    blankPage.on("request",req=>{
      if(req.isNavigationRequest()&&req.frame()===blankPage.mainFrame()){
        req.respond({status:200,contentType:"text/html",headers:{"Cache-Control":"no-store"},body:"<!doctype html><html><head><title>Isolated Blank Benchmark</title></head><body></body></html>"}).catch(()=>{});
      }else req.abort().catch(()=>{});
    });

    dashboard=blankPage;
    await blankPage.goto(URL,{waitUntil:"domcontentloaded",timeout:60000});
    await sleep(500);
    blank=await runCase("ISOLATED BLANK PAGE",seconds);

    dashboard=realDashboard;
    await dashboard.goto(URL,{waitUntil:"domcontentloaded",timeout:60000});
    await sleep(3000);
    actual=await runCase("REAL DASHBOARD",seconds);

    const result={blank,dashboard:actual,comparison:{blankFps:blank.capture.actualFps,dashboardFps:actual.capture.actualFps,fpsDifference:+(blank.capture.actualFps-actual.capture.actualFps).toFixed(2)}};
    console.log("[ACTUAL CAPTURE COMPARISON]",JSON.stringify(result));
    return result;
  }finally{
    dashboard=realDashboard;
    if(recordingActive){try{await stopRecording();}catch(e){console.error("[CLEANUP]",e.message);}}
    if(blankPage&&!blankPage.isClosed())await blankPage.close().catch(()=>{});
  }
}

async function close(){
  if(recordingActive){try{await stopRecording();}catch(e){console.error("[CAPTURE STOP]",e.message);}}
  if(statusTimer){clearInterval(statusTimer);statusTimer=null;}
  if(browser){await browser.close();browser=null;dashboard=null;cdp=null;}
}

module.exports={initialize,startRecording,stopRecording,getStatus,diagnostics,close,runBenchmark};
