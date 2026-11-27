
"use strict";
const {spawn,execFileSync}=require("child_process"),{performance}=require("perf_hooks"),renderer=require("./render"),fs=require("fs"),os=require("os"),path=require("path");
let ffmpeg=process.env.FFMPEG_PATH||null;
if(!ffmpeg){try{ffmpeg=require("ffmpeg-static");}catch(e){ffmpeg="ffmpeg";}}
const W=1280,H=720,FPS=10,FRAME_MS=1000/FPS,BYTES=W*H*4,BITRATE="1500k",sleep=ms=>new Promise(r=>setTimeout(r,ms));
let active=false,child=null,restartTimer=null,frames=0,dropped=0,intervalFrames=0,lastReport=0,starting=false,ffmpegChecked=false,encoderChecked=false,rawChecked=false,actualChecked=false,flvChecked=false,restartCount=0;

function log(...a){console.log("[STREAM]",...a);}
function runTest(args,label,timeoutMs=15000){
 return new Promise(resolve=>{
  let output="",done=false,timer,proc;
  const finish=(ok,reason)=>{if(done)return;done=true;clearTimeout(timer);if(proc&&!proc.killed)proc.kill("SIGKILL");console.log("["+label+"]",ok?"PASSED":"FAILED",reason||"");resolve(ok);};
  try{proc=spawn(ffmpeg,args,{stdio:["ignore","ignore","pipe"]});}catch(e){return finish(false,e.message);}
  proc.stderr.on("data",d=>{output+=d.toString();if(output.length>12000)output=output.slice(-12000);});
  proc.on("error",e=>finish(false,e.message));
  proc.on("close",(code,signal)=>finish(code===0,"code="+code+" signal="+signal+(code===0?"":" "+output.slice(-500))));
  timer=setTimeout(()=>finish(false,"timeout"),timeoutMs);
 });
}
function runFrameTest(args,label,getFrame,timeoutMs=30000){
 return new Promise(resolve=>{
  let proc,done=false,timer,index=0,output="";
  const finish=(ok,reason)=>{if(done)return;done=true;clearTimeout(timer);if(proc&&!proc.killed)proc.kill("SIGKILL");console.log("["+label+"]",ok?"PASSED":"FAILED",reason||"");resolve(ok);};
  try{proc=spawn(ffmpeg,args,{stdio:["pipe","ignore","pipe"]});}catch(e){return finish(false,e.message);}
  proc.stderr.on("data",d=>{output+=d.toString();if(output.length>12000)output=output.slice(-12000);});
  proc.on("error",e=>finish(false,e.message));
  proc.on("close",(code,signal)=>finish(code===0&&index===10,"code="+code+" signal="+signal+" frames="+index+(code===0?"":" "+output.slice(-500))));
  timer=setTimeout(()=>finish(false,"timeout"),timeoutMs);
  const send=()=>{
   if(done)return;
   if(index>=10){proc.stdin.end();return;}
   let frame;
   try{frame=getFrame();if(!frame||frame.length!==BYTES)throw Error("Invalid frame size: "+(frame&&frame.length));}
   catch(e){return finish(false,e.message);}
   proc.stdin.write(frame,err=>{if(err)return finish(false,err.message);index++;send();});
  };
  proc.stdin.on("error",e=>finish(false,e.message));
  send();
 });
}
function checkFFmpeg(){
 if(ffmpegChecked)return true;
 ffmpegChecked=true;
 try{
  const version=execFileSync(ffmpeg,["-version"],{encoding:"utf8",timeout:10000}).split("\n")[0];
  console.log("[FFMPEG PACKAGE]",require("ffmpeg-static/package.json").version);
  console.log("[FFMPEG PATH]",ffmpeg);
  console.log("[FFMPEG VERSION]",version);
  return true;
 }catch(e){console.error("[FFMPEG CHECK] FAILED",e.message);return false;}
}
async function testEncoder(){
 if(encoderChecked)return true;
 console.log("[STREAM] Testing H.264 encoder...");
 const ok=await runTest(["-hide_banner","-loglevel","error","-f","lavfi","-i","testsrc2=size=1280x720:rate=10","-frames:v","10","-an","-c:v","libx264","-threads","1","-preset","ultrafast","-tune","zerolatency","-pix_fmt","yuv420p","-f","null","-"],"H264 TEST");
 encoderChecked=ok;return ok;
}
function rawArgs(output){
 return ["-hide_banner","-loglevel","error","-f","rawvideo","-pixel_format","rgba","-video_size",W+"x"+H,"-framerate",String(FPS),"-i","pipe:0","-frames:v","10","-an","-c:v","libx264","-threads","1","-preset","ultrafast","-tune","zerolatency","-pix_fmt","yuv420p",...output];
}
async function testRawInput(){
 if(rawChecked)return true;
 console.log("[RAW INPUT TEST] Testing synthetic RGBA input...");
 const ok=await runFrameTest(rawArgs(["-f","null","-"]), "RAW INPUT TEST",()=>Buffer.alloc(BYTES,80));
 rawChecked=ok;return ok;
}
function getCanvasFrame(getData){
 const data=getData();
 const frame=renderer.renderRawFrame(data);
 if(!frame||frame.length!==BYTES)throw Error("Canvas frame must be "+BYTES+" bytes; received "+(frame&&frame.length));
 return Buffer.isBuffer(frame)?frame:Buffer.from(frame.buffer,frame.byteOffset,frame.byteLength);
}
async function testActualFrames(getData){
 if(actualChecked)return true;
 console.log("[ACTUAL FRAME TEST] Testing real Canvas frames...");
 const ok=await runFrameTest(rawArgs(["-f","null","-"]), "ACTUAL FRAME TEST",()=>getCanvasFrame(getData));
 actualChecked=ok;return ok;
}
async function testFLV(getData){
 if(flvChecked)return true;
 console.log("[FLV TEST] Testing actual Canvas frames with H.264 + FLV muxer...");
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"stream-flv-")),file=path.join(dir,"test.flv");
 try{
  const ok=await runFrameTest(rawArgs(["-flvflags","no_duration_filesize","-f","flv",file]),"FLV TEST",()=>getCanvasFrame(getData),30000);
  if(!ok)return false;
  const size=fs.statSync(file).size;
  console.log("[FLV TEST] File size:",size,"bytes");
  flvChecked=size>0;
  return flvChecked;
 }catch(e){console.error("[FLV TEST] FAILED",e.message);return false;}
 finally{try{fs.rmSync(dir,{recursive:true,force:true});}catch(e){}}
}
async function diagnostics(getData){
 if(!checkFFmpeg())throw Error("FFmpeg binary is unavailable");
 if(!await testEncoder())throw Error("H.264 encoder test failed");
 if(!await testRawInput())throw Error("Raw RGBA input test failed");
 if(!await testActualFrames(getData))throw Error("Actual Canvas frame test failed");
 if(!await testFLV(getData))throw Error("FLV muxer test failed");
}
function scheduleRestart(getData,reason){
 if(!active||restartTimer)return;
 restartCount++;
 const delay=Math.min(30000,2000*Math.pow(2,Math.min(restartCount-1,4)));
 log("Restart scheduled:",reason,"in",delay+"ms");
 restartTimer=setTimeout(()=>{restartTimer=null;if(active)launch(getData).catch(e=>{console.error("[STREAM RESTART]",e.message);scheduleRestart(getData,e.message);});},delay);
}
async function launch(getData){
 if(!active||starting)return;
 starting=true;
 try{
  if(!process.env.YOUTUBE_STREAM_KEY)throw Error("YOUTUBE_STREAM_KEY is missing from environment variables");
  await diagnostics(getData);
  if(!active)return;
  const url="rtmps://a.rtmps.youtube.com:443/live2/"+process.env.YOUTUBE_STREAM_KEY;
  const args=["-hide_banner","-loglevel","info","-threads","1","-filter_threads","1","-rw_timeout","15000000","-f","rawvideo","-pixel_format","rgba","-video_size",W+"x"+H,"-framerate",String(FPS),"-i","pipe:0","-an","-c:v","libx264","-threads","1","-preset","ultrafast","-tune","zerolatency","-pix_fmt","yuv420p","-r",String(FPS),"-g",String(FPS*2),"-keyint_min",String(FPS*2),"-sc_threshold","0","-b:v",BITRATE,"-maxrate",BITRATE,"-bufsize","3000k","-flvflags","no_duration_filesize","-f","flv",url];
  child=spawn(ffmpeg,args,{stdio:["pipe","ignore","pipe"]});
  const current=child;
  current.stderr.on("data",d=>{const s=d.toString().trim();if(s)console.log("[FFMPEG]",s.slice(-1500));});
  current.on("error",e=>{console.error("[FFMPEG ERROR]",e.message);if(child===current)child=null;});
  current.on("close",(code,signal)=>{
   if(child===current)child=null;
   log("FFmpeg exited: code="+code+" signal="+signal);
   if(signal==="SIGSEGV")console.error("[STREAM] Native FFmpeg crash detected");
   if(active)scheduleRestart(getData,"FFmpeg exited");
  });
  log("FFmpeg started |",W+"x"+H,"|",FPS,"FPS | H.264 | RTMPS |",BITRATE);
  restartCount=0;
  pump(getData,current).catch(e=>{console.error("[STREAM PUMP]",e.message);if(current.stdin&&!current.stdin.destroyed)current.stdin.destroy(e);});
 }catch(e){console.error("[STREAM START FAILED]",e.message);scheduleRestart(getData,e.message);}
 finally{starting=false;}
}
function writeFrame(proc,frame){
 return new Promise((resolve,reject)=>{
  if(!proc||proc.killed||proc.stdin.destroyed)return reject(Error("FFmpeg stdin is closed"));
  let settled=false;
  const cleanup=()=>{proc.stdin.removeListener("error",onError);proc.removeListener("close",onClose);};
  const finish=(err)=>{if(settled)return;settled=true;cleanup();err?reject(err):resolve();};
  const onError=e=>finish(e),onClose=()=>finish(Error("FFmpeg closed while writing"));
  proc.stdin.once("error",onError);proc.once("close",onClose);
  try{proc.stdin.write(frame,e=>finish(e||null));}catch(e){finish(e);}
 });
}
async function pump(getData,proc){
 let next=performance.now();
 while(active&&child===proc&&!proc.killed){
  const now=performance.now();
  if(now<next)await sleep(next-now);
  if(!active||child!==proc)break;
  const start=performance.now();
  try{
   const frame=getCanvasFrame(getData);
   await writeFrame(proc,frame);
   frames++;intervalFrames++;
  }catch(e){
   if(active)console.error("[STREAM FRAME]",e.message);
   break;
  }
  next+=FRAME_MS;
  if(performance.now()-next>FRAME_MS){dropped++;next=performance.now();}
  if(performance.now()-lastReport>=30000){
   const elapsed=lastReport?((performance.now()-lastReport)/1000):30;
   console.log("[STREAM STATS] FPS:",(intervalFrames/elapsed).toFixed(2),"Frames:",frames,"Dropped:",dropped,"Render/write:",(performance.now()-start).toFixed(1)+"ms");
   intervalFrames=0;lastReport=performance.now();
  }
 }
 if(active&&child===proc&&!proc.killed&&proc.stdin&&!proc.stdin.destroyed)proc.stdin.end();
}
async function start(getData){
 if(active)return status();
 if(typeof getData!=="function")throw Error("start(getData) requires a data function");
 active=true;frames=0;dropped=0;intervalFrames=0;lastReport=performance.now();restartCount=0;
 launch(getData).catch(e=>{console.error("[STREAM START]",e.message);scheduleRestart(getData,e.message);});
 return status();
}
function stop(){
 active=false;
 if(restartTimer){clearTimeout(restartTimer);restartTimer=null;}
 if(child){const p=child;child=null;try{p.stdin.end();}catch(e){}try{p.kill("SIGTERM");}catch(e){}}
 log("Stopped");
 return status();
}
function status(){
 return {active,started:!!child,starting,frames,dropped,restarts:restartCount,ffmpeg,settings:{width:W,height:H,fps:FPS,bitrate:BITRATE}};
}
module.exports={start,stop,status};
