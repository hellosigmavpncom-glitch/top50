const page=()=>`<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Edge Capture Benchmark</title>
<style>
*{box-sizing:border-box}body{margin:0;padding:24px;background:#090b12;color:#e8eaf2;font-family:Arial,sans-serif}.wrap{fmax-width:1000px;margin:auto}h1{font-size:25px;margin:0 0 8px}.muted{color:#9298aa;font-size:13px}button{background:#7187ff;color:white;border:0;border-radius:8px;padding:12px 20px;font-weight:bold;cursor:pointer;margin:16px 8px 16px 0}button:disabled{opacity:.4;cursor:not-allowed}#stop{background:#33394b}video{position:fixed;width:1px;height:1px;left:-100px;top:0;opacity:0;pointer-events:none}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-top:16px}.card{background:#151925;border:1px solid #252c3c;border-radius:10px;padding:15px}.label{font-size:11px;color:#9298aa;text-transform:uppercase;letter-spacing:.6px}.value{font-size:25px;font-weight:bold;margin-top:8px}.progress{height:8px;background:#252c3c;border-radius:10px;overflow:hidden;margin-top:16px}.bar{height:100%;width:0;background:#7187ff}#result{background:#151925;border:1px solid #252c3c;border-radius:10px;padding:18px;margin-top:16px;line-height:1.8;display:none;overflow-wrap:anywhere}
</style>
</head>
<body>
<div class="wrap">
<h1>Edge Capture Benchmark</h1>
<div class="muted">60-second browser screen capture performance test</div>
<button id="start">START 60-SECOND TEST</button>
<button id="stop" disabled>STOP TEST</button>
<div class="progress"><div class="bar" id="bar"></div></div>
<video id="video" autoplay muted playsinline></video>
<div class="grid">
<div class="card"><div class="label">Preview FPS</div><div class="value" id="fps">0</div></div>
<div class="card"><div class="label">Target FPS</div><div class="value" id="target">15</div></div>
<div class="card"><div class="label">Resolution</div><div class="value" id="resolution">-</div></div>
<div class="card"><div class="label">Elapsed</div><div class="value" id="elapsed">0s</div></div>
<div class="card"><div class="label">Preview Frames</div><div class="value" id="frames">0</div></div>
<div class="card"><div class="label">Dropped Frames</div><div class="value" id="dropped">0</div></div>
<div class="card"><div class="label">JS Heap</div><div class="value" id="memory">-</div></div>
<div class="card"><div class="label">Long Tasks</div><div class="value" id="longtasks">-</div></div>
</div>
<div id="result"></div>
</div>
<script>
const video=document.getElementById("video"),startBtn=document.getElementById("start"),stopBtn=document.getElementById("stop"),bar=document.getElementById("bar"),result=document.getElementById("result");
const FPS=15,DURATION=60;
let stream=null,track=null,active=false,frames=0,dropped=0,started=0,timer=null,frameCallback=null,lastSample=0,lastSampleFrames=0,lastTime=0,lastFrames=0,lastDropped=0,intervals=[],longTaskTime=0,observer=null,settings={};
function report(error){
fetch("/api/capture/status",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({running:active,connected:!!stream,fps:frames/Math.max(.1,(performance.now()-started)/1000),width:settings.width||0,height:settings.height||0,frames:frames,droppedFrames:dropped,error:error||null})}).catch(()=>{});
}
function update(){
const elapsed=(performance.now()-started)/1000;
document.getElementById("elapsed").textContent=elapsed.toFixed(1)+"s";
document.getElementById("frames").textContent=frames.toLocaleString();
document.getElementById("dropped").textContent=dropped.toLocaleString();
document.getElementById("fps").textContent=lastTime?((frames-lastFrames)/Math.max(.001,(performance.now()-lastTime)/1000)).toFixed(1):"0";
document.getElementById("memory").textContent=performance.memory?(performance.memory.usedJSHeapSize/1048576).toFixed(1)+" MB":"N/A";
document.getElementById("longtasks").textContent=elapsed>0?(longTaskTime/1000).toFixed(2)+"s":"0s";
bar.style.width=Math.min(100,elapsed/DURATION*100)+"%";
}
function onFrame(){
if(!active)return;
frames++;
if(video.requestVideoFrameCallback)frameCallback=video.requestVideoFrameCallback(onFrame);
}
function finish(reason){
if(!active)return;
active=false;
clearInterval(timer);
if(frameCallback!==null&&video.cancelVideoFrameCallback)video.cancelVideoFrameCallback(frameCallback);
if(observer)observer.disconnect();
const elapsed=(performance.now()-started)/1000;
const avg=frames/Math.max(.001,elapsed);
const min=intervals.length?Math.min(...intervals):0;
const max=intervals.length?Math.max(...intervals):0;
const consistency=intervals.length?intervals.filter(v=>Math.abs(v-FPS)<=1.5).length/intervals.length*100:0;
const rate=frames+dropped>0?dropped/(frames+dropped)*100:0;
const output=reason==="Completed"
?"<b>60-second benchmark completed</b><br>Average preview FPS: "+avg.toFixed(2)+"<br>Target FPS: "+FPS+"<br>Minimum 5-second FPS: "+min.toFixed(2)+"<br>Maximum 5-second FPS: "+max.toFixed(2)+"<br>FPS consistency: "+consistency.toFixed(1)+"%<br>Total preview frames: "+frames.toLocaleString()+"<br>Dropped preview frames: "+dropped.toLocaleString()+"<br>Drop rate: "+rate.toFixed(2)+"%"
:"<b>Test stopped early</b><br>Elapsed: "+elapsed.toFixed(1)+" seconds<br>Average preview FPS so far: "+avg.toFixed(2);
result.innerHTML=output;
result.style.display="block";
if(stream)stream.getTracks().forEach(t=>t.stop());
stream=null;track=null;video.srcObject=null;
startBtn.disabled=false;stopBtn.disabled=true;
update();report(reason==="Completed"?null:reason);
}
startBtn.onclick=async()=>{
try{
result.style.display="none";
startBtn.disabled=true;stopBtn.disabled=false;
frames=0;dropped=0;intervals=[];longTaskTime=0;lastSample=0;lastSampleFrames=0;lastTime=0;lastFrames=0;lastDropped=0;frameCallback=null;
document.getElementById("fps").textContent="0";
document.getElementById("target").textContent=FPS;
stream=await navigator.mediaDevices.getDisplayMedia({video:{width:{ideal:1280},height:{ideal:720},frameRate:{ideal:FPS,max:FPS}},audio:false});
track=stream.getVideoTracks()[0];
settings=track.getSettings();
document.getElementById("resolution").textContent=(settings.width||0)+" × "+(settings.height||0);
video.srcObject=stream;
await video.play();
active=true;started=performance.now();lastSample=started;lastTime=started;
if(video.requestVideoFrameCallback)frameCallback=video.requestVideoFrameCallback(onFrame);
if("PerformanceObserver"in window){
try{observer=new PerformanceObserver(list=>{for(const entry of list.getEntries())longTaskTime+=entry.duration});observer.observe({type:"longtask",buffered:true})}catch(e){}
}
track.addEventListener("ended",()=>finish("Screen sharing ended"),{once:true});
timer=setInterval(()=>{
if(!active)return;
const now=performance.now(),elapsed=(now-lastSample)/1000;
if(elapsed>=4.5){
const sample=(frames-lastSampleFrames)/elapsed;
intervals.push(sample);
lastSample=now;lastSampleFrames=frames;
}
if(video.getVideoPlaybackQuality){
const quality=video.getVideoPlaybackQuality();
dropped=Math.max(dropped,quality.droppedVideoFrames||0);
}
update();report();
if((now-started)/1000>=DURATION)finish("Completed");
},1000);
report();
}catch(error){
active=false;startBtn.disabled=false;stopBtn.disabled=true;
result.innerHTML="<b>Capture failed</b><br>"+String(error.message||error);
result.style.display="block";
if(stream)stream.getTracks().forEach(t=>t.stop());
stream=null;report(String(error.message||error));
}
};
stopBtn.onclick=()=>finish("Stopped manually");
</script>
</body>
</html>`;
function attach(app,express){
let status={running:false,connected:false,fps:0,width:0,height:0,frames:0,droppedFrames:0,error:null};
app.get("/capture",(req,res)=>{res.type("html").send(page())});
app.get("/api/capture/status",(req,res)=>res.json(status));
app.post("/api/capture/status",express.json(),(req,res)=>{
const body=req.body||{};
status={...status,...body};
res.json({ok:true});
});
}
module.exports={attach};
