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
let stream=null,track=null,worker=null,active=false,started=0,uiTimer=null,settings={};
function report(error,fps,frames){
fetch("/api/capture/status",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({running:active,connected:!!stream,fps:fps||0,width:settings.width||0,height:settings.height||0,frames:frames||0,droppedFrames:0,error:error||null})}).catch(()=>{});
}
function cleanup(){
clearInterval(uiTimer);
if(stream)stream.getTracks().forEach(t=>t.stop());
if(worker){worker.terminate();worker=null}
stream=null;track=null;active=false;
startBtn.disabled=false;stopBtn.disabled=true;
}
function showError(message){
result.innerHTML="<b>Test failed</b><br>"+String(message);
result.style.display="block";
cleanup();report(String(message),0,0);
}
const workerCode=[
"let reader=null,active=false,finished=false,frames=0,started=0,lastSample=0,lastFrames=0,samples=[],sampleTimer=null,endTimer=null;",
"function finish(reason){if(finished)return;finished=true;active=false;clearInterval(sampleTimer);clearTimeout(endTimer);const elapsed=(performance.now()-started)/1000;const avg=frames/Math.max(.001,elapsed);const min=samples.length?Math.min(...samples):0;const max=samples.length?Math.max(...samples):0;const consistency=samples.length?samples.filter(v=>Math.abs(v-15)<=1.5).length/samples.length*100:0;self.postMessage({type:'finish',reason:reason,elapsed:elapsed,frames:frames,average:avg,min:min,max:max,consistency:consistency,samples:samples});if(reader)reader.cancel().catch(()=>{});}",
"self.onmessage=async function(e){if(e.data.stop){finish('Stopped manually');return;}const track=e.data.track;try{if(typeof MediaStreamTrackProcessor==='undefined')throw new Error('MediaStreamTrackProcessor is not available in the capture worker.');const processor=new MediaStreamTrackProcessor({track:track});reader=processor.readable.getReader();active=true;started=performance.now();lastSample=started;self.postMessage({type:'ready'});sampleTimer=setInterval(function(){if(!active)return;const now=performance.now();const seconds=(now-lastSample)/1000;const fps=(frames-lastFrames)/Math.max(.001,seconds);samples.push(fps);self.postMessage({type:'sample',fps:fps,frames:frames,elapsed:(now-started)/1000});lastSample=now;lastFrames=frames;},5000);endTimer=setTimeout(function(){finish('Completed');},60000);while(active){const item=await reader.read();if(item.done)break;frames++;item.value.close();}if(!finished)finish('Capture track ended');}catch(error){if(!finished)finish('Error: '+(error.message||String(error)));}};"
].join("");
startBtn.onclick=async()=>{
try{
result.style.display="none";startBtn.disabled=true;stopBtn.disabled=false;
document.getElementById("fps").textContent="0";
document.getElementById("average").textContent="0";
document.getElementById("frames").textContent="0";
document.getElementById("minimum").textContent="-";
document.getElementById("maximum").textContent="-";
document.getElementById("consistency").textContent="-";
bar.style.width="0%";
stream=await navigator.mediaDevices.getDisplayMedia({video:{width:{ideal:1280},height:{ideal:720},frameRate:{ideal:FPS,max:FPS}},audio:false});
track=stream.getVideoTracks()[0];
settings=track.getSettings();
document.getElementById("resolution").textContent=(settings.width||0)+" × "+(settings.height||0);
const blob=new Blob([workerCode],{type:"text/javascript"});
const workerUrl=URL.createObjectURL(blob);
worker=new Worker(workerUrl);
URL.revokeObjectURL(workerUrl);
active=true;started=performance.now();
worker.onmessage=e=>{
const data=e.data;
if(data.type==="ready"){result.style.display="none";report(null,0,0)}
if(data.type==="sample"){
document.getElementById("fps").textContent=data.fps.toFixed(2);
document.getElementById("frames").textContent=data.frames.toLocaleString();
document.getElementById("average").textContent=(data.frames/Math.max(.001,data.elapsed)).toFixed(2);
document.getElementById("elapsed").textContent=data.elapsed.toFixed(1)+"s";
bar.style.width=Math.min(100,data.elapsed/DURATION*100)+"%";
report(null,data.frames/Math.max(.001,data.elapsed),data.frames);
}
if(data.type==="finish"){
const completed=data.reason==="Completed";
document.getElementById("fps").textContent=data.average.toFixed(2);
document.getElementById("average").textContent=data.average.toFixed(2);
document.getElementById("frames").textContent=data.frames.toLocaleString();
document.getElementById("elapsed").textContent=data.elapsed.toFixed(1)+"s";
document.getElementById("minimum").textContent=data.min.toFixed(2);
document.getElementById("maximum").textContent=data.max.toFixed(2);
document.getElementById("consistency").textContent=data.consistency.toFixed(1)+"%";
bar.style.width=Math.min(100,data.elapsed/DURATION*100)+"%";
result.innerHTML=(completed?"<b>60-second capture-track benchmark completed</b>":"<b>Test ended early: "+data.reason+"</b>")+"<br>Average capture-track FPS: "+data.average.toFixed(2)+"<br>Target FPS: "+FPS+"<br>Minimum 5-second FPS: "+data.min.toFixed(2)+"<br>Maximum 5-second FPS: "+data.max.toFixed(2)+"<br>FPS consistency: "+data.consistency.toFixed(1)+"%<br>Total frames received: "+data.frames.toLocaleString()+"<br>Elapsed: "+data.elapsed.toFixed(1)+" seconds<br><br>These are frames received directly from MediaStreamTrackProcessor, not video-preview frames.";
result.style.display="block";
const finalFps=data.average,finalFrames=data.frames;
cleanup();report(completed?null:data.reason,finalFps,finalFrames);
}
};
worker.onerror=e=>showError(e.message||"Capture worker failed");
track.addEventListener("ended",()=>{if(worker)worker.postMessage({stop:true})},{once:true});
worker.postMessage({track:track},[track]);
uiTimer=setInterval(()=>{
if(!active)return;
const elapsed=(performance.now()-started)/1000;
document.getElementById("elapsed").textContent=elapsed.toFixed(1)+"s";
},250);
report(null,0,0);
}catch(error){showError(error.message||String(error))}
};
stopBtn.onclick=()=>{if(worker)worker.postMessage({stop:true})};
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
