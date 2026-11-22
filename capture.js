
const {chromium}=require("playwright");
const URL="https://zhong-vs-fede.onrender.com/";
let browser=null,context=null,page=null,starting=false,closed=false;
let status={running:false,connected:false,url:URL,browser:null,title:null,width:1600,height:900,h264:null,error:null,started:null};
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function start(){
if(starting||browser||closed)return;
starting=true;status.error=null;
try{
browser=await chromium.launch({headless:true,args:["--no-sandbox","--disable-dev-shm-usage","--disable-gpu","--autoplay-policy=no-user-gesture-required"]});
context=await browser.newContext({viewport:{width:1600,height:900},deviceScaleFactor:1});
page=await context.newPage();
page.setDefaultNavigationTimeout(60000);
page.on("crash",()=>{status.connected=false;status.running=false;status.error="Browser page crashed";});
browser.on("disconnected",()=>{status.connected=false;status.running=false;status.error="Chromium disconnected";browser=null;context=null;page=null;});
await page.goto(URL,{waitUntil:"domcontentloaded",timeout:60000});
await page.waitForTimeout(5000);
const info=await page.evaluate(async()=>{
let h264=false,reason=null;
try{
if(typeof VideoEncoder==="undefined")reason="VideoEncoder unavailable";
else h264=(await VideoEncoder.isConfigSupported({codec:"avc1.42002a",width:1600,height:900,bitrate:2500000,framerate:15,latencyMode:"realtime"})).supported;
}catch(e){reason=e.message;}
return{title:document.title,url:location.href,width:innerWidth,height:innerHeight,videoEncoder:typeof VideoEncoder!=="undefined",h264,reason};
});
status={...status,running:true,connected:true,browser:browser.version(),title:info.title,width:info.width,height:info.height,h264:info.h264,encoderInfo:info,started:new Date().toISOString(),error:null};
console.log("[CAPTURE] Chromium ready:",JSON.stringify(status));
}catch(e){
status.running=false;status.connected=false;status.error=e.message||String(e);
console.error("[CAPTURE]",status.error);
if(browser){try{await browser.close()}catch(x){}}
browser=null;context=null;page=null;
}finally{starting=false;}
}
function attach(app,express){
app.get("/api/capture/status",(req,res)=>res.set("Cache-Control","no-store").json(status));
app.get("/api/capture/screenshot.jpg",async(req,res)=>{
try{
if(!page||page.isClosed())return res.status(503).json({error:"Capture browser is not ready",status});
const shot=await page.screenshot({type:"jpeg",quality:70});
res.set({"Content-Type":"image/jpeg","Cache-Control":"no-store"}).send(shot);
}catch(e){res.status(500).json({error:e.message});}
});
app.post("/api/capture/restart",async(req,res)=>{
if(browser){try{await browser.close()}catch(e){}}
browser=null;context=null;page=null;status.running=false;status.connected=false;
start().then(()=>console.log("[CAPTURE] Restart finished"));
res.json({ok:true,restarting:true});
});
start();
}
async function close(){
closed=true;
if(browser){try{await browser.close()}catch(e){}}
browser=null;context=null;page=null;status.running=false;status.connected=false;
}
module.exports={attach,close};
