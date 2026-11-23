
const {spawn}=require("child_process");
const {once}=require("events");
const fs=require("fs");
const os=require("os");
const path=require("path");
const renderer=require("./render");
const ffmpeg=require("ffmpeg-static");
const pidusage=require("pidusage");

const W=1280,H=720,FPS=15,SECONDS=60,TOTAL=FPS*SECONDS,BYTES=W*H*4;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const elapsed=start=>Number(process.hrtime.bigint()-start)/1e6;
const mib=n=>+(n/1048576).toFixed(2);
const stats=values=>{
 if(!values.length)return{averageMs:0,p95Ms:0,maxMs:0};
 const a=[...values].sort((x,y)=>x-y);
 return{
  averageMs:+(values.reduce((s,n)=>s+n,0)/values.length).toFixed(2),
  p95Ms:+a[Math.min(a.length-1,Math.ceil(a.length*.95)-1)].toFixed(2),
  maxMs:+a[a.length-1].toFixed(2)
 };
};

let state={
 running:false,status:"idle",id:null,startedAt:null,finishedAt:null,
 frames:0,targetFrames:TOTAL,progress:0,error:null,result:null,videoPath:null
};

const publicState=()=>({
 running:state.running,status:state.status,id:state.id,
 startedAt:state.startedAt,finishedAt:state.finishedAt,
 frames:state.frames,targetFrames:state.targetFrames,
 progress:+state.progress.toFixed(1),error:state.error,result:state.result
});

async function run(getData){
 const output=path.join(os.tmpdir(),`encode-test-${state.id}.mp4`);
 let child=null,timer=null,spawnError=null,stderr="",closed;
 const renderTimes=[],writeTimes=[];
 let cpuTotal=0,cpuSamples=0,cpuMax=0,ffmpegMemoryMax=0;
 let ffmpegSpeed=null,ffmpegFps=null,backpressure=0,lateFrames=0,missed=0;
 let sampling=false;
 const start=process.hrtime.bigint();
 const nodeMemoryStart=process.memoryUsage();

 try{
  if(!ffmpeg)throw Error("FFmpeg binary not found");
  try{await fs.promises.unlink(output);}catch{}

  child=spawn(ffmpeg,[
   "-hide_banner","-loglevel","info","-stats_period","1",
   "-f","rawvideo","-pixel_format","rgba",
   "-video_size",`${W}x${H}`,"-framerate",String(FPS),"-i","pipe:0",
   "-an","-c:v","libx264","-preset","ultrafast",
   "-tune","zerolatency","-pix_fmt","yuv420p",
   "-movflags","+faststart","-y",output
  ],{stdio:["pipe","ignore","pipe"]});

  child.on("error",e=>{spawnError=e;});
  child.stdin.on("error",e=>{spawnError=spawnError||e;});
  closed=once(child,"close");

  child.stderr.setEncoding("utf8");
  child.stderr.on("data",chunk=>{
   stderr=(stderr+chunk).slice(-12000);
   const speed=[...chunk.matchAll(/speed=\s*([\d.]+)x/g)].pop();
   const fps=[...chunk.matchAll(/fps=\s*([\d.]+)/g)].pop();
   if(speed)ffmpegSpeed=Number(speed[1]);
   if(fps)ffmpegFps=Number(fps[1]);
  });

  timer=setInterval(async()=>{
   if(sampling||!child?.pid)return;
   sampling=true;
   try{
    const p=await pidusage(child.pid);
    cpuTotal+=p.cpu;cpuSamples++;
    cpuMax=Math.max(cpuMax,p.cpu);
    ffmpegMemoryMax=Math.max(ffmpegMemoryMax,p.memory);
   }catch{}finally{sampling=false;}
  },1000);

  const scheduleStart=process.hrtime.bigint();
  const interval=1e9/FPS;

  for(let i=0;i<TOTAL;i++){
   const deadline=scheduleStart+BigInt(Math.round(i*interval));
   let remaining=Number(deadline-process.hrtime.bigint())/1e6;
   if(remaining>1)await sleep(remaining-0.5);

   const frameStart=process.hrtime.bigint();
   const late=Math.max(0,Number(frameStart-deadline)/1e6);
   if(late>2)lateFrames++;
   if(late>=1000/FPS)missed++;

   const frame=await renderer.renderRawFrame(getData());
   renderTimes.push(elapsed(frameStart));
   if(!frame||frame.byteLength!==BYTES)throw Error(`Invalid RGBA frame: expected ${BYTES} bytes`);

   const writeStart=process.hrtime.bigint();
   if(!child.stdin.write(frame)){
    backpressure++;
    await Promise.race([
     once(child.stdin,"drain"),
     closed.then(()=>{throw Error("FFmpeg closed before accepting all frames");})
    ]);
   }
   writeTimes.push(elapsed(writeStart));
   state.frames=i+1;
   state.progress=state.frames/TOTAL*100;
  }

  child.stdin.end();
  const [code,signal]=await closed;
  if(spawnError)throw spawnError;
  if(code!==0)throw Error(`FFmpeg exited with code ${code}${signal?` (${signal})`:""}: ${stderr.slice(-1800)}`);

  const file=await fs.promises.stat(output);
  const duration=elapsed(start);
  const nodeMemoryEnd=process.memoryUsage();

  state.videoPath=output;
  state.result={
   resolution:`${W}x${H}`,fpsTarget:FPS,durationTargetSeconds:SECONDS,
   framesSent:state.frames,framesExpected:TOTAL,
   achievedFPS:+(state.frames/(duration/1000)).toFixed(3),
   elapsedMs:+duration.toFixed(2),
   ffmpegSpeed,ffmpegReportedFPS:ffmpegFps,
   outputSizeBytes:file.size,outputSizeMiB:mib(file.size),
   render:stats(renderTimes),inputWrite:stats(writeTimes),
   backpressureCount:backpressure,lateFrames,missedDeadlines:missed,
   ffmpegProcess:{
    averageCpuPercent:cpuSamples?+(cpuTotal/cpuSamples).toFixed(1):null,
    maxCpuPercent:+cpuMax.toFixed(1),
    maxMemoryMiB:mib(ffmpegMemoryMax)
   },
   nodeMemory:{
    heapUsedMiB:mib(nodeMemoryEnd.heapUsed),
    rssMiB:mib(nodeMemoryEnd.rss),
    externalMiB:mib(nodeMemoryEnd.external),
    startRssMiB:mib(nodeMemoryStart.rss)
   },
   ffmpegExitCode:code
  };

  state.status="completed";
  state.progress=100;
  state.finishedAt=new Date().toISOString();
  console.log("[ENCODE TEST] Completed",JSON.stringify(state.result));
 }catch(e){
  if(child&&!child.killed)child.kill("SIGKILL");
  state.status="failed";
  state.error=e.message;
  state.finishedAt=new Date().toISOString();
  console.error("[ENCODE TEST]",e.stack||e.message);
 }finally{
  if(timer)clearInterval(timer);
  state.running=false;
 }
}

function attach(app,getData){
 app.get("/api/encode-test",(req,res)=>{
  const token=process.env.ENCODE_TEST_TOKEN;
  if(token&&req.get("x-encode-test-token")!==token)
   return res.status(401).json({error:"Unauthorized"});
  if(state.running)
   return res.status(409).json({error:"Benchmark already running",status:publicState()});

  state={
   running:true,status:"running",id:Date.now(),
   startedAt:new Date().toISOString(),finishedAt:null,
   frames:0,targetFrames:TOTAL,progress:0,error:null,result:null,videoPath:null
  };
  run(getData);
  res.set("Cache-Control","no-store");
  res.status(202).json({started:true,status:publicState()});
 });

 app.get("/api/encode-test/status",(req,res)=>{
  res.set("Cache-Control","no-store");
  res.json(publicState());
 });

 app.get("/api/encode-test/results",(req,res)=>{
  res.set("Cache-Control","no-store");
  if(state.running)return res.status(409).json({error:"Benchmark still running",status:publicState()});
  if(!state.result)return res.status(404).json({error:"No completed results",status:publicState()});
  res.json(state.result);
 });

 app.get("/api/encode-test/video",(req,res)=>{
  if(state.running)return res.status(409).send("Benchmark still running");
  if(state.status!=="completed"||!state.videoPath||!fs.existsSync(state.videoPath))
   return res.status(404).send("No completed video available");
  res.set("Cache-Control","no-store");
  res.download(state.videoPath,"encode-test.mp4");
 });
}

module.exports={attach};
