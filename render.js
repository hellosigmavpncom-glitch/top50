
const { createCanvas, loadImage, GlobalFonts } = require("@napi-rs/canvas");
const path = require("path");

const W=1280,H=720;
const C={bg:"#050713",panel:"#0b1024",panel2:"#101832",border:"#273a68",blue:"#27a9ff",purple:"#8b36ff",teal:"#25e5c0",white:"#f5f7ff",muted:"#aab8df",red:"#ff4267"};
const canvas=createCanvas(W,H),ctx=canvas.getContext("2d");
const history={subs:[],rate:[],last:0,previous:0},avatars={};

for(const weight of [400,500,600,700,800,900]){
  try {
    const file=require.resolve(`@fontsource/inter/files/inter-latin-${weight}-normal.woff2`);
    GlobalFonts.registerFromPath(file,"Inter");
  } catch(e) { console.error("Inter font load failed:",weight,e.message); }
}

const fmt=v=>v==null||!Number.isFinite(Number(v))?"—":Math.round(Number(v)).toLocaleString("en-US");
const get=(o,...keys)=>{
  for(const k of keys) if(o?.[k]!=null&&Number.isFinite(Number(o[k]))) return Number(o[k]);
  return null;
};
const rect=(x,y,w,h,r=12,fill=C.panel,stroke=C.border)=>{
  ctx.beginPath();ctx.roundRect(x,y,w,h,r);ctx.fillStyle=fill;ctx.fill();
  if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=1;ctx.stroke();}
};
const txt=(s,x,y,size=16,color=C.white,weight=700,max=Infinity,align="left")=>{
  let str=String(s??"—");
  ctx.font=`${weight} ${size}px Inter,Arial,sans-serif`;
  while(ctx.measureText(str).width>max&&size>9){
    size--;ctx.font=`${weight} ${size}px Inter,Arial,sans-serif`;
  }
  ctx.fillStyle=color;ctx.textAlign=align;ctx.textBaseline="middle";ctx.fillText(str,x,y);
};
const line=(x1,y1,x2,y2,color=C.border,width=1)=>{
  ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.strokeStyle=color;ctx.lineWidth=width;ctx.stroke();
};
const label=(s,x,y)=>txt(String(s).toUpperCase(),x,y,10,C.muted,800);
const card=(x,y,w,h,title,accent=C.blue)=>{
  rect(x,y,w,h,13);txt(title,x+17,y+22,11,accent,900,w-34);
};

function getStats(d){
  const s=d?.sctools||{},f=d?.freewebtools||{},e=f.estimation||{};
  return {
    name:d?.channel?.name||s.name||"Channel",
    avatar:d?.channel?.avatar||s.avatar||f.thumbnail||"",
    linear:get(s,"linearSubscribers","linearCount","estSubscribers","estCount"),
    est:get(s,"estSubscribers","estCount"),
    api:get(s,"apiSubscribers","apiCount"),
    views:get(s,"estViews","viewCount"),
    apiViews:get(s,"apiViews"),
    videos:get(s,"estVideos"),
    apiVideos:get(s,"apiVideos","videoCount"),
    hourly:get(s,"hourly")??get(s.averages,"hourly")??get(f,"hourly"),
    daily:get(s,"daily")??get(s.averages,"daily")??get(f,"daily"),
    freeEst:get(f,"estimatedSubscribers")??get(e,"estimated_count"),
    freeApi:get(f,"apiSubscribers","subscriberCount"),
    freeEstViews:get(f,"estimatedViews"),
    freeApiViews:get(f,"viewCount"),
    freeEstVideos:get(f,"estimatedVideos"),
    freeApiVideos:get(f,"videoCount")
  };
}
async function avatar(url,x,y,size){
  if(!url)return;
  try{
    if(!avatars[url])avatars[url]=loadImage(url);
    const img=await avatars[url];
    ctx.save();ctx.beginPath();ctx.arc(x+size/2,y+size/2,size/2,0,Math.PI*2);
    ctx.clip();ctx.drawImage(img,x,y,size,size);ctx.restore();
  }catch{}
}
function background(){
  ctx.fillStyle=C.bg;ctx.fillRect(0,0,W,H);
  const g=ctx.createLinearGradient(0,0,W,H);
  g.addColorStop(0,"#0c1530");g.addColorStop(.5,C.bg);g.addColorStop(1,"#100b25");
  ctx.fillStyle=g;ctx.fillRect(0,0,W,H);
}
function header(){
  rect(8,8,1264,46,10,C.panel2);
  txt("LUCAN PEVIDOR  |  ROAD TO 60M",25,31,16,C.white,900,900);
  ctx.beginPath();ctx.arc(1222,31,5,0,Math.PI*2);ctx.fillStyle=C.red;ctx.fill();
  txt("LIVE",1237,31,11,C.red,900,50);
}
async function profile(d,x,y){
  rect(x,y,420,139);
  await avatar(d.avatar,x+14,y+10,116);
  txt(d.name,x+143,y+36,22,C.white,900,260);
  txt("@LucanPevidor",x+143,y+62,12,C.muted,700,250);
  txt("ROAD TO 60 MILLION",x+143,y+91,11,C.blue,900,250);
  line(x+143,y+111,x+400,y+111);
  txt("LIVE CHANNEL TRACKING",x+143,y+124,9,C.muted,700,250);
}
async function miniStats(d,x,y){
  rect(x,y,420,238);
  txt("MY CHANNEL  |  VYSTATS",x+16,y+22,12,C.purple,900,380);
  await avatar(d.avatar,x+16,y+39,62);
  txt("My Channel",x+91,y+55,17,C.white,900,290);
  txt("@vystatsyt",x+91,y+79,11,C.muted,700,290);
  line(x+15,y+113,x+405,y+113);
  const cols=[
    ["SUBSCRIBERS",d.freeEst,d.freeApi],
    ["TOTAL VIEWS",d.freeEstViews,d.freeApiViews],
    ["VIDEOS",d.freeEstVideos,d.freeApiVideos]
  ];
  cols.forEach((c,i)=>{
    const xx=x+15+i*132;
    if(i)line(xx-7,y+128,xx-7,y+220);
    label(c[0],xx,y+137);
    txt(fmt(c[1]),xx,y+166,16,C.white,900,115);
    label("ESTIMATED",xx,y+190);
    txt(fmt(c[2]),xx,y+211,14,C.purple,800,115);
    label("API",xx,y+226);
  });
}
function chart(values,x,y,w,h,color){
  if(values.length<2)return;
  const min=Math.min(...values),max=Math.max(...values),range=max-min||1;
  ctx.beginPath();
  values.forEach((v,i)=>{
    const px=x+i/(values.length-1)*w,py=y+h-(v-min)/range*h;
    i?ctx.lineTo(px,py):ctx.moveTo(px,py);
  });
  ctx.strokeStyle=color;ctx.lineWidth=3;ctx.lineJoin="round";ctx.stroke();
}
function bars(values,x,y,w,h,color){
  if(!values.length)return;
  const data=values.slice(-24),max=Math.max(...data.map(Math.abs),1),bw=w/data.length;
  data.forEach((v,i)=>{
    const bh=Math.max(3,Math.abs(v)/max*h);
    ctx.fillStyle=color;ctx.globalAlpha=.65+.35*(i/data.length);
    ctx.fillRect(x+i*bw,y+h-bh,bw-4,bh);
  });
  ctx.globalAlpha=1;
}
let subtitleValues={hourly:null,daily:null},progress=0,remaining=null;
function mainCard(x,title,value,subtitle,accent,kind){
  card(x,66,268,387,title,accent);
  txt(value,x+17,128,55,C.white,900,234);
  txt(subtitle,x+17,164,11,C.muted,800,234);
  line(x+17,190,x+251,190);
  if(kind==="subs"){
    label("LIVE SUBSCRIBER HISTORY",x+17,211);
    chart(history.subs.slice(-50),x+18,231,230,92,accent);
    line(x+17,340,x+251,340);
    label("LINEAR ESTIMATE",x+17,360);
    txt(fmt(history.subs.at(-1)),x+17,380,16,C.white,900,105);
    label("HOURLY GAIN",x+137,360);
    txt(fmt(subtitleValues.hourly),x+137,380,16,C.teal,900,105);
    label("DAILY GAIN",x+17,420);
    txt(fmt(subtitleValues.daily),x+17,438,16,C.teal,900,105);
  }else if(kind==="rate"){
    label("RECENT RATE ACTIVITY",x+17,211);
    bars(history.rate,x+18,235,230,100,accent);
    line(x+17,350,x+251,350);
    label("LIVE AVERAGE",x+17,374);
    txt(value,x+17,410,32,accent,900,230);
  }else{
    label("MILESTONE PROGRESS",x+17,211);
    rect(x+17,241,234,12,6,C.panel2,null);
    rect(x+17,241,234*progress,12,6,accent,null);
    txt((progress*100).toFixed(3)+"% complete",x+17,280,14,C.teal,900,230);
    line(x+17,320,x+251,320);
    label("NEXT MILESTONE",x+17,350);
    txt("60,000,000",x+17,380,22,C.white,900,230);
    label("SUBSCRIBERS REMAINING",x+17,420);
    txt(fmt(remaining),x+17,440,17,C.teal,900,230);
  }
}
function sources(a,b){
  rect(8,465,1264,211);
  txt("DATA SOURCES",25,489,12,C.white,900);
  txt("LIVE  ·  BOTH PROVIDERS",1250,489,10,C.teal,900,230,"right");
  const heads=["METRIC","SCTOOLS EST.","SCTOOLS API","FREEWEBTOOLS EST.","FREEWEBTOOLS API"];
  const xs=[25,270,480,690,980],widths=[230,200,200,280,260];
  heads.forEach((h,i)=>txt(h,xs[i],520,10,C.muted,900,widths[i]));
  line(25,538,1255,538);
  const rows=[
    ["SUBSCRIBERS",a.est,a.api,b.freeEst,b.freeApi],
    ["TOTAL VIEWS",a.views,a.apiViews,b.freeEstViews,b.freeApiViews],
    ["VIDEOS",a.videos,a.apiVideos,b.freeEstVideos,b.freeApiVideos]
  ];
  rows.forEach((r,i)=>{
    const yy=565+i*34;
    txt(r[0],25,yy,11,C.white,900,220);
    r.slice(1).forEach((v,j)=>txt(fmt(v),xs[j+1],yy,13,j===0?C.blue:j===2?C.purple:C.white,900,widths[j+1]));
    if(i<2)line(25,yy+17,1255,yy+17,"#1b294a");
  });
}
async function renderDashboard(data={}){
  const a=getStats(data.lucan||{}),b=getStats(data.mine||{});
  const now=Date.now(),current=a.linear??a.est;
  if(current!=null&&now-history.last>3000){
    if(history.previous!=null&&history.last){
      const elapsed=(now-history.last)/1000;
      if(elapsed>0)history.rate.push((current-history.previous)/elapsed);
    }
    history.subs.push(current);history.previous=current;history.last=now;
    history.subs=history.subs.slice(-100);history.rate=history.rate.slice(-100);
  }
  const rate=history.rate.at(-1)??0;
  subtitleValues={hourly:a.hourly,daily:a.daily};
  remaining=current==null?null:Math.max(0,60000000-current);
  progress=current==null?0:Math.min(1,current/60000000);
  background();header();
  await profile(a,8,66);
  await miniStats(b,8,215);
  mainCard(440,"LUCAN LIVE SUBSCRIBERS",fmt(current),"LINEAR ESTIMATE",C.blue,"subs");
  mainCard(712,"SUBSCRIBERS GAINED / SEC",(rate>=0?"+":"")+rate.toFixed(2),"LIVE RATE",C.purple,"rate");
  mainCard(984,"SUBSCRIBERS TO 60M",fmt(remaining),"REMAINING",C.teal,"goal");
  sources(a,b);
  txt("UPDATED "+new Date().toLocaleTimeString(),25,700,10,C.muted,800,300);
  txt("CONNECTED  ·  SCTOOLS + FREEWEBTOOLS",1255,700,10,C.teal,900,500,"right");
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
