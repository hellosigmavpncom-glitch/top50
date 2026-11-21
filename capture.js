

const puppeteer=require("puppeteer");

const DASHBOARD_URL=process.env.DASHBOARD_URL||"https://zhong-vs-fede.onrender.com/";
const WIDTH=1280,HEIGHT=720,FPS=20;
let browser=null,page=null,recorderPage=null,cdp=null;
let active=false,busy=false,frames=0,dropped=0,error=null,startedAt=0;

async function initialize(){
  if(browser)return;
  browser=await puppeteer.launch({
    headless:true,
    args:["--no-sandbox","--disable-setuid-sandbox","--disable-dev-shm-usage"]
  });
  page=await browser.newPage();
  await page.setViewport({width:WIDTH,height:HEIGHT,deviceScaleFactor:1});
  await page.goto(DASHBOARD_URL,{waitUntil:"domcontentloaded",timeout:60000});
  recorderPage=await browser.newPage();
  await recorderPage.setViewport({width:WIDTH,height:HEIGHT});
  await recorderPage.setContent(`<html><body style="margin:0"><canvas id="c" width="${WIDTH}" height="${HEIGHT}"></canvas><script>
  const canvas=document.getElementById("c"),ctx=canvas.getContext("2d");
  const stream=canvas.captureStream(0);
  const mime="video/webm;codecs=vp8";
  if(!MediaRecorder.isTypeSupported(mime))throw Error("VP8 MediaRecorder unavailable");
  const recorder=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:4000000});
  const chunks=[];
  recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};
  window.__draw=async data=>{
    const img=new Image();
    await new Promise((resolve,reject)=>{
      img.onload=resolve;
      img.onerror=reject;
      img.src="data:image/jpeg;base64,"+data;
    });
    ctx.drawImage(img,0,0,canvas.width,canvas.height);
    stream.getVideoTracks()[0].requestFrame();
  };
  window.__start=()=>{chunks.length=0;recorder.start(1000)};
  window.__stop=()=>new Promise(resolve=>{
    recorder.addEventListener("stop",async()=>{
      const blob=new Blob(chunks,{type:"video/webm"});
      const buffer=await blob.arrayBuffer();
      let binary="";
      const bytes=new Uint8Array(buffer);
      for(let i=0;i<bytes.length;i+=32768)
        binary+=String.fromCharCode(...bytes.subarray(i,i+32768));
      resolve(btoa(binary));
    },{once:true});
    recorder.stop();
  });
  </script></body></html>`);
  cdp=await page.target().createCDPSession();
  cdp.on("Page.screencastFrame",async event=>{
    if(!active||busy){
      dropped++;
      await cdp.send("Page.screencastFrameAck",{sessionId:event.sessionId}).catch(()=>{});
      return;
    }
    busy=true;
    try{
      await recorderPage.evaluate(data=>window.__draw(data),event.data);
      frames++;
    }catch(e){error=e.message}
    finally{
      busy=false;
      await cdp.send("Page.screencastFrameAck",{sessionId:event.sessionId}).catch(()=>{});
    }
  });
}

async function startRecording(){
  if(active)throw Error("Recording already running");
  await initialize();
  frames=0;dropped=0;error=null;
  await recorderPage.evaluate(()=>window.__start());
  active=true;
  startedAt=Date.now();
  try{
    await cdp.send("Page.startScreencast",{
      format:"jpeg",
      quality:65,
      maxWidth:WIDTH,
      maxHeight:HEIGHT,
      everyNthFrame:1
    });
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
  const base64=await recorderPage.evaluate(()=>window.__stop());
  return {
    video:Buffer.from(base64,"base64"),
    status:getStatus()
  };
}

function getStatus(){
  return {
    running:active,
    frames,
    dropped,
    elapsed:startedAt?Math.round((Date.now()-startedAt)/1000):0,
    fps:startedAt&&frames?Number((frames/((Date.now()-startedAt)/1000)).toFixed(1)):0,
    error
  };
}

async function close(){
  active=false;
  if(browser)await browser.close().catch(()=>{});
  browser=null;page=null;recorderPage=null;cdp=null;
}

module.exports={initialize,startRecording,stopRecording,getStatus,close};
