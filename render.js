
const { createCanvas, loadImage, GlobalFonts } = require("@napi-rs/canvas");

const W=1280,H=720,S=.805;
const C={bg:"#050713",panel:"#0b1024",panel2:"#101832",border:"#273a68",blue:"#27a9ff",purple:"#8b36ff",teal:"#25e5c0",white:"#f5f7ff",muted:"#aab8df",red:"#ff4267"};
const canvas=createCanvas(W,H),ctx=canvas.getContext("2d");
const history={subs:[],rates:[],last:0,previous:null},avatars={};
const X=n=>n*S, F=n=>n*.86, R=n=>n*S;

for(const w of [400,500,600,700,800,900]){
  try{GlobalFonts.registerFromPath(require.resolve(`@fontsource/inter/files/inter-latin-${w}-normal.woff2`),"Inter");}catch{}
}

const fmt=v=>v==null||v===""||!Number.isFinite(Number(v))?"—":Math.round(Number(v)).toLocaleString("en-US");
const num=(o,...keys)=>{
  for(const k of keys)if(o?.[k]!=null&&Number.isFinite(Number(o[k])))return Number(o[k]);
  return null;
};
const rect=(x,y,w,h,r=12,fill=C.panel,stroke=C.border)=>{
  ctx.beginPath();ctx.roundRect(X(x),y,X(w),R(r));ctx.fillStyle=fill;ctx.fill();
  if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=1;ctx.stroke();}
};
const txt=(v,x,y,size=16,color=C.white,weight=700,max=Infinity,align="left")=>{
  const str=String(v??"—");let f=F(size);
  ctx.font=`${weight} ${f}px Inter,Arial,sans-serif`;
  while(ctx.measureText(str).width>X(max)&&f>8){f--;ctx.font=`${weight} ${f}px Inter,Arial,sans-serif`;}
  ctx.fillStyle=color;ctx.textAlign=align;ctx.textBaseline="middle";ctx.fillText(str,X(x),y);
};
const line=(x1,y1,x2,y2,color="#ffffff20",width=1)=>{
  ctx.beginPath();ctx.moveTo(X(x1),y1);ctx.lineTo(X(x2),y2);ctx.strokeStyle=color;ctx.lineWidth=width;ctx.stroke();
};
const label=(s,x,y,color=C.muted)=>txt(String(s).toUpperCase(),x,y,11,color,900,Infinity);
const glow=(x,y,w,h,color)=>{
  ctx.save();ctx.shadowColor=color;ctx.shadowBlur=18;
  rect(x,y,w,h,19,"#00000000",color);ctx.restore();
};

function getStats(d={}){
  const s=d.sctools||{},f=d.freewebtools||{},e=f.estimation||{};
  return {
    name:d.channel?.name||s.name||"Channel",
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
    ctx.save();
    ctx.shadowColor=border;ctx.shadowBlur=12;
    ctx.beginPath();ctx.arc(X(x+size/2),y+size/2,X(size/2),0,Math.PI*2);ctx.fillStyle=C.panel;ctx.fill();
    ctx.shadowBlur=0;ctx.beginPath();ctx.arc(X(x+size/2),y+size/2,X(size/2-2),0,Math.PI*2);ctx.clip();
    ctx.drawImage(img,X(x),y,X(size),size);ctx.restore();
    ctx.beginPath();ctx.arc(X(x+size/2),y+size/2,X(size/2-1),0,Math.PI*2);
    ctx.strokeStyle=border;ctx.lineWidth=2;ctx.stroke();
  }catch{}
}

function background(){
  const g=ctx.createRadialGradient(W/2,0,10,W/2,H,850);
  g.addColorStop(0,"#19265a");g.addColorStop(.5,"#080b1b");g.addColorStop(1,"#040610");
  ctx.fillStyle=g;ctx.fillRect(0,0,W,H);
}

function header(){
  txt("LUCAN PEVIDOR",24,31,23,C.white,900,220);
  txt("| ROAD TO 60M",242,31,23,C.purple,900,240);
  txt("● LIVE",1575,31,17,C.red,900,70,"right");
}

async function profile(d){
  rect(12,65,420,157,19,"#0b1024","#743dff");
  glow(12,65,420,157,"#743dff");
  await avatar(d.avatar,25,85,120);
  txt(d.name,158,101,22,C.white,900,255);
  txt("@LucanPevidor",158,125,11,C.muted,800,250);
  txt("Jesus loves you! I hope every",158,147,13,"#dce5ff",800,260);
  txt("video makes you smile!",158,163,13,"#dce5ff",800,260);
  rect(158,177,95,23,8,"#5423c5",null);
  txt("ROAD TO 60M",205,189,10,C.white,900,85,"center");
}

async function miniStats(d){
  rect(12,236,420,239,19,"#0b1024","#245caa");
  txt("MY CHANNEL",26,284,16,"#d7e5ff",900,150);
  await avatar(d.avatar,273,250,66);
  txt("VYStats",348,270,16,C.white,900,90);
  txt("@vystatsyt",348,291,11,C.muted,800,100);
  line(27,326,417,326);
  const cols=[
    ["SUBSCRIBERS",d.freeEst,d.freeApi],
    ["VIEWS",d.freeEstViews,d.freeApiViews],
    ["VIDEOS",d.freeEstVideos,d.freeApiVideos]
  ];
  cols.forEach((c,i)=>{
    const x=27+i*130;
    if(i)line(x-7,338,x-7,462);
    txt(c[0],x+55,371,11,"#b8caff",900,115,"center");
    txt("EST.",x,399,10,C.muted,900);
    txt(fmt(c[1]),x+115,399,17,C.white,900,100,"right");
    txt("API",x,429,10,C.muted,900);
    txt(fmt(c[2]),x+115,429,17,C.white,900,100,"right");
  });
}

function chart(values,x,y,w,h){
  if(values.length<2)return;
  const min=Math.min(...values),max=Math.max(...values),range=max-min||1;
  const points=values.map((v,i)=>[x+i/(values.length-1)*w,y+h-(v-min)/range*h]);
  ctx.beginPath();points.forEach(([px,py],i)=>i?ctx.lineTo(X(px),py):ctx.moveTo(X(px),py));
  ctx.strokeStyle=C.teal;ctx.lineWidth=3;ctx.lineJoin="round";ctx.lineCap="round";
  ctx.shadowColor=C.teal;ctx.shadowBlur=7;ctx.stroke();ctx.shadowBlur=0;
}

function bars(values,x,y,w,h){
  const a=values.slice(-14);if(!a.length)return;
  const max=Math.max(...a.map(Math.abs),.01),bw=w/a.length;
  a.forEach((v,i)=>{
    const bh=Math.max(8,Math.abs(v)/max*h);
    const g=ctx.createLinearGradient(0,y+h-bh,0,y+h);
    g.addColorStop(0,"#a63cff");g.addColorStop(1,"#5420c7");
    ctx.fillStyle=g;ctx.globalAlpha=.65+.35*i/a.length;
    ctx.beginPath();ctx.roundRect(X(x+i*bw),y+h-bh,X(Math.max(4,bw-6)),bh,5);ctx.fill();
  });
  ctx.globalAlpha=1;
}

function mainCard(x,w,title,accent){
  rect(x,65,w,410,19,"#0b1024",accent);
  const g=ctx.createLinearGradient(X(x),65,X(x+w),475);
  g.addColorStop(0,"#ffffff08");g.addColorStop(1,"#00000000");
  rect(x+1,66,w-2,408,18,g,null);
  txt(title,x+w/2,111,17,"#d7e3ff",900,w-30,"center");
}

function subscriberCard(x,w,current,hourly,daily){
  mainCard(x,w,"↗  LUCAN · LIVE SUBSCRIBERS",C.blue);
  txt("(LINEAR ESTIMATE)",x+w/2,133,16,"#d7e3ff",900,w-30,"center");
  txt(fmt(current),x+w/2,202,76,C.white,900,w-26,"center");
  chart(history.subs.slice(-18),x+18,265,w-36,65);
  line(x+15,343,x+w-15,343);
  const cols=[["LINEAR ESTIMATE",fmt(current)],["HOURLY GAIN",fmt(hourly)],["DAILY GAIN",fmt(daily)]];
  const widths=[w*.39,w*.29,w*.32];let at=x;
  cols.forEach((c,i)=>{
    if(i)line(at,355,at,454);
    txt(c[0],at+widths[i]/2,386,12,"#b9caff",900,widths[i]-5,"center");
    txt(c[1],at+widths[i]/2,418,22,C.teal,900,widths[i]-8,"center");
    at+=widths[i];
  });
}

function rateCard(x,w,rate){
  mainCard(x,w,"ϟ  SUBS GAINED PER SEC","#2869c9");
  txt(rate<0?"−":"+",x+54,205,76,C.white,900,65,"center");
  txt(Math.abs(rate).toFixed(2),x+w*.64,205,76,C.white,900,w*.65,"center");
  bars(history.rates,x+25,290,w-50,80);
  txt("◉ LIVE AVERAGE",x+w/2,430,14,C.teal,900,w-30,"center");
}

function goalCard(x,w,remaining,progress){
  mainCard(x,w,"⚑  SUBSCRIBERS REMAINING","#793dff");
  txt("TO 60,000,000",x+w/2,133,16,"#d7e3ff",900,w-30,"center");
  txt(fmt(remaining),x+w/2,207,76,C.white,900,w-24,"center");
  rect(x+20,275,w-40,15,10,"#111f43",null);
  rect(x+20,275,(w-40)*progress,15,10,"#8b36ff",null);
  rect(x+20,275,(w-40)*progress,15,10,"#20dfd0",null);
  txt("ROAD TO 60M",x+20,307,11,"#b9caff",900,120);
  txt((progress*100).toFixed(1)+"%",x+w-20,307,11,"#b9caff",900,80,"right");
  txt("◎ SUBSCRIBERS LEFT",x+w/2,430,14,C.teal,900,w-30,"center");
}

function sources(a,b){
  rect(12,485,1566,210,19,"#0b1024","#4268a8");
  txt("▤  DATA SOURCES",27,513,16,"#d6e3ff",900,250);
  txt("● LIVE · BOTH PROVIDERS",1570,513,11,C.teal,900,240,"right");
  const left=27,labelW=130,gap=9,usable=1540-labelW-gap*4,colW=usable/4;
  const xs=[left+labelW+gap,left+labelW+gap+colW+gap,left+labelW+gap+(colW+gap)*2,left+labelW+gap+(colW+gap)*3];
  ["SCTools Est.","SCTools API","FreeWebTools Est.","FreeWebTools API"].forEach((v,i)=>txt(v,xs[i]+colW/2,548,14,"#d6e3ff",900,colW,"center"));
  const rows=[
    ["SUBSCRIBERS",a.est,a.api,b.freeEst,b.freeApi],
    ["TOTAL VIEWS",a.views,a.apiViews,b.freeEstViews,b.freeApiViews],
    ["VIDEOS",a.videos,a.apiVideos,b.freeEstVideos,b.freeApiVideos]
  ];
  rows.forEach((r,i)=>{
    const y=559+i*43;
    txt(r[0],left,y+21,12,"#799bff",900,labelW);
    r.slice(1).forEach((v,j)=>{
      rect(xs[j],y,colW,41,8,"#080d1b","#26375b");
      txt(fmt(v),xs[j]+12,y+21,21,j===0?C.teal:j===2?C.teal:"#c4d1ff",900,colW-20);
    });
  });
}

async function renderDashboard(data={}){
  const a=getStats(data.lucan||{}),b=getStats(data.mine||{});
  const current=a.linear??a.est;
  const now=Date.now();
  if(current!=null&&now-history.last>=3000){
    if(history.previous!=null&&history.last){
      const seconds=(now-history.last)/1000;
      if(seconds>0)history.rates.push((current-history.previous)/seconds);
    }
    history.subs.push(current);
    history.previous=current;
    history.last=now;
    history.subs=history.subs.slice(-60);
    history.rates=history.rates.slice(-14);
  }
  const rate=history.rates.at(-1)??0;
  const remaining=current==null?null:Math.max(0,60000000-current);
  const progress=current==null?0:Math.min(1,current/60000000);

  background();header();
  await profile(a);await miniStats(b);
  const start=446*S,gap=14*S,w=(1566-420-28)/3;
  const cardW=w*S,cardGap=gap;
  const x1=start,x2=x1+cardW+cardGap,x3=x2+cardW+cardGap;
  subscriberCard(x1,cardW,current,a.hourly,a.daily);
  rateCard(x2,cardW,rate);
  goalCard(x3,cardW,remaining,progress);
  sources(a,b);
  txt("↻ UPDATED "+new Date().toLocaleTimeString(),25,720,13,"#b9caff",900,300);
  txt("● CONNECTED",1570,720,13,C.teal,900,180,"right");
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
}
module.exports={renderDashboard,attach};
