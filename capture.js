
const path=require("path"),fs=require("fs");
process.env.PUPPETEER_CACHE_DIR=process.env.PUPPETEER_CACHE_DIR||path.join(__dirname,".cache","puppeteer");
const puppeteer=require("puppeteer");

const DASHBOARD_URL=process.env.DASHBOARD_URL||"https://zhong-vs-fede.onrender.com/";
const WIDTH=1280,HEIGHT=720,FPS=5,INTERVAL=1000/FPS;
let browser=null,page=null,recorderPage=null;
let active=false,busy=false,frames=0,dropped=0,error=null,startedAt=0,timer=null;

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
  const canvas=document.getElementById("c"),ctx=canvas.getContext("2d"),stream=canvas.captureStream(0);
  const mime="video/webm;codecs=vp8";
  if(!MediaRecorder.isTypeSupported(mime))throw Error("VP8 MediaRecorder unavailable");
  const recorder=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:2000000}),chunks=[];
  recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};
  window.__start=()=>{chunks.length=0;recorder.start(1000)};
  window.__draw=data=>{
    const img=new Image();
    return new Promise((resolve,reject)=>{
      img.onload=()=>{ctx.drawImage(img,0,0,canvas.width,canvas.height);stream.getVideoTracks()[0].requestFrame();resolve()};
      img.onerror=()=>reject(Error("Screenshot image could not be decoded"));
      img.src="data:image/jpeg;base64,"+data;
    });
  };
  window.__stop=()=>new Promise((resolve,reject)=>{
    recorder.addEventListener("stop",async()=>{
      try{
        const blob=new Blob(chunks,{type:"video/webm"});
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

async function captureFrame(){
  if(!active||busy){if(active)dropped++;return}
  busy=true;
  try{
    const screenshot=await page.screenshot({type:"jpeg",quality:60,encoding:"base64"});
    await recorderPage.evaluate(data=>window.__draw(data),screenshot);
    frames++;
    if(frames<=5||frames%25===0)console.log("[FRAME]",frames);
  }catch(e){
    error=e.message;
    console.error("[FRAME]",e.message);
  }finally{busy=false}
}

async function startRecording(){
  if(active)throw Error("Recording already running");
  await initialize();
  frames=0;dropped=0;error=null;
  await recorderPage.evaluate(()=>window.__start());
  active=true;startedAt=Date.now();
  await captureFrame();
  timer=setInterval(()=>captureFrame(),INTERVAL);
  return getStatus();
}

async function stopRecording(){
  if(!active)throw Error("Recording is not running");
  active=false;
  if(timer){clearInterval(timer);timer=null}
  while(busy)await new Promise(resolve=>setTimeout(resolve,20));
  const base64=await recorderPage.evaluate(()=>window.__stop());
  if(typeof base64!=="string"||!base64.length)throw Error("Recording returned empty or invalid Base64 data");
  return Buffer.from(base64,"base64");
}

function getStatus(){
  return {running:active,frames,dropped,elapsed:startedAt?Math.round((Date.now()-startedAt)/1000):0,fps:startedAt&&frames?Number((frames/((Date.now()-startedAt)/1000)).toFixed(1)):0,error};
}

async function close(){
  active=false;
  if(timer){clearInterval(timer);timer=null}
  if(browser)await browser.close().catch(()=>{});
  browser=null;page=null;recorderPage=null;busy=false;
}

module.exports={initialize,startRecording,stopRecording,getStatus,close};
