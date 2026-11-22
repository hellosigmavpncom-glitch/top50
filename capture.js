const page=()=>`<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Edge Capture Track Benchmark</title>
<style>
*{box-sizing:border-box}body{margin:0;padding:24px;background:#090b12;color:#e8eaf2;font-family:Arial,sans-serif}.wrap{max-width:1000px;margin:auto}h1{font-size:25px;margin:0 0 8px}.muted{color:#9298aa;font-size:13px}button{background:#7187ff;color:white;border:0;border-radius:8px;padding:12px 20px;font-weight:bold;cursor:pointer;margin:16px 8px 16px 0}button:disabled{opacity:.4;cursor:not-allowed}#stop{background:#33394b}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;margin-top:16px}.card{background:#151925;border:1px solid #252c3c;border-radius:10px;padding:15px}.label{font-size:11px;color:#9298aa;text-transform:uppercase;letter-spacing:.6px}.value{font-size:25px;font-weight:bold;margin-top:8px}.progress{height:8px;background:#252c3c;border-radius:10px;overflow:hidden;margin-top:16px}.bar{height:100%;width:0;background:#7187ff}#result{background:#151925;border:1px solid #252c3c;border-radius:10px;padding:18px;margin-top:16px;line-height:1.8;display:none;overflow-wrap:anywhere}
</style>
</head>
<body>
<div class="wrap">
<h1>Edge Capture Track Benchmark</h1>
<div class="muted">Direct screen-capture frame measurement · No video preview · 60 seconds</div>
<button id="start">START 60-SECOND TEST</button>
<button id="stop" disabled>STOP TEST</button>
<div class="progress"><div class="bar" id="bar"></div></div>
<div class="grid">
<div class="card"><div class="label">Capture Track FPS</div><div class="value" id="fps">0</div></div>
<div class="card"><div class="label">Target FPS</div><div class="value">15</div></div>
<div class="card"><div class="label">Capture Resolution</div><div class="value" id="resolution">-</div></div>
<div class="card"><div class="label">Elapsed</div><div class="value" id="elapsed">0s</div></div>
<div class="card"><div class="label">Frames Received</div><div class="value" id="frames">0</div></div>
<div class="card"><div class="label">Average Track FPS</div><div class="value" id="average">0</div></div>
<div class="card"><div class="label">Minimum 5-Second FPS</div><div class="value" id="minimum">-</div></div>
<div class="card"><div class="label">Maximum 5-Second FPS</div><div class="value" id="maximum">-</div></div>
<div class="card"><div class="label">FPS Consistency</div><div class="value" id="consistency">-</div></div>
</div>
<div id="result"></div>
</div>
<script>
const startBtn=document.getElementById("start"),stopBtn=document.getElementById("stop"),bar=document.getElementById("bar"),result=document.getElementById("result");
const FPS=15,DURATION=60;
let stream=null,track=null,reader=null,active=false,started=0,uiTimer=null,sampleTimer=null,endTimer=null,frames=0,lastFrames=0,lastSample=0,samples=[],settings={},finished=false;
function report(error,fps,count){
fetch("/api/capture/status",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({running:active,connected:!!stream,fps:fps||0,width:settings.width||0,height:settings.height||0,frames:count||0,droppedFrames:0,error:error||null})}).catch(()=>{});
}
function cleanup(){
clearInterval(uiTimer);clearInterval(sampleTimer);clearTimeout(endTimer);
if(stream)stream.getTracks().forEach(t=>t.stop());
if(reader){reader.cancel().catch(()=>{});reader=null}
stream=null;track=null;active=false;
startBtn.disabled=false;stopBtn.disabled=true;
}
function showError(message){
result.innerHTML="<b>Test failed</b><br>"+String(message);
result.style.display="block";
cleanup();report(String(message),0,0);
}
function update(){
if(!active)return;
const elapsed=(performance.now()-started)/1000;
const avg=frames/Math.max(.001,elapsed);
document.getElementById("elapsed").textContent=elapsed.toFixed(1)+"s";
document.getElementById("frames").textContent=frames.toLocaleString();
document.getElementById("average").textContent=avg.toFixed(2);
bar.style.width=Math.min(100,elapsed/DURATION*100)+"%";
}
function finish(reason){
if(finished)return;
finished=true;
const elapsed=(performance.now()-started)/1000;
const avg=frames/Math.max(.001,elapsed);
const min=samples.length?Math.min(...samples):0;
const max=samples.length?Math.max(...samples):0;
const consistency=samples.length?samples.filter(v=>Math.abs(v-FPS)<=1.5).length/samples.length*100:0;
const completed=reason==="Completed";
document.getElementById("fps").textContent=avg.toFixed(2);
document.getElementById("average").textContent=avg.toFixed(2);
document.getElementById("frames").textContent=frames.toLocaleString();
document.getElementById("elapsed").textContent=elapsed.toFixed(1)+"s";
document.getElementById("minimum").textContent=min.toFixed(2);
document.getElementById("maximum").textContent=max.toFixed(2);
document.getElementById("consistency").textContent=consistency.toFixed(1)+"%";
bar.style.width=Math.min(100,elapsed/DURATION*100)+"%";
result.innerHTML=(completed?"<b>60-second capture-track benchmark completed</b>":"<b>Test ended: "+reason+"</b>")+"<br>Average capture-track FPS: "+avg.toFixed(2)+"<br>Target FPS: "+FPS+"<br>Minimum 5-second FPS: "+min.toFixed(2)+"<br>Maximum 5-second FPS: "+max.toFixed(2)+"<br>FPS consistency: "+consistency.toFixed(1)+"%<br>Total frames received: "+frames.toLocaleString()+"<br>Elapsed: "+elapsed.toFixed(1)+" seconds<br><br>Frames counted directly from MediaStreamTrackProcessor, not video-preview playback.";
result.style.display="block";
const finalFrames=frames;
cleanup();report(completed?null:reason,avg,finalFrames);
}
async function readFrames(){
try{
while(active&&reader){
const item=await reader.read();
if(item.done)break;
frames++;
item.value.close();
}
if(active)finish("Capture track ended");
}catch(error){
if(active)finish("Read error: "+(error.message||String(error)));
}
}
startBtn.onclick=async()=>{
try{
result.style.display="none";startBtn.disabled=true;stopBtn.disabled=true;
frames=0;lastFrames=0;samples=[];finished=false;reader=null;
for(const id of ["fps","average","frames"])document.getElementById(id).textContent="0";
for(const id of ["minimum","maximum","consistency"])document.getElementById(id).textContent="-";
document.getElementById("elapsed").textContent="0s";bar.style.width="0%";
if(!("MediaStreamTrackProcessor"in window))throw new Error("MediaStreamTrackProcessor is not available on this Edge browser's main thread.");
stream=await navigator.mediaDevices.getDisplayMedia({video:{width:{ideal:1280},height:{ideal:720},frameRate:{ideal:FPS,max:FPS}},audio:false});
track=stream.getVideoTracks()[0];
settings=track.getSettings();
document.getElementById("resolution").textContent=(settings.width||0)+" × "+(settings.height||0);
const processor=new MediaStreamTrackProcessor({track});
reader=processor.readable.getReader();
active=true;started=performance.now();lastSample=started;
startBtn.disabled=true;stopBtn.disabled=false;
track.addEventListener("ended",()=>{if(active)finish("Screen sharing ended")},{once:true});
sampleTimer=setInterval(()=>{
if(!active)return;
const now=performance.now(),seconds=(now-lastSample)/1000;
const fps=(frames-lastFrames)/Math.max(.001,seconds);
samples.push(fps);
lastSample=now;lastFrames=frames;
document.getElementById("fps").textContent=fps.toFixed(2);
update();report(null,frames/Math.max(.001,(now-started)/1000),frames);
},5000);
uiTimer=setInterval(update,250);
endTimer=setTimeout(()=>finish("Completed"),DURATION*1000);
report(null,0,0);
readFrames();
}catch(error){showError(error.message||String(error))}
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
status={...status,...(req.body||{})};
res.json({ok:true});
});
}
module.exports={attach};
