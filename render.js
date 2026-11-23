
const {createCanvas,loadImage,GlobalFonts}=require("@napi-rs/canvas");

const W=1280,H=720;
const C={bg:"#050713",panel:"#0b1024",panel2:"#101832",border:"#273a68",blue:"#27a9ff",purple:"#8b36ff",teal:"#25e5c0",white:"#f5f7ff",muted:"#aab8df",red:"#ff4267"};
const canvas=createCanvas(W,H),ctx=canvas.getContext("2d");
const history={subs:[],rates:[],last:0,previous:null},avatars={};

for(const w of [400,500,600,700,800,900]){
  try{GlobalFonts.registerFromPath(require.resolve(`@fontsource/inter/files/inter-latin-${w}-normal.woff2`),"Inter");}catch{}
}

const fmt=v=>v==null||v===""||!Number.isFinite(Number(v))?"—":Math.round(Number(v)).toLocaleString("en-US");
const num=(o,...keys)=>{
  for(const k of keys)if(o?.[k]!=null&&o[k]!==""&&Number.isFinite(Number(o[k])))return Number(o[k]);
  return null;
};
const rect=(x,y,w,h,r=12,fill=C.panel,stroke=C.border)=>{
  ctx.beginPath();ctx.roundRect(x,y,w,h,r);ctx.fillStyle=fill;ctx.fill();
  if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=1;ctx.stroke();}
};
const txt=(v,x,y,size=16,color=C.white,weight=700,max=Infinity,align="left")=>{
  const s=String(v??"—");let f=size;
  ctx.font=`${weight} ${f}px Inter,Arial,sans-serif`;
  while(ctx.measureText(s).width>max&&f>9){f--;ctx.font=`${weight} ${f}px Inter,Arial,sans-serif`;}
  ctx.fillStyle=color;ctx.textAlign=align;ctx.textBaseline="middle";ctx.fillText(s,x,y);
};
const line=(x1,y1,x2,y2,color="#ffffff20",width=1)=>{
  ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.strokeStyle=color;ctx.lineWidth=width;ctx.stroke();
};
const label=(s,x,y,color=C.muted)=>txt(String(s).toUpperCase(),x,y,10,color,900);

function icon(type,x,y,size,color){
  ctx.save();ctx.translate(x,y);ctx.strokeStyle=color;ctx.fillStyle=color;
  ctx.lineWidth=2.2;ctx.lineCap="round";ctx.lineJoin="round";
  ctx.shadowColor=color;ctx.shadowBlur=7;ctx.beginPath();
  if(type==="arrow"){
    ctx.moveTo(-size*.38,size*.3);ctx.lineTo(size*.3,-size*.38);
    ctx.moveTo(-size*.02,-size*.38);ctx.lineTo(size*.3,-size*.38);ctx.lineTo(size*.3,-size*.06);
  }else if(type==="bolt"){
    ctx.moveTo(size*.08,-size*.45);ctx.lineTo(-size*.2,size*.04);
    ctx.lineTo(size*.04,size*.04);ctx.lineTo(-size*.08,size*.45);
    ctx.lineTo(size*.28,-size*.12);ctx.lineTo(size*.04,-size*.12);ctx.closePath();ctx.fill();
  }else if(type==="flag"){
    ctx.moveTo(-size*.25,size*.43);ctx.lineTo(-size*.25,-size*.45);
    ctx.moveTo(-size*.22,-size*.4);ctx.lineTo(size*.3,-size*.28);
    ctx.lineTo(-size*.02,-size*.04);ctx.lineTo(-size*.22,-size*.1);
  }else if(type==="data"){
    ctx.rect(-size*.36,-size*.36,size*.72,size*.72);
    ctx.moveTo(-size*.36,-size*.08);ctx.lineTo(size*.36,-size*.08);
    ctx.moveTo(-size*.36,size*.18);ctx.lineTo(size*.36,size*.18);
  }else if(type==="live"){
    ctx.arc(0,0,size*.25,0,Math.PI*2);ctx.fill();
  }else if(type==="check"){
    ctx.moveTo(-size*.35,0);ctx.lineTo(-size*.08,size*.27);ctx.lineTo(size*.38,-size*.3);
  }
  ctx.stroke();ctx.restore();
}

function getStats(d={}){
  const s=d.sctools||{},f=d.freewebtools||{},e=f.estimation||{};
  return{
    name:d.channel?.name||s.name||"Channel",
    handle:d.channel?.handle||"",
    avatar:d.channel?.avatar||s.avatar||f.thumbnail||"",
    linear:num(s,"linearSubscribers","linearCount","estSubscribers","estCount"),
    est:num(s,"estSubscribers","estCount"),
    api:num(s,"apiSubscribers","apiCount"),
    views:num(s,"estViews","viewCount"),
    apiViews:num(s,"apiViews"),
    videos:num(s,"estVideos"),
    apiVideos:num(s,"apiVideos","videoCount"),
    hourly:num(s,"hourly")??num(s.averages,"hourly")??num(f,"hourly"),
    daily:num(s,"daily")??num(s.averages,"daily")??num(f,"daily"),
    freeEst:num(f,"estimatedSubscribers")??num(e,"estimated_count"),
    freeApi:num(f,"apiSubscribers","subscriberCount"),
    freeEstViews:num(f,"estimatedViews"),
    freeApiViews:num(f,"viewCount"),
    freeEstVideos:num(f,"estimatedVideos"),
    freeApiVideos:num(f,"videoCount")
  };
}

async function avatar(url,x,y,size,border=C.blue){
  if(!url)return;
  try{
    if(!avatars[url])avatars[url]=loadImage(url);
    const img=await avatars[url];
    ctx.save();ctx.shadowColor=border;ctx.shadowBlur=15;
    ctx.beginPath();ctx.arc(x+size/2,y+size/2,size/2,0,Math.PI*2);
    ctx.fillStyle=C.panel;ctx.fill();ctx.shadowBlur=0;
    ctx.beginPath();ctx.arc(x+size/2,y+size/2,size/2-2,0,Math.PI*2);ctx.clip();
    ctx.drawImage(img,x,y,size,size);ctx.restore();
    ctx.beginPath();ctx.arc(x+size/2,y+size/2,size/2-1,0,Math.PI*2);
    ctx.strokeStyle=border;ctx.lineWidth=2;ctx.stroke();
  }catch{}
}

function background(){
  ctx.fillStyle=C.bg;ctx.fillRect(0,0,W,H);
  const g=ctx.createRadialGradient(W/2,-80,10,W/2,H,850);
  g.addColorStop(0,"#19265a");g.addColorStop(.5,"#080b1b");g.addColorStop(1,"#040610");
  ctx.fillStyle=g;ctx.fillRect(0,0,W,H);
}

function header(){
  rect(8,8,1264,48,10,C.panel2,null);
  txt("LUCAN PEVIDOR",22,32,19,C.white,900,180);
  txt("| ROAD TO 60M",198,32,19,C.purple,900,230);
  icon("live",1212,32,12,C.red);txt("LIVE",1225,32,15,C.red,900,50);
}

async function profile(d){
  rect(8,66,420,136,19,"#0b1024","#743dff");
  await avatar(d.avatar,20,74,120);
  txt(d.name,154,102,21,C.white,900,258);
  txt(d.handle||"@LucanPevidor",154,126,11,C.muted,800,255);
  txt("Jesus loves you! I hope every",154,148,12,"#dce5ff",800,258);
  txt("video makes you smile!",154,164,12,"#dce5ff",800,258);
  rect(154,176,96,18,7,"#5423c5",null);
  txt("ROAD TO 60M",202,185,9,C.white,900,90,"center");
}

async function miniStats(d){
  rect(8,214,420,240,19,"#0b1024","#245caa");
  txt("MY CHANNEL",22,242,15,"#d7e5ff",900,120);
  await avatar(d.avatar,248,226,66);
  txt(d.name||"VYStats",326,246,15,C.white,900,90);
  txt(d.handle||"@vystatsyt",326,268,10,C.muted,800,90);
  line(22,294,414,294);
  const cols=[["SUBSCRIBERS",d.freeEst,d.freeApi],["VIEWS",d.freeEstViews,d.freeApiViews],["VIDEOS",d.freeEstVideos,d.freeApiVideos]];
  cols.forEach((c,i)=>{
    const x=22+i*132;
    if(i)line(x-8,306,x-8,440);
    txt(c[0],x+58,324,10,"#b8caff",900,116,"center");
    txt("EST.",x,354,10,C.muted,900);txt(fmt(c[1]),x+116,354,15,C.white,900,100,"right");
    txt("API",x,389,10,C.muted,900);txt(fmt(c[2]),x+116,389,15,C.white,900,100,"right");
  });
}

function mainCard(x,title,accent,type){
  rect(x,66,267,388,19,"#0b1024",accent);
  const g=ctx.createLinearGradient(x,66,x+267,454);
  g.addColorStop(0,"#ffffff08");g.addColorStop(1,"#00000000");
  rect(x+1,67,265,386,18,g,null);
  icon(type,x+24,112,15,accent);txt(title,x+38,112,14,"#d7e3ff",900,210);
}

function chart(values,x,y,w,h){
  if(values.length<2)return;
  const min=Math.min(...values),max=Math.max(...values),range=max-min||1;
  const pts=values.map((v,i)=>[x+i/(values.length-1)*w,y+h-(v-min)/range*h]);
  const first=pts[0],last=pts[pts.length-1];
  const g=ctx.createLinearGradient(0,y,0,y+h);
  g.addColorStop(0,"#18e9d944");g.addColorStop(1,"#18e9d900");
  ctx.beginPath();ctx.moveTo(first[0],y+h);
  pts.forEach(([px,py])=>ctx.lineTo(px,py));
  ctx.lineTo(last[0],y+h);ctx.closePath();ctx.fillStyle=g;ctx.fill();
  ctx.beginPath();pts.forEach(([px,py],i)=>i?ctx.lineTo(px,py):ctx.moveTo(px,py));
  ctx.strokeStyle=C.teal;ctx.lineWidth=3;ctx.lineJoin="round";ctx.lineCap="round";
  ctx.shadowColor=C.teal;ctx.shadowBlur=7;ctx.stroke();ctx.shadowBlur=0;
}

function bars(values,x,y,w,h){
  const a=values.slice(-14);if(!a.length)return;
  const gap=6,bw=Math.min(20,(w-gap*(a.length-1))/a.length);
  const total=a.length*bw+(a.length-1)*gap,start=x+(w-total)/2;
  const max=Math.max(...a.map(Math.abs),.01);
  a.forEach((v,i)=>{
    const bh=Math.max(8,Math.abs(v)/max*h);
    const g=ctx.createLinearGradient(0,y+h-bh,0,y+h);
    g.addColorStop(0,"#a63cff");g.addColorStop(1,"#5420c7");
    ctx.fillStyle=g;ctx.globalAlpha=.65+.35*i/a.length;
    ctx.beginPath();ctx.roundRect(start+i*(bw+gap),y+h-bh,bw,bh,4);ctx.fill();
  });
  ctx.globalAlpha=1;
}

function subscriberCard(x,current,hourly,daily){
  mainCard(x,"LUCAN · LIVE SUBSCRIBERS",C.blue,"arrow");
  txt("(LINEAR ESTIMATE)",x+133.5,139,13,"#d7e3ff",900,237,"center");
  txt(fmt(current),x+133.5,202,55,C.white,900,239,"center");
  chart(history.subs.slice(-18),x+18,250,231,66);
  line(x+15,330,x+252,330);
  const cols=[["LINEAR ESTIMATE",fmt(current)],["HOURLY GAIN",fmt(hourly)],["DAILY GAIN",fmt(daily)]];
  const widths=[105,77,85];let at=x+8;
  cols.forEach((c,i)=>{
    if(i)line(at-4,343,at-4,438);
    txt(c[0],at+widths[i]/2,361,10,"#b9caff",900,widths[i],"center");
    txt(c[1],at+widths[i]/2,397,17,C.teal,900,widths[i],"center");
    at+=widths[i];
  });
}

function rateCard(x,rate){
  mainCard(x,"SUBS GAINED PER SEC","#2869c9","bolt");
  txt(rate<0?"−":"+ ",x+67,213,64,C.white,900,65,"center");
  txt(Math.abs(rate).toFixed(2),x+168,213,64,C.white,900,175,"center");
  bars(history.rates,x+25,280,217,84);
  txt("LIVE AVERAGE",x+133.5,401,13,C.teal,900,235,"center");
}

function goalCard(x,remaining,progress){
  mainCard(x,"SUBSCRIBERS REMAINING",C.purple,"flag");
  txt("TO 60,000,000",x+133.5,139,13,"#d7e3ff",900,237,"center");
  txt(fmt(remaining),x+133.5,207,55,C.white,900,239,"center");
  rect(x+20,275,227,15,10,"#111f43",null);
  rect(x+20,275,227*progress,15,10,"#8b36ff",null);
  txt("ROAD TO 60M",x+20,309,10,"#b9caff",900,120);
  txt((progress*100).toFixed(1)+"%",x+247,309,10,"#b9caff",900,65,"right");
  txt("SUBSCRIBERS LEFT",x+133.5,401,13,C.teal,900,235,"center");
}

function sources(a,b){
  rect(8,464,1264,210,19,"#0b1024","#4268a8");
  icon("data",29,485,13,"#d6e3ff");txt("DATA SOURCES",43,485,15,"#d6e3ff",900,250);
  icon("live",1129,485,9,C.teal);txt("LIVE · BOTH PROVIDERS",1141,485,10,C.teal,900,114);
  line(22,503,1258,503);
  const left=22,labelW=130,gap=9,colW=(1236-labelW-gap*4)/4;
  const xs=Array.from({length:4},(_,i)=>left+labelW+gap+i*(colW+gap));
  ["SCTools Est.","SCTools API","FreeWebTools Est.","FreeWebTools API"].forEach((v,i)=>txt(v,xs[i]+colW/2,522,12,"#d6e3ff",900,colW,"center"));
  const rows=[["SUBSCRIBERS",a.est,a.api,b.freeEst,b.freeApi],["TOTAL VIEWS",a.views,a.apiViews,b.freeEstViews,b.freeApiViews],["VIDEOS",a.videos,a.apiVideos,b.freeEstVideos,b.freeApiVideos]];
  rows.forEach((r,i)=>{
    const y=536+i*43;txt(r[0],left,y+17,11,"#799bff",900,labelW);
    r.slice(1).forEach((v,j)=>{
      rect(xs[j],y,colW,36,7,"#080d1b","#26375b");
      txt(fmt(v),xs[j]+11,y+18,17,j===0||j===2?C.teal:"#c4d1ff",900,colW-20);
    });
  });
}

async function renderDashboard(data={}){
  const a=getStats(data.lucan||{}),b=getStats(data.mine||{});
  const current=a.linear??a.est,now=Date.now();

  if(current!=null&&now-history.last>=3000){
    if(history.previous!=null&&history.last){
      const seconds=(now-history.last)/1000;
      if(seconds>0)history.rates.push((current-history.previous)/seconds);
    }
    history.subs.push(current);history.previous=current;history.last=now;
    history.subs=history.subs.slice(-60);history.rates=history.rates.slice(-14);
  }

  const rate=history.rates.at(-1)??0;
  const remaining=current==null?null:Math.max(0,60000000-current);
  const progress=current==null?0:Math.min(1,current/60000000);

  background();header();
  await profile(a);await miniStats(b);
  subscriberCard(442,current,a.hourly,a.daily);
  rateCard(723,rate);goalCard(1004,remaining,progress);sources(a,b);
  line(8,686,1272,686,"#ffffff18");
  txt("UPDATED "+new Date().toLocaleTimeString(),22,702,11,"#b9caff",900,300);
  icon("live",1179,702,9,C.teal);txt("CONNECTED",1192,702,11,C.teal,900,80);
  return canvas.toBuffer("image/png");
}

function attach(app,getData){
  app.get("/api/renderer/preview.png",async(req,res)=>{
    try{
      const png=await renderDashboard(getData());
      res.set("Content-Type","image/png");
      res.set("Cache-Control","no-store, no-cache, must-revalidate");
      res.send(png);
    }catch(e){
      console.error("Renderer error:",e.stack||e.message);
      res.status(500).send("Renderer failed");
    }
  });

  // Actual renderer benchmark: 3 warm-ups + 30 measured frames
  app.get("/api/renderer/benchmark",async(req,res)=>{
    try{
      const data=getData(),times=[];
      let png;
      for(let i=0;i<3;i++)png=await renderDashboard(data);
      for(let i=0;i<30;i++){
        const start=process.hrtime.bigint();
        png=await renderDashboard(data);
        times.push(Number(process.hrtime.bigint()-start)/1e6);
      }
      times.sort((a,b)=>a-b);
      const avg=times.reduce((sum,n)=>sum+n,0)/times.length;
      const percentile=p=>times[Math.min(times.length-1,Math.ceil(times.length*p)-1)];
      const round=n=>Number(n.toFixed(2));
      res.set("Cache-Control","no-store");
      res.json({
        renderer:"@napi-rs/canvas",frames:times.length,warmupFrames:3,
        averageMs:round(avg),medianMs:round(percentile(.5)),
        p95Ms:round(percentile(.95)),minMs:round(times[0]),
        maxMs:round(times[times.length-1]),estimatedFPS:round(1000/avg),
        pngSizeKB:round(png.length/1024),
        frameBudgets:{"10fps":100,"15fps":66.67,"30fps":33.33}
      });
    }catch(e){
      console.error("Benchmark error:",e.stack||e.message);
      res.status(500).json({error:"Benchmark failed",message:e.message});
    }
  });
}

module.exports={renderDashboard,attach};
