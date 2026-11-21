
const path=require("path"),fs=require("fs"),os=require("os");
process.env.PUPPETEER_CACHE_DIR=process.env.PUPPETEER_CACHE_DIR||path.join(__dirname,".cache","puppeteer");
const puppeteer=require("puppeteer");

const DASHBOARD_URL=process.env.DASHBOARD_URL||"https://zhong-vs-fede.onrender.com/";
const WIDTH=640,HEIGHT=360,FPS=1,INTERVAL=1000,WARMUPS=8,TESTS=40;
let browser=null,page=null,recorderPage=null;
let active=false,busy=false,frames=0,dropped=0,error=null,startedAt=0,loopPromise=null;

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const round=n=>Number(n.toFixed(2));
const percentile=(values,p)=>{
  const sorted=[...values].sort((a,b)=>a-b);
  return sorted[Math.min(sorted.length-1,Math.ceil(sorted.length*p)-1)];
};
const stats=values=>{
  if(!values.length)return null;
  const avg=values.reduce((a,b)=>a+b,0)/values.length;
  return {
    samples:values.length,
    min:round(Math.min(...values)),
    avg:round(avg),
    median:round(percentile(values,.5)),
    p95:round(percentile(values,.95)),
    max:round(Math.max(...values)),
    stdDev:round(Math.sqrt(values.reduce((s,v)=>s+(v-avg)**2,0)/values.length))
  };
};

async function initialize(){
  if(browser)return;
  const CHROME=puppeteer.executablePath();
  console.log("[CHROME] Path:",CHROME,"Exists:",fs.existsSync(CHROME));
  if(!fs.existsSync(CHROME))throw Error("Chrome executable missing: "+CHROME);
  browser=await puppeteer.launch({executablePath:CHROME,headless:true,args:["--no-sandbox","--disable-setuid-sandbox","--disable-dev-shm-usage"]});
  page=await browser.newPage();
  await page.setViewport({width:WIDTH,height:HEIGHT,deviceScaleFactor:1});
  await page.goto(DASHBOARD_URL,{waitUntil:"domcontentloaded",timeout:60000});
  await sleep(5000);
  console.log("[DASHBOARD] Loaded:",await page.title());
  recorderPage=await browser.newPage();
  await recorderPage.setViewport({width:WIDTH,height:HEIGHT,deviceScaleFactor:1});
  await recorderPage.setContent(`<html><body style="margin:0"><canvas id="c" width="${WIDTH}" height="${HEIGHT}"></canvas><script>
  const canvas=document.getElementById("c"),ctx=canvas.getContext("2d"),stream=canvas.captureStream(1);
  const mime="video/webm;codecs=vp8";
  if(!MediaRecorder.isTypeSupported(mime))throw Error("VP8 MediaRecorder unavailable");
  const recorder=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:500000}),chunks=[];
  recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};
  recorder.onerror=e=>{window.__recordingError=e.error?.message||"MediaRecorder error"};
  window.__start=()=>{
    if(recorder.state!=="inactive")throw Error("MediaRecorder is already active");
    chunks.length=0;window.__recordingError=null;recorder.start(1000);
  };
  window.__draw=data=>new Promise((resolve,reject)=>{
    const img=new Image();
    img.onload=()=>{ctx.drawImage(img,0,0,canvas.width,canvas.height);resolve()};
    img.onerror=()=>reject(Error("Screenshot image could not be decoded"));
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

async function runBenchmark(){
  if(active)throw Error("Stop recording before running benchmark");
  await initialize();
  console.log(`[BENCHMARK] ${WIDTH}x${HEIGHT} | ${WARMUPS} warmups + ${TESTS} measured captures per page`);
  const blankPage=await browser.newPage();
  await blankPage.setViewport({width:WIDTH,height:HEIGHT,deviceScaleFactor:1});
  await blankPage.setContent("<!doctype html><html><head><style>*{margin:0;padding:0}</style></head><body></body></html>");
  const results={dashboard:[],blank:[]},sizes={dashboard:[],blank:[]};
  const targets={dashboard:page,blank:blankPage};
  const capture=async label=>{
    const start=performance.now();
    const data=await targets[label].screenshot({type:"jpeg",quality:55,encoding:"base64"});
    const ms=performance.now()-start;
    results[label].push(ms);
    sizes[label].push(Buffer.byteLength(data,"base64")*.75);
    return ms;
  };
  const cpuBefore=process.cpuUsage(),memoryBefore=process.memoryUsage(),metricsBefore=await page.metrics();
  const started=Date.now();
  try{
    for(let i=0;i<WARMUPS;i++){
      const order=i%2?["blank","dashboard"]:["dashboard","blank"];
      for(const label of order)await targets[label].screenshot({type:"jpeg",quality:55,encoding:"base64"});
      console.log(`[WARMUP] ${i+1}/${WARMUPS}`);
    }
    for(let i=0;i<TESTS;i++){
      const order=i%2?["blank","dashboard"]:["dashboard","blank"];
      for(const label of order){
        const ms=await capture(label);
        console.log(`[${label.toUpperCase()}] ${i+1}/${TESTS} | ${round(ms)}ms`);
      }
    }
    const dashboard=stats(results.dashboard),blank=stats(results.blank);
    const dashboardBytes=stats(sizes.dashboard),blankBytes=stats(sizes.blank);
    const metricsAfter=await page.metrics(),cpuAfter=process.cpuUsage(cpuBefore),memoryAfter=process.memoryUsage();
    const dashboardFps=1000/dashboard.avg,blankFps=1000/blank.avg;
    const report={
      resolution:`${WIDTH}x${HEIGHT}`,
      screenshot:"JPEG quality 55",
      warmupsPerPage:WARMUPS,
      testsPerPage:TESTS,
      testDurationSeconds:round((Date.now()-started)/1000),
      dashboard,
      blank,
      screenshotSizeKB:{dashboard:round(dashboardBytes.avg/1024),blank:round(blankBytes.avg/1024)},
      dashboardSlowerByMs:round(dashboard.avg-blank.avg),
      dashboardSlowerByPercent:round((dashboard.avg/blank.avg-1)*100),
      estimatedCaptureFPS:{dashboard:round(dashboardFps),blank:round(blankFps)},
      browser:{
        taskDurationSeconds:round((metricsAfter.TaskDuration-metricsBefore.TaskDuration)),
        jsHeapUsedMB:round(metricsAfter.JSHeapUsedSize/1048576),
        jsHeapDeltaMB:round((metricsAfter.JSHeapUsedSize-metricsBefore.JSHeapUsedSize)/1048576)
      },
      node:{
        cpuUsedMs:round((cpuAfter.user+cpuAfter.system)/1000),
        rssBeforeMB:round(memoryBefore.rss/1048576),
        rssAfterMB:round(memoryAfter.rss/1048576)
      }
    };
    console.log("\n========== DASHBOARD VS BLANK RESULTS ==========");
    console.log(JSON.stringify(report,null,2));
    console.log("================================================\n");
    return report;
  }finally{
    await blankPage.close().catch(()=>{});
  }
}

async function captureLoop(){
  let nextFrameAt=performance.now();
  while(active){
    busy=true;
    const frameStart=performance.now();
    try{
      const screenshot=await page.screenshot({type:"jpeg",quality:55,encoding:"base64"});
      await recorderPage.evaluate(data=>window.__draw(data),screenshot);
      frames++;
      if(frames<=5||frames%10===0)console.log("[FRAME]",frames);
    }catch(e){
      error=e.message;
      console.error("[FRAME]",e.message);
      break;
    }finally{busy=false}
    nextFrameAt+=INTERVAL;
    const delay=nextFrameAt-performance.now();
    if(delay>0)await sleep(delay);
    else{
      dropped+=Math.max(1,Math.floor(-delay/INTERVAL)+1);
      nextFrameAt=performance.now();
    }
  }
}

async function startRecording(){
  if(active)throw Error("Recording already running");
  await initialize();
  frames=0;dropped=0;error=null;
  await recorderPage.evaluate(()=>window.__start());
  active=true;startedAt=Date.now();
  loopPromise=captureLoop();
  return getStatus();
}

async function stopRecording(){
  if(!active)throw Error("Recording is not running");
  active=false;
  if(loopPromise)await loopPromise;
  while(busy)await sleep(20);
  const base64=await recorderPage.evaluate(()=>window.__stop());
  if(typeof base64!=="string"||!base64.length)throw Error("Recording returned empty or invalid Base64 data");
  const video=Buffer.from(base64,"base64");
  if(!video.length)throw Error("Decoded recording is empty");
  loopPromise=null;
  return video;
}

function getStatus(){
  const elapsed=startedAt?(Date.now()-startedAt)/1000:0;
  return {running:active,frames,dropped,elapsed:Math.round(elapsed),fps:elapsed?round(frames/elapsed):0,error};
}

async function close(){
  active=false;
  if(loopPromise)await loopPromise.catch(()=>{});
  if(browser)await browser.close().catch(()=>{});
  browser=null;page=null;recorderPage=null;busy=false;loopPromise=null;
}

module.exports={initialize,runBenchmark,startRecording,stopRecording,getStatus,close};

if(require.main===module){
  runBenchmark().catch(e=>{console.error("[BENCHMARK ERROR]",e)}).finally(()=>close());
}
