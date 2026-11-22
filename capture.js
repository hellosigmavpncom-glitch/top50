
const WIDTH=1280,HEIGHT=720,FPS=15;
let stream=null;
let status={running:false,connected:false,width:0,height:0,fps:0,frames:0,droppedFrames:0,started:null,error:null};
const page=()=>`<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Dashboard Capture Test</title>
<style>
*{box-sizing:border-box}body{margin:0;padding:22px;background:#101114;color:#eee;font:15px Arial,sans-serif}h2{margin:0 0 8px}p{color:#999;margin:0 0 20px}.video{width:100%;max-width:1100px;background:#000;border:1px solid #333;border-radius:10px;aspect-ratio:16/9;object-fit:contain}button{padding:12px 20px;margin:15px 8px 15px 0;border:0;border-radius:7px;background:#7187ff;color:white;font-weight:bold;cursor:pointer}button:disabled{opacity:.4;cursor:default}#stop{background:#444}.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:10px;max-width:1100px}.stat{background:#1b1d22;border:1px solid #303239;border-radius:8px;padding:14px}.stat small{display:block;color:#999;margin-bottom:8px}.stat strong{font-size:23px}#status{margin:12px 0;color:#aaa}#error{color:#ff7777;white-space:pre-wrap}
</style>
</head>
<body>
<h2>Dashboard Capture Performance Test</h2>
<p>Capture your dashboard tab and measure Edge's browser capture performance. No streaming server required.</p>
<video class="video" id="video" autoplay muted playsinline></video>
<br>
<button id="start">START CAPTURE</button><button id="stop" disabled>STOP CAPTURE</button>
<div id="status">Status: Waiting</div>
<div class="stats">
<div class="stat"><small>CAPTURE FPS</small><strong id="fps">0</strong></div>
<div class="stat"><small>RESOLUTION</small><strong id="resolution">-</strong></div>
<div class="stat"><small>TOTAL FRAMES</small><strong id="frames">0</strong></div>
<div class="stat"><small>DROPPED FRAMES</small><strong id="dropped">0</strong></div>
<div class="stat"><small>VIDEO BITRATE</small><strong id="bitrate">N/A</strong></div>
<div class="stat"><small>RUN TIME</small><strong id="runtime">0s</strong></div>
</div>
<p id="error"></p>
<script>
const video=document.getElementById("video"),start=document.getElementById("start"),stop=document.getElementById("stop");
let stream=null,track=null,active=false,frames=0,lastFrames=0,lastTime=0,fps=0,started=0,timer=null,frameCallback=null;
const show=(id,value)=>document.getElementById(id).textContent=value;
const report=async data=>{try{await fetch("/api/capture/status",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(data)});}catch(e){}};
function frameLoop(){if(!active||!video.requestVideoFrameCallback)return;frameCallback=video.requestVideoFrameCallback(()=>{frames++;frameLoop();});}
function stopCapture(){
active=false;clearInterval(timer);if(frameCallback!==null&&video.cancelVideoFrameCallback)video.cancelVideoFrameCallback(frameCallback);
if(stream)stream.getTracks().forEach(t=>t.stop());stream=null;track=null;video.srcObject=null;
start.disabled=false;stop.disabled=true;show("status","Status: Stopped");report({running:false,connected:false,fps,width:0,height:0,frames,droppedFrames:0,error:null});
}
start.onclick=async()=>{
if(active)return;
try{
document.getElementById("error").textContent="";
stream=await navigator.mediaDevices.getDisplayMedia({video:{width:{ideal:1280},height:{ideal:720},frameRate:{ideal:15,max:15}},audio:false});
track=stream.getVideoTracks()[0];const settings=track.getSettings();
video.srcObject=stream;await video.play();active=true;started=Date.now();frames=0;lastFrames=0;lastTime=performance.now();fps=0;
start.disabled=true;stop.disabled=false;show("status","Status: Capturing locally");
show("resolution",(settings.width||0)+" × "+(settings.height||0));
track.onended=stopCapture;frameLoop();
timer=setInterval(()=>{
const now=performance.now(),elapsed=(now-lastTime)/1000;fps=elapsed>0?(frames-lastFrames)/elapsed:0;lastFrames=frames;lastTime=now;
const quality=video.getVideoPlaybackQuality?video.getVideoPlaybackQuality():{droppedVideoFrames:0};
const dropped=quality.droppedVideoFrames||0;
show("fps",fps.toFixed(1));show("frames",frames.toLocaleString());show("dropped",dropped.toLocaleString());show("runtime",Math.floor((Date.now()-started)/1000)+"s");
report({running:true,connected:true,fps:Number(fps.toFixed(1)),width:settings.width||0,height:settings.height||0,frames,droppedFrames:dropped,error:null});
},1000);
}catch(e){document.getElementById("error").textContent=e.name+": "+e.message;show("status","Status: Capture failed");if(stream)stream.getTracks().forEach(t=>t.stop());stream=null;start.disabled=false;stop.disabled=true;report({running:false,connected:false,error:e.message});}
};
stop.onclick=stopCapture;
window.addEventListener("beforeunload",()=>{if(stream)stream.getTracks().forEach(t=>t.stop());});
</script>
</body>
</html>`;
function attach(app,express){
app.get("/capture",(q,r)=>r.set("Cache-Control","no-store").type("html").send(page()));
app.get("/api/capture/status",(q,r)=>(r.set("Cache-Control","no-store"),r.json(status)));
app.post("/api/capture/status",express.json({limit:"2kb"}),(q,r)=>{status={...status,...q.body};r.json({ok:true});});
}
async function close(){status.running=false;status.connected=false;}
function getStatus(){return status;}
module.exports={attach,getStatus,close};
