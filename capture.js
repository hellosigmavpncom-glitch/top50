
const page=()=>`<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Edge Frame Rate Benchmark</title>
<style>
*{box-sizing:border-box}body{margin:0;padding:24px;background:#090b12;color:#e8eaf2;font-family:Arial,sans-serif}.wrap{max-width:1000px;margin:auto}h1{font-size:25px;margin:0 0 8px}.muted{color:#9298aa;font-size:13px}button{background:#7187ff;color:white;border:0;border-radius:8px;padding:12px 20px;font-weight:bold;cursor:pointer;margin:16px 8px 16px 0}button:disabled{opacity:.4;cursor:not-allowed}#stop{background:#33394b}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;margin-top:16px}.card{background:#151925;border:1px solid #252c3c;border-radius:10px;padding:15px}.label{font-size:11px;color:#9298aa;text-transform:uppercase;letter-spacing:.6px}.value{font-size:25px;font-weight:bold;margin-top:8px}.progress{height:8px;background:#252c3c;border-radius:10px;overflow:hidden;margin-top:16px}.bar{height:100%;width:0;background:#7187ff}#result{background:#151925;border:1px solid #252c3c;border-radius:10px;padding:18px;margin-top:16px;line-height:1.8;display:none;overflow-wrap:anywhere}table{width:100%;border-collapse:collapse;margin-top:14px;font-size:13px}th,td{text-align:left;padding:11px 8px;border-bottom:1px solid #252c3c}th{color:#9298aa;font-size:11px;text-transform:uppercase}
</style>
</head>
<body>
<div class="wrap">
<h1>Edge Frame Rate Benchmark</h1>
<div class="muted">Fixed 1920×1080 resolution · 15, 10 and 5 FPS · 15 seconds per test</div>
<button id="start">START FRAME RATE TEST</button>
<button id="stop" disabled>STOP TEST</button>
<div class="progress"><div class="bar" id="bar"></div></div>
<div class="grid">
<div class="card"><div class="label">Current FPS Target</div><div class="value" id="target">-</div></div>
<div class="card"><div class="label">Actual Capture FPS</div><div class="value" id="fps">0</div></div>
<div class="card"><div class="label">Actual Resolution</div><div class="value" id="resolution">-</div></div>
<div class="card"><div class="label">Elapsed</div><div class="value" id="elapsed">0s</div></div>
<div class="card"><div class="label">Frames Received</div><div class="value" id="frames">0</div></div>
<div class="card"><div class="label">Current Test Average</div><div class="value" id="average">0</div></div>
</div>
<div id="result">
<b>Frame rate comparison</b>
<table>
<thead><tr><th>Target</th><th>Actual Resolution</th><th>Average FPS</th><th>Minimum</th><th>Maximum</th><th>Consistency</th></tr></thead>
<tbody id="rows"></tbody>
</table>
</div>
</div>
<script>
const startBtn=document.getElementById("start"),stopBtn=document.getElementById("stop"),bar=document.getElementById("bar"),result=document.getElementById("result"),rows=document.getElementById("rows");
const RES={width:1920,height:1080},TARGETS=[15,10,5],TEST_TIME=15,WARMUP=2;
let stream=null,track=null,reader=null,active=false,started=0,frames=0,stageFrames=0,currentStage=0,uiTimer=null,finished=false,results=[];
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function report(error){
const s=track?.getSettings()||{};
fetch("/api/capture/status",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({running:active,connected:!!stream,fps:Number(document.getElementById("fps").textContent)||0,width:s.width||0,height:s.height||0,frames,error:error||null})}).catch(()=>{});
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
document.getElementById("elapsed").textContent=((performance.now()-started)/1000).toFixed(1)+"s";
document.getElementById("frames").textContent=frames.toLocaleString();
bar.style.width=Math.min(100,currentStage/TARGETS.length*100)+"%";
}
async function readFrames(){
try{
while(active&&reader){
const item=await reader.read();
if(item.done)break;
frames++;stageFrames++;
item.value.close();
}
}catch(error){
if(active)finish("Capture read error: "+(error.message||String(error)));
}
}
async function runStage(target,index){
if(!active)return;
currentStage=index;
stageFrames=0;
document.getElementById("target").textContent=target+" FPS";
document.getElementById("fps").textContent="Warming up";
document.getElementById("average").textContent="-";
try{
await track.applyConstraints({width:{ideal:RES.width},height:{ideal:RES.height},frameRate:{ideal:target,max:target}});
}catch(error){
results.push({target,failed:error.message});
rows.innerHTML+="<tr><td>"+target+"</td><td colspan='5'>Constraint failed: "+error.message+"</td></tr>";
return;
}
await sleep(WARMUP*1000);
if(!active)return;
const settings=track.getSettings(),actual=(settings.width||0)+"×"+(settings.height||0);
stageFrames=0;
const stageStarted=performance.now();
let previousFrames=0,previousTime=stageStarted,samples=[];
for(let i=0;i<3;i++){
await sleep(5000);
if(!active)return;
const now=performance.now();
const sample=(stageFrames-previousFrames)/Math.max(.001,(now-previousTime)/1000);
samples.push(sample);
previousFrames=stageFrames;previousTime=now;
document.getElementById("fps").textContent=sample.toFixed(2);
document.getElementById("average").textContent=(stageFrames/Math.max(.001,(now-stageStarted)/1000)).toFixed(2);
update();report(null);
}
const avg=samples.reduce((a,b)=>a+b,0)/samples.length;
const min=Math.min(...samples),max=Math.max(...samples);
const consistency=samples.filter(v=>Math.abs(v-target)<=Math.max(1,target*.1)).length/samples.length*100;
results.push({target,actual,avg,min,max,consistency});
rows.innerHTML+="<tr><td>"+target+" FPS</td><td>"+actual+"</td><td>"+avg.toFixed(2)+"</td><td>"+min.toFixed(2)+"</td><td>"+max.toFixed(2)+"</td><td>"+consistency.toFixed(1)+"%</td></tr>";
}
function finish(reason){
if(finished)return;
finished=true;
const completed=reason==="Completed";
result.style.display="block";
result.insertAdjacentHTML("afterbegin","<div><b>"+(completed?"All frame-rate tests completed":"Test stopped: "+reason)+"</b><br>Tests completed: "+results.length+"/"+TARGETS.length+"<br>Resolution requested: 1920×1080</div><br>");
bar.style.width=completed?"100%":bar.style.width;
cleanup();report(completed?null:reason);
}
startBtn.onclick=async()=>{
try{
finished=false;results=[];rows.innerHTML="";result.style.display="none";bar.style.width="0%";
frames=0;currentStage=0;
for(const id of ["fps","average","frames"])document.getElementById(id).textContent="0";
document.getElementById("target").textContent="-";document.getElementById("resolution").textContent="-";document.getElementById("elapsed").textContent="0s";
startBtn.disabled=true;stopBtn.disabled=true;
if(!("MediaStreamTrackProcessor"in window))throw new Error("MediaStreamTrackProcessor is not available in this Edge browser.");
stream=await navigator.mediaDevices.getDisplayMedia({video:{width:{ideal:RES.width},height:{ideal:RES.height},frameRate:{ideal:15,max:15}},audio:false});
track=stream.getVideoTracks()[0];
const processor=new MediaStreamTrackProcessor({track});
reader=processor.readable.getReader();
active=true;started=performance.now();stopBtn.disabled=false;
track.addEventListener("ended",()=>{if(active)finish("Screen sharing ended")},{once:true});
uiTimer=setInterval(update,250);
readFrames();
for(let i=0;i<TARGETS.length&&active;i++)await runStage(TARGETS[i],i+1);
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
