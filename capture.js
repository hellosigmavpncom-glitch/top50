
const puppeteer=require("puppeteer");
const WIDTH=640,HEIGHT=360,FPS=30,BITRATE=900000,MAX_BYTES=16*1024*1024;
let browser,dashboard,recorder,cdp,listener,running=false,drawing=false,pending=null,resolveFirst=null,started=0,sourceFrames=0,paintedFrames=0,dropped=0,outputBytes=0,chunks=[],error=null,overflow=false,trackSettings=null;

const sleep=ms=>new Promise(r=>setTimeout(r,ms));

async function initialize(){
  if(browser)return;
  browser=await puppeteer.launch({headless:true,executablePath:puppeteer.executablePath(),args:["--no-sandbox","--disable-setuid-sandbox","--disable-dev-shm-usage","--disable-gpu","--disable-background-timer-throttling","--disable-renderer-backgrounding","--disable-backgrounding-occluded-windows","--renderer-process-limit=2","--disable-extensions"]});
  dashboard=await browser.newPage();
  await dashboard.setViewport({width:WIDTH,height:HEIGHT,deviceScaleFactor:1});
  await dashboard.goto(process.env.DASHBOARD_URL||"https://zhong-vs-fede.onrender.com/",{waitUntil:"domcontentloaded",timeout:60000});
  await sleep(3000);
  recorder=await browser.newPage();
  await recorder.setViewport({width:WIDTH,height:HEIGHT});
  await recorder.exposeFunction("__captureChunk",base64=>{
    if(overflow)return;
    const chunk=Buffer.from(base64,"base64");
    if(outputBytes+chunk.length>MAX_BYTES){overflow=true;error="Recording reached the 16 MB safety limit";return;}
    chunks.push(chunk);outputBytes+=chunk.length;
  });
  await recorder.setContent("<!doctype html><html><body style='margin:0;background:#000'></body></html>");
  await recorder.evaluate(({w,h,fps,bitrate})=>{
    const source=document.createElement("canvas"),output=document.createElement("canvas");
    source.width=output.width=w;source.height=output.height=h;
    const sctx=source.getContext("2d",{alpha:false}),octx=output.getContext("2d",{alpha:false});
    sctx.fillStyle=octx.fillStyle="#000";sctx.fillRect(0,0,w,h);octx.fillRect(0,0,w,h);
    let last=0,stream,rec,jobs=new Set();
    const paint=t=>{if(t-last>=1000/fps){octx.drawImage(source,0,0);last=t;}requestAnimationFrame(paint);};
    requestAnimationFrame(paint);
    window.__capture={
      draw:data=>new Promise((resolve,reject)=>{
        const img=new Image();
        img.onload=()=>{sctx.drawImage(img,0,0,w,h);resolve(true)};
        img.onerror=()=>reject(Error("Frame decode failed"));
        img.src="data:image/jpeg;base64,"+data;
      }),
      start:()=>{
        stream=output.captureStream(fps);
        const type=MediaRecorder.isTypeSupported("video/webm;codecs=vp8")?"video/webm;codecs=vp8":"video/webm";
        rec=new MediaRecorder(stream,{mimeType:type,videoBitsPerSecond:bitrate});
        rec.ondataavailable=e=>{
          if(!e.data.size)return;
          const job=new Promise(resolve=>{
            const reader=new FileReader();
            reader.onload=()=>window.__captureChunk(String(reader.result).split(",")[1]).then(resolve).catch(resolve);
            reader.onerror=resolve;
            reader.readAsDataURL(e.data);
          });
          jobs.add(job);job.finally(()=>jobs.delete(job));
        };
        rec.start(1000);
        return {mimeType:type,track:stream.getVideoTracks()[0].getSettings()};
      },
      stop:()=>new Promise(resolve=>{
        if(!rec||rec.state==="inactive"){resolve(false);return;}
        rec.onstop=async()=>{await Promise.all([...jobs]);stream.getTracks().forEach(t=>t.stop());resolve(true)};
        rec.stop();
      })
    };
  },{w:WIDTH,h:HEIGHT,fps:FPS,bitrate:BITRATE});
}

async function pump(){
  if(drawing)return;
  drawing=true;
  try{
    while(pending){
      const frame=pending;pending=null;
      try{
        await recorder.evaluate(data=>window.__capture.draw(data),frame);
        paintedFrames++;
        if(resolveFirst){resolveFirst();resolveFirst=null;}
      }catch(e){error=e.message;console.error("[CAPTURE FRAME]",e.message);}
    }
  }finally{drawing=false;if(pending)pump();}
}

function getStatus(){
  const elapsed=started?Date.now()-started:0;
  return {running,method:"CDP + Canvas MediaRecorder",width:WIDTH,height:HEIGHT,targetFps:FPS,bitrate:BITRATE,sourceFrames,paintedFrames,dropped,elapsed,fps:elapsed?+(paintedFrames/(elapsed/1000)).toFixed(2):0,track:trackSettings,outputBytes,error};
}

async function startRecording(){
  if(running)throw Error("Recording is already running");
  await initialize();
  chunks=[];outputBytes=0;sourceFrames=paintedFrames=dropped=0;error=null;overflow=false;pending=null;drawing=false;trackSettings=null;
  const settings=await recorder.evaluate(()=>window.__capture.start());
  trackSettings=settings.track;
  started=Date.now();running=true;
  const firstFrame=new Promise(resolve=>{resolveFirst=resolve});
  cdp=await dashboard.createCDPSession();
  await cdp.send("Page.enable");
  listener=params=>{
    sourceFrames++;
    cdp.send("Page.screencastFrameAck",{sessionId:params.sessionId}).catch(()=>{});
    if(pending!==null)dropped++;
    pending=params.data;pump();
  };
  cdp.on("Page.screencastFrame",listener);
  try{
    await cdp.send("Page.startScreencast",{format:"jpeg",quality:55,maxWidth:WIDTH,maxHeight:HEIGHT,everyNthFrame:1});
    await Promise.race([firstFrame,sleep(15000).then(()=>{throw Error("No dashboard frame received within 15 seconds")})]);
  }catch(e){
    error=e.message;running=false;
    try{await cdp.send("Page.stopScreencast")}catch{}
    try{await recorder.evaluate(()=>window.__capture.stop())}catch{}
    throw e;
  }
  console.log(`[CAPTURE] Started | ${WIDTH}x${HEIGHT} | ${FPS} FPS target`);
  return getStatus();
}

async function stopRecording(){
  if(!running)throw Error("No recording is active");
  running=false;
  try{await cdp.send("Page.stopScreencast")}catch{}
  if(listener)cdp.off("Page.screencastFrame",listener);
  while(drawing||pending!==null)await sleep(10);
  await recorder.evaluate(()=>window.__capture.stop());
  const buffer=Buffer.concat(chunks,outputBytes);
  chunks=[];
  if(overflow)throw Error(error);
  if(!buffer.length)throw Error("No recording data was received");
  console.log(`[CAPTURE] Stopped | ${((Date.now()-started)/1000).toFixed(1)}s | ${sourceFrames} source frames | ${paintedFrames} painted frames | ${(buffer.length/1024/1024).toFixed(2)} MB`);
  return buffer;
}

async function runBenchmark(seconds=5){
  console.log(`[BENCHMARK] Recording for ${seconds} seconds...`);
  await startRecording();
  await sleep(seconds*1000);
  const buffer=await stopRecording();
  const result={...getStatus(),recordingBytes:buffer.length,recordingSeconds:+((Date.now()-started)/1000).toFixed(2)};
  console.log("[BENCHMARK RESULT]",JSON.stringify(result));
  return result;
}

async function close(){
  try{if(running)await stopRecording()}catch(e){console.error("[CAPTURE STOP]",e.message)}
  try{if(cdp)await cdp.detach()}catch{}
  if(browser){await browser.close();browser=null;dashboard=recorder=cdp=null;}
}

module.exports={initialize,startRecording,stopRecording,getStatus,close,runBenchmark};
