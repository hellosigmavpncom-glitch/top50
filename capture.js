
const page=()=>`<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Edge Capture Bottleneck Benchmark</title>
<style>
*{box-sizing:border-box}body{margin:0;padding:24px;background:#090b12;color:#e8eaf2;font-family:Arial,sans-serif}.wrap{max-width:1100px;margin:auto}h1{font-size:25px;margin:0 0 8px}.muted{color:#9298aa;font-size:13px}button{background:#7187ff;color:white;border:0;border-radius:8px;padding:12px 20px;font-weight:bold;cursor:pointer;margin:16px 8px 16px 0}button:disabled{opacity:.4;cursor:not-allowed}#stop{background:#33394b}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;margin-top:16px}.card{background:#151925;border:1px solid #252c3c;border-radius:10px;padding:15px}.label{font-size:11px;color:#9298aa;text-transform:uppercase;letter-spacing:.6px}.value{font-size:23px;font-weight:bold;margin-top:8px}.progress{height:8px;background:#252c3c;border-radius:10px;overflow:hidden;margin-top:16px}.bar{height:100%;width:0;background:#7187ff}#result{background:#151925;border:1px solid #252c3c;border-radius:10px;padding:18px;margin-top:16px;line-height:1.8;display:none;overflow-x:auto}table{width:100%;border-collapse:collapse;margin-top:14px;font-size:12px;min-width:1100px}th,td{text-align:left;padding:10px 8px;border-bottom:1px solid #252c3c;white-space:nowrap}th{color:#9298aa;font-size:10px;text-transform:uppercase}.good{color:#70dba0}.bad{color:#ff8585}
</style>
</head>
<body>
<div class="wrap">
<h1>Edge Capture Bottleneck Benchmark</h1>
<div class="muted">1920×1080 requested · 15 FPS · H.264 WebCodecs · 30s capture only + 30s capture and encoding</div>
<button id="start">START DIAGNOSTIC TEST</button>
<button id="stop" disabled>STOP TEST</button>
<div class="progress"><div class="bar" id="bar"></div></div>
<div class="grid">
<div class="card"><div class="label">Current Phase</div><div class="value" id="phase">-</div></div>
<div class="card"><div class="label">Encoder State</div><div class="value" id="state">Inactive</div></div>
<div class="card"><div class="label">Actual Resolution</div><div class="value" id="resolution">-</div></div>
<div class="card"><div class="label">Elapsed</div><div class="value" id="elapsed">0s</div></div>
<div class="card"><div class="label">Captured FPS</div><div class="value" id="capturefps">0</div></div>
<div class="card"><div class="label">Encoded FPS</div><div class="value" id="encodedfps">0</div></div>
<div class="card"><div class="label">Encoded Frames</div><div class="value" id="frames">0</div></div>
<div class="card"><div class="label">Encoded Output</div><div class="value" id="output">0 MB</div></div>
<div class="card"><div class="label">Output Bitrate</div><div class="value" id="bitrate">0 kbps</div></div>
<div class="card"><div class="label">Avg Encode Latency</div><div class="value" id="latency">0 ms</div></div>
<div class="card"><div class="label">Max Encoder Queue</div><div class="value" id="queue">0</div></div>
<div class="card"><div class="label">Encoding Errors</div><div class="value" id="errors">0</div></div>
</div>
<div id="result">
<b>Capture bottleneck comparison</b>
<table>
<thead><tr><th>Phase</th><th>Duration</th><th>Captured</th><th>Capture FPS</th><th>Source FPS</th><th>Avg Frame Gap</th><th>Max Frame Gap</th><th>Encoded</th><th>Output</th><th>Bitrate</th><th>Avg Latency</th><th>Avg Encode Call</th><th>Max Queue</th></tr></thead>
<tbody id="rows"></tbody>
</table>
</div>
</div>
<script>
const $=id=>document.getElementById(id);
const startBtn=$("start"),stopBtn=$("stop"),bar=$("bar"),result=$("result"),rows=$("rows");
const RES={width:1920,height:1080},PHASE_DURATION=30,DURATION=60,FPS=15,BITRATE=2500000,CODEC="avc1.42002a";
let stream=null,track=null,reader=null,encoder=null,active=false,started=0,uiTimer=null,stopTimer=null,stopReason="Completed",finished=false,errors=[],maxQueue=0,phases=[];
const escapeHTML=value=>String(value).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const elapsed=()=>started?Math.max(0,(performance.now()-started)/1000):0;
function newPhase(name){return{name,frames:0,encoded:0,bytes:0,previousTimestamp:null,previousArrival:null,timestampGaps:[],arrivalGaps:[],latencies:[],encodeCalls:[],pending:new Map(),maxQueue:0}}
function report(error,extra={}){
const s=track?.getSettings()||{};
fetch("/api/capture/status",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({running:active,connected:!!stream,width:s.width||0,height:s.height||0,error:error||null,...extra})}).catch(()=>{});
}
function requestStop(reason){
if(!active)return;
active=false;stopReason=reason;stopBtn.disabled=true;$("state").textContent="Finishing";
if(reader)reader.cancel().catch(()=>{});
}
function update(){
if(!started)return;
const seconds=elapsed(),phaseIndex=seconds>=PHASE_DURATION?1:0,p=phases[phaseIndex];
$("elapsed").textContent=seconds.toFixed(1)+"s";
$("capturefps").textContent=(p.frames/Math.max(.001,Math.min(PHASE_DURATION,seconds-phaseIndex*PHASE_DURATION))).toFixed(1);
$("encodedfps").textContent=(p.encoded/Math.max(.001,Math.min(PHASE_DURATION,seconds-PHASE_DURATION))).toFixed(1);
$("frames").textContent=phases.reduce((n,p)=>n+p.encoded,0);
$("output").textContent=(phases.reduce((n,p)=>n+p.bytes,0)/1048576).toFixed(2)+" MB";
$("bitrate").textContent=(phases.reduce((n,p)=>n+p.bytes,0)*8/Math.max(.001,seconds)/1000).toFixed(0)+" kbps";
const latencies=phases.flatMap(p=>p.latencies);
$("latency").textContent=(latencies.length?latencies.reduce((a,b)=>a+b,0)/latencies.length:0).toFixed(1)+" ms";
$("queue").textContent=maxQueue;
$("errors").textContent=errors.length;
$("phase").textContent=phaseIndex?"Capture + Encode":"Capture Only";
$("state").textContent=phaseIndex?"Encoding":"Capturing";
bar.style.width=Math.min(100,seconds/DURATION*100)+"%";
}
function encoderOutput(chunk){
const p=phases[1];
p.encoded++;p.bytes+=chunk.byteLength;
const submitted=p.pending.get(chunk.timestamp);
if(submitted!==undefined){p.latencies.push(performance.now()-submitted);p.pending.delete(chunk.timestamp)}
}
function encoderError(error){errors.push(error.message||String(error));$("errors").textContent=errors.length}
async function captureLoop(){
while(active){
const item=await reader.read();
if(item.done||!active)break;
const frame=item.value;
try{
const seconds=elapsed(),index=seconds>=PHASE_DURATION?1:0,p=phases[index],now=performance.now();
p.frames++;
if(p.previousTimestamp!==null&&frame.timestamp>p.previousTimestamp)p.timestampGaps.push((frame.timestamp-p.previousTimestamp)/1000);
if(p.previousArrival!==null)p.arrivalGaps.push(now-p.previousArrival);
p.previousTimestamp=frame.timestamp;p.previousArrival=now;
if(index===1){
const before=performance.now();
p.pending.set(frame.timestamp,now);
encoder.encode(frame,{keyFrame:p.encoded===0||p.encoded%30===0});
p.encodeCalls.push(performance.now()-before);
maxQueue=Math.max(maxQueue,encoder.encodeQueueSize);
p.maxQueue=Math.max(p.maxQueue,encoder.encodeQueueSize);
}
}catch(error){errors.push(error.message||String(error))}
finally{frame.close()}
}
}
function average(a){return a.length?a.reduce((x,y)=>x+y,0)/a.length:0}
function maximum(a){return a.length?Math.max(...a):0}
function finish(){
if(finished)return;
finished=true;clearInterval(uiTimer);clearTimeout(stopTimer);
const seconds=elapsed(),settings=track?.getSettings()||{},resolution=(settings.width||0)+"×"+(settings.height||0);
const durations=[Math.min(PHASE_DURATION,seconds),Math.max(0,seconds-PHASE_DURATION)];
for(let i=0;i<2;i++){
const p=phases[i],duration=Math.max(.001,durations[i]),fps=p.frames/duration,sourceFPS=p.timestampGaps.length?1000/average(p.timestampGaps):0;
const bitrate=p.bytes*8/duration/1000;
const tr=document.createElement("tr");
tr.innerHTML="<td>"+p.name+"</td><td>"+duration.toFixed(1)+"s</td><td>"+p.frames+"</td><td>"+fps.toFixed(2)+"</td><td>"+sourceFPS.toFixed(2)+"</td><td>"+average(p.arrivalGaps).toFixed(0)+" ms</td><td>"+maximum(p.arrivalGaps).toFixed(0)+" ms</td><td>"+p.encoded+"</td><td>"+(p.bytes/1048576).toFixed(2)+" MB</td><td>"+bitrate.toFixed(0)+" kbps</td><td>"+average(p.latencies).toFixed(1)+" ms</td><td>"+average(p.encodeCalls).toFixed(2)+" ms</td><td>"+p.maxQueue+"</td>";
rows.appendChild(tr);
}
const status=errors.length?"ERROR":phases[1].encoded?"ENCODED":"NO OUTPUT";
$("state").textContent=status;$("phase").textContent="Finished";
$("resolution").textContent=resolution;
bar.style.width=stopReason==="Completed"?"100%":bar.style.width;
result.style.display="block";
result.insertAdjacentHTML("afterbegin","<div><b>"+(stopReason==="Completed"?"60-second diagnostic completed":"Test stopped: "+escapeHTML(stopReason))+"</b><br>Requested capture: 1920×1080 at 15 FPS<br>First phase: 30 seconds capture only<br>Second phase: 30 seconds capture + H.264 encoding<br>Actual resolution: "+resolution+"</div><br>");
report(errors.join("; ")||null,{codec:"H.264 WebCodecs diagnostic",errors:errors.length,captureOnlyFPS:phases[0].frames/Math.max(.001,durations[0]),captureEncodeFPS:phases[1].frames/Math.max(.001,durations[1]),encoded:phases[1].encoded});
try{if(encoder&&encoder.state==="configured")encoder.close()}catch(e){}
if(stream)stream.getTracks().forEach(t=>t.stop());
stream=null;track=null;reader=null;encoder=null;active=false;
startBtn.disabled=false;stopBtn.disabled=true;
}
startBtn.onclick=async()=>{
try{
finished=false;stopReason="Completed";errors=[];maxQueue=0;phases=[newPhase("Capture only"),newPhase("Capture + H.264")];
rows.innerHTML="";result.style.display="none";bar.style.width="0%";
for(const id of ["phase","resolution"])$(id).textContent="-";
for(const id of ["capturefps","encodedfps","frames","output","bitrate","latency","queue","errors"])$(id).textContent="0";
$("elapsed").textContent="0s";$("state").textContent="Starting";
startBtn.disabled=true;stopBtn.disabled=true;
if(!navigator.mediaDevices?.getDisplayMedia)throw new Error("Screen capture is unavailable.");
if(typeof VideoEncoder==="undefined"||typeof VideoFrame==="undefined")throw new Error("WebCodecs is unavailable.");
if(typeof MediaStreamTrackProcessor==="undefined")throw new Error("MediaStreamTrackProcessor is unavailable.");
stream=await navigator.mediaDevices.getDisplayMedia({video:{width:{ideal:RES.width},height:{ideal:RES.height},frameRate:{ideal:FPS,max:FPS}},audio:false});
track=stream.getVideoTracks()[0];
const settings=track.getSettings(),width=settings.width||RES.width,height=settings.height||RES.height;
$("resolution").textContent=width+"×"+height;
const config={codec:CODEC,width,height,bitrate:BITRATE,framerate:FPS,latencyMode:"realtime",hardwareAcceleration:"no-preference"};
const support=await VideoEncoder.isConfigSupported(config);
if(!support.supported)throw new Error("H.264 WebCodecs configuration is not supported.");
encoder=new VideoEncoder({output:encoderOutput,error:encoderError});
encoder.configure(support.config);
const processor=new MediaStreamTrackProcessor({track});
reader=processor.readable.getReader();
active=true;started=performance.now();
$("phase").textContent="Capture Only";$("state").textContent="Capturing";
stopBtn.disabled=false;
track.addEventListener("ended",()=>requestStop("Screen sharing ended"),{once:true});
uiTimer=setInterval(update,250);
stopTimer=setTimeout(()=>requestStop("Completed"),DURATION*1000);
await captureLoop();
clearTimeout(stopTimer);
$("state").textContent="Flushing encoder";
if(encoder.state==="configured")await encoder.flush();
finish();
}catch(error){
errors.push(error.message||String(error));stopReason=error.message||String(error);active=false;
try{if(reader)await reader.cancel()}catch(e){}
try{if(encoder&&encoder.state==="configured")await encoder.flush()}catch(e){errors.push(e.message||String(e))}
finish();
}
};
stopBtn.onclick=()=>requestStop("Stopped manually");
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
