
process.env.PUPPETEER_CACHE_DIR ||= "/opt/render/project/src/.cache/puppeteer";
const puppeteer=require("puppeteer");
const WIDTH=1280,HEIGHT=720,FPS=30,URL=process.env.DASHBOARD_URL||"https://zhong-vs-fede.onrender.com/";
let browser,dashboard,recorder,cdp,listener,running=false,drawing=false,pending=null,firstFrame,resolveFirst,started=0,sourceFrames=0,paintedFrames=0,dropped=0,lastFrameAt=null,error=null,videoFps=null,outputBytes=0;

const sleep=ms=>new Promise(r=>setTimeout(r,ms));

async function initialize(){
  if(browser)return;
  browser=await puppeteer.launch({headless:true,executablePath:puppeteer.executablePath(),args:["--no-sandbox","--disable-setuid-sandbox","--disable-dev-shm-usage","--disable-gpu","--disable-background-timer-throttling","--disable-renderer-backgrounding","--disable-backgrounding-occluded-windows"]});
  dashboard=await browser.newPage();
  await dashboard.setViewport({width:WIDTH,height:HEIGHT,deviceScaleFactor:1});
  await dashboard.goto(URL,{waitUntil:"domcontentloaded",timeout:60000});
  await sleep(5000);
  recorder=await browser.newPage();
  await recorder.setViewport({width:WIDTH,height:HEIGHT});
  await recorder.setContent("<!doctype html><html><body style='margin:0;background:#000'></body></html>");
  await recorder.evaluate(({w,h,fps})=>{
    const source=document.createElement("canvas"),output=document.createElement("canvas");
    source.width=output.width=w;source.height=output.height=h;
    const sctx=source.getContext("2d"),octx=output.getContext("2d");
    sctx.fillStyle=octx.fillStyle="#000";sctx.fillRect(0,0,w,h);octx.fillRect(0,0,w,h);
    let last=0,raf;
    const paint=t=>{if(t-last>=1000/fps){octx.drawImage(source,0,0);last=t;}raf=requestAnimationFrame(paint);};
    raf=requestAnimationFrame(paint);
    window.__capture={source,output,raf,chunks:[],rec:null,blob:null,
      draw:data=>new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>{sctx.drawImage(img,0,0,w,h);resolve(true)};img.onerror=()=>reject(Error("Frame decode failed"));img.src="data:image/jpeg;base64,"+data;}),
      start:()=>{
        const stream=output.captureStream(fps);
        const type=MediaRecorder.isTypeSupported("video/webm;codecs=vp8")?"video/webm;codecs=vp8":"video/webm";
        const rec=new MediaRecorder(stream,{mimeType:type,videoBitsPerSecond:4000000});
        window.__capture.chunks=[];window.__capture.rec=rec;
        rec.ondataavailable=e=>{if(e.data.size)window.__capture.chunks.push(e.data)};
        rec.start(1000);
        return {mimeType:type,track:stream.getVideoTracks()[0].getSettings()};
      },
      stop:()=>new Promise(resolve=>{
        const rec=window.__capture.rec;
        if(!rec||rec.state==="inactive"){resolve(null);return;}
        rec.onstop=async()=>{
          const blob=new Blob(window.__capture.chunks,{type:rec.mimeType});
          window.__capture.blob=blob;
          const reader=new FileReader();
          reader.onload=()=>resolve({base64:String(reader.result).split(",")[1],size:blob.size,type:blob.type});
          reader.readAsDataURL(blob);
        };
        rec.stop();
      })
    };
  },{w:WIDTH,h:HEIGHT,fps:FPS});
}

async function pump(){
  if(drawing)return;
  drawing=true;
  try{
    while(pending){
      const frame=pending;pending=null;
      try{
        await recorder.evaluate(data=>window.__capture.draw(data),frame);
        paintedFrames++;lastFrameAt=Date.now();
        if(resolveFirst){resolveFirst();resolveFirst=null;}
      }catch(e){error=e.message;console.error("[CAPTURE FRAME]",e.message);}
    }
  }finally{drawing=false;if(pending)pump();}
}

function getStatus(){
  const elapsed=started?Date.now()-started:0;
  return {running,method:"CDP + Canvas MediaRecorder",frames:paintedFrames,sourceFrames,paintedFrames,dropped,elapsed,fps:elapsed?+(paintedFrames/(elapsed/1000)).toFixed(2):0,videoFps,targetFps:FPS,outputBytes,lastFrameAt,error};
}

async function startRecording(){
  if(running)throw Error("Recording is already running");
  await initialize();
  sourceFrames=paintedFrames=dropped=outputBytes=0;videoFps=null;error=null;pending=null;drawing=false;
  await recorder.evaluate(()=>window.__capture.start());
  started=Date.now();running=true;
  firstFrame=new Promise(resolve=>{resolveFirst=resolve});
  cdp=await dashboard.createCDPSession();
  await cdp.send("Page.enable");
  listener=params=>{
    sourceFrames++;
    cdp.send("Page.screencastFrameAck",{sessionId:params.sessionId}).catch(()=>{});
    if(pending)dropped++;
    pending=params.data;
    pump();
  };
  cdp.on("Page.screencastFrame",listener);
  try{
    await cdp.send("Page.startScreencast",{format:"jpeg",quality:75,maxWidth:WIDTH,maxHeight:HEIGHT,everyNthFrame:1});
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
  if(!running)return null;
  running=false;
  try{await cdp.send("Page.stopScreencast")}catch{}
  if(listener)cdp.off("Page.screencastFrame",listener);
  while(drawing||pending)await sleep(10);
  const result=await recorder.evaluate(()=>window.__capture.stop());
  if(!result)throw Error("No recording data was returned");
  const buffer=Buffer.from(result.base64,"base64");
  outputBytes=buffer.length;
  console.log(`[CAPTURE] Stopped | ${((Date.now()-started)/1000).toFixed(1)}s | ${paintedFrames} painted frames | ${(buffer.length/1024/1024).toFixed(2)} MB`);
  return buffer;
}

async function runBenchmark(seconds=15){
  console.log(`[BENCHMARK] Recording for ${seconds} seconds...`);
  await startRecording();
  await sleep(seconds*1000);
  const buffer=await stopRecording();
  const metrics=await recorder.evaluate(async()=>{
    const blob=window.__capture.blob;
    if(!blob)return null;
    const url=URL.createObjectURL(blob),v=document.createElement("video");
    v.muted=true;v.src=url;v.playsInline=true;
    await new Promise((resolve,reject)=>{v.onloadedmetadata=resolve;v.onerror=()=>reject(Error("Could not inspect recorded video"));});
    let frames=0;
    const done=new Promise(resolve=>{
      v.onended=()=>resolve();
      const next=()=>{frames++;if(!v.ended)v.requestVideoFrameCallback(next)};
      v.requestVideoFrameCallback(next);
    });
    await v.play();await done;
    const result={duration:+v.duration.toFixed(3),decodedFrames:frames,fps:+(frames/v.duration).toFixed(2),width:v.videoWidth,height:v.videoHeight};
    URL.revokeObjectURL(url);v.remove();return result;
  });
  videoFps=metrics?.fps??null;
  console.log("[BENCHMARK RESULT]",JSON.stringify({...getStatus(),recordingBytes:buffer.length,video:metrics}));
  return {...getStatus(),recordingBytes:buffer.length,video:metrics};
}

async function close(){
  try{if(running)await stopRecording()}catch(e){console.error("[CAPTURE STOP]",e.message)}
  try{if(cdp)await cdp.detach()}catch{}
  if(browser){await browser.close();browser=null;dashboard=recorder=cdp=null;}
}

module.exports={initialize,startRecording,stopRecording,getStatus,close,runBenchmark};
