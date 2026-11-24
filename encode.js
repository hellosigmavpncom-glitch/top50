
const {spawn}=require("child_process"),{once}=require("events"),fs=require("fs"),os=require("os"),path=require("path"),renderer=require("./render"),ffmpeg=require("ffmpeg-static"),pidusage=require("pidusage");

const W=1280,H=720,FPS=15,TEST_FRAMES=30,BYTES=W*H*4;
const sleep=ms=>new Promise(r=>setTimeout(r,ms)),elapsed=t=>Number(process.hrtime.bigint()-t)/1e6,mib=n=>+(n/1048576).toFixed(2);
const stats=v=>{if(!v.length)return{averageMs:0,medianMs:0,p95Ms:0,minMs:0,maxMs:0};const a=[...v].sort((x,y)=>x-y);return{averageMs:+(v.reduce((s,n)=>s+n,0)/v.length).toFixed(2),medianMs:+(a[Math.floor(a.length/2)]).toFixed(2),p95Ms:+a[Math.min(a.length-1,Math.ceil(a.length*.95)-1)].toFixed(2),minMs:+a[0].toFixed(2),maxMs:+a.at(-1).toFixed(2)};};
const memory=()=>{const m=process.memoryUsage();return{heapUsedMiB:mib(m.heapUsed),externalMiB:mib(m.external),rssMiB:mib(m.rss)};};

let state={running:false,status:"idle",id:null,startedAt:null,finishedAt:null,frames:0,targetFrames:TEST_FRAMES,progress:0,error:null,result:null,videoPath:null};
const publicState=()=>({running:state.running,status:state.status,id:state.id,startedAt:state.startedAt,finishedAt:state.finishedAt,frames:state.frames,targetFrames:state.targetFrames,progress:+state.progress.toFixed(1),error:state.error,result:state.result});

async function run(getData){
 const output=path.join(os.tmpdir(),`encode-test-${state.id}.mp4`);
 let child=null,timer=null,sampling=false,stderr="",spawnError=null,ffmpegSpeed=null,ffmpegFps=null,ffmpegCpuTotal=0,ffmpegCpuSamples=0,ffmpegCpuMax=0,ffmpegMemoryMax=0;
 const dataTimes=[],renderTimes=[],writeCallTimes=[],drainWaitTimes=[],frameTimes=[];
 const start=process.hrtime.bigint(),nodeMemoryStart=memory();
 let closed;

 try{
  if(!ffmpeg)throw Error("FFmpeg binary not found");
  if(typeof renderer.renderRawFrame!=="function")throw Error("renderer.renderRawFrame is not exported");
  try{await fs.promises.unlink(output);}catch{}

  child=spawn(ffmpeg,["-hide_banner","-loglevel","info","-stats_period","1","-f","rawvideo","-pixel_format","rgba","-video_size",`${W}x${H}`,"-framerate",String(FPS),"-i","pipe:0","-an","-c:v","libx264","-preset","ultrafast","-tune","zerolatency","-pix_fmt","yuv420p","-movflags","+faststart","-y",output],{stdio:["pipe","ignore","pipe"]});

  closed=new Promise((resolve,reject)=>{child.once("close",(code,signal)=>resolve({code,signal}));child.once("error",reject);});
  child.on("error",e=>{spawnError=e;});
  child.stdin.on("error",e=>{spawnError=spawnError||e;});
  child.stderr.setEncoding("utf8");
  child.stderr.on("data",chunk=>{
   stderr=(stderr+chunk).slice(-12000);
   const speed=[...chunk.matchAll(/speed=\s*([\d.]+)x/g)].pop(),fps=[...chunk.matchAll(/fps=\s*([\d.]+)/g)].pop();
   if(speed)ffmpegSpeed=Number(speed[1]);
   if(fps)ffmpegFps=Number(fps[1]);
  });

  timer=setInterval(async()=>{
   if(sampling||!child?.pid)return;
   sampling=true;
   try{const p=await pidusage(child.pid);ffmpegCpuTotal+=p.cpu;ffmpegCpuSamples++;ffmpegCpuMax=Math.max(ffmpegCpuMax,p.cpu);ffmpegMemoryMax=Math.max(ffmpegMemoryMax,p.memory);}catch{}finally{sampling=false;}
  },500);

  for(let i=0;i<TEST_FRAMES;i++){
   if(spawnError)throw spawnError;
   const frameStart=process.hrtime.bigint();

   const dataStart=process.hrtime.bigint();
   const data=await getData();
   dataTimes.push(elapsed(dataStart));

   const renderStart=process.hrtime.bigint();
   const frame=await renderer.renderRawFrame(data);
   renderTimes.push(elapsed(renderStart));

   if(!frame||frame.byteLength!==BYTES)throw Error(`Invalid RGBA frame ${i+1}: expected ${BYTES} bytes, received ${frame?.byteLength??"nothing"}`);
   if(child.stdin.destroyed||child.stdin.writableEnded)throw Error("FFmpeg input pipe closed unexpectedly");

   const writeStart=process.hrtime.bigint(),accepted=child.stdin.write(frame);
   writeCallTimes.push(elapsed(writeStart));

   if(!accepted){
    const drainStart=process.hrtime.bigint();
    await Promise.race([once(child.stdin,"drain"),closed.then(({code,signal})=>{throw Error(`FFmpeg closed while waiting for pipe drain: ${code} ${signal||""}`);})]);
    drainWaitTimes.push(elapsed(drainStart));
   }

   frameTimes.push(elapsed(frameStart));
   state.frames=i+1;
   state.progress=state.frames/TEST_FRAMES*100;
  }

  child.stdin.end();
  const exit=await closed;
  if(spawnError)throw spawnError;
  if(exit.code!==0)throw Error(`FFmpeg exited with code ${exit.code}${exit.signal?` (${exit.signal})`:""}: ${stderr.slice(-1800)}`);

  const file=await fs.promises.stat(output),duration=elapsed(start),nodeMemoryEnd=memory();
  const actualFps=state.frames/(duration/1000);
  state.videoPath=output;
  state.result={
   renderer:"takumi-js",mode:"maximum-throughput-pipeline",resolution:`${W}x${H}`,fpsTarget:FPS,framesExpected:TEST_FRAMES,framesSent:state.frames,videoDurationSeconds:+(state.frames/FPS).toFixed(2),
   elapsedMs:+duration.toFixed(2),achievedPipelineFPS:+actualFps.toFixed(3),speedVsTarget:+(actualFps/FPS).toFixed(3),
   stages:{getData:stats(dataTimes),takumiRender:stats(renderTimes),pipeWriteCall:stats(writeCallTimes),pipeDrainWait:stats(drainWaitTimes),completeFrameCycle:stats(frameTimes)},
   ffmpeg:{reportedSpeed:ffmpegSpeed,reportedFPS:ffmpegFps,averageCpuPercent:ffmpegCpuSamples?+(ffmpegCpuTotal/ffmpegCpuSamples).toFixed(1):null,maxCpuPercent:+ffmpegCpuMax.toFixed(1),maxMemoryMiB:mib(ffmpegMemoryMax),exitCode:exit.code},
   output:{sizeBytes:file.size,sizeMiB:mib(file.size),frameBytes:BYTES},
   memory:{before:nodeMemoryStart,after:nodeMemoryEnd},
   checksum:state.frames+Math.round(dataTimes.reduce((a,b)=>a+b,0))+Math.round(renderTimes.reduce((a,b)=>a+b,0))
  };
  state.status="completed";state.progress=100;state.finishedAt=new Date().toISOString();
  console.log("[ENCODE DIAGNOSTIC]",JSON.stringify(state.result));
 }catch(e){
  if(child&&!child.killed)child.kill("SIGKILL");
  state.status="failed";state.error=e.message;state.finishedAt=new Date().toISOString();
  console.error("[ENCODE DIAGNOSTIC]",e.stack||e.message);
 }finally{
  if(timer)clearInterval(timer);
  state.running=false;
 }
}

function attach(app,getData){
 app.get("/api/encode-test",(req,res)=>{
  const token=process.env.ENCODE_TEST_TOKEN;
  if(token&&req.get("x-encode-test-token")!==token)return res.status(401).json({error:"Unauthorized"});
  if(state.running)return res.status(409).json({error:"Benchmark already running",status:publicState()});
  state={running:true,status:"running",id:Date.now(),startedAt:new Date().toISOString(),finishedAt:null,frames:0,targetFrames:TEST_FRAMES,progress:0,error:null,result:null,videoPath:null};
  res.set("Cache-Control","no-store");
  res.status(202).json({started:true,status:publicState()});
  run(getData);
 });

 app.get("/api/encode-test/status",(req,res)=>{res.set("Cache-Control","no-store");res.json(publicState());});

 app.get("/api/encode-test/results",(req,res)=>{
  res.set("Cache-Control","no-store");
  if(state.running)return res.status(409).json({error:"Benchmark still running",status:publicState()});
  if(!state.result)return res.status(404).json({error:"No completed results",status:publicState()});
  res.json(state.result);
 });

 app.get("/api/encode-test/video",(req,res)=>{
  if(state.running)return res.status(409).send("Benchmark still running");
  if(state.status!=="completed"||!state.videoPath||!fs.existsSync(state.videoPath))return res.status(404).send("No completed video available");
  res.set({"Cache-Control":"no-store","Content-Type":"video/mp4","Content-Disposition":'inline; filename="encode-test.mp4"',"Accept-Ranges":"bytes"});
  res.sendFile(state.videoPath);
 });

 app.get("/api/encode-test/download",(req,res)=>{
  if(state.running)return res.status(409).send("Benchmark still running");
  if(state.status!=="completed"||!state.videoPath||!fs.existsSync(state.videoPath))return res.status(404).send("No completed video available");
  res.download(state.videoPath,"encode-test.mp4");
 });
}

module.exports={attach};
