
const path=require("path"),fs=require("fs");
process.env.PUPPETEER_CACHE_DIR=process.env.PUPPETEER_CACHE_DIR||path.join(__dirname,".cache","puppeteer");
const puppeteer=require("puppeteer");

const DASHBOARD_URL=process.env.DASHBOARD_URL||"https://zhong-vs-fede.onrender.com/";
const WIDTH=640,HEIGHT=360,TEST_SECONDS=15;
let browser=null,page=null,recorderPage=null,cdp=null;
let active=false,recording=false,frames=0,dropped=0,error=null,startedAt=0,drawBusy=false,pendingDraw=null;

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const round=n=>Number(n.toFixed(2));
const percentile=(v,p)=>{const s=[...v].sort((a,b)=>a-b);return s[Math.min(s.length-1,Math.ceil(s.length*p)-1)];};
const stats=v=>v.length?{samples:v.length,min:round(Math.min(...v)),avg:round(v.reduce((a,b)=>a+b,0)/v.length),median:round(percentile(v,.5)),p95:round(percentile(v,.95)),max:round(Math.max(...v))}:null;

async function initialize(){
  if(browser)return;
  const chrome=puppeteer.executablePath();
  console.log("[CHROME]",chrome,"Exists:",fs.existsSync(chrome));
  if(!fs.existsSync(chrome))throw Error("Chrome executable missing: "+chrome);
  browser=await puppeteer.launch({executablePath:chrome,headless:true,args:["--no-sandbox","--disable-setuid-sandbox","--disable-dev-shm-usage"]});
  page=await browser.newPage();
  await page.setViewport({width:WIDTH,height:HEIGHT,deviceScaleFactor:1});
  await page.goto(DASHBOARD_URL,{waitUntil:"domcontentloaded",timeout:60000});
  await sleep(5000);
  console.log("[DASHBOARD] Loaded:",await page.title());
  cdp=await page.createCDPSession();
  await cdp.send("Page.enable");
  cdp.on("Page.screencastFrame",params=>{
    cdp.send("Page.screencastFrameAck",{sessionId:params.sessionId}).catch(e=>{error=e.message;});
    if(!recording)return;
    if(drawBusy){dropped++;return;}
    drawBusy=true;
    pendingDraw=recorderPage.evaluate(data=>window.__draw(data),params.data)
      .then(()=>frames++)
      .catch(e=>{error=e.message;console.error("[FRAME]",e.message);})
      .finally(()=>{drawBusy=false;});
  });
  recorderPage=await browser.newPage();
  await recorderPage.setViewport({width:WIDTH,height:HEIGHT,deviceScaleFactor:1});
  await recorderPage.setContent(`<html><body style="margin:0"><canvas id="c" width="${WIDTH}" height="${HEIGHT}"></canvas><script>
  const canvas=document.getElementById("c"),ctx=canvas.getContext("2d"),stream=canvas.captureStream(0),track=stream.getVideoTracks()[0];
  const mime="video/webm;codecs=vp8";
  if(!MediaRecorder.isTypeSupported(mime))throw Error("VP8 MediaRecorder unavailable");
  if(!track.requestFrame)throw Error("Canvas manual frame capture unavailable");
  const recorder=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:1500000}),chunks=[];
  recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};
  recorder.onerror=e=>{window.__recordingError=e.error?.message||"MediaRecorder error"};
  window.__start=()=>{
    if(recorder.state!=="inactive")throw Error("MediaRecorder is already active");
    chunks.length=0;window.__recordingError=null;recorder.start(1000);
  };
  window.__draw=data=>new Promise((resolve,reject)=>{
    const img=new Image();
    img.onload=()=>{ctx.drawImage(img,0,0,canvas.width,canvas.height);track.requestFrame();resolve()};
    img.onerror=()=>reject(Error("Screencast frame could not be decoded"));
    img.src="data:image/jpeg;base64,"+data;
  });
  window.__stop=()=>new Promise((resolve,reject)=>{
    if(recorder.state==="inactive"){reject(Error("MediaRecorder is not recording"));return}
    recorder.addEventListener("stop",async()=>{
      try{
        if(window.__recordingError)throw Error(window.__recordingError);
        const blob=new Blob(chunks,{type:"video/webm"});
        if(!blob.size)throw Error("MediaRecorder produced an empty video");
        const bytes=new Uint8Array(await blob.arrayBuffer());
        let binary="";
        for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));
        resolve(btoa(binary));
      }catch(e){reject(e)}
    },{once:true});
    recorder.stop();
  });
  </script></body></html>`);
}

async function testScreencast(target,label){
  const session=await target.createCDPSession();
  await session.send("Page.enable");
  const arrivals=[],acks=[],sizes=[];
  let pending=0,ackErrors=0;
  const handler=params=>{
    const arrived=performance.now();
    arrivals.push(arrived);
    sizes.push(Buffer.byteLength(params.data,"base64")*.75);
    pending++;
    session.send("Page.screencastFrameAck",{sessionId:params.sessionId})
      .then(()=>acks.push(performance.now()-arrived))
      .catch(()=>ackErrors++)
      .finally(()=>pending--);
  };
  session.on("Page.screencastFrame",handler);
  try{
    await session.send("Page.startScreencast",{format:"jpeg",quality:55,maxWidth:WIDTH,maxHeight:HEIGHT,everyNthFrame:1});
    console.log(`[CDP] ${label} started`);
    const start=performance.now();
    await sleep(TEST_SECONDS*1000);
    const elapsed=(performance.now()-start)/1000;
    await session.send("Page.stopScreencast");
    await sleep(300);
    const intervals=arrivals.slice(1).map((t,i)=>t-arrivals[i]);
    const result={
      frames:arrivals.length,
      fps:round(arrivals.length/elapsed),
      frameIntervalsMs:stats(intervals),
      frameSizeKB:stats(sizes.map(x=>x/1024)),
      ackMs:stats(acks),
      pendingAcks:pending,
      ackErrors
    };
    console.log(`[CDP] ${label} finished | ${result.frames} frames | ${result.fps} FPS`);
    return result;
  }finally{
    session.off("Page.screencastFrame",handler);
    await session.detach().catch(()=>{});
  }
}

async function runBenchmark(){
  if(active)throw Error("Stop recording before running benchmark");
  await initialize();
  console.log("[BENCHMARK] Static vs animated vs dashboard CDP |",WIDTH+"x"+HEIGHT);
  const blank=await browser.newPage();
  const animated=await browser.newPage();
  await Promise.all([blank,animated].map(p=>p.setViewport({width:WIDTH,height:HEIGHT,deviceScaleFactor:1})));
  await blank.setContent("<!doctype html><html><body style='margin:0;background:white'></body></html>");
  await animated.setContent(`<html><head><style>
  *{margin:0}body{background:white;overflow:hidden}
  #moving{position:absolute;top:30px;left:0;width:8px;height:8px;background:black;will-change:transform;animation:move 1s linear infinite}
  @keyframes move{from{transform:translateX(0)}to{transform:translateX(500px)}}
  </style></head><body><div id="moving"></div></body></html>`);
  try{
    const results={};
    results.staticBlank=await testScreencast(blank,"STATIC BLANK");
    results.animatedBlank=await testScreencast(animated,"ANIMATED BLANK");
    results.dashboard=await testScreencast(page,"DASHBOARD");
    const screenshotTimes=[];
    for(let i=0;i<8;i++){
      const start=performance.now();
      await page.screenshot({type:"jpeg",quality:55});
      screenshotTimes.push(performance.now()-start);
      console.log(`[SCREENSHOT] ${i+1}/8 | ${round(screenshotTimes[i])}ms`);
    }
    const report={
      resolution:`${WIDTH}x${HEIGHT}`,
      testSecondsPerPage:TEST_SECONDS,
      screenshotMethod:stats(screenshotTimes),
      cdp:results,
      interpretation:{
        animatedVsStaticFPS:results.staticBlank.fps?round(results.animatedBlank.fps/results.staticBlank.fps):null,
        dashboardVsAnimatedFPS:results.animatedBlank.fps?round(results.dashboard.fps/results.animatedBlank.fps):null
      }
    };
    console.log("\n========== THREE-WAY CDP RESULTS ==========");
    console.log(JSON.stringify(report,null,2));
    console.log("===========================================\n");
    return report;
  }finally{
    await Promise.all([blank.close().catch(()=>{}),animated.close().catch(()=>{})]);
  }
}

async function startRecording(){
  if(active)throw Error("Recording already running");
  await initialize();
  frames=0;dropped=0;error=null;drawBusy=false;pendingDraw=null;
  await recorderPage.evaluate(()=>window.__start());
  recording=true;active=true;startedAt=Date.now();
  try{
    await cdp.send("Page.startScreencast",{format:"jpeg",quality:55,maxWidth:WIDTH,maxHeight:HEIGHT,everyNthFrame:1});
  }catch(e){recording=false;active=false;throw e;}
  console.log("[RECORDING] CDP screencast started");
  return getStatus();
}

async function stopRecording(){
  if(!active)throw Error("Recording is not running");
  try{await cdp.send("Page.stopScreencast");}catch(e){}
  recording=false;active=false;
  if(pendingDraw)await pendingDraw.catch(()=>{});
  const base64=await recorderPage.evaluate(()=>window.__stop());
  if(typeof base64!=="string"||!base64.length)throw Error("Recording returned empty or invalid Base64 data");
  const video=Buffer.from(base64,"base64");
  if(!video.length)throw Error("Decoded recording is empty");
  console.log("[RECORDING] Finished | Frames:",frames,"Dropped:",dropped,"Bytes:",video.length);
  return video;
}

function getStatus(){
  const elapsed=startedAt?(Date.now()-startedAt)/1000:0;
  return {running:active,method:"CDP screencast",frames,dropped,elapsed:Math.round(elapsed),fps:elapsed?round(frames/elapsed):0,error};
}

async function close(){
  active=false;recording=false;
  if(cdp)try{await cdp.send("Page.stopScreencast");}catch(e){}
  if(browser)await browser.close().catch(()=>{});
  browser=null;page=null;recorderPage=null;cdp=null;drawBusy=false;pendingDraw=null;
}

module.exports={initialize,runBenchmark,startRecording,stopRecording,getStatus,close};

if(require.main===module){
  runBenchmark().catch(e=>console.error("[BENCHMARK ERROR]",e)).finally(()=>close());
}
