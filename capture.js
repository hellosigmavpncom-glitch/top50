
const WIDTH=1280,HEIGHT=720,FPS=15,BENCHMARK=60;
let stream=null,track=null,active=false,frames=0,dropped=0,started=0,timer=null,frameCallback=null,lastSample=0,lastSampleFrames=0,lastTime=0,lastFrames=0,lastDropped=0,intervals=[],longTaskTime=0,observer=null,settings={};
const page=()=>`<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Dashboard Capture Benchmark</title>
<style>
*{box-sizing:border-box}body{margin:0;padding:22px;background:#101114;color:#eee;font:15px Arial,sans-serif}h2{margin:0 0 8px}p{color:#999;margin:0 0 20px}.video{width:100%;max-width:1100px;background:#000;border:1px solid #333;border-radius:10px;aspect-ratio:16/9;object-fit:contain}button{padding:12px 20px;margin:15px 8px 15px 0;border:0;border-radius:7px;background:#7187ff;color:white;font-weight:bold;cursor:pointer}button:disabled{opacity:.4;cursor:default}#stop{background:#444}.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(155px,1fr));gap:10px;max-width:1100px}.stat{background:#1b1d22;border:1px solid #303239;border-radius:8px;padding:14px}.stat small{display:block;color:#999;margin-bottom:8px}.stat strong{font-size:23px}.stat em{display:block;color:#888;font-size:11px;font-style:normal;margin-top:5px}#status{margin:12px 0;color:#aaa}#error{color:#ff7777;white-space:pre-wrap}.progress{max-width:1100px;height:9px;background:#292b32;border-radius:8px;overflow:hidden;margin:12px 0 18px}.progress div{height:100%;width:0;background:#7187ff;transition:width .3s}.section{max-width:1100px;margin:22px 0 10px;color:#aaa;font-size:12px;letter-spacing:1px}.result{max-width:1100px;background:#1b1d22;border:1px solid #303239;border-radius:8px;padding:16px;margin-top:12px;line-height:1.8}
</style>
</head>
<body>
<h2>Edge Capture Performance Benchmark</h2>
<p>60-second local screen capture test · Target: 1280 × 720 at 15 FPS</p>
<video class="video" id="video" autoplay muted playsinline></video>
<br>
<button id="start">START 60-SECOND TEST</button><button id="stop" disabled>STOP TEST</button>
<div id="status">Status: Waiting for capture</div>
<div class="progress"><div id="progress"></div></div>
<div class="section">LIVE PERFORMANCE</div>
<div class="stats">
<div class="stat"><small>5-SECOND AVERAGE FPS</small><strong id="fps">0</strong><em>Smoothed live measurement</em></div>
<div class="stat"><small>60-SECOND AVERAGE FPS</small><strong id="average">-</strong><em>Main benchmark result</em></div>
<div class="stat"><small>MINIMUM 5-SEC FPS</small><strong id="minimum">-</strong></div>
<div class="stat"><small>MAXIMUM 5-SEC FPS</small><strong id="maximum">-</strong></div>
<div class="stat"><small>CAPTURE RESOLUTION</small><strong id="resolution">-</strong></div>
<div class="stat"><small>TARGET FPS</small><strong id="target">15</strong></div>
<div class="stat"><small>TOTAL PREVIEW FRAMES</small><strong id="frames">0</strong></div>
<div class="stat"><small>DROPPED PREVIEW FRAMES</small><strong id="dropped">0</strong></div>
<div class="stat"><small>DROP RATE</small><strong id="dropRate">0%</strong></div>
<div class="stat"><small>FPS CONSISTENCY</small><strong id="stability">-</strong><em>5-sec intervals within 1.5 FPS of target</em></div>
<div class="stat"><small>JS HEAP MEMORY</small><strong id="memory">N/A</strong><em>Browser JavaScript heap only</em></div>
<div class="stat"><small>MAIN-THREAD LONG TASKS</small><strong id="busy">N/A</strong><em>Time spent in tasks over 50ms</em></div>
<div class="stat"><small>RUN TIME</small><strong id="runtime">0s</strong></div>
</div>
<div class="section">FINAL BENCHMARK</div>
<div class="result" id="result">Complete a 60-second test to see your final benchmark.</div>
<p id="error"></p>
<script>
const video=document.getElementById("video"),start=document.getElementById("start"),stop=document.getElementById("stop");
let stream=null,track=null,active=false,frames=0,dropped=0,started=0,timer=null,frameCallback=null,lastSample=0,lastTime=0,lastFrames=0,lastDropped=0,intervals=[],longTaskTime=0,observer=null,settings={};
const show=(id,value)=>document.getElementById(id).textContent=value;
const report=async data=>{try{await fetch("/api/capture/status",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(data)});}catch(e){}};
const quality=()=>video.getVideoPlaybackQuality?video.getVideoPlaybackQuality():{droppedVideoFrames:0};
function frameLoop(){if(!active||!video.requestVideoFrameCallback)return;frameCallback=video.requestVideoFrameCallback(()=>{frames++;frameLoop();});}
function finish(reason="Completed"){
if(!active)return;
active=false;clearInterval(timer);
if(frameCallback!==null&&video.cancelVideoFrameCallback)video.cancelVideoFrameCallback(frameCallback);
if(observer)observer.disconnect();
const elapsed=(performance.now()-started)/1000,avg=elapsed>0?frames/elapsed:0;
const q=quality();dropped=q.droppedVideoFrames||dropped;
const rate=(frames+dropped)>0?dropped/(frames+dropped)*100:0;
const good=intervals.filter(x=>Math.abs(x-FPS)<=1.5).length;
const consistency=intervals.length?good/intervals.length*100:0;
const min=intervals.length?Math.min(...intervals):0,max=intervals.length?Math.max(...intervals):0;
const result=reason==="Completed"?`<b>60-second benchmark completed</b><br>Average preview FPS: ${avg.toFixed(2)}<br>Target FPS: ${FPS}<br>Minimum 5-second FPS: ${min.toFixed(2)}<br>Maximum 5-second FPS: ${max.toFixed(2)}<br>FPS consistency: ${consistency.toFixed(1)}%<br>Total preview frames: ${frames.toLocaleString()}<br>Dropped preview frames: ${dropped.toLocaleString()}<br>Drop rate: ${rate.toFixed(2)}%`:`<b>Test stopped early</b><br>Elapsed: ${elapsed.toFixed(1)} seconds<br>Average preview FPS so far: ${avg.toFixed(2)}`;
document.getElementById("result").innerHTML=result;
show("average",avg.toFixed(2));show("minimum",min.toFixed(2));show("maximum",max.toFixed(2));show("stability",consistency.toFixed(1)+"%");
show("dropRate",rate.toFixed(2)+"%");show("dropped",dropped.toLocaleString());
if(stream)stream.getTracks().forEach(t=>t.stop());
stream=null;track=null;video.srcObject=null;start.disabled=false;stop.disabled=true;
show("status",reason==="Completed"?"Status: Benchmark completed":"Status: Test stopped");
report({running:false,connected:false,width:settings.width||0,height:settings.height||0,fps:Number(avg.toFixed(2)),frames,droppedFrames:dropped,error:null});
}
start.onclick=async()=>{
if(active)return;
try{
document.getElementById("error").textContent="";document.getElementById("result").textContent="Benchmark running...";
frames=0;dropped=0;intervals=[];longTaskTime=0;
stream=await navigator.mediaDevices.getDisplayMedia({video:{width:{ideal:WIDTH},height:{ideal:HEIGHT},frameRate:{ideal:FPS,max:FPS}},audio:false});
track=stream.getVideoTracks()[0];settings=track.getSettings();
video.srcObject=stream;await video.play();
active=true;started=performance.now();lastTime=started;lastSample=started;lastFrames=0;lastDropped=0;
start.disabled=true;stop.disabled=false;
show("status","Status: Capturing · 60-second benchmark running");
show("resolution",(settings.width||0)+" × "+(settings.height||0));
show("target",settings.frameRate?settings.frameRate.toFixed(1):FPS);
track.onended=()=>finish("Stopped");
if("PerformanceObserver" in window){try{observer=new PerformanceObserver(list=>{for(const entry of list.getEntries())longTaskTime+=entry.duration;});observer.observe({type:"longtask",buffered:true});}catch(e){}}
frameLoop();
timer=setInterval(()=>{
if(!active)return;
const now=performance.now(),elapsed=(now-lastTime)/1000;
const currentQuality=quality(),currentDropped=currentQuality.droppedVideoFrames||0;
const fps=elapsed>0?(frames-lastFrames)/elapsed:0;
const sampleElapsed=(now-lastSample)/1000;
if(sampleElapsed>=4.5){
intervals.push((frames-lastSampleFrames)/sampleElapsed);
lastSample=now;lastSampleFrames=frames;
}
lastFrames=frames;lastTime=now;dropped=currentDropped;
const totalElapsed=(now-started)/1000,avg=totalElapsed>0?frames/totalElapsed:0;
const rate=(frames+dropped)>0?dropped/(frames+dropped)*100:0;
const good=intervals.filter(x=>Math.abs(x-FPS)<=1.5).length;
const consistency=intervals.length?good/intervals.length*100:0;
show("fps",fps.toFixed(1));show("average",avg.toFixed(2));
show("frames",frames.toLocaleString());show("dropped",dropped.toLocaleString());
show("dropRate",rate.toFixed(2)+"%");
show("minimum",intervals.length?Math.min(...intervals).toFixed(2):"-");
show("maximum",intervals.length?Math.max(...intervals).toFixed(2):"-");
show("stability",intervals.length?consistency.toFixed(1)+"%":"Measuring");
show("runtime",Math.floor(totalElapsed)+"s");
document.getElementById("progress").style.width=Math.min(100,totalElapsed/BENCHMARK*100)+"%";
if(performance.memory)show("memory",(performance.memory.usedJSHeapSize/1048576).toFixed(1)+" MB");
if(observer)show("busy",(longTaskTime/Math.max(1,totalElapsed*1000)*100).toFixed(1)+"%");
show("status","Status: Benchmarking · "+Math.min(60,Math.floor(totalElapsed))+" / 60 seconds");
report({running:true,connected:true,fps:Number(avg.toFixed(2)),width:settings.width||0,height:settings.height||0,frames,droppedFrames:dropped,error:null});
if(totalElapsed>=BENCHMARK)finish("Completed");
},1000);
}catch(e){
document.getElementById("error").textContent=e.name+": "+e.message;
show("status","Status: Capture failed");
if(stream)stream.getTracks().forEach(t=>t.stop());
stream=null;start.disabled=false;stop.disabled=true;
report({running:false,connected:false,error:e.message});
}
};
stop.onclick=()=>finish("Stopped");
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
