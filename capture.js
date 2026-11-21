
const path=require("path"),fs=require("fs"),os=require("os");
process.env.PUPPETEER_CACHE_DIR=process.env.PUPPETEER_CACHE_DIR||path.join(__dirname,".cache","puppeteer");
const puppeteer=require("puppeteer");

const DASHBOARD_URL=process.env.DASHBOARD_URL||"https://zhong-vs-fede.onrender.com/";
const WIDTH=640,HEIGHT=360,FPS=1,INTERVAL=1000;
let browser=null,page=null,recorderPage=null;
let active=false,busy=false,frames=0,dropped=0,error=null,startedAt=0,loopPromise=null;

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const percentile=(values,p)=>{
  const sorted=[...values].sort((a,b)=>a-b);
  return Number(sorted[Math.min(sorted.length-1,Math.ceil(sorted.length*p)-1)].toFixed(2));
};
const stats=values=>({
  min:Number(Math.min(...values).toFixed(2)),
  avg:Number((values.reduce((a,b)=>a+b,0)/values.length).toFixed(2)),
  median:percentile(values,.5),
  p95:percentile(values,.95),
  max:Number(Math.max(...values).toFixed(2))
});

async function initialize(){
  if(browser)return;
  const CHROME=puppeteer.executablePath();
  console.log("[CHROME] Path:",CHROME,"Exists:",fs.existsSync(CHROME));
  if(!fs.existsSync(CHROME))throw Error("Chrome executable missing: "+CHROME);
  browser=await puppeteer.launch({executablePath:CHROME,headless:true,args:["--no-sandbox","--disable-setuid-sandbox","--disable-dev-shm-usage"]});
  page=await browser.newPage();
  await page.setViewport({width:WIDTH,height:HEIGHT,deviceScaleFactor:1});
  await page.goto(DASHBOARD_URL,{waitUntil:"domcontentloaded",timeout:60000});
  recorderPage=await browser.newPage();
  await recorderPage.setViewport({width:WIDTH,height:HEIGHT});
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
  console.log("[BENCHMARK] Starting 2 warmups + 10 measured capture cycles...");
  await initialize();
  const results={screenshot:[],draw:[],cycle:[],ping:[],imageKB:[]};
  const cpuBefore=process.cpuUsage(),metricsBefore=await page.metrics(),started=Date.now();
  for(let i=0;i<12;i++){
    const pingStart=Date.now();
    await page.evaluate(()=>document.readyState);
    const ping=Date.now()-pingStart;
    const shotStart=Date.now();
    const screenshot=await page.screenshot({type:"jpeg",quality:55,encoding:"base64"});
    const screenshotMs=Date.now()-shotStart;
    const drawStart=Date.now();
    await recorderPage.evaluate(data=>window.__draw(data),screenshot);
    const drawMs=Date.now()-drawStart;
    const cycleMs=Date.now()-shotStart;
    if(i>=2){
      results.ping.push(ping);
      results.screenshot.push(screenshotMs);
      results.draw.push(drawMs);
      results.cycle.push(cycleMs);
      results.imageKB.push(Buffer.byteLength(screenshot,"base64")/1024);
    }
    console.log(`[BENCHMARK] ${i+1}/12 ${i<2?"WARMUP":"TEST"} | screenshot ${screenshotMs}ms | draw ${drawMs}ms | total ${cycleMs}ms`);
  }
  const cpu=process.cpuUsage(cpuBefore),metricsAfter=await page.metrics(),elapsed=(Date.now()-started)/1000;
  const report={
    resolution:`${WIDTH}x${HEIGHT}`,
    measuredCycles:10,
    elapsedSeconds:Number(elapsed.toFixed(2)),
    screenshot:stats(results.screenshot),
    canvasDraw:stats(results.draw),
    fullCycle:stats(results.cycle),
    pagePing:stats(results.ping),
    screenshotSizeKB:stats(results.imageKB),
    estimatedMaxFPS:Number((1000/(results.cycle.reduce((a,b)=>a+b,0)/results.cycle.length)).toFixed(2)),
    nodeCPU:{userMs:Number((cpu.user/1000).toFixed(2)),systemMs:Number((cpu.system/1000).toFixed(2))},
    chrome:{taskDurationDeltaSeconds:Number(((metricsAfter.TaskDuration||0)-(metricsBefore.TaskDuration||0)).toFixed(3)),jsHeapMB:Number(((metricsAfter.JSHeapUsedSize||0)/1048576).toFixed(2))},
    nodeMemoryMB:{rss:Number((process.memoryUsage().rss/1048576).toFixed(2)),heapUsed:Number((process.memoryUsage().heapUsed/1048576).toFixed(2))},
    systemLoadAverage:os.loadavg().map(n=>Number(n.toFixed(2)))
  };
  console.log("\n========== CAPTURE BENCHMARK RESULTS ==========");
  console.log(JSON.stringify(report,null,2));
  console.log("================================================\n");
  return report;
}

async function captureLoop(){
  while(active){
    busy=true;
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
    if(active)await sleep(INTERVAL);
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
  return {running:active,frames,dropped,elapsed:startedAt?Math.round((Date.now()-startedAt)/1000):0,fps:startedAt?Number((frames/((Date.now()-startedAt)/1000)).toFixed(2)):0,error};
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
