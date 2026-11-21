
const puppeteer=require("puppeteer");
const {performance}=require("node:perf_hooks");
const WIDTH=640,HEIGHT=360,FPS=30,FRAME_MS=1000/FPS,MAX_BYTES=16*1024*1024;
let browser,dashboard,recordingActive=false,started=0,outputBytes=0,error=null,container="VP8 elementary stream (not WebM)",statusPoll=null,diagnosticsBefore=null;
let stats={frames:0,encodedFrames:0,missedDeadlines:0,frameTimes:[],intervals:[],encodeTimes:[],drawTimes:[],maxQueue:0,queueSamples:[]};

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
    running:recordingActive,method:"Browser-side Canvas + WebCodecs VP8",
    width:WIDTH,height:HEIGHT,targetFps:FPS,
    actualFps:elapsed?+(stats.encodedFrames/(elapsed/1000)).toFixed(2):0,
    elapsed,frames:stats.frames,encodedFrames:stats.encodedFrames,
    missedDeadlines:stats.missedDeadlines,maxQueue:stats.maxQueue,
    outputBytes,container,error
  };
}

async function setupEncoder(){
  return dashboard.evaluate(async({width,height,fps,maxBytes,frameMs})=>{
    if(!("VideoEncoder" in window)||!("VideoFrame" in window))throw Error("WebCodecs VideoEncoder/VideoFrame unavailable");
    if(window.__capture?.canvas)window.__capture.canvas.remove();
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
    let total=0,frames=0,encodedFrames=0,missedDeadlines=0,limitReached=false,encoderError=null,active=false,timer=null,lastAt=0,nextAt=0,maxQueue=0;
    const frameTimes=[],intervals=[],encodeTimes=[],drawTimes=[],queueSamples=[];
    const sample=(a,v)=>{a.push(v);if(a.length>900)a.splice(0,100);};
    const encoder=new VideoEncoder({
      output(chunk){
        const data=new Uint8Array(chunk.byteLength);
        chunk.copyTo(data);
        total+=data.byteLength;
        encodedFrames++;
        if(total>maxBytes){limitReached=true;active=false;if(timer)clearTimeout(timer);return;}
        chunks.push(data);
      },
      error(e){encoderError=e.message||String(e);active=false;if(timer)clearTimeout(timer);}
    });
    encoder.configure(supported.config);

    const draw=frame=>{
      const t=performance.now();
      ctx.fillStyle="#101522";ctx.fillRect(0,0,width,height);
      ctx.fillStyle="#7187ff";ctx.fillRect(0,0,width,5);
      ctx.fillStyle="#ffffff";ctx.font="bold 25px Arial";ctx.fillText("WEBCODECS BENCHMARK",25,48);
      ctx.fillStyle="#aab4ca";ctx.font="14px Arial";ctx.fillText("DIRECT CANVAS → VP8 ENCODER",26,73);
      ctx.fillStyle="#ffffff";ctx.font="bold 36px Arial";ctx.fillText((81208850+frame).toLocaleString("en-US"),25,145);
      ctx.fillStyle="#8995ad";ctx.font="15px Arial";ctx.fillText("LIVE SUBSCRIBERS",27,170);
      ctx.fillStyle="#bd82ff";ctx.fillRect(25,205,590,12);
      ctx.fillStyle="#ffffff";ctx.font="15px Arial";ctx.fillText("FRAME "+frame,25,255);
      ctx.fillStyle="#8995ad";ctx.fillText(new Date().toISOString().slice(11,19),25,285);
      return performance.now()-t;
    };

    const tick=()=>{
      if(!active)return;
      const frameStart=performance.now();
      if(lastAt)sample(intervals,frameStart-lastAt);
      lastAt=frameStart;
      try{
        const drawMs=draw(frames);
        const videoFrame=new VideoFrame(canvas,{timestamp:Math.round(frames*1000000/fps)});
        const before=performance.now();
        encoder.encode(videoFrame,{keyFrame:frames%(fps*2)===0});
        videoFrame.close();
        const encodeMs=performance.now()-before;
        const queue=encoder.encodeQueueSize;
        frames++;
        maxQueue=Math.max(maxQueue,queue);
        sample(drawTimes,drawMs);
        sample(encodeTimes,encodeMs);
        sample(queueSamples,queue);
        const elapsed=performance.now()-frameStart;
        sample(frameTimes,elapsed);
        if(elapsed>frameMs)missedDeadlines++;
        if(queue>fps*2){encoderError="Encoder queue exceeded 2 seconds of frames";active=false;return;}
      }catch(e){encoderError=e.message||String(e);active=false;return;}
      if(!active)return;
      nextAt+=frameMs;
      const now=performance.now();
      if(nextAt<now-frameMs)nextAt=now;
      timer=setTimeout(tick,Math.max(0,nextAt-now));
    };

    window.__capture={
      canvas,
      start(){
        if(active)throw Error("Browser encoder is already running");
        active=true;frames=0;lastAt=0;nextAt=performance.now();
        tick();
        return true;
      },
      stats:()=>({frames,encodedFrames,missedDeadlines,total,maxQueue,queue:encoder.encodeQueueSize,limitReached,encoderError}),
      stop:async()=>{
        active=false;
        if(timer)clearTimeout(timer);
        await encoder.flush();
        const finalStats={frames,encodedFrames,missedDeadlines,total,maxQueue,queue:encoder.encodeQueueSize,limitReached,encoderError};
        encoder.close();
        const combined=new Uint8Array(chunks.reduce((n,c)=>n+c.length,0));
        let offset=0;
        for(const chunk of chunks){combined.set(chunk,offset);offset+=chunk.length;}
        let base64="";
        if(combined.length){
          const blob=new Blob([combined],{type:"application/octet-stream"});
          base64=await new Promise((resolve,reject)=>{
            const reader=new FileReader();
            reader.onload=()=>resolve(reader.result.split(",")[1]);
            reader.onerror=reject;
            reader.readAsDataURL(blob);
          });
        }
        return {...finalStats,base64,size:combined.length,frameTimes,intervals,encodeTimes,drawTimes,queueSamples};
      }
    };
    return {supported:true,codec:supported.config.codec,bitrate:supported.config.bitrate,framerate:supported.config.framerate,loop:"browser-side"};
  },{width:WIDTH,height:HEIGHT,fps:FPS,maxBytes:MAX_BYTES,frameMs:FRAME_MS});
}

function updateStats(s){
  stats.frames=s.frames;
  stats.encodedFrames=s.encodedFrames;
  stats.missedDeadlines=s.missedDeadlines;
  stats.maxQueue=s.maxQueue;
  outputBytes=s.total;
  if(s.encoderError)error=s.encoderError;
  if(s.limitReached)error="Recording reached the 16 MB safety limit";
}

async function startRecording(){
  if(recordingActive)throw Error("Recording is already running");
  await initialize();
  await dashboard.bringToFront();
  console.log("[CAPTURE PAGE]",JSON.stringify(await dashboard.evaluate(()=>({visibility:document.visibilityState,hidden:document.hidden}))));
  const setup=await setupEncoder();
  console.log("[WEBCODECS]",JSON.stringify(setup));
  stats={frames:0,encodedFrames:0,missedDeadlines:0,frameTimes:[],intervals:[],encodeTimes:[],drawTimes:[],maxQueue:0,queueSamples:[]};
  outputBytes=0;container="VP8 elementary stream (not WebM)";error=null;
  started=Date.now();recordingActive=true;
  try{
    await dashboard.evaluate(()=>window.__capture.start());
    statusPoll=setInterval(async()=>{
      try{
        const s=await dashboard.evaluate(()=>window.__capture.stats());
        updateStats(s);
      }catch(e){error=e.message;}
    },1000);
  }catch(e){recordingActive=false;throw e;}
  console.log(`[CAPTURE] Browser-side WebCodecs started | ${WIDTH}x${HEIGHT} | ${FPS} FPS target`);
  return getStatus();
}

async function stopRecording(){
  if(!recordingActive)throw Error("No recording is active");
  if(statusPoll){clearInterval(statusPoll);statusPoll=null;}
  try{
    const result=await dashboard.evaluate(()=>window.__capture.stop());
    const buffer=Buffer.from(result.base64||"","base64");
    updateStats(result);
    stats.frameTimes=result.frameTimes;
    stats.intervals=result.intervals;
    stats.encodeTimes=result.encodeTimes;
    stats.drawTimes=result.drawTimes;
    stats.queueSamples=result.queueSamples;
    outputBytes=buffer.length;
    if(result.encoderError)throw Error(result.encoderError);
    if(result.limitReached||buffer.length>MAX_BYTES)throw Error("Recording exceeded the 16 MB safety limit");
    if(!buffer.length)throw Error("WebCodecs returned no encoded frames");
    console.log(`[CAPTURE] Stopped | ${((Date.now()-started)/1000).toFixed(1)}s | ${stats.frames} submitted | ${stats.encodedFrames} encoded | ${(buffer.length/1024/1024).toFixed(2)} MB`);
    recordingActive=false;
    return buffer;
  }catch(e){error=e.message;recordingActive=false;throw e;}
}

async function runBenchmark(seconds=15){
  console.log(`[DIAGNOSTIC] Browser-side WebCodecs test starting | ${seconds}s`);
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
      drawTime:summary(stats.drawTimes),
      queue:{max:stats.maxQueue,avg:average(stats.queueSamples)}
    },
    benchmarkSeconds:seconds
  };
  console.log("[WEBCODECS RESULT]",JSON.stringify(result));
  return result;
}

async function close(){
  if(statusPoll){clearInterval(statusPoll);statusPoll=null;}
  if(recordingActive){try{await stopRecording()}catch(e){console.error("[CAPTURE STOP]",e.message)}}
  if(browser){await browser.close();browser=null;dashboard=null;}
}

module.exports={initialize,startRecording,stopRecording,getStatus,diagnostics,close,runBenchmark};
