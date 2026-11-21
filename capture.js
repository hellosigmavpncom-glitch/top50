
const path=require("path"),fs=require("fs");
process.env.PUPPETEER_CACHE_DIR=process.env.PUPPETEER_CACHE_DIR||path.join(__dirname,".cache","puppeteer");
const puppeteer=require("puppeteer");

const DASHBOARD_URL=process.env.DASHBOARD_URL||"https://zhong-vs-fede.onrender.com/";
const WIDTH=1280,HEIGHT=720,FPS=20;
let browser=null,page=null,cdp=null,active=false,busy=false,frames=0,dropped=0,error=null,startedAt=0,screencastEvents=0;

async function initialize(){
  if(browser)return;
  const CHROME=puppeteer.executablePath();
  console.log("[CHROME] Path:",CHROME,"Exists:",fs.existsSync(CHROME));
  if(!fs.existsSync(CHROME))throw Error("Chrome executable missing: "+CHROME);
  browser=await puppeteer.launch({executablePath:CHROME,headless:true,args:["--no-sandbox","--disable-setuid-sandbox","--disable-dev-shm-usage"]});
  page=await browser.newPage();
  await page.setViewport({width:WIDTH,height:HEIGHT,deviceScaleFactor:1});
  await page.goto(DASHBOARD_URL,{waitUntil:"domcontentloaded",timeout:60000});
  await page.evaluate(async({width,height,fps})=>{
    const canvas=document.createElement("canvas");
    canvas.width=width;canvas.height=height;
    canvas.style.cssText="position:fixed;left:-10000px;top:0";
    document.body.appendChild(canvas);
    const stream=canvas.captureStream(fps);
    const mime="video/webm;codecs=vp8";
    if(!MediaRecorder.isTypeSupported(mime))throw Error("VP8 MediaRecorder unavailable");
    const recorder=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:4000000});
    const chunks=[];
    recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};
    window.__capture={canvas,ctx:canvas.getContext("2d"),recorder,chunks,stream};
    window.__start=()=>{chunks.length=0;recorder.start(1000)};
    window.__stop=()=>new Promise(resolve=>{
      recorder.addEventListener("stop",async()=>{
        const blob=new Blob(chunks,{type:"video/webm"});
        resolve(await blob.arrayBuffer());
      },{once:true});
      recorder.stop();
    });
    window.__draw=async data=>{
      const img=new Image();
      await new Promise((resolve,reject)=>{
        img.onload=resolve;img.onerror=reject;
        img.src="data:image/jpeg;base64,"+data;
      });
      const c=window.__capture;
      c.ctx.drawImage(img,0,0,width,height);
    };
  },{width:WIDTH,height:HEIGHT,fps:FPS});
  cdp=await page.target().createCDPSession();
  cdp.on("Page.screencastFrame",async event=>{
    screencastEvents++;
    if(screencastEvents<=5||screencastEvents%50===0)console.log("[SCREENCAST] Event:",screencastEvents);
    if(!active||busy){
      dropped++;
      await cdp.send("Page.screencastFrameAck",{sessionId:event.sessionId}).catch(()=>{});
      return;
    }
    busy=true;
    try{
      await page.evaluate(data=>window.__draw(data),event.data);
      frames++;
    }catch(e){
      error=e.message;
      console.error("[FRAME]",e.message);
    }finally{
      busy=false;
      await cdp.send("Page.screencastFrameAck",{sessionId:event.sessionId}).catch(()=>{});
    }
  });
}

async function startRecording(){
  if(active)throw Error("Recording already running");
  await initialize();
  frames=0;dropped=0;error=null;screencastEvents=0;
  await page.evaluate(()=>window.__start());
  active=true;startedAt=Date.now();
  try{
    await cdp.send("Page.startScreencast",{format:"jpeg",quality:65,maxWidth:WIDTH,maxHeight:HEIGHT,everyNthFrame:1});
  }catch(e){
    active=false;
    throw e;
  }
  return getStatus();
}

async function stopRecording(){
  if(!active)throw Error("Recording is not running");
  active=false;
  await cdp.send("Page.stopScreencast").catch(()=>{});
  while(busy)await new Promise(resolve=>setTimeout(resolve,20));
  const video=await page.evaluate(()=>window.__stop());
  return Buffer.from(video);
}

function getStatus(){
  return {running:active,frames,dropped,elapsed:startedAt?Math.round((Date.now()-startedAt)/1000):0,fps:startedAt&&frames?Number((frames/((Date.now()-startedAt)/1000)).toFixed(1)):0,error};
}

async function close(){
  active=false;
  if(browser)await browser.close().catch(()=>{});
  browser=null;page=null;cdp=null;
}

module.exports={initialize,startRecording,stopRecording,getStatus,close};
