
const WIDTH=1280,HEIGHT=720,FPS=15;
const WHIP_URL=process.env.WHIP_URL||"";
const now=()=>new Date().toLocaleTimeString();
const log=(s,d)=>console.log(`[CAPTURE ${now()}] ${s}`,d===undefined?"":JSON.stringify(d));

let status={running:false,connected:false,width:WIDTH,height:HEIGHT,fps:FPS,started:null,error:null};
let attached=false;

const html=()=>`<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Dashboard Live Capture</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#101116;color:#eee;font:15px Arial;padding:24px}main{max-width:850px;margin:auto}h1{font-size:25px}p{color:#aaa}video{width:100%;background:#050505;border-radius:12px;margin-top:15px}button{padding:12px 20px;border:0;border-radius:8px;font-weight:bold;cursor:pointer;margin:12px 8px 0 0}#start{background:#45c878;color:#07150c}#stop{background:#ed5555;color:white}#status{padding:14px;background:#20232b;border-radius:9px;margin-top:16px}small{color:#999}button:disabled{opacity:.4;cursor:default}
</style>
</head>
<body>
<main>
<h1>Dashboard Live Capture</h1>
<p>Capture your dashboard tab and publish it to the configured WHIP streaming server.</p>
<video id="preview" autoplay muted playsinline></video>
<div><button id="start">START CAPTURE</button><button id="stop" disabled>STOP CAPTURE</button></div>
<div id="status">Status: Waiting</div>
<p><small>Choose your dashboard tab in Edge's screen-sharing picker.</small></p>
</main>
<script>
const WHIP_URL=${JSON.stringify(WHIP_URL).replace(/</g,"\\u003c")};
const preview=document.getElementById("preview");
const output=document.getElementById("status");
const startButton=document.getElementById("start");
const stopButton=document.getElementById("stop");
let stream=null,pc=null,sessionUrl=null,started=false;

function show(s){output.textContent="Status: "+s;}
async function report(running,connected,error=null){
 try{await fetch("/api/capture/status",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({running,connected,error})});}catch(e){}
}
function waitIce(){
 return new Promise(resolve=>{
  if(pc.iceGatheringState==="complete")return resolve();
  const timer=setTimeout(resolve,15000);
  pc.addEventListener("icegatheringstatechange",()=>{
   if(pc.iceGatheringState==="complete"){clearTimeout(timer);resolve();}
  });
 });
}
async function stop(){
 started=false;
 if(sessionUrl)await fetch(sessionUrl,{method:"DELETE"}).catch(()=>{});
 if(pc){pc.close();pc=null;}
 if(stream){stream.getTracks().forEach(t=>t.stop());stream=null;}
 preview.srcObject=null;sessionUrl=null;
 startButton.disabled=false;stopButton.disabled=true;
 show("Stopped");await report(false,false);
}
async function begin(){
 if(started)return;
 if(!WHIP_URL)throw Error("WHIP_URL is not configured on the server");
 if(!navigator.mediaDevices?.getDisplayMedia)throw Error("This browser does not support screen capture");
 started=true;startButton.disabled=true;
 try{
  show("Waiting for screen selection...");
  stream=await navigator.mediaDevices.getDisplayMedia({video:{width:{ideal:${WIDTH}},height:{ideal:${HEIGHT}},frameRate:{ideal:${FPS},max:${FPS}}},audio:false});
  preview.srcObject=stream;await preview.play();
  stream.getVideoTracks()[0].addEventListener("ended",()=>stop());
  show("Connecting to streaming server...");
  pc=new RTCPeerConnection({iceServers:[{urls:"stun:stun.l.google.com:19302"}]});
  stream.getTracks().forEach(track=>pc.addTrack(track,stream));
  pc.onconnectionstatechange=()=>{
   show("WebRTC: "+pc.connectionState);
   if(pc.connectionState==="connected")report(true,true);
   if(["failed","disconnected","closed"].includes(pc.connectionState))report(false,false,"Connection "+pc.connectionState);
  };
  const offer=await pc.createOffer();
  await pc.setLocalDescription(offer);
  await waitIce();
  const response=await fetch(WHIP_URL,{method:"POST",headers:{"Content-Type":"application/sdp"},body:pc.localDescription.sdp});
  if(!response.ok)throw Error("WHIP HTTP "+response.status+": "+(await response.text()).slice(0,250));
  const answer=await response.text();
  sessionUrl=response.headers.get("Location");
  if(sessionUrl&&!/^https?:\\/\\//i.test(sessionUrl))sessionUrl=new URL(sessionUrl,WHIP_URL).href;
  await pc.setRemoteDescription({type:"answer",sdp:answer});
  stopButton.disabled=false;
  show("Publishing — waiting for WebRTC connection...");
  log("WHIP SESSION CREATED");
 }catch(e){
  log("CAPTURE FAILED",e.message);
  await report(false,false,e.message);
  await stop();
  show("ERROR: "+e.message);
 }
}
startButton.addEventListener("click",begin);
stopButton.addEventListener("click",stop);
window.addEventListener("beforeunload",()=>{if(pc)pc.close();});
</script>
</body>
</html>`;

function attach(app,express){
 if(attached)throw Error("Capture routes already attached");
 attached=true;
 app.get("/capture",(q,r)=>r.set("Cache-Control","no-store").type("html").send(html()));
 app.get("/api/capture/status",(q,r)=>r.set("Cache-Control","no-store").json(getStatus()));
 app.post("/api/capture/status",express.json({limit:"2kb"}),(q,r)=>{
  const b=q.body||{};
  status={...status,running:!!b.running,connected:!!b.connected,error:typeof b.error==="string"?b.error:null};
  if(status.running&&!status.started)status.started=Date.now();
  if(!status.running)status.started=null;
  log("STATUS UPDATE",status);
  r.json({ok:true,status:getStatus()});
 });
 log("CAPTURE ROUTES ATTACHED",{width:WIDTH,height:HEIGHT,fps:FPS,whipConfigured:!!WHIP_URL});
}

function getStatus(){
 return {...status,elapsed:status.started?Date.now()-status.started:0,method:"Edge getDisplayMedia → WebRTC WHIP"};
}

function close(){
 status={...status,running:false,connected:false,started:null};
 log("CAPTURE MODULE CLOSED");
}

module.exports={attach,getStatus,close};
