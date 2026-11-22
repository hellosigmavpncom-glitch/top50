
const {chromium}=require("playwright");
const URL="https://zhong-vs-fede.onrender.com/";
const WIDTH=1600,HEIGHT=900,FPS=15,BENCHMARK_MS=30000;
let browser=null,context=null,page=null,cdp=null,starting=false,closed=false,monitor=null,recording=null;
let startedAt=0,benchmarkDone=false,recordingBuffer=null;
let status={running:false,connected:false,url:URL,browser:null,title:null,width:WIDTH,height:HEIGHT,fps:FPS,codec:"AV1",error:null,started:null,metrics:null,benchmark:null};

const delay=ms=>new Promise(r=>setTimeout(r,ms));

async function readStream(handle){
 const chunks=[];
 let total=0;
 for(;;){
  const result=await cdp.send("IO.read",{handle,size:1048576});
  const chunk=Buffer.from(result.data,result.base64Encoded?"base64":"utf8");
  chunks.push(chunk);
  total+=chunk.length;
  if(result.eof)break;
 }
 await cdp.send("IO.close",{handle}).catch(()=>{});
 return{buffer:Buffer.concat(chunks,total),bytes:total};
}

async function start(){
 if(starting||browser||closed)return;
 starting=true;
 status.error=null;
 try{
  browser=await chromium.launch({headless:true,args:["--no-sandbox","--disable-dev-shm-usage","--disable-gpu","--autoplay-policy=no-user-gesture-required"]});
  context=await browser.newContext({viewport:{width:WIDTH,height:HEIGHT},deviceScaleFactor:1});
  page=await context.newPage();
  page.setDefaultNavigationTimeout(60000);
  page.on("crash",()=>{status.connected=false;status.running=false;status.error="Browser page crashed";});
  browser.on("disconnected",()=>{
   status.connected=false;status.running=false;status.error="Chromium disconnected";
   browser=null;context=null;page=null;cdp=null;clearInterval(monitor);monitor=null;
  });

  await page.goto(URL,{waitUntil:"domcontentloaded",timeout:60000});
  await page.waitForTimeout(5000);

  const info=await page.evaluate(()=>({
   title:document.title,url:location.href,width:innerWidth,height:innerHeight
  }));

  cdp=await context.newCDPSession(page);
  const result=await cdp.send("Page.startScreenRecording",{
   maxWidth:WIDTH,maxHeight:HEIGHT,frameRate:FPS,audio:false
  });

  if(!result.stream)throw Error("Native recorder did not return a stream handle");

  recording=result.stream;
  startedAt=Date.now();
  status={...status,running:true,connected:true,browser:browser.version(),title:info.title,width:info.width,height:info.height,started:new Date().toISOString(),error:null,metrics:{phase:"Recording",elapsedSeconds:0},benchmark:null};
  console.log("[CAPTURE] Native recording started:",JSON.stringify(status));
  monitor=setInterval(updateMetrics,1000);

  await delay(BENCHMARK_MS);
  if(closed||!cdp)return;

  status.metrics={...status.metrics,phase:"Finalizing"};
  const stopped=await cdp.send("Page.stopScreenRecording");
  const stream=stopped.stream||recording;
  const output=await readStream(stream);
  recording=null;
  recordingBuffer=output.buffer;

  const elapsed=(Date.now()-startedAt)/1000;
  const header=recordingBuffer.subarray(0,32).toString("latin1");
  const hasFtyp=header.includes("ftyp");
  const hasAv1=recordingBuffer.includes(Buffer.from("av01"));
  const hasMp4=hasFtyp&&recordingBuffer.length>1000;

  status.running=false;
  status.benchmark={
   durationSeconds:Number(elapsed.toFixed(1)),
   requestedWidth:WIDTH,
   requestedHeight:HEIGHT,
   requestedFps:FPS,
   fileBytes:output.bytes,
   fileSizeMB:Number((output.bytes/1048576).toFixed(2)),
   bitrateKbps:Number((output.bytes*8/elapsed/1000).toFixed(1)),
   mp4Container:hasMp4,
   av1CodecMarker:hasAv1,
   recordingValid:hasMp4&&hasAv1,
   frameCount:null,
   framesNote:"Native recording does not expose frame counts through this CDP command.",
   downloadEndpoint:"/api/capture/recording.mp4"
  };
  status.metrics={phase:"Finished",...status.benchmark};
  benchmarkDone=true;
  console.log("[CAPTURE] Native 30-second benchmark:",JSON.stringify(status.benchmark));
 }catch(e){
  status.running=false;
  status.error=e.message||String(e);
  console.error("[CAPTURE]",status.error);
 }finally{
  clearInterval(monitor);
  monitor=null;
  starting=false;
 }
}

async function updateMetrics(){
 if(!page||page.isClosed()||closed||benchmarkDone)return;
 const elapsed=(Date.now()-startedAt)/1000;
 status.metrics={phase:"Recording",elapsedSeconds:Number(elapsed.toFixed(1)),targetSeconds:30};
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
 app.get("/api/capture/recording.mp4",(req,res)=>{
  if(!recordingBuffer)return res.status(404).json({error:"Native recording is not ready yet",status});
  res.set({"Content-Type":"video/mp4","Content-Length":recordingBuffer.length,"Content-Disposition":"attachment; filename=native-capture.mp4","Cache-Control":"no-store"});
  res.send(recordingBuffer);
 });
 start();
}

async function close(){
 closed=true;
 clearInterval(monitor);
 monitor=null;
 if(cdp&&recording){
  try{await cdp.send("Page.stopScreenRecording");}catch(e){}
  try{await cdp.send("IO.close",{handle:recording});}catch(e){}
  recording=null;
 }
 if(cdp){try{await cdp.detach();}catch(e){}}
 if(browser){try{await browser.close();}catch(e){}}
 browser=null;context=null;page=null;cdp=null;
 status.running=false;status.connected=false;
}

module.exports={attach,close};
