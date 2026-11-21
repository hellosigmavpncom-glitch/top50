
const puppeteer=require("puppeteer");
const {performance}=require("node:perf_hooks");

const WIDTH=640,HEIGHT=360,FPS=30,FRAME_MS=1000/FPS,MAX_BYTES=16*1024*1024;
const DASHBOARD_URL=process.env.DASHBOARD_URL||"https://zhong-vs-fede.onrender.com/";
const METRICS=["Timestamp","TaskDuration","ScriptDuration","LayoutDuration","RecalcStyleDuration","JSHeapUsedSize","Nodes","Documents","Frames","LayoutCount","RecalcStyleCount","JSEventListeners"];

let browser,dashboard,cdp,running=false,recordingActive=false,benchmarking=false,started=0,outputBytes=0,error=null,container="VP8 elementary stream (not WebM)",statusTimer=null,polling=false,lastBrowserStats=null;
let stats={frames:0,encodedFrames:0,missedDeadlines:0,maxQueue:0};

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
    const p=window.__probe={raf:0,timers:0,mutations:0,mutationTypes:{},mutationTargets:{},longTasks:[],layoutShifts:[],observerErrors:[]};
    const raf=requestAnimationFrame.bind(window);
    window.requestAnimationFrame=cb=>raf(t=>{p.raf++;cb(t)});
    const interval=setInterval.bind(window);
    window.setInterval=(cb,ms,...args)=>interval(()=>{p.timers++;cb(...args)},ms);
    new MutationObserver(list=>{
      p.mutations+=list.length;
      for(const m of list){
        p.mutationTypes[m.type]=(p.mutationTypes[m.type]||0)+1;
        const e=m.target.nodeType===1?m.target:m.target.parentElement;
        if(e){
          const key=(e.tagName||"").toLowerCase()+(e.id?"#"+e.id:"")+(typeof e.className==="string"&&e.className.trim()?"."+e.className.trim().replace(/\s+/g,".").slice(0,70):"");
          p.mutationTargets[key]=(p.mutationTargets[key]||0)+1;
        }
      }
    }).observe(document,{subtree:true,childList:true,attributes:true,characterData:true});
    try{
      new PerformanceObserver(list=>{
        for(const e of list.getEntries())p.longTasks.push({duration:+e.duration.toFixed(2),start:+e.startTime.toFixed(1),name:e.name||"task"});
        if(p.longTasks.length>300)p.longTasks.splice(0,p.longTasks.length-300);
      }).observe({type:"longtask",buffered:true});
    }catch(e){p.observerErrors.push("longtask: "+e.message)}
    try{
      new PerformanceObserver(list=>{
        for(const e of list.getEntries())if(!e.hadRecentInput)p.layoutShifts.push({value:+e.value.toFixed(5),start:+e.startTime.toFixed(1)});
        if(p.layoutShifts.length>300)p.layoutShifts.splice(0,p.layoutShifts.length-300);
      }).observe({type:"layout-shift",buffered:true});
    }catch(e){p.observerErrors.push("layout-shift: "+e.message)}
  });
  await dashboard.goto(DASHBOARD_URL,{waitUntil:"domcontentloaded",timeout:60000});
  await sleep(3000);
  try{
    cdp=await dashboard.createCDPSession();
    await cdp.send("Performance.enable");
    await cdp.send("Profiler.enable");
    await cdp.send("Profiler.setSamplingInterval",{interval:1000});
    console.log("[PROFILER] Chrome CPU profiler enabled | 1ms sampling");
  }catch(e){
    console.log("[PROFILER] CDP profiling unavailable:",e.message);
    cdp=null;
  }
}

async function diagnostics(){
  try{
    return await dashboard.evaluate(()=>{
      const p=window.__probe||{};
      const resources=performance.getEntriesByType("resource").map(e=>({
        name:e.name.split("/").slice(-2).join("/").slice(0,120),
        type:e.initiatorType,
        duration:+e.duration.toFixed(1),
        transfer:e.transferSize||0,
        size:e.decodedBodySize||0
      }));
      const sorted=(o)=>Object.entries(o||{}).sort((a,b)=>b[1]-a[1]).slice(0,15).map(([name,count])=>({name,count}));
      const slowResources=[...resources].sort((a,b)=>b.duration-a.duration).slice(0,15);
      const resourceTypes={};
      for(const r of resources)resourceTypes[r.type]=(resourceTypes[r.type]||0)+1;
      return {
        visibility:document.visibilityState,hidden:document.hidden,hasFocus:document.hasFocus(),
        rafTicks:p.raf||0,timerTicks:p.timers||0,domMutations:p.mutations||0,
        mutationTypes:p.mutationTypes||{},topMutationTargets:sorted(p.mutationTargets),
        longTasks:{count:(p.longTasks||[]).length,totalMs:+(p.longTasks||[]).reduce((n,x)=>n+x.duration,0).toFixed(1),maxMs:Math.max(0,...(p.longTasks||[]).map(x=>x.duration)),top:[...(p.longTasks||[])].sort((a,b)=>b.duration-a.duration).slice(0,10)},
        layoutShifts:{count:(p.layoutShifts||[]).length,total:+(p.layoutShifts||[]).reduce((n,x)=>n+x.value,0).toFixed(5)},
        resources:{count:resources.length,types:resourceTypes,slowest:slowResources},
        observerErrors:p.observerErrors||[],title:document.title,url:location.href
      };
    });
  }catch(e){return {diagnosticError:e.message};}
}

async function getCdpMetrics(){
  if(!cdp)return null;
  try{
    const result=await cdp.send("Performance.getMetrics");
    const out={};
    for(const m of result.metrics)if(METRICS.includes(m.name))out[m.name]=m.value;
    return out;
  }catch(e){return {error:e.message};}
}

function metricDifference(before,after){
  if(!before||!after||before.error||after.error)return {before,after};
  const out={};
  for(const k of Object.keys(after)){
    if(typeof before[k]==="number"&&typeof after[k]==="number"){
      const d=after[k]-before[k];
      out[k]=+d.toFixed(3);
    }
  }
  return out;
}

async function startCpuProfile(){
  if(!cdp)return {available:false,reason:"CDP profiler unavailable"};
  try{
    const metricsBefore=await getCdpMetrics();
    await cdp.send("Profiler.start");
    return {available:true,metricsBefore};
  }catch(e){return {available:false,reason:e.message};}
}

async function stopCpuProfile(state){
  if(!state?.available)return state;
  try{
    const result=await cdp.send("Profiler.stop");
    const profile=result.profile;
    const nodes=new Map(profile.nodes.map(n=>[n.id,n]));
    const selfTime=new Map();
    for(let i=0;i<(profile.samples||[]).length;i++){
      const id=profile.samples[i];
      const delta=(profile.timeDeltas?.[i]||1000)/1000;
      selfTime.set(id,(selfTime.get(id)||0)+delta);
    }
    const hotspots=[...selfTime.entries()].map(([id,ms])=>{
      const n=nodes.get(id),f=n?.callFrame||{};
      return {function:f.functionName||"(anonymous)",url:(f.url||"").split("/").slice(-2).join("/").slice(0,100),line:f.lineNumber==null?null:f.lineNumber+1,selfMs:+ms.toFixed(2),samples:n?.hitCount||0};
    }).sort((a,b)=>b.selfMs-a.selfMs).slice(0,30);
    const metricsAfter=await getCdpMetrics();
    return {
      available:true,samplingIntervalUs:1000,
      durationMs:+((profile.endTime-profile.startTime)/1000).toFixed(1),
      samples:(profile.samples||[]).length,
      hotspots,
      metrics:metricDifference(state.metricsBefore,metricsAfter)
    };
  }catch(e){return {available:false,reason:e.message};}
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
  return dashboard.evaluate(async({width,height,fps,frameMs,maxBytes})=>{
    if(!("VideoEncoder" in window)||!("VideoFrame" in window))throw Error("WebCodecs unavailable");
    const config={codec:"vp8",width,height,bitrate:900000,framerate:fps,latencyMode:"realtime",hardwareAcceleration:"prefer-software"};
    const supported=await VideoEncoder.isConfigSupported(config);
    if(!supported.supported)throw Error("VP8 encoder configuration unsupported");
    const canvas=document.createElement("canvas");
    canvas.width=width;canvas.height=height;
    canvas.style.cssText="position:fixed;left:-10000px;top:0";
    document.documentElement.appendChild(canvas);
    const ctx=canvas.getContext("2d",{alpha:false,desynchronized:true});
    if(!ctx)throw Error("Canvas 2D unavailable");
    const chunks=[];
    const data={frames:0,encodedFrames:0,missedDeadlines:0,maxQueue:0,outputBytes:0,error:null,frameTimes:[],intervals:[],encodeTimes:[],drawTimes:[],queueSamples:[]};
    let total=0,active=false,timer=null,lastAt=0,nextAt=0,encoderError=null,limitReached=false;
    const record=(array,value)=>{array.push(value);if(array.length>900)array.shift()};
    const encoder=new VideoEncoder({
      output(chunk){
        const bytes=new Uint8Array(chunk.byteLength);
        chunk.copyTo(bytes);
        total+=bytes.length;
        if(total>maxBytes){limitReached=true;return}
        chunks.push(bytes);
        data.encodedFrames++;
        data.outputBytes=total;
      },
      error(e){encoderError=e.message||String(e);data.error=encoderError;active=false}
    });
    encoder.configure(supported.config);
    function draw(frame){
      const t=performance.now();
      ctx.fillStyle="#101522";ctx.fillRect(0,0,width,height);
      ctx.fillStyle="#7187ff";ctx.fillRect(0,0,width,5);
      ctx.fillStyle="#fff";ctx.font="bold 25px Arial";ctx.fillText("WEBCODECS BENCHMARK",25,48);
      ctx.fillStyle="#aab4ca";ctx.font="14px Arial";ctx.fillText("DIRECT CANVAS → VP8 ENCODER",26,73);
      ctx.fillStyle="#fff";ctx.font="bold 36px Arial";ctx.fillText((81208850+frame).toLocaleString("en-US"),25,145);
      ctx.fillStyle="#8995ad";ctx.font="15px Arial";ctx.fillText("LIVE SUBSCRIBERS",27,170);
      ctx.fillStyle="#bd82ff";ctx.fillRect(25,205,590,12);
      ctx.fillStyle="#fff";ctx.font="15px Arial";ctx.fillText("FRAME "+frame,25,255);
      ctx.fillStyle="#8995ad";ctx.fillText(new Date().toISOString().slice(11,19),25,285);
      return performance.now()-t;
    }
    function tick(){
      if(!active||encoderError||limitReached)return;
      const begin=performance.now();
      if(lastAt)record(data.intervals,begin-lastAt);
      if(nextAt&&begin-nextAt>frameMs)data.missedDeadlines+=Math.floor((begin-nextAt)/frameMs);
      lastAt=begin;
      try{
        const drawMs=draw(data.frames);
        const frame=new VideoFrame(canvas,{timestamp:Math.round(data.frames*1000000/fps)});
        const before=performance.now();
        encoder.encode(frame,{keyFrame:data.frames%(fps*2)===0});
        frame.close();
        record(data.drawTimes,drawMs);
        record(data.encodeTimes,performance.now()-before);
        data.maxQueue=Math.max(data.maxQueue,encoder.encodeQueueSize);
        record(data.queueSamples,encoder.encodeQueueSize);
        data.frames++;
        record(data.frameTimes,performance.now()-begin);
        if(encoder.encodeQueueSize>fps*2)throw Error("Encoder queue exceeded 2 seconds");
      }catch(e){data.error=e.message||String(e);active=false;return}
      if(limitReached){data.error="Recording reached the 16 MB limit";active=false;return}
      nextAt+=frameMs;
      const now=performance.now();
      if(now-nextAt>frameMs)nextAt=now;
      timer=setTimeout(tick,Math.max(0,nextAt-now));
    }
    window.__capture={
      config:supported.config,
      start(){
        if(active)throw Error("Capture already running");
        active=true;lastAt=0;nextAt=performance.now();tick();return true;
      },
      stats(){return {...data,outputBytes:total,encoderError,limitReached}},
      async stop(){
        active=false;
        if(timer)clearTimeout(timer);
        await encoder.flush();
        const finalStats={...data,outputBytes:total,encoderError,limitReached};
        encoder.close();canvas.remove();
        const combined=new Uint8Array(chunks.reduce((n,c)=>n+c.length,0));
        let offset=0;
        for(const chunk of chunks){combined.set(chunk,offset);offset+=chunk.length}
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
  },{width:WIDTH,height:HEIGHT,fps:FPS,frameMs:FRAME_MS,maxBytes:MAX_BYTES});
}

async function refreshStatus(){
  if(!recordingActive||polling)return;
  polling=true;
  try{
    const s=await dashboard.evaluate(()=>window.__capture?.stats());
    if(s){
      stats={frames:s.frames,encodedFrames:s.encodedFrames,missedDeadlines:s.missedDeadlines,maxQueue:s.maxQueue};
      outputBytes=s.outputBytes;
      if(s.error)error=s.error;
    }
  }catch(e){error=e.message}
  finally{polling=false}
}

async function startRecording(){
  if(recordingActive)throw Error("Recording is already running");
  await initialize();
  await dashboard.bringToFront();
  console.log("[CAPTURE PAGE]",JSON.stringify(await dashboard.evaluate(()=>({visibility:document.visibilityState,hidden:document.hidden}))));
  const setup=await setupEncoder();
  console.log("[WEBCODECS]",JSON.stringify({...setup,loop:"browser-side"}));
  stats={frames:0,encodedFrames:0,missedDeadlines:0,maxQueue:0};
  outputBytes=0;error=null;lastBrowserStats=null;
  container="VP8 elementary stream (not WebM)";
  started=Date.now();recordingActive=true;
  await dashboard.evaluate(()=>window.__capture.start());
  if(!benchmarking)statusTimer=setInterval(refreshStatus,1000);
  console.log(`[CAPTURE] Browser-side WebCodecs started | ${WIDTH}x${HEIGHT} | ${FPS} FPS target`);
  return getStatus();
}

async function stopRecording(){
  if(!recordingActive)throw Error("No recording is active");
  recordingActive=false;
  if(statusTimer){clearInterval(statusTimer);statusTimer=null}
  await refreshStatus();
  try{
    const result=await dashboard.evaluate(()=>window.__capture.stop());
    const buffer=Buffer.from(result.base64||"","base64");
    lastBrowserStats=result;
    stats={frames:result.frames,encodedFrames:result.encodedFrames,missedDeadlines:result.missedDeadlines,maxQueue:result.maxQueue};
    outputBytes=buffer.length;
    if(result.encoderError)throw Error(result.encoderError);
    if(result.error)throw Error(result.error);
    if(result.limitReached||buffer.length>MAX_BYTES)throw Error("Recording exceeded the 16 MB safety limit");
    if(!buffer.length)throw Error("WebCodecs returned no encoded frames");
    console.log(`[CAPTURE] Stopped | ${((Date.now()-started)/1000).toFixed(1)}s | ${stats.frames} submitted | ${stats.encodedFrames} encoded | ${(buffer.length/1024/1024).toFixed(2)} MB`);
    return buffer;
  }catch(e){error=e.message;throw e}
}

function captureSummary(buffer){
  const s=lastBrowserStats||{};
  return {
    ...getStatus(),recordingBytes:buffer.length,
    frameTime:summary(s.frameTimes||[]),
    frameInterval:summary(s.intervals||[]),
    encodeTime:summary(s.encodeTimes||[]),
    drawTime:summary(s.drawTimes||[]),
    queue:{max:s.maxQueue||0,avg:average(s.queueSamples||[])}
  };
}

async function runCase(name,seconds){
  const before=await diagnostics();
  const cpuState=await startCpuProfile();
  console.log(`[TEST] ${name} starting`);
  await startRecording();
  await sleep(seconds*1000);
  const after=await diagnostics();
  const buffer=await stopRecording();
  const cpu=await stopCpuProfile(cpuState);
  const result={name,before,after,capture:captureSummary(buffer),cpu};
  console.log(`[TEST RESULT] ${name}`,JSON.stringify(result));
  return result;
}

async function runBenchmark(seconds=15){
  if(recordingActive)throw Error("Stop the current recording before benchmarking");
  benchmarking=true;
  try{
    console.log(`[DIAGNOSTIC] Full bottleneck profile | blank vs dashboard | ${seconds}s each`);
    await initialize();
    await dashboard.evaluate(()=>{document.documentElement.innerHTML="<head><title>Blank Benchmark</title></head><body></body>"});
    await sleep(500);
    const blank=await runCase("BLANK PAGE",seconds);
    await dashboard.goto(DASHBOARD_URL,{waitUntil:"domcontentloaded",timeout:60000});
    await sleep(3000);
    const actual=await runCase("DASHBOARD PAGE",seconds);
    const result={
      blank,dashboard:actual,
      comparison:{
        blankFps:blank.capture.actualFps,dashboardFps:actual.capture.actualFps,
        fpsDifference:+(blank.capture.actualFps-actual.capture.actualFps).toFixed(2),
        dashboardLongTasks:actual.after.longTasks,
        dashboardMutations:actual.after.domMutations,
        dashboardMutationTargets:actual.after.topMutationTargets,
        dashboardCpuHotspots:actual.cpu.hotspots||[],
        dashboardCdpMetrics:actual.cpu.metrics||null
      }
    };
    console.log("[FULL BOTTLENECK REPORT]",JSON.stringify(result));
    return result;
  }finally{benchmarking=false}
}

async function close(){
  if(recordingActive){try{await stopRecording()}catch(e){console.error("[CAPTURE STOP]",e.message)}}
  if(statusTimer){clearInterval(statusTimer);statusTimer=null}
  if(cdp){try{await cdp.detach()}catch(e){}cdp=null}
  if(browser){await browser.close();browser=null;dashboard=null}
}

module.exports={initialize,startRecording,stopRecording,getStatus,diagnostics,close,runBenchmark};
