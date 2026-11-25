
"use strict";
const path=require("path");
const {Worker}=require("worker_threads");
const {monitorEventLoopDelay}=require("perf_hooks");

const W=1280,H=720,FPS=10,FRAME_MS=1000/FPS,FRAME_BYTES=W*H*4,MAX_RSS=440*1048576;
let worker=null,nextId=1,benchmarkActive=false;
const pending=new Map();

function startWorker(){
 if(worker)return worker;
 const w=new Worker(path.join(__dirname,"renderer-worker.js"));
 worker=w;
 w.on("message",message=>{
  const p=pending.get(message.id);
  if(!p)return;
  pending.delete(message.id);
  if(!message.ok){p.reject(Error(message.error||"Renderer worker failed"));return;}
  const buffer=message.buffer?Buffer.from(message.buffer):null;
  p.resolve({buffer,workerMs:message.workerMs||0,coreTiming:message.coreTiming||{},eventLoopDelay:message.eventLoopDelay||null,memory:message.memory||null});
 });
 const fail=error=>{
  if(worker===w)worker=null;
  for(const [id,p] of pending){pending.delete(id);p.reject(error instanceof Error?error:Error(String(error)));}
 };
 w.on("error",fail);
 w.on("exit",code=>{if(worker===w)worker=null;if(code!==0)fail(Error("Renderer worker exited with code "+code));});
 return w;
}

function send(message){
 const w=startWorker(),id=nextId++;
 return new Promise((resolve,reject)=>{
  pending.set(id,{resolve,reject});
  try{w.postMessage({...message,id});}
  catch(e){pending.delete(id);reject(e);}
 });
}

async function renderRequest(data={},mode="raw"){
 const started=process.hrtime.bigint();
 const result=await send({type:"render",mode,data});
 const roundTripMs=Number(process.hrtime.bigint()-started)/1e6;
 if(!result.buffer)throw Error("Renderer worker returned an empty frame");
 if(mode==="raw"&&result.buffer.length!==FRAME_BYTES)throw Error("Invalid worker RGBA frame size: "+result.buffer.length+" expected "+FRAME_BYTES);
 return{...result,roundTripMs};
}

const renderDashboard=async data=>(await renderRequest(data,"png")).buffer;
const renderRawFrame=async data=>(await renderRequest(data,"raw")).buffer;

function stats(values){
 if(!values.length)return{averageMs:0,medianMs:0,p95Ms:0,minMs:0,maxMs:0};
 const sorted=[...values].sort((a,b)=>a-b),avg=values.reduce((a,b)=>a+b,0)/values.length;
 const pick=q=>sorted[Math.min(sorted.length-1,Math.ceil(sorted.length*q)-1)];
 const r=n=>+n.toFixed(2);
 return{averageMs:r(avg),medianMs:r(pick(.5)),p95Ms:r(pick(.95)),minMs:r(sorted[0]),maxMs:r(sorted[sorted.length-1])};
}

const mib=n=>+(n/1048576).toFixed(2);
function memorySnapshot(){
 const m=process.memoryUsage();
 return{rssMiB:mib(m.rss),heapUsedMiB:mib(m.heapUsed),heapTotalMiB:mib(m.heapTotal),externalMiB:mib(m.external),arrayBuffersMiB:mib(m.arrayBuffers||0)};
}

function eventLoopSnapshot(h){
 const ms=n=>Number(n)/1e6;
 return{meanMs:Number.isFinite(h.mean)?+ms(h.mean).toFixed(2):0,minMs:+ms(h.min).toFixed(2),maxMs:+ms(h.max).toFixed(2),p50Ms:+ms(h.percentile(50)).toFixed(2),p95Ms:+ms(h.percentile(95)).toFixed(2),p99Ms:+ms(h.percentile(99)).toFixed(2)};
}

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,Math.max(1,ms)));

async function freshBenchmark(getData){
 const duration=10000,warmupFrames=8,times=[],fetches=[],roundTrips=[],workerTimes=[],slowFrames=[];
 let frames=0,missed=0,maxLate=0,maxRss=0,stopReason=null;
 const mainLoop=monitorEventLoopDelay({resolution:10});
 mainLoop.enable();

 try{
  for(let i=0;i<warmupFrames;i++){
   const data=await getData();
   const frame=await renderRequest(data,"raw");
   if(frame.buffer.length!==FRAME_BYTES)throw Error("Invalid worker warm-up frame");
  }

  await send({type:"reset"});
  mainLoop.reset();

  const start=process.hrtime.bigint(),cpu=process.cpuUsage(),mem=process.memoryUsage();
  let next=start;

  while(Number(process.hrtime.bigint()-start)/1e6<duration){
   if(process.memoryUsage().rss>MAX_RSS){stopReason="Memory safety limit reached";break;}

   const frameStart=process.hrtime.bigint();
   const data=await getData();
   const dataDone=process.hrtime.bigint();
   const result=await renderRequest(data,"raw");
   const done=process.hrtime.bigint();
   const totalMs=Number(done-frameStart)/1e6;

   if(result.buffer.length!==FRAME_BYTES)throw Error("Invalid worker RGBA frame");

   times.push(totalMs);
   fetches.push(Number(dataDone-frameStart)/1e6);
   roundTrips.push(result.roundTripMs);
   workerTimes.push(result.workerMs);

   if(totalMs>50){
    slowFrames.push({frame:frames+1,totalMs:+totalMs.toFixed(2),roundTripMs:+result.roundTripMs.toFixed(2),workerMs:+result.workerMs.toFixed(2)});
    if(slowFrames.length>25)slowFrames.shift();
   }

   frames++;
   maxRss=Math.max(maxRss,process.memoryUsage().rss);

   next+=BigInt(Math.round(FRAME_MS*1e6));

   if(done>next){
    const late=done-next,slots=late/BigInt(Math.round(FRAME_MS*1e6))+1n;
    missed+=Number(slots);
    maxLate=Math.max(maxLate,Number(late)/1e6);
    next+=slots*BigInt(Math.round(FRAME_MS*1e6));
   }else{
    const wait=Number(next-done)/1e6;
    if(wait>0&&Number(process.hrtime.bigint()-start)/1e6+wait<duration)await sleep(wait);
    else if(Number(process.hrtime.bigint()-start)/1e6+wait>=duration)break;
   }
  }

  const total=Number(process.hrtime.bigint()-start)/1e6;
  const used=process.cpuUsage(cpu),after=process.memoryUsage();
  const workerMetrics=await send({type:"metrics"});

  return{
   renderer:"@napi-rs/canvas",
   mode:"worker-thread-render-and-event-loop-isolation",
   resolution:`${W}x${H}`,
   targetFPS:FPS,
   warmupFrames,
   durationMs:+total.toFixed(2),
   frames,
   frameSizeBytes:FRAME_BYTES,
   frameSizeMiB:mib(FRAME_BYTES),
   estimatedFPS:+(frames/Math.max(.001,total/1000)).toFixed(2),
   frameTime:stats(times),
   stages:{
    dataFetch:stats(fetches),
    mainToWorkerRoundTrip:stats(roundTrips),
    workerTotal:stats(workerTimes)
   },
   mainThreadEventLoopDelay:eventLoopSnapshot(mainLoop),
   workerThreadEventLoopDelay:workerMetrics.eventLoopDelay,
   slowFrames,
   missedDeadlines:missed,
   missedDeadlinePercent:+(missed/Math.max(1,frames+missed)*100).toFixed(2),
   maxLatenessMs:+maxLate.toFixed(2),
   cpu:{userMs:+(used.user/1000).toFixed(2),systemMs:+(used.system/1000).toFixed(2)},
   memory:{
    mainThreadBefore:{rssMiB:mib(mem.rss),heapUsedMiB:mib(mem.heapUsed)},
    mainThreadAfter:{rssMiB:mib(after.rss),heapUsedMiB:mib(after.heapUsed)},
    processPeakRssMiB:mib(maxRss),
    workerSnapshot:workerMetrics.memory
   },
   stopReason
  };
 }finally{
  mainLoop.disable();
 }
}

function attach(app,getData){
 app.get("/api/renderer/preview.png",async(req,res)=>{
  if(benchmarkActive)return res.status(503).send("Benchmark running; retry shortly");
  try{
   const png=await renderDashboard(await getData());
   res.set({"Content-Type":"image/png","Cache-Control":"no-store, no-cache, must-revalidate"}).send(png);
  }catch(e){
   console.error("[WORKER PREVIEW]",e.stack||e);
   if(!res.headersSent)res.status(500).send(e.message);
  }
 });

 app.get("/api/renderer/benchmark",async(req,res)=>{
  if(benchmarkActive)return res.status(409).json({error:"Benchmark already running"});
  benchmarkActive=true;
  try{
   res.set("Cache-Control","no-store");
   res.json(await freshBenchmark(getData));
  }catch(e){
   console.error("[WORKER BENCHMARK]",e.stack||e);
   if(!res.headersSent)res.status(500).json({error:"Worker benchmark failed",message:e.message});
  }finally{
   benchmarkActive=false;
  }
 });

 const diagnostics=async(req,res)=>{
  if(benchmarkActive)return res.status(409).json({error:"Another benchmark is running"});
  benchmarkActive=true;
  try{
   const result=await renderRequest(await getData(),"raw");
   const metrics=await send({type:"metrics"});
   res.set("Cache-Control","no-store").json({
    renderer:"@napi-rs/canvas",
    mode:"worker-thread-diagnostics",
    resolution:`${W}x${H}`,
    frameBytes:result.buffer.length,
    expectedBytes:FRAME_BYTES,
    valid:result.buffer.length===FRAME_BYTES,
    workerMs:result.workerMs,
    roundTripMs:result.roundTripMs,
    workerThreadEventLoopDelay:metrics.eventLoopDelay,
    memory:{mainThread:memorySnapshot(),worker:metrics.memory}
   });
  }catch(e){
   console.error("[WORKER DIAGNOSTICS]",e.stack||e);
   if(!res.headersSent)res.status(500).json({error:"Worker diagnostics failed",message:e.message});
  }finally{
   benchmarkActive=false;
  }
 };

 app.get("/api/renderer/diagnostics",diagnostics);
 app.get("/api/renderer/multi-diagnostics",diagnostics);
 app.get("/api/renderer/takumi-cost",diagnostics);
}

module.exports={renderDashboard,renderRawFrame,attach};
