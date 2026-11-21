
const puppeteer=require("puppeteer");
const {performance}=require("node:perf_hooks");
const WIDTH=640,HEIGHT=360,FPS=30,FRAME_MS=1000/FPS,MAX_BYTES=16*1024*1024;
let browser,dashboard,running=false,recordingActive=false,started=0,outputBytes=0,error=null,container="VP8 elementary stream (not WebM)",loopPromise=null,diagnosticsBefore=null;
let stats={frames:0,encodedFrames:0,missedDeadlines:0,frameTimes:[],intervals:[],encodeTimes:[],maxQueue:0,queueSamples:[]};

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const average=a=>a.length?+(a.reduce((x,y)=>x+y,0)/a.length).toFixed(2):0;
const percentile=(a,p)=>a.length?[...a].sort((x,y)=>x-y)[Math.min(a.length-1,Math.floor(a.length*p))]:0;
function summary(a){return {count:a.length,avg:average(a),min:a.length?+Math.min(...a).toFixed(2):0,max:a.length?+Math.max(...a).toFixed(2):0,p95:+percentile(a,.95).toFixed(2)};}

async function initialize(){
  if(browser)return;
  browser=await puppeteer.launch({
    headless:true,
    executablePath:puppeteer.executablePath(),
    args:["--no-sandbox","--disable-setuid-sandbox","--disable-dev-shm-usage","--disable-background-timer-throttling","--disable-renderer-backgrounding","--disable-backgrounding-occluded-windows","--renderer-process-limit=2","--disable-extensions"]
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
  try{return await dashboard.evaluate(()=>{
    const p=window.__probe||{};
    return {visibility:document.visibilityState,hidden:document.hidden,hasFocus:document.hasFocus(),rafTicks:p.raf||0,timerTicks:p.timers||0,domMutations:p.mutations||0,title:document.title,url:location.href};
  });}catch(e){return {diagnosticError:e.message};}
}

function getStatus(){
  const elapsed=started?Math.max(1,Date.now()-started):0;
  return {
    running:recordingActive,method:"Canvas + WebCodecs VideoEncoder (VP8)",
    width:WIDTH,height:HEIGHT,targetFps:FPS,
    actualFps:elapsed?+(stats.encodedFrames/(elapsed/1000)).toFixed(2):0,
    elapsed,frames:stats.frames,encodedFrames:stats.encodedFrames,
    missedDeadlines:stats.missedDeadlines,maxQueue:stats.maxQueue,
    outputBytes,container,error
  };
}

async function setupEncoder(){
  return dashboard.evaluate(async({width,height,fps,maxBytes})=>{
    if(!("VideoEncoder" in window)||!("VideoFrame" in window))throw Error("WebCodecs VideoEncoder/VideoFrame unavailable");
    const config={codec:"vp8",width,height,bitrate:900000,framerate:fps,latencyMode:"realtime",hardwareAcceleration:"prefer-software"};
    const supported=await VideoEncoder.isConfigSupported(config);
    if(!supported.supported)throw Error("Chrome does not support this VP8 encoder configuration");
    const canvas=document.createElement("canvas");
    canvas.width=width;canvas.height=height;
    canvas.style.cssText="position:fixed;left:-10000px;top:0";
    document.documentElement.appendChild(canvas);
    const ctx=canvas.getContext("2d",{alpha:false,desynchronized:true});
    if(!ctx)throw Error("Canvas 2D unavailable");
    const chunks=[];
    let total=0,encodedFrames=0,limitReached=false,encoderError=null;
    const encoder=new VideoEncoder({
      output(chunk){
        const data=new Uint8Array(chunk.byteLength);
        chunk.copyTo(data);
        total+=data.byteLength;
        if(total>maxBytes){limitReached=true;return;}
        chunks.push(data);
        encodedFrames++;
      },
      error(e){encoderError=e.message||String(e);}
    });
    encoder.configure(supported.config);
    const draw=(frame)=>{
      const t=performance.now();
      ctx.fillStyle="#101522";ctx.fillRect(0,0,width,height);
      ctx.fillStyle="#7187ff";ctx.fillRect(0,0,width,5);
      ctx.fillStyle="#ffffff";ctx.font="bold 25px Arial";ctx.fillText("WEBCodecs BENCHMARK",25,48);
      ctx.fillStyle="#aab4ca";ctx.font="14px Arial";ctx.fillText("DIRECT CANVAS → VP8 ENCODER",26,73);
      const value=(81208850+frame).toLocaleString("en-US");
      ctx.fillStyle="#ffffff";ctx.font="bold 36px Arial";ctx.fillText(value,25,145);
      ctx.fillStyle="#8995ad";ctx.font="15px Arial";ctx.fillText("LIVE SUBSCRIBERS",27,170);
      ctx.fillStyle="#bd82ff";ctx.fillRect(25,205,590,12);
      ctx.fillStyle="#ffffff";ctx.font="15px Arial";ctx.fillText("FRAME "+frame,25,255);
      ctx.fillStyle="#8995ad";ctx.fillText(new Date().toISOString().slice(11,19),25,285);
      return performance.now()-t;
    };
    window.__capture={
      config:supported.config,
      draw,
      encode(frame,timestamp){
        if(encoderError)throw Error(encoderError);
        if(limitReached)return {limitReached:true};
        const drawMs=draw(frame);
        const videoFrame=new VideoFrame(canvas,{timestamp});
        const before=performance.now();
        encoder.encode(videoFrame,{keyFrame:frame%(fps*2)===0});
        videoFrame.close();
        return {drawMs,encodeMs:performance.now()-before,queue:encoder.encodeQueueSize,limitReached};
      },
      stats:()=>({encodedFrames,total,limitReached,encoderError,queue:encoder.encodeQueueSize}),
      stop:async()=>{
        await encoder.flush();
        const finalStats={encodedFrames,total,limitReached,encoderError,queue:encoder.encodeQueueSize};
        encoder.close();
        const combined=new Uint8Array(chunks.reduce((n,c)=>n+c.length,0));
        let offset=0;
        for(const chunk of chunks){combined.set(chunk,offset);offset+=chunk.length;}
        const blob=new Blob([combined],{type:"application/octet-stream"});
        const base64=await new Promise((resolve,reject)=>{
          const reader=new FileReader();
          reader.onload=()=>resolve(reader.result.split(",")[1]);
          reader.onerror=reject;
          reader.readAsDataURL(blob);
        });
        return {...finalStats,base64,size:combined.length};
      }
    };
    return {supported:true,codec:supported.config.codec,bitrate:supported.config.bitrate,framerate:supported.config.framerate};
  },{width:WIDTH,height:HEIGHT,fps:FPS,maxBytes:MAX_BYTES});
}

async function frameLoop(){
  let nextAt=performance.now(),lastAt=0,frame=0;
  while(running){
    const frameStart=performance.now();
    if(lastAt)stats.intervals.push(frameStart-lastAt);
    lastAt=frameStart;
    try{
      const result=await dashboard.evaluate(({frame,timestamp})=>window.__capture.encode(frame,timestamp),{frame,timestamp:Math.round(frame*1000000/FPS)});
      if(result.limitReached){error="Recording reached the 16 MB safety limit";running=false;break;}
      stats.frames++;
      stats.frameTimes.push(performance.now()-frameStart);
      stats.encodeTimes.push(result.encodeMs);
      stats.maxQueue=Math.max(stats.maxQueue,result.queue);
      stats.queueSamples.push(result.queue);
      if(result.queue>FPS*2){error="Encoder queue exceeded 2 seconds of frames";running=false;break;}
      frame++;
      if(performance.now()-frameStart>FRAME_MS)stats.missedDeadlines++;
    }catch(e){
      error=e.message;running=false;
      console.error("[WEBCODECS ERROR]",e.message);
      break;
    }
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
  const setup=await setupEncoder();
  console.log("[WEBCODECS]",JSON.stringify(setup));
  stats={frames:0,encodedFrames:0,missedDeadlines:0,frameTimes:[],intervals:[],encodeTimes:[],maxQueue:0,queueSamples:[]};
  outputBytes=0;container="VP8 elementary stream (not WebM)";error=null;
  started=Date.now();recordingActive=true;running=true;
  loopPromise=frameLoop();
  console.log(`[CAPTURE] WebCodecs recording started | ${WIDTH}x${HEIGHT} | ${FPS} FPS target`);
  return getStatus();
}

async function stopRecording(){
  if(!recordingActive)throw Error("No recording is active");
  running=false;
  if(loopPromise)await loopPromise;
  try{
    const result=await dashboard.evaluate(()=>window.__capture.stop());
    const buffer=Buffer.from(result.base64||"","base64");
    outputBytes=buffer.length;
    stats.encodedFrames=result.encodedFrames;
    if(result.encoderError)throw Error(result.encoderError);
    if(result.limitReached||buffer.length>MAX_BYTES)throw Error("Recording exceeded the 16 MB safety limit");
    if(!buffer.length)throw Error("WebCodecs returned no encoded frames");
    console.log(`[CAPTURE] Stopped | ${((Date.now()-started)/1000).toFixed(1)}s | ${stats.frames} submitted | ${stats.encodedFrames} encoded | ${(buffer.length/1024/1024).toFixed(2)} MB`);
    recordingActive=false;
    return buffer;
  }catch(e){error=e.message;recordingActive=false;throw e;}
}

async function runBenchmark(seconds=15){
  console.log(`[DIAGNOSTIC] WebCodecs test starting | ${seconds}s`);
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
      ...getStatus(),recordingBytes:buffer.length,
      frameTime:summary(stats.frameTimes),
      frameInterval:summary(stats.intervals),
      encodeTime:summary(stats.encodeTimes),
      queue:{max:stats.maxQueue,avg:average(stats.queueSamples)}
    },
    benchmarkSeconds:seconds
  };
  console.log("[WEBCODECS RESULT]",JSON.stringify(result));
  return result;
}

async function close(){
  if(recordingActive){try{await stopRecording()}catch(e){console.error("[CAPTURE STOP]",e.message)}}
  if(browser){await browser.close();browser=null;dashboard=null;}
}

module.exports={initialize,startRecording,stopRecording,getStatus,diagnostics,close,runBenchmark};
