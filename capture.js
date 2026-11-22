
const page=()=>`<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Edge Multi-Resolution Capture Benchmark</title>
<style>
*{box-sizing:border-box}body{margin:0;padding:24px;background:#090b12;color:#e8eaf2;font-family:Arial,sans-serif}.wrap{max-width:1100px;margin:auto}h1{font-size:25px;margin:0 0 8px}.muted{color:#9298aa;font-size:13px}button{background:#7187ff;color:white;border:0;border-radius:8px;padding:12px 20px;font-weight:bold;cursor:pointer;margin:16px 8px 16px 0}button:disabled{opacity:.4;cursor:not-allowed}#stop{background:#33394b}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;margin-top:16px}.card{background:#151925;border:1px solid #252c3c;border-radius:10px;padding:15px}.label{font-size:11px;color:#9298aa;text-transform:uppercase;letter-spacing:.6px}.value{font-size:25px;font-weight:bold;margin-top:8px}.progress{height:8px;background:#252c3c;border-radius:10px;overflow:hidden;margin-top:16px}.bar{height:100%;width:0;background:#7187ff}#result{background:#151925;border:1px solid #252c3c;border-radius:10px;padding:18px;margin-top:16px;line-height:1.8;display:none;overflow-wrap:anywhere}table{width:100%;border-collapse:collapse;margin-top:14px;font-size:13px}th,td{text-align:left;padding:11px 8px;border-bottom:1px solid #252c3c}th{color:#9298aa;font-size:11px;text-transform:uppercase}td{white-space:nowrap}.status{color:#9298aa}
</style>
</head>
<body>
<div class="wrap">
<h1>Edge Multi-Resolution Capture Benchmark</h1>
<div class="muted">Five resolutions · 15 FPS target · 15 seconds measured per resolution</div>
<button id="start">START ALL BENCHMARKS</button>
<button id="stop" disabled>STOP TEST</button>
<div class="progress"><div class="bar" id="bar"></div></div>
<div class="grid">
<div class="card"><div class="label">Current Resolution</div><div class="value" id="resolution">-</div></div>
<div class="card"><div class="label">Current FPS</div><div class="value" id="fps">0</div></div>
<div class="card"><div class="label">Target FPS</div><div class="value">15</div></div>
<div class="card"><div class="label">Elapsed</div><div class="value" id="elapsed">0s</div></div>
<div class="card"><div class="label">Frames Received</div><div class="value" id="frames">0</div></div>
<div class="card"><div class="label">Current Test Average</div><div class="value" id="average">0</div></div>
</div>
<div id="result">
<b>Resolution benchmark results</b>
<table>
<thead><tr><th>Requested</th><th>Actual</th><th>Average</th><th>Minimum</th><th>Maximum</th><th>Consistency</th><th>Status</th></tr></thead>
<tbody id="rows"></tbody>
</table>
</div>
</div>
<script>
const startBtn=document.getElementById("start"),stopBtn=document.getElementById("stop"),bar=document.getElementById("bar"),result=document.getElementById("result"),rows=document.getElementById("rows");
const FPS=15,TEST_TIME=15,WARMUP=2;
const resolutions=[{w:1920,h:1080},{w:1600,h:900},{w:1280,h:720},{w:960,h:540},{w:640,h:360}];
let stream=null,track=null,reader=null,active=false,started=0,frames=0,stageFrames=0,stageStarted=0,currentStage=0,uiTimer=null,finished=false,results=[];
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function report(error){
fetch("/api/capture/status",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({running:active,connected:!!stream,fps:Number(document.getElementById("fps").textContent)||0,width:track?.getSettings().width||0,height:track?.getSettings().height||0,frames,error:error||null})}).catch(()=>{});
}
function cleanup(){
clearInterval(uiTimer);
if(stream)stream.getTracks().forEach(t=>t.stop());
if(reader){reader.cancel().catch(()=>{});reader=null}
stream=null;track=null;active=false;
startBtn.disabled=false;stopBtn.disabled=true;
}
function update(){
if(!active)return;
const elapsed=(performance.now()-started)/1000;
document.getElementById("elapsed").textContent=elapsed.toFixed(1)+"s";
document.getElementById("frames").textContent=frames.toLocaleString();
bar.style.width=Math.min(100,currentStage/resolutions.length*100)+"%";
}
async function readFrames(){
try{
while(active&&reader){
const item=await reader.read();
if(item.done)break;
frames++;
stageFrames++;
item.value.close();
}
}catch(error){
if(active)finish("Capture read error: "+(error.message||String(error)));
}
}
async function runStage(stage,index){
if(!active)return;
currentStage=index;
stageFrames=0;
const requested=stage.w+"×"+stage.h;
document.getElementById("resolution").textContent=requested;
document.getElementById("fps").textContent="Warming up";
document.getElementById("average").textContent="-";
try{
await track.applyConstraints({width:{ideal:stage.w},height:{ideal:stage.h},frameRate:{ideal:FPS,max:FPS}});
}catch(error){
rows.innerHTML+="<tr><td>"+requested+"</td><td>-</td><td>-</td><td>-</td><td>-</td><td>-</td><td>Constraint failed: "+error.name+"</td></tr>";
results.push({requested,failed:true});
return;
}
await sleep(WARMUP*1000);
if(!active)return;
const settings=track.getSettings(),actual=(settings.width||0)+"×"+(settings.height||0);
document.getElementById("resolution").textContent=actual;
stageFrames=0;
stageStarted=performance.now();
let previousFrames=0,previousTime=stageStarted,samples=[];
for(let i=0;i<3;i++){
await sleep(5000);
if(!active)return;
const now=performance.now(),seconds=(now-previousTime)/1000;
const sample=(stageFrames-previousFrames)/Math.max(.001,seconds);
samples.push(sample);
previousFrames=stageFrames;
previousTime=now;
document.getElementById("fps").textContent=sample.toFixed(2);
document.getElementById("average").textContent=(stageFrames/Math.max(.001,(now-stageStarted)/1000)).toFixed(2);
update();
report(null);
}
const avg=samples.reduce((a,b)=>a+b,0)/samples.length;
const min=Math.min(...samples),max=Math.max(...samples);
const consistency=samples.filter(v=>Math.abs(v-FPS)<=1.5).length/samples.length*100;
const status=avg>=13.5&&consistency>=66.7?"GOOD":avg>=10?"BORDERLINE":"SLOW";
results.push({requested,actual,avg,min,max,consistency,status});
rows.innerHTML+="<tr><td>"+requested+"</td><td>"+actual+"</td><td>"+avg.toFixed(2)+"</td><td>"+min.toFixed(2)+"</td><td>"+max.toFixed(2)+"</td><td>"+consistency.toFixed(1)+"%</td><td>"+status+"</td></tr>";
}
function finish(reason){
if(finished)return;
finished=true;
const completed=reason==="Completed";
result.style.display="block";
document.getElementById("fps").textContent="Finished";
bar.style.width=completed?"100%":bar.style.width;
const good=results.filter(r=>!r.failed&&r.status==="GOOD").length;
result.insertAdjacentHTML("afterbegin","<div><b>"+(completed?"All resolution tests completed":"Test stopped: "+reason)+"</b><br>Resolutions tested: "+results.length+"/"+resolutions.length+"<br>Good results: "+good+"</div><br>");
cleanup();report(completed?null:reason);
}
startBtn.onclick=async()=>{
try{
finished=false;results=[];rows.innerHTML="";result.style.display="none";bar.style.width="0%";
frames=0;currentStage=0;
for(const id of ["fps","average","frames"])document.getElementById(id).textContent="0";
document.getElementById("elapsed").textContent="0s";
startBtn.disabled=true;stopBtn.disabled=true;
if(!("MediaStreamTrackProcessor"in window))throw new Error("MediaStreamTrackProcessor is not available in this Edge browser.");
stream=await navigator.mediaDevices.getDisplayMedia({video:{width:{ideal:1920},height:{ideal:1080},frameRate:{ideal:FPS,max:FPS}},audio:false});
track=stream.getVideoTracks()[0];
const processor=new MediaStreamTrackProcessor({track});
reader=processor.readable.getReader();
active=true;started=performance.now();
stopBtn.disabled=false;
track.addEventListener("ended",()=>{if(active)finish("Screen sharing ended")},{once:true});
uiTimer=setInterval(update,250);
readFrames();
for(let i=0;i<resolutions.length&&active;i++){
await runStage(resolutions[i],i+1);
bar.style.width=(i+1)/resolutions.length*100+"%";
}
if(active)finish("Completed");
}catch(error){finish(error.message||String(error))}
};
stopBtn.onclick=()=>finish("Stopped manually");
</script>
</body>
</html>`;
function attach(app,express){
let status={running:false,connected:false,fps:0,width:0,height:0,frames:0,error:null};
app.get("/capture",(req,res)=>{res.type("html").send(page())});
app.get("/api/capture/status",(req,res)=>res.json(status));
app.post("/api/capture/status",express.json(),(req,res)=>{
status={...status,...(req.body||{})};
res.json({ok:true});
});
}
module.exports={attach};
