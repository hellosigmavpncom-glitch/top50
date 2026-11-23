
const { createCanvas, loadImage } = require("@napi-rs/canvas");

const W = 1280, H = 720;
const C = {
  bg:"#050713", panel:"#0b1024", panel2:"#101832", border:"#273a68",
  blue:"#27a9ff", purple:"#8b36ff", teal:"#25e5c0", white:"#f5f7ff",
  muted:"#aab8df", red:"#ff4267"
};
const canvas = createCanvas(W,H), ctx = canvas.getContext("2d");
const history = { subs:[], rate:[], last:0, previous:0 };
const avatars = {};

const num = v => Number.isFinite(Number(v)) ? Number(v) : null;
const fmt = v => v == null ? "—" : Math.round(v).toLocaleString("en-US");
const short = v => v == null ? "—" : v >= 1e9 ? (v/1e9).toFixed(2)+"B" : v >= 1e6 ? (v/1e6).toFixed(2)+"M" : v >= 1e3 ? (v/1e3).toFixed(1)+"K" : fmt(v);
const get = (o,...keys) => {
  for (const k of keys) if (o?.[k] != null) return num(o[k]);
  return null;
};
const roundRect = (x,y,w,h,r=12,fill=C.panel,stroke=C.border) => {
  ctx.beginPath(); ctx.roundRect(x,y,w,h,r); ctx.fillStyle=fill; ctx.fill();
  if (stroke) { ctx.strokeStyle=stroke; ctx.lineWidth=1; ctx.stroke(); }
};
const text = (s,x,y,size=16,color=C.white,weight=600,max=Infinity,align="left") => {
  ctx.font=`${weight} ${size}px Inter,Arial,sans-serif`;
  let str=String(s ?? "—");
  while (ctx.measureText(str).width>max && size>9) {
    size--; ctx.font=`${weight} ${size}px Inter,Arial,sans-serif`;
  }
  ctx.fillStyle=color; ctx.textAlign=align; ctx.textBaseline="middle";
  ctx.fillText(str,x,y);
};
const line = (x1,y1,x2,y2,color=C.border,width=1) => {
  ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2);
  ctx.strokeStyle=color; ctx.lineWidth=width; ctx.stroke();
};
const label = (s,x,y) => text(s.toUpperCase(),x,y,10,C.muted,700);
const card = (x,y,w,h,title,accent=C.blue) => {
  roundRect(x,y,w,h,13);
  text(title,x+17,y+22,11,accent,800,w-34);
};
const getStats = d => {
  const s=d?.sctools||{}, f=d?.freewebtools||{}, e=f.estimation||{};
  return {
    name:d?.channel?.name||s.name||"Channel",
    avatar:d?.channel?.avatar||s.avatar||f.thumbnail||"",
    linear:get(s,"linearSubscribers","linearCount","estSubscribers","estCount"),
    est:get(s,"estSubscribers","estCount","linearSubscribers","linearCount"),
    api:get(s,"apiSubscribers","apiCount"),
    views:get(s,"estViews","viewCount"),
    apiViews:get(s,"apiViews"),
    videos:get(s,"estVideos"),
    apiVideos:get(s,"apiVideos","videoCount"),
    hourly:get(s,"hourly") ?? get(s.averages,"hourly") ?? get(f,"hourly"),
    daily:get(s,"daily") ?? get(s.averages,"daily") ?? get(f,"daily"),
    freeEst:get(f,"estimatedSubscribers") ?? get(e,"estimated_count"),
    freeApi:get(f,"apiSubscribers","subscriberCount"),
    freeViews:get(f,"estimatedViews","viewCount"),
    freeVideos:get(f,"estimatedVideos","videoCount")
  };
};
async function avatar(url,x,y,size) {
  if (!url) return;
  try {
    if (!avatars[url]) avatars[url]=loadImage(url);
    const img=await avatars[url];
    ctx.save(); ctx.beginPath(); ctx.arc(x+size/2,y+size/2,size/2,0,Math.PI*2);
    ctx.clip(); ctx.drawImage(img,x,y,size,size); ctx.restore();
  } catch {}
}
function background() {
  ctx.fillStyle=C.bg; ctx.fillRect(0,0,W,H);
  const g=ctx.createLinearGradient(0,0,W,H);
  g.addColorStop(0,"#0c1530"); g.addColorStop(.5,C.bg); g.addColorStop(1,"#100b25");
  ctx.fillStyle=g; ctx.fillRect(0,0,W,H);
}
function header() {
  roundRect(8,8,1264,46,10,C.panel2);
  text("LUCAN PEVIDOR  |  ROAD TO 60M",25,31,16,C.white,800,900);
  ctx.beginPath(); ctx.arc(1222,31,5,0,Math.PI*2);
  ctx.fillStyle=C.red; ctx.fill();
  text("LIVE",1237,31,11,C.red,800,50);
}
async function profile(d,x,y) {
  roundRect(x,y,420,139,12);
  await avatar(d.avatar,x+14,y+10,116);
  text(d.name,x+143,y+36,22,C.white,800,260);
  text("@LucanPevidor",x+143,y+62,12,C.muted,600,250);
  text("ROAD TO 60 MILLION",x+143,y+91,11,C.blue,800,250);
  line(x+143,y+111,x+400,y+111);
  text("LIVE CHANNEL TRACKING",x+143,y+124,9,C.muted,600,250);
}
async function miniStats(d,x,y) {
  roundRect(x,y,420,238,12);
  text("MY CHANNEL  |  VYSTATS",x+16,y+22,12,C.purple,800,380);
  await avatar(d.avatar,x+16,y+39,62);
  text("My Channel",x+91,y+55,17,C.white,800,290);
  text("@vystatsyt",x+91,y+79,11,C.muted,600,290);
  line(x+15,y+113,x+405,y+113);
  const cols=[
    ["SUBSCRIBERS",d.freeEst,d.freeApi],
    ["TOTAL VIEWS",d.freeViews,d.freeViews],
    ["VIDEOS",d.freeVideos,d.freeVideos]
  ];
  cols.forEach((c,i)=>{
    const xx=x+15+i*132;
    if (i) line(xx-7,y+128,xx-7,y+220);
    label(c[0],xx,y+137);
    text(short(c[1]),xx,y+166,16,C.white,800,115);
    label("ESTIMATED",xx,y+190);
    text(short(c[2]),xx,y+211,14,C.purple,700,115);
    label("API",xx,y+226);
  });
}
function chart(values,x,y,w,h,color) {
  if (values.length<2) return;
  const min=Math.min(...values), max=Math.max(...values), range=max-min||1;
  ctx.beginPath();
  values.forEach((v,i)=>{
    const px=x+i/(values.length-1)*w, py=y+h-(v-min)/range*h;
    i ? ctx.lineTo(px,py) : ctx.moveTo(px,py);
  });
  ctx.strokeStyle=color; ctx.lineWidth=2.5; ctx.stroke();
}
function bars(x,y,w,h,color) {
  for (let i=0;i<24;i++) {
    const v=.2+Math.abs(Math.sin(i*2.13)*.65)+Math.abs(Math.cos(i*.71)*.15);
    ctx.fillStyle=color; ctx.globalAlpha=.35+v*.55;
    ctx.fillRect(x+i*(w/24),y+h-v*h,w/24-3,v*h);
  }
  ctx.globalAlpha=1;
}
function mainCard(x,title,value,subtitle,accent,kind) {
  card(x,66,268,387,title,accent);
  text(value,x+17,128,43,C.white,800,234);
  text(subtitle,x+17,164,11,C.muted,600,234);
  line(x+17,190,x+251,190);
  if (kind==="subs") {
    label("LIVE SUBSCRIBER HISTORY",x+17,211);
    chart(history.subs.slice(-50),x+18,231,230,92,accent);
    line(x+17,340,x+251,340);
    label("LINEAR ESTIMATE",x+17,360);
    text(fmt(history.subs.at(-1)),x+17,380,16,C.white,700,105);
    label("HOURLY GAIN",x+137,360);
    text(fmt(subtitleValues.hourly),x+137,380,16,C.teal,700,105);
    label("DAILY GAIN",x+17,420);
    text(fmt(subtitleValues.daily),x+17,438,16,C.teal,700,105);
  } else if (kind==="rate") {
    label("RECENT RATE ACTIVITY",x+17,211);
    bars(x+18,235,230,100,accent);
    line(x+17,350,x+251,350);
    label("LIVE AVERAGE",x+17,374);
    text(value,x+17,410,30,accent,800,230);
  } else {
    label("MILESTONE PROGRESS",x+17,211);
    roundRect(x+17,241,234,12,6,C.panel2,null);
    const pct=Math.max(0,Math.min(1,progress));
    roundRect(x+17,241,234*pct,12,6,accent,null);
    text((pct*100).toFixed(3)+"% complete",x+17,280,14,C.teal,700,230);
    line(x+17,320,x+251,320);
    label("NEXT MILESTONE",x+17,350);
    text("60,000,000",x+17,380,22,C.white,800,230);
    label("SUBSCRIBERS REMAINING",x+17,420);
    text(fmt(remaining),x+17,440,17,C.teal,800,230);
  }
}
let subtitleValues={hourly:null,daily:null}, progress=0, remaining=null;
function sources(a,b) {
  roundRect(8,465,1264,211,12);
  text("DATA SOURCES",25,489,12,C.white,800);
  text("LIVE  ·  BOTH PROVIDERS",1250,489,10,C.teal,700,230,"right");
  const heads=["METRIC","SCTOOLS EST.","SCTOOLS API","FREEWEBTOOLS EST.","FREEWEBTOOLS API"];
  const xs=[25,270,480,690,980], widths=[230,200,200,280,260];
  heads.forEach((h,i)=>text(h,xs[i],520,10,C.muted,800,widths[i]));
  line(25,538,1255,538);
  const rows=[
    ["SUBSCRIBERS",a.est,a.api,b.freeEst,b.freeApi],
    ["TOTAL VIEWS",a.views,a.apiViews,b.freeViews,null],
    ["VIDEOS",a.videos,a.apiVideos,b.freeVideos,b.freeVideos]
  ];
  rows.forEach((r,i)=>{
    const yy=565+i*34;
    text(r[0],25,yy,11,C.white,700,220);
    r.slice(1).forEach((v,j)=>text(fmt(v),xs[j+1],yy,13,j===0?C.blue:j===2?C.purple:C.white,700,widths[j+1]));
    if (i<2) line(25,yy+17,1255,yy+17,"#1b294a");
  });
}
async function renderDashboard(data={}) {
  const a=getStats(data.lucan||{}), b=getStats(data.mine||{});
  const now=Date.now(), current=a.linear ?? a.est ?? 0;
  if (now-history.last>3000) {
    if (history.previous && current) history.rate.push((current-history.previous)/Math.max(1,(now-history.last)/1000));
    history.subs.push(current); history.previous=current; history.last=now;
    history.subs=history.subs.slice(-100); history.rate=history.rate.slice(-100);
  }
  const rate=history.rate.at(-1) ?? 0;
  subtitleValues={hourly:a.hourly,daily:a.daily};
  remaining=Math.max(0,60000000-current);
  progress=Math.min(1,current/60000000);
  background(); header();
  await profile(a,8,66);
  await miniStats(b,8,215);
  mainCard(440,"LUCAN LIVE SUBSCRIBERS",fmt(current),"LINEAR ESTIMATE",C.blue,"subs");
  mainCard(712,"SUBSCRIBERS GAINED / SEC",(rate>=0?"+":"")+rate.toFixed(2),"LIVE RATE",C.purple,"rate");
  mainCard(984,"SUBSCRIBERS TO 60M",fmt(remaining),"REMAINING",C.teal,"goal");
  sources(a,b);
  text("UPDATED "+new Date().toLocaleTimeString(),25,700,10,C.muted,600,300);
  text("CONNECTED  ·  SCTOOLS + FREEWEBTOOLS",1255,700,10,C.teal,700,500,"right");
  return canvas.toBuffer("image/png");
}
function attach(app,getData) {
  app.get("/api/renderer/preview.png",async(req,res)=>{
    try {
      const png=await renderDashboard(getData());
      res.set("Content-Type","image/png");
      res.set("Cache-Control","no-store, no-cache, must-revalidate");
      res.send(png);
    } catch(e) {
      console.error("Renderer error:",e.message);
      res.status(500).send("Renderer failed");
    }
  });
}
module.exports={renderDashboard,attach};
