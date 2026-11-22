
const page=()=>`<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Edge MediaRecorder Benchmark</title>
<style>
*{box-sizing:border-box}body{margin:0;padding:24px;background:#090b12;color:#e8eaf2;font-family:Arial,sans-serif}.wrap{max-width:1100px;margin:auto}h1{font-size:25px;margin:0 0 8px}.muted{color:#9298aa;font-size:13px}button{background:#7187ff;color:white;border:0;border-radius:8px;padding:12px 20px;font-weight:bold;cursor:pointer;margin:16px 8px 16px 0}button:disabled{opacity:.4;cursor:not-allowed}#stop{background:#33394b}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;margin-top:16px}.card{background:#151925;border:1px solid #252c3c;border-radius:10px;padding:15px}.label{font-size:11px;color:#9298aa;text-transform:uppercase;letter-spacing:.6px}.value{font-size:23px;font-weight:bold;margin-top:8px}.progress{height:8px;background:#252c3c;border-radius:10px;overflow:hidden;margin-top:16px}.bar{height:100%;width:0;background:#7187ff}#result{background:#151925;border:1px solid #252c3c;border-radius:10px;padding:18px;margin-top:16px;line-height:1.8;display:none;overflow-x:auto}table{width:100%;border-collapse:collapse;margin-top:14px;font-size:12px;min-width:850px}th,td{text-align:left;padding:10px 8px;border-bottom:1px solid #252c3c;white-space:nowrap}th{color:#9298aa;font-size:10px;text-transform:uppercase}.good{color:#70dba0}.bad{color:#ff8585}
</style>
</head>
<body>
<div class="wrap">
<h1>Edge MediaRecorder Benchmark</h1>
<div class="muted">1920×1080 requested · H.264 and VP8 · 20 seconds per recording · 1-second chunks</div>
<button id="start">START RECORDING TEST</button>
<button id="stop" disabled>STOP TEST</button>
<div class="progress"><div class="bar" id="bar"></div></div>
<div class="grid">
<div class="card"><div class="label">Current Codec</div><div class="value" id="codec">-</div></div>
<div class="card"><div class="label">Recorder State</div><div class="value" id="state">Inactive</div></div>
<div class="card"><div class="label">Actual Resolution</div><div class="value" id="resolution">-</div></div>
<div class="card"><div class="label">Elapsed</div><div class="value" id="elapsed">0s</div></div>
<div class="card"><div class="label">Chunks Received</div><div class="value" id="chunks">0</div></div>
<div class="card"><div class="label">Encoded Output</div><div class="value" id="output">0 MB</div></div>
<div class="card"><div class="label">Current Bitrate</div><div class="value" id="bitrate">0 kbps</div></div>
<div class="card"><div class="label">Encoding Errors</div><div class="value" id="errors">0</div></div>
</div>
<div id="result">
<b>MediaRecorder comparison results</b>
<table>
<thead><tr><th>Codec</th><th>Actual MIME</th><th>Resolution</th><th>Duration</th><th>Chunks</th><th>Output</th><th>Bitrate</th><th>Avg Gap</th><th>Max Gap</th><th>Errors</th><th>Status</th></tr></thead>
<tbody id="rows"></tbody>
</table>
</div>
</div>
<script>
const startBtn=document.getElementById("start"),stopBtn=document.getElementById("stop"),bar=document.getElementById("bar"),result=document.getElementById("result"),rows=document.getElementById("rows");
const RES={width:1920,height:1080},DURATION=20,WARMUP=2;
const codecs=[
{label:"H.264",types:['video/mp4;codecs="avc1.42E01E"','video/mp4;codecs=avc1','video/mp4']},
{label:"VP8",types:["video/webm;codecs=vp8","video/webm"]}
];
let stream=null,track=null,activeRecorder=null,active=false,stopRequested=false,started=0,uiTimer=null,finished=false,results=[];
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function report(error,extra={}){
const s=track?.getSettings()||{};
fetch("/api/capture/status",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({running:active,connected:!!stream,width:s.width||0,height:s.height||0,error:error||null,...extra})}).catch(()=>{});
}
function cleanup(){
clearInterval(uiTimer);
if(activeRecorder&&activeRecorder.state!=="inactive"){
try{activeRecorder.stop()}catch(e){}
}
activeRecorder=null;
if(stream)stream.getTracks().forEach(t=>t.stop());
stream=null;track=null;active=false;
startBtn.disabled=false;stopBtn.disabled=true;
}
function update(){
if(!active)return;
document.getElementById("elapsed").textContent=((performance.now()-started)/1000).toFixed(1)+"s";
bar.style.width=Math.min(100,results.length/codecs.length*100)+"%";
}
function chooseType(types){
return types.find(type=>MediaRecorder.isTypeSupported(type))||null;
}
async function runCodec(codec,index){
if(!active||stopRequested)return;
document.getElementById("codec").textContent=codec.label;
document.getElementById("state").textContent="Preparing";
document.getElementById("chunks").textContent="0";
document.getElementById("output").textContent="0 MB";
document.getElementById("bitrate").textContent="0 kbps";
document.getElementById("errors").textContent="0";
await sleep(WARMUP*1000);
if(!active||stopRequested)return;
const mime=chooseType(codec.types);
if(!mime){
rows.innerHTML+="<tr><td>"+codec.label+"</td><td colspan='10'>Unsupported by MediaRecorder</td></tr>";
results.push({codec:codec.label,unsupported:true});
return;
}
const settings=track.getSettings(),resolution=(settings.width||0)+"×"+(settings.height||0);
document.getElementById("resolution").textContent=resolution;
let recorder,chunks=[],eventTimes=[],errors=[],bytes=0,begin=0,end=0;
try{
recorder=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:2500000});
}catch(error){
rows.innerHTML+="<tr><td>"+codec.label+"</td><td colspan='10'>Recorder creation failed: "+error.message+"</td></tr>";
results.push({codec:codec.label,failed:true});
return;
}
activeRecorder=recorder;
const stopped=new Promise(resolve=>{
recorder.ondataavailable=event=>{
if(!event.data||!event.data.size)return;
chunks.push(event.data);bytes+=event.data.size;eventTimes.push(performance.now());
const duration=Math.max(.001,(performance.now()-begin)/1000);
document.getElementById("chunks").textContent=chunks.length;
document.getElementById("output").textContent=(bytes/1048576).toFixed(2)+" MB";
document.getElementById("bitrate").textContent=(bytes*8/duration/1000).toFixed(0)+" kbps";
};
recorder.onerror=event=>{
errors.push(event.error?.message||event.message||"Unknown MediaRecorder error");
document.getElementById("errors").textContent=errors.length;
};
recorder.onstop=resolve;
});
try{
recorder.start(1000);
begin=performance.now();
document.getElementById("state").textContent="Recording";
const timer=setTimeout(()=>{
if(recorder.state!=="inactive")recorder.stop();
},DURATION*1000);
await stopped;
clearTimeout(timer);
}catch(error){
errors.push(error.message||String(error));
if(recorder.state!=="inactive"){
try{recorder.stop()}catch(e){}
await stopped;
}
}
end=performance.now();
if(activeRecorder===recorder)activeRecorder=null;
const duration=Math.max(.001,(end-begin)/1000);
const blob=new Blob(chunks,{type:recorder.mimeType||mime});
const bitrate=blob.size*8/duration/1000;
const gaps=eventTimes.slice(1).map((time,i)=>time-eventTimes[i]);
const avgGap=gaps.length?gaps.reduce((a,b)=>a+b,0)/gaps.length:0;
const maxGap=gaps.length?Math.max(...gaps):0;
const output=(blob.size/1048576).toFixed(2)+" MB";
const status=errors.length?"ERROR":blob.size===0?"NO OUTPUT":chunks.length>=10&&maxGap<3000?"RECORDED":"UNSTABLE";
const item={codec:codec.label,mime:recorder.mimeType||mime,resolution,duration,chunks:chunks.length,bytes:blob.size,bitrate,avgGap,maxGap,errors:errors.length,status};
results.push(item);
const cls=status==="RECORDED"?"good":"bad";
rows.innerHTML+="<tr><td>"+item.codec+"</td><td>"+item.mime+"</td><td>"+resolution+"</td><td>"+duration.toFixed(1)+"s</td><td>"+item.chunks+"</td><td>"+output+"</td><td>"+bitrate.toFixed(0)+" kbps</td><td>"+avgGap.toFixed(0)+" ms</td><td>"+maxGap.toFixed(0)+" ms</td><td>"+errors.length+"</td><td class='"+cls+"'>"+status+"</td></tr>";
document.getElementById("state").textContent=status;
report(errors.join("; ")||null,{codec:codec.label,chunks:chunks.length,bytes:blob.size,bitrate,errors:errors.length});
chunks=[];
}
function finish(reason){
if(finished)return;
finished=true;
const completed=reason==="Completed";
result.style.display="block";
result.insertAdjacentHTML("afterbegin","<div><b>"+(completed?"All recording tests completed":"Test stopped: "+reason)+"</b><br>Tests completed: "+results.length+"/"+codecs.length+"<br>Requested capture: 1920×1080 at 15 FPS<br>Recording duration: up to "+DURATION+" seconds per codec</div><br>");
bar.style.width=completed?"100%":bar.style.width;
cleanup();report(completed?null:reason);
}
startBtn.onclick=async()=>{
try{
finished=false;stopRequested=false;results=[];rows.innerHTML="";result.style.display="none";bar.style.width="0%";
for(const id of ["codec","resolution"])document.getElementById(id).textContent="-";
for(const id of ["chunks","output","bitrate","errors"])document.getElementById(id).textContent="0";
document.getElementById("elapsed").textContent="0s";document.getElementById("state").textContent="Starting";
startBtn.disabled=true;stopBtn.disabled=true;
if(!navigator.mediaDevices?.getDisplayMedia)throw new Error("Screen capture is unavailable.");
if(!window.MediaRecorder)throw new Error("MediaRecorder is unavailable in this Edge browser.");
stream=await navigator.mediaDevices.getDisplayMedia({video:{width:{ideal:RES.width},height:{ideal:RES.height},frameRate:{ideal:15,max:15}},audio:false});
track=stream.getVideoTracks()[0];
active=true;started=performance.now();stopBtn.disabled=false;
track.addEventListener("ended",()=>{if(active)finish("Screen sharing ended")},{once:true});
uiTimer=setInterval(update,250);
for(let i=0;i<codecs.length&&active&&!stopRequested;i++)await runCodec(codecs[i],i+1);
if(active)finish(stopRequested?"Stopped manually":"Completed");
}catch(error){finish(error.message||String(error))}
};
stopBtn.onclick=()=>{
stopRequested=true;
if(activeRecorder&&activeRecorder.state!=="inactive"){
try{activeRecorder.stop()}catch(e){}
}else finish("Stopped manually");
};
</script>
</body>
</html>`;
function attach(app,express){
let status={running:false,connected:false,width:0,height:0,error:null};
app.get("/capture",(req,res)=>{res.type("html").send(page())});
app.get("/api/capture/status",(req,res)=>res.json(status));
app.post("/api/capture/status",express.json(),(req,res)=>{
status={...status,...(req.body||{})};
res.json({ok:true});
});
}
module.exports={attach};
