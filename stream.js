
"use strict";

const {spawn}=require("child_process"),{once}=require("events"),{performance}=require("perf_hooks"),renderer=require("./render"),ffmpeg=require("ffmpeg-static");

const W=1280,H=720,FPS=10,FRAME_MS=1000/FPS,BYTES=W*H*4,BITRATE="1500k";
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

let active=false,child=null,restartTimer=null,frames=0,dropped=0,intervalFrames=0,lastReport=Date.now();

function launch(){
 if(!active||child)return;
 if(!ffmpeg){console.error("[STREAM] FFmpeg binary unavailable");return;}

 const key=process.env.YOUTUBE_STREAM_KEY;
 if(!key){console.error("[STREAM] Missing YOUTUBE_STREAM_KEY");return;}

 const url=`rtmps://a.rtmps.youtube.com:443/live2/${key}`;
 const args=[
  "-hide_banner","-loglevel","warning",
  "-f","rawvideo","-pixel_format","rgba","-video_size",`${W}x${H}`,
  "-framerate",String(FPS),"-i","pipe:0",
  "-an","-c:v","libx264","-preset","ultrafast","-tune","zerolatency",
  "-pix_fmt","yuv420p","-r",String(FPS),
  "-g",String(FPS*2),"-keyint_min",String(FPS*2),"-sc_threshold","0",
  "-b:v",BITRATE,"-minrate",BITRATE,"-maxrate",BITRATE,"-bufsize","3000k",
  "-f","flv",url
 ];

 const p=spawn(ffmpeg,args,{stdio:["pipe","ignore","pipe"]});
 child=p;

 p.stderr.setEncoding("utf8");
 p.stderr.on("data",s=>{const t=s.trim();if(t)console.error("[FFMPEG]",t.slice(-700));});
 p.on("error",e=>console.error("[FFMPEG ERROR]",e.message));
 p.on("close",(code,signal)=>{
  if(child===p)child=null;
  if(!active)return;
  console.error(`[STREAM] FFmpeg exited: code=${code} signal=${signal||"none"}`);
  restartTimer=setTimeout(()=>{if(active&&!child)launch();},5000);
  restartTimer.unref();
 });

 console.log("[STREAM] FFmpeg started | 1280x720 | 10 FPS | H.264");
}

async function writeFrame(p,frame){
 if(p!==child||p.stdin.destroyed||p.exitCode!==null)throw Error("FFmpeg pipe unavailable");
 if(p.stdin.write(frame))return;

 const drain=once(p.stdin,"drain");
 const closed=once(p,"close").then(([code,signal])=>{throw Error(`FFmpeg closed during pipe backpressure: ${code} ${signal||""}`);});
 await Promise.race([drain,closed]);
}

async function pump(getData){
 let nextAt=performance.now();

 while(active){
  const wait=nextAt-performance.now();
  if(wait>0)await sleep(wait);
  if(!active)break;

  const p=child;
  if(!p||p.stdin.destroyed||p.exitCode!==null){
   await sleep(250);
   nextAt=performance.now();
   continue;
  }

  try{
   const data=getData();
   const frame=await renderer.renderRawFrame(data);

   if(!frame||frame.byteLength!==BYTES)throw Error(`Invalid RGBA frame: ${frame?.byteLength??"none"} bytes`);
   await writeFrame(p,frame);

   frames++;
   intervalFrames++;
  }catch(e){
   if(active)console.error("[STREAM FRAME]",e.message);
   await sleep(200);
  }

  nextAt+=FRAME_MS;
  const now=performance.now();

  if(now>nextAt){
   dropped+=Math.floor((now-nextAt)/FRAME_MS)+1;
   nextAt=now+FRAME_MS;
  }

  if(Date.now()-lastReport>=30000){
   console.log(`[STREAM] FPS=${(intervalFrames/((Date.now()-lastReport)/1000)).toFixed(2)} | Total=${frames} | Missed=${dropped} | Encoder=${child?"RUNNING":"RESTARTING"}`);
   intervalFrames=0;
   lastReport=Date.now();
  }
 }
}

function start(getData){
 if(active)return true;
 if(typeof getData!=="function")throw Error("getData must be a function");
 if(!process.env.YOUTUBE_STREAM_KEY){console.log("[STREAM] Disabled: set YOUTUBE_STREAM_KEY in Render environment");return false;}
 if(!ffmpeg){console.error("[STREAM] ffmpeg-static binary unavailable");return false;}

 active=true;
 frames=0;
 dropped=0;
 intervalFrames=0;
 lastReport=Date.now();

 launch();
 pump(getData).catch(e=>console.error("[STREAM PUMP]",e.stack||e.message));

 return true;
}

function stop(){
 active=false;
 if(restartTimer)clearTimeout(restartTimer);
 restartTimer=null;

 const p=child;
 child=null;

 if(p){
  try{p.stdin.end();}catch{}
  try{p.kill("SIGTERM");}catch{}
 }

 console.log("[STREAM] Stopped");
}

function status(){
 return{running:active,ffmpegRunning:!!child,frames,dropped};
}

module.exports={start,stop,status};
