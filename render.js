
const fs=require("fs"),path=require("path"),{render}=require("takumi-js"),{googleFonts}=require("takumi-js/helpers");
const W=1280,H=720,FPS=15,FRAME_MS=1000/FPS,DIR=__dirname,nf=new Intl.NumberFormat("en-US"),images=new Map(),rollStates=new Map(),history={subs:[],rates:[],samples:[],lastSample:0};
let queue=Promise.resolve(),benchmarkActive=false,lastTiming={},fontPromise=null,htmlPromise=null,templatePromise=null,lastDiag="",lastLog=0,diagLogged=false,sampleTimer=null,latestMain=null;
const diagnostics=[],voidTags=new Set(["area","base","br","col","embed","hr","img","input","link","meta","param","source","track","wbr"]);
const elapsed=(a,b=process.hrtime.bigint())=>Number(b-a)/1e6,mib=n=>+(n/1048576).toFixed(2),esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function numeric(v){if(v==null||v==="")return null;if(typeof v==="number")return Number.isFinite(v)?v:null;const s=String(v).trim().replace(/,/g,""),m=s.match(/^([-+]?\d*\.?\d+)\s*([KMB])?$/i);if(!m)return null;const n=Number(m[1]),factor=({K:1e3,M:1e6,B:1e9})[String(m[2]||"").toUpperCase()]||1;return Number.isFinite(n)?n*factor:null;}
function looksSpanish(s){return /\b(el|la|los|las|de|del|para|con|por|que|una|uno|sus|bienvenidos|gracias|suscríbete|canal|vídeos|videos)\b|[áéíóúñ¿¡]/i.test(String(s||""));}
function englishDescription(c){const choices=[c.descriptionEnglish,c.englishDescription,c.description_en,c.descriptionEn,c.enDescription,c.localized?.en?.description,c.translations?.en?.description];for(const v of choices)if(typeof v==="string"&&v.trim())return v.trim();const generic=typeof c.description==="string"?c.description.trim():"";return generic&&!looksSpanish(generic)?generic:"Jesus loves you! I hope every video makes you smile!";}
function locate(html,id){const safe=String(id).replace(/[.*+?^${}()|[\]\\]/g,"\\$&"),re=new RegExp(`<([a-z][\\w:-]*)\\b(?=[^>]*\\bid=["']${safe}["'])[^>]*>`,"i"),m=re.exec(html);if(!m)return null;const tag=m[1].toLowerCase(),start=m.index,openEnd=start+m[0].length;if(voidTags.has(tag)||/\/\s*>$/.test(m[0]))return{tag,start,openEnd,closeStart:openEnd,end:openEnd,selfClosing:true};const token=new RegExp(`<\\/?${tag}\\b[^>]*>`,"gi");token.lastIndex=openEnd;let depth=1,x;while((x=token.exec(html))){if(/^<\//.test(x[0]))depth--;else if(!/\/\s*>$/.test(x[0]))depth++;if(depth===0)return{tag,start,openEnd,closeStart:x.index,end:token.lastIndex,selfClosing:false};}return null;}
function compileTemplate(html){const ids=["lucanAvatar","mineAvatar","lucanName","lucanHandle","lucanDescription","mineName","mineHandle","lucanRateSign","updated","status","lucanCount","lucanRemaining","lucanRate","stLinearText","stHourlyText","stDailyText","mineEstSubs","mineApiSubs","mineEstViews","mineApiViews","mineEstVideos","mineApiVideos","goalPercent","goalProgress","srcCard","rateBars"];const index={};for(const id of ids){index[id]=locate(html,id);if(!index[id])diagnostics.push("MISSING TEMPLATE ID: "+id);}const re=/(<svg\b(?=[^>]*\bclass=["'][^"']*\bchart\b[^"']*["'])[^>]*>)[\s\S]*?(<\/svg>)/i,m=re.exec(html);index.chart=m?{start:m.index,end:m.index+m[0].length,open:m[1],close:m[2]}:null;if(!index.chart)diagnostics.push("MISSING CHART SVG");return{html,index,originalLength:html.length};}
async function getFonts(){if(!fontPromise)fontPromise=googleFonts([{name:"Inter",weight:"700..900"}]).catch(e=>{fontPromise=null;throw e;});return fontPromise;}
async function getHtml(){if(!htmlPromise)htmlPromise=fs.promises.readFile(path.join(DIR,"index.html"),"utf8").catch(e=>{htmlPromise=null;throw e;});return htmlPromise;}
const css=`<style>
*,*::before,*::after{box-sizing:border-box!important}
html,body{width:1280px!important;height:720px!important;min-width:1280px!important;min-height:720px!important;max-width:1280px!important;max-height:720px!important;overflow:hidden!important;margin:0!important}
.pg{width:99%!important;height:720px!important;min-height:720px!important;max-height:720px!important;box-sizing:border-box!important;display:grid!important;grid-template-rows:48px minmax(0,1fr) 210px 28px!important;gap:10px!important;padding:8px 0!important}
.hero{display:grid!important;grid-template-columns:420px minmax(0,1fr)!important;gap:14px!important;min-height:0!important;min-width:0!important}
.sidebar{display:grid!important;grid-template-rows:minmax(0,1fr) 240px!important;gap:12px!important;min-height:0!important;min-width:0!important}
.main-stats{display:grid!important;grid-template-columns:repeat(3,minmax(0,1fr))!important;gap:14px!important;min-height:0!important;min-width:0!important}
.stat-card{display:grid!important;grid-template-rows:62px minmax(0,1fr) 112px!important;min-width:0!important;min-height:0!important}
.sources-panel{min-height:0!important;min-width:0!important}
.pg>header,.pg>footer{min-height:0!important}
#lucanCount{font-size:46px!important;letter-spacing:-2.5px!important;white-space:nowrap!important;width:100%!important;max-width:100%!important;display:block!important;text-align:center!important;transform:scaleX(.78)!important;transform-origin:center center!important}
.stat-icon{display:inline-flex!important;align-items:center!important;justify-content:center!important;min-width:25px!important}
.stat-icon svg{display:block!important;flex-shrink:0!important}
.src-h{display:flex!important;align-items:center!important;justify-content:space-between!important;font-size:18px!important;font-weight:900!important;letter-spacing:.6px!important}
.src-h>span:first-child{display:flex!important;align-items:center!important;gap:7px!important}
.src-h svg{width:19px!important;height:19px!important}
.src-status{display:flex!important;align-items:center!important;gap:6px!important;font-size:13px!important;font-weight:900!important}
.live-dot{display:inline-block!important;width:8px!important;height:8px!important;min-width:8px!important;border-radius:50%!important;background:#ff4267!important;vertical-align:middle!important}
.mtx{display:grid!important;grid-template-columns:130px repeat(4,minmax(0,1fr))!important;grid-template-rows:20px repeat(3,minmax(0,1fr))!important;gap:3px 7px!important;width:100%!important;min-width:0!important;min-height:0!important}
.mh{font-size:14px!important;font-weight:900!important;text-align:center!important;white-space:nowrap!important;overflow:hidden!important;color:#e1eaff!important}
.mg{font-size:13px!important;font-weight:900!important;white-space:nowrap!important;min-width:0!important}
.cell{padding:3px 7px!important;min-height:0!important;height:100%!important;display:flex!important;align-items:center!important;overflow:hidden!important}
.vl{font-size:clamp(15px,1.25vw,20px)!important;font-weight:900!important;line-height:1.1!important}
.src-meta{display:flex!important;gap:7px!important;margin-top:0!important;min-width:0!important}
.src-meta>div{display:flex!important;flex:1 1 0!important;flex-direction:column!important;align-items:center!important;justify-content:center!important;gap:3px!important;background:#080d1b!important;border:1px solid #26375b!important;border-radius:8px!important;padding:4px 6px!important;min-width:0!important;overflow:hidden!important}
.src-meta span{font-size:12px!important;line-height:1.15!important;font-weight:900!important;color:#c4d2f3!important;text-align:center!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:clip!important}
.src-meta b{font-size:18px!important;line-height:1.1!important;font-weight:900!important;color:#25e5c0!important;white-space:nowrap!important;flex-shrink:0!important}
.odometer{font-family:Inter,sans-serif!important;white-space:nowrap!important;display:inline-block!important;line-height:1em!important;vertical-align:baseline!important;font-variant-numeric:tabular-nums!important;font-feature-settings:"tnum" 1!important}
.roll-window{display:inline-block!important;position:relative!important;width:.62em!important;height:1em!important;min-width:.62em!important;max-width:.62em!important;overflow:hidden!important;vertical-align:baseline!important;line-height:1em!important;padding:0!important;margin:0!important;clip-path:inset(0)!important}
.roll-strip{position:absolute!important;display:block!important;left:0!important;top:0!important;width:100%!important;height:auto!important;line-height:1em!important;padding:0!important;margin:0!important;will-change:transform!important}
.roll-strip>span{display:block!important;position:relative!important;width:100%!important;height:1em!important;min-height:1em!important;max-height:1em!important;line-height:1em!important;padding:0!important;margin:0!important;text-align:center!important;white-space:nowrap!important;font-size:1em!important;font-weight:inherit!important;font-family:inherit!important;font-style:normal!important}
</style>`;
async function getTemplate(){if(!templatePromise)templatePromise=(async()=>{let html=await getHtml();html=html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,"").replace(/<link\b[^>]*>/gi,"");if(!html.includes("</head>"))throw Error("index.html is missing </head>");html=html.replace("</head>",css+"</head>");return compileTemplate(html);})().catch(e=>{templatePromise=null;throw e;});return templatePromise;}
async function avatar(url){if(!url)return"";if(images.has(url))return images.get(url);const task=(async()=>{try{const r=await fetch(url,{signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error("HTTP "+r.status);const b=Buffer.from(await r.arrayBuffer());if(b.length>2e6)throw Error("Avatar too large");console.log(`[AVATAR] OK | ${b.length} bytes | ${url.slice(0,85)}`);return`data:${r.headers.get("content-type")||"image/jpeg"};base64,${b.toString("base64")}`;}catch(e){console.error(`[AVATAR] FAILED | ${e.message} | ${url}`);return"";}})();images.set(url,task);return task;}
function rollingMarkup(id,value,decimals=0,suffix=""){const n=numeric(value);if(n===null)return`<span class="odometer" data-odometer="${esc(id)}">—</span>`;const rounded=decimals?Number(n.toFixed(decimals)):Math.round(n),target=(decimals?rounded.toFixed(decimals):nf.format(rounded))+suffix,now=Date.now();let s=rollStates.get(id);if(!s){s={targetString:target,transitions:[]};rollStates.set(id,s);}else if(s.targetString!==target){const oldDigits=(s.targetString.match(/\d/g)||[]),newDigits=(target.match(/\d/g)||[]);s.transitions=newDigits.map((d,i)=>({from:oldDigits[oldDigits.length-newDigits.length+i]??d,to:d,start:now}));s.targetString=target;}let digitIndex=0,out="";for(const ch of target){if(/\d/.test(ch)){const t=s.transitions[digitIndex++];if(t&&t.from!==t.to){const p=Math.max(0,Math.min(1,(now-t.start)/650));out+=p<1?`<span class="roll-window"><span class="roll-strip" style="transform:translateY(-${p.toFixed(3)}em)"><span>${t.from}</span><span>${t.to}</span></span></span>`:ch;}else out+=ch;}else out+=esc(ch);}return`<span class="odometer" data-odometer="${esc(id)}">${out}</span>`;}
function svgIcon(type){const paths={arrow:'<path d="M7 17 17 7M7 7h10v10"/>',bolt:'<path d="m13 2-9 12h7l-1 8 10-12h-7z"/>',flag:'<path d="M5 3v18M5 4h13l-3 5 3 5H5"/>',grid:'<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18M15 3v18M3 9h18M3 15h18"/>',refresh:'<path d="M20 7v5h-5M4 17v-5h5M5.6 9a7 7 0 0 1 11.8-2L20 12M4 12l2.6 5a7 7 0 0 0 11.8-2"/>'};return`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="23" height="23" fill="none" stroke="#27a9ff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">${paths[type]||paths.grid}</svg>`;}
function chartPoints(a){if(a.length<2)return"0,65 60,55 120,52 180,45 240,38 300,30 360,22 400,15";const min=Math.min(...a),max=Math.max(...a),range=Math.max(1,max-min);return a.map((v,i)=>`${(i/(a.length-1)*400).toFixed(1)},${(68-((v-min)/range)*52).toFixed(1)}`).join(" ");}
function chartMarkup(points){return`<defs><linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#18e9d9" stop-opacity=".35"/><stop offset="100%" stop-color="#18e9d9" stop-opacity="0"/></linearGradient></defs><polygon class="chart-fill" id="chartFill" points="0,80 ${points} 400,80" style="fill:url(#chartGradient);stroke:none;opacity:1"/><polyline points="${points}" fill="none" style="stroke:#168fff;stroke-width:10;stroke-linecap:round;stroke-linejoin:round;opacity:.16"/><polyline id="chartLine" points="${points}" fill="none" style="stroke:#25e5c0;stroke-width:3;stroke-linecap:round;stroke-linejoin:round;opacity:1"/>`;}
function rateBars(){return history.rates.slice(-14).map((v,i,a)=>{const n=Math.min(12,Math.max(1,Math.round(Math.abs(v)*4)));return`<span style="height:${Math.max(12,n*7)}px;opacity:${.55+i/Math.max(1,a.length)*.45}"></span>`;}).join("");}
function sourceCard(a){const rows=[["SUBSCRIBERS",a.st.estSubscribers,a.st.apiSubscribers,a.fw.estimatedSubscribers,a.fw.apiSubscribers],["TOTAL VIEWS",a.st.estViews,a.st.apiViews,a.fw.estimatedViews,a.fw.apiViews],["VIDEOS",a.st.estVideos,a.st.apiVideos,a.fw.estimatedVideos,a.fw.apiVideos]],heads=["","SCTools Est.","SCTools API","FreeWebTools Est.","FreeWebTools API"],display=a.fw.displayCount??a.fw.estimation?.display_count??"—",hourly=a.fw.hourly??a.fw.estimation?.growth_rate_per_hour,daily=a.fw.daily??a.fw.estimation?.growth_rate_per_day;return`<div class="src-h"><span>${svgIcon("grid")} DATA SOURCES</span><span class="src-status"><span class="live-dot"></span> LIVE · BOTH PROVIDERS</span></div><div class="mtx">${heads.map((v,i)=>`<div class="${i?"mh":"mg"}">${v}</div>`).join("")}${rows.map((row,r)=>`<div class="mg">${row[0]}</div>`+row.slice(1).map((v,i)=>`<div class="cell"><span class="vl ${i%2?"api":"fw"}">${rollingMarkup(`src-${r}-${i}`,v)}</span></div>`).join("")).join("")}</div><div class="src-meta"><div><span>FREEWEBTOOLS DISPLAY COUNT</span><b>${rollingMarkup("fw-display-count",display)}</b></div><div><span>FREEWEBTOOLS HOURLY GROWTH</span><b>${rollingMarkup("fw-hourly",hourly)}</b></div><div><span>FREEWEBTOOLS DAILY GROWTH</span><b>${rollingMarkup("fw-daily",daily)}</b></div><div><span>FREEWEBTOOLS CONFIDENCE</span><b>${esc(a.fw.confidence||"—").toUpperCase()}</b></div></div>`;}
function applyPatches(template,patches){let html=template;patches.sort((a,b)=>b.start-a.start);for(const p of patches)html=html.slice(0,p.start)+p.value+html.slice(p.end);return html;}
function addInnerPatch(patches,html,p,id,inner){const x=p[id];if(!x){diagnostics.push("MISSING INNER ID: "+id);return;}patches.push({start:x.start,end:x.end,value:html.slice(x.start,x.openEnd)+inner+html.slice(x.closeStart,x.end)});}
function addTextPatch(patches,html,p,id,value){addInnerPatch(patches,html,p,id,esc(value??"—"));}
function addAttrPatch(patches,html,p,id,name,value){const x=p[id];if(!x){diagnostics.push("MISSING ATTRIBUTE ID: "+id);return;}const open=html.slice(x.start,x.openEnd),re=new RegExp(`\\s${name}=["'][^"']*["']`,"i"),next=re.test(open)?open.replace(re,` ${name}="${esc(value)}"`):open.replace(/\/?>$/,end=>` ${name}="${esc(value)}"`+end);patches.push({start:x.start,end:x.openEnd,value:next});}
function takeSample(){if(latestMain==null||!Number.isFinite(latestMain))return;const now=Date.now(),n=latestMain;history.subs.push(n);if(history.subs.length>18)history.subs.shift();history.samples.push({t:now,n});if(history.samples.length>6)history.samples.shift();if(history.samples.length>1){const first=history.samples[0],last=history.samples.at(-1),seconds=(last.t-first.t)/1000;if(seconds>0){history.rates.push((last.n-first.n)/seconds);if(history.rates.length>14)history.rates.shift();}}history.lastSample=now;}
function record(main){if(main!=null&&Number.isFinite(Number(main)))latestMain=Number(main);if(!sampleTimer&&latestMain!=null){takeSample();sampleTimer=setInterval(takeSample,2000);sampleTimer.unref?.();}}
function layoutDiagnostics(html,p){const ids=["lucanAvatar","mineAvatar","lucanCount","lucanRemaining","lucanRate","srcCard","rateBars","goalProgress","mineEstSubs","mineApiSubs","mineEstViews","mineApiViews","mineEstVideos","mineApiVideos"],found=ids.map(id=>`${id}:${p[id]?"YES":"NO"}`).join(" | ");return{ids:found,gridRules:(html.match(/grid-template-(?:rows|columns)\s*:/gi)||[]).length,flexRules:(html.match(/display\s*:\s*flex/gi)||[]).length,hero:/\.hero\s*\{[^}]*display\s*:\s*grid/i.test(html),main:/\.main-stats\s*\{[^}]*display\s*:\s*grid/i.test(html)};}
async function buildHtml(data={}){const started=process.hrtime.bigint(),l=data.lucan||{},m=data.mine||{},st=l.sctools||{},fw=l.freewebtools||{},mst=m.sctools||{},mfw=m.freewebtools||{},lc=l.channel||{},mc=m.channel||{},main=st.linearSubscribers??st.estSubscribers??fw.estimatedSubscribers??st.apiSubscribers??fw.apiSubscribers,remaining=main==null?null:Math.max(0,60000000-Number(main)),progress=main==null?0:Math.min(100,Number(main)/60000000*100),hourly=st.hourly??fw.hourly,daily=st.daily??fw.daily;record(main);const[la,ma,template]=await Promise.all([avatar(lc.avatar),avatar(mc.avatar),getTemplate()]);diagnostics.length=0;const base=template.html,p=template.index,patches=[],rate=history.rates.at(-1)??null;addAttrPatch(patches,base,p,"lucanAvatar","src",la||"data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=");addAttrPatch(patches,base,p,"mineAvatar","src",ma||"data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=");const fields={lucanName:lc.name||"Lucan Pevidor",lucanHandle:lc.handle||"@LucanPevidor",lucanDescription:englishDescription(lc),mineName:mc.name||"VYStats",mineHandle:mc.handle||"@vystatsyt",lucanRateSign:rate!=null&&rate<0?"−":"+",updated:(l.updated||m.updated)?"↻ UPDATED "+new Date(Math.max(l.updated||0,m.updated||0)).toLocaleTimeString():"WAITING FOR DATA",status:l.updated||m.updated?"● CONNECTED":"● CONNECTING"};for(const[id,v]of Object.entries(fields))addTextPatch(patches,base,p,id,v);for(const[id,v,d]of [["lucanCount",main,0],["lucanRemaining",remaining,0],["lucanRate",rate==null?null:Math.abs(rate),2],["stLinearText",st.linearSubscribers??st.estSubscribers,0],["stHourlyText",hourly,0],["stDailyText",daily,0],["mineEstSubs",mst.estSubscribers??mfw.estimatedSubscribers,0],["mineApiSubs",mst.apiSubscribers??mfw.apiSubscribers,0],["mineEstViews",mst.estViews??mfw.estimatedViews,0],["mineApiViews",mst.apiViews??mfw.viewCount,0],["mineEstVideos",mst.estVideos??mfw.videoCount,0],["mineApiVideos",mst.apiVideos??mfw.videoCount,0],["goalPercent",progress,1]])addInnerPatch(patches,base,p,id,rollingMarkup(id,v,d,id==="goalPercent"?"%":""));addAttrPatch(patches,base,p,"goalProgress","style",`width:${progress}%;`);addInnerPatch(patches,base,p,"srcCard",sourceCard({st,fw}));addInnerPatch(patches,base,p,"rateBars",rateBars());if(p.chart)patches.push({start:p.chart.start,end:p.chart.end,value:p.chart.open+chartMarkup(chartPoints(history.subs))+p.chart.close});else diagnostics.push("MISSING CHART SVG");let html=applyPatches(base,patches);html=html.replace('<span class="stat-icon">↗</span>',`<span class="stat-icon">${svgIcon("arrow")}</span>`).replace('<span class="stat-icon">ϟ</span>',`<span class="stat-icon">${svgIcon("bolt")}</span>`).replace('<span class="stat-icon">⚑</span>',`<span class="stat-icon">${svgIcon("flag")}</span>`);html=html.replace(/●/g,'<span class="live-dot"></span>').replace(/[◉◎]/g,"").replace("↻ UPDATED",`${svgIcon("refresh")} UPDATED`);if(!diagLogged){const after=layoutDiagnostics(html,p),key=JSON.stringify({after,diagnostics});if(key!==lastDiag||Date.now()-lastLog>60000){lastDiag=key;lastLog=Date.now();console.log(`[HTML DIAGNOSTICS] original=${template.originalLength} | final=${html.length} chars | build=${elapsed(started).toFixed(1)}ms`);console.log("[HTML IDS]",after.ids);console.log("[LAYOUT CHECK]",JSON.stringify(after));console.log("[HTML CHANGES]",diagnostics.length?diagnostics.join(" || "):"All requested replacements found");}diagLogged=true;}return html;}
async function renderInternal(data={},mode="png"){const start=process.hrtime.bigint();try{const[html,fonts]=await Promise.all([buildHtml(data),getFonts()]),built=process.hrtime.bigint(),output=await render(html,{width:W,height:H,format:mode==="raw"?"raw":"png",fonts}),rendered=process.hrtime.bigint(),result=Buffer.from(output),converted=process.hrtime.bigint();lastTiming={buildMs:elapsed(start,built),renderMs:elapsed(built,rendered),bufferMs:elapsed(rendered,converted),totalMs:elapsed(start,converted)};if(mode==="raw"&&result.length!==W*H*4)throw Error(`Bad RGBA frame: ${result.length}; expected ${W*H*4}`);if(mode==="png"){const signature=result.subarray(0,8).toString("hex"),width=result.length>=24?result.readUInt32BE(16):0,height=result.length>=24?result.readUInt32BE(20):0;if(signature!=="89504e470d0a1a0a")throw Error("Invalid PNG signature: "+signature);console.log(`[TAKUMI] PNG OK | ${width}x${height} | ${(result.length/1024).toFixed(1)} KB | build=${lastTiming.buildMs.toFixed(1)}ms render=${lastTiming.renderMs.toFixed(1)}ms buffer=${lastTiming.bufferMs.toFixed(1)}ms total=${lastTiming.totalMs.toFixed(1)}ms`);if(width!==W||height!==H)console.warn(`[TAKUMI] WRONG SIZE ${width}x${height}`);}else if(result.length!==W*H*4)throw Error(`Bad RGBA frame: ${result.length}; expected ${W*H*4}`);return result;}catch(e){console.error(`[TAKUMI FATAL] ${mode} failed after ${elapsed(start).toFixed(1)}ms`);console.error(e.stack||e);throw e;}}
function run(data,mode){const job=queue.then(()=>renderInternal(data,mode));queue=job.catch(e=>console.error("[RENDER QUEUE]",e.message));return job;}
const renderDashboard=data=>run(data,"png"),renderRawFrame=data=>run(data,"raw");
function stats(a){if(!a.length)return{averageMs:0,medianMs:0,p95Ms:0,minMs:0,maxMs:0};const s=[...a].sort((x,y)=>x-y),avg=a.reduce((x,y)=>x+y,0)/a.length,p=q=>s[Math.min(s.length-1,Math.ceil(s.length*q)-1)],r=n=>+n.toFixed(2);return{averageMs:r(avg),medianMs:r(p(.5)),p95Ms:r(p(.95)),minMs:r(s[0]),maxMs:r(s.at(-1))};}
async function freshBenchmark(getData){const duration=10000,interval=BigInt(Math.round(FRAME_MS*1e6));await getFonts();await getTemplate();const warmData=await getData();await renderRawFrame(warmData);const start=process.hrtime.bigint(),before=process.memoryUsage(),times=[],buildTimes=[],renderTimes=[],bufferTimes=[];let frames=0,missed=0,maxLate=0,firstSize=0,next=start+interval;const cpu=process.cpuUsage();while(elapsed(start)<duration){const t=process.hrtime.bigint(),data=await getData(),frame=await renderRawFrame(data),done=process.hrtime.bigint();times.push(elapsed(t,done));buildTimes.push(lastTiming.buildMs||0);renderTimes.push(lastTiming.renderMs||0);bufferTimes.push(lastTiming.bufferMs||0);frames++;firstSize=frame.length;if(done>next){const late=done-next,slots=Number(late/interval)+1;missed+=slots;maxLate=Math.max(maxLate,Number(late)/1e6);next+=BigInt(slots)*interval;}else next+=interval;}const after=process.memoryUsage(),used=process.cpuUsage(cpu),total=elapsed(start),m=n=>+(n/1048576).toFixed(2),timing=stats(times),estimatedFPS=total>0?frames/(total/1000):0,averageFrameFPS=timing.averageMs>0?1000/timing.averageMs:0;return{renderer:"takumi-js",mode:"warmed-render-with-rolling-digits",warmupFrames:1,resolution:`${W}x${H}`,fpsTarget:FPS,frameIntervalMs:+FRAME_MS.toFixed(3),durationMs:+total.toFixed(2),frames,frameSizeBytes:firstSize,frameSizeMiB:m(firstSize),freshRenderFPS:+estimatedFPS.toFixed(2),estimatedFPS:+estimatedFPS.toFixed(2),averageFrameCapacityFPS:+averageFrameFPS.toFixed(2),fpsGoal:FPS,fpsGoalAchievedPercent:+(estimatedFPS/FPS*100).toFixed(2),fpsGoalMet:estimatedFPS>=FPS,renderTime:timing,stages:{htmlPreparation:stats(buildTimes),takumiRender:stats(renderTimes),bufferConversion:stats(bufferTimes)},missedDeadlines:missed,missedDeadlinePercent:+(missed/Math.max(1,frames+missed)*100).toFixed(2),maxLatenessMs:+maxLate.toFixed(2),cpu:{userMs:+(used.user/1000).toFixed(2),systemMs:+(used.system/1000).toFixed(2)},memory:{heapBeforeMiB:m(before.heapUsed),heapAfterMiB:m(after.heapUsed),externalBeforeMiB:m(before.external),externalAfterMiB:m(after.external),rssBeforeMiB:m(before.rss),rssAfterMiB:m(after.rss)}};}

/* BENCHMARK VARIANT HELPERS */
function replaceElementInner(html,id,inner){const x=locate(html,id);if(!x||x.selfClosing)return html;return html.slice(0,x.openEnd)+inner+html.slice(x.closeStart);}
function replaceAvatarSource(html,id){const x=locate(html,id);if(!x)return html;const open=html.slice(x.start,x.openEnd),re=/\ssrc=["'][^"']*["']/i,next=re.test(open)?open.replace(re,' src="data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=“'):open.replace(/\/?>$/,end=>' src="data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs="'+end);return html.slice(0,x.start)+next+html.slice(x.openEnd);}
function hideElement(html,id){const x=locate(html,id);if(!x)return html;return html.slice(0,x.start)+html.slice(x.start,x.openEnd).replace(/>$/,` style="display:none!important">`)+html.slice(x.openEnd);}
function removeElement(html,id){const x=locate(html,id);return x?html.slice(0,x.start)+html.slice(x.end):html;}
function noRollingDigits(html){return html.replace(/<span class="roll-window"><span class="roll-strip"[^>]*><span>\d<\/span><span>(\d)<\/span><\/span><\/span>/g,"$1");}
function noVisualEffects(html){return html.replace(/(?:box-shadow|text-shadow|filter|backdrop-filter)\s*:[^;}]+;?/gi,"");}
function noShadows(html){return html.replace(/(?:box-shadow|text-shadow)\s*:[^;}]+;?/gi,"");}
function noFilters(html){return html.replace(/(?:filter|backdrop-filter)\s*:[^;}]+;?/gi,"");}
function noGradients(html){return html.replace(/(?:background|background-image|fill)\s*:[^;}]*gradient\([^;}]*\)[^;}]*;?/gi,"background:none!important;");}
function noBordersRadius(html){return html.replace(/border-radius\s*:[^;}]+;?/gi,"border-radius:0!important;");}
function noTransforms(html){return html.replace(/transform(?:-origin)?\s*:[^;}]+;?/gi,"");}
function noChart(html){return html.replace(/<svg\b(?=[^>]*\bclass=["'][^"']*\bchart\b[^"']*["'])[^>]*>[\s\S]*?<\/svg>/i,'<svg class="chart" viewBox="0 0 400 80"></svg>');}
function noSourcePanel(html){return replaceElementInner(html,"srcCard",'<div style="height:100%;width:100%"></div>');}
function noRateBars(html){return replaceElementInner(html,"rateBars","");}
function noSvgIcons(html){return html.replace(/<svg\b(?![^>]*\bclass=["'][^"']*\bchart\b[^"']*["'])[^>]*>[\s\S]*?<\/svg>/gi,"");}
function noAllSvg(html){return html.replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi,"");}
function noImages(html){return html.replace(/<img\b[^>]*>/gi,"");}
function simpleSourcePanel(html){const simple='<div class="src-h">DATA SOURCES · SIMPLIFIED</div><div style="display:flex;gap:16px;justify-content:space-around;padding:18px;font-size:18px;font-weight:900"><span>SCTOOLS</span><span>FREEWEBTOOLS</span></div>';return replaceElementInner(html,"srcCard",simple);}
function simpleChart(html){return html.replace(/<svg\b(?=[^>]*\bclass=["'][^"']*\bchart\b[^"']*["'])[^>]*>[\s\S]*?<\/svg>/i,'<svg class="chart" viewBox="0 0 400 80"><polyline points="0,60 100,45 200,50 300,25 400,15" fill="none" stroke="#25e5c0" stroke-width="3"/></svg>');}
function simpleRateBars(html){return replaceElementInner(html,"rateBars",'<span style="height:30px"></span><span style="height:50px"></span><span style="height:40px"></span><span style="height:60px"></span>');}
function simpleAvatars(html){return html.replace(/<img\b[^>]*\bid=["'](?:lucanAvatar|mineAvatar)["'][^>]*>/gi,'<div class="avatar-benchmark-placeholder"></div>');}
function stripInlineSvgIcons(html){return html.replace(/<svg\b(?![^>]*\bclass=["'][^"']*\bchart\b[^"']*["'])[^>]*>[\s\S]*?<\/svg>/gi,'<span class="icon-placeholder"></span>');}
function diagnosticVariants(html){
 const noAvatars=replaceAvatarSource(replaceAvatarSource(html,"lucanAvatar"),"mineAvatar");
 const noAvatarElements=hideElement(hideElement(html,"lucanAvatar"),"mineAvatar");
 const noSource=noSourcePanel(html),noBars=noRateBars(html),noRoll=noRollingDigits(html),noEffects=noVisualEffects(html),noChartVersion=noChart(html);
 const allSimple=noChart(noVisualEffects(noRollingDigits(noRateBars(noSource(noAvatars)))));
 return{
  "00 BASELINE · ORIGINAL":html,
  "01 REMOVE LUCAN AVATAR SOURCE":replaceAvatarSource(html,"lucanAvatar"),
  "02 REMOVE VYSTATS AVATAR SOURCE":replaceAvatarSource(html,"mineAvatar"),
  "03 REMOVE BOTH AVATAR SOURCES":noAvatars,
  "04 HIDE BOTH AVATAR ELEMENTS":noAvatarElements,
  "05 REMOVE ALL IMAGE ELEMENTS":noImages(html),
  "06 REMOVE CHART CONTENT":noChartVersion,
  "07 SIMPLIFY CHART CONTENT":simpleChart(html),
  "08 REMOVE RATE BARS":noBars,
  "09 SIMPLIFY RATE BARS":simpleRateBars(html),
  "10 REMOVE SOURCE PANEL CONTENT":noSource,
  "11 SIMPLIFY SOURCE PANEL":simpleSourcePanel(html),
  "12 REMOVE ROLLING DIGITS":noRoll,
  "13 REMOVE ALL SVG ICONS":noSvgIcons(html),
  "14 REPLACE SVG ICONS WITH PLACEHOLDERS":stripInlineSvgIcons(html),
  "15 REMOVE ALL SVG INCLUDING CHART":noAllSvg(html),
  "16 REMOVE BOX SHADOWS AND TEXT SHADOWS":noShadows(html),
  "17 REMOVE FILTERS":noFilters(html),
  "18 REMOVE ALL VISUAL EFFECTS":noEffects,
  "19 REMOVE GRADIENTS":noGradients(html),
  "20 REMOVE BORDER RADII":noBordersRadius(html),
  "21 REMOVE TRANSFORMS":noTransforms(html),
  "22 REMOVE DESCRIPTION TEXT":replaceElementInner(html,"lucanDescription",""),
  "23 REMOVE SOURCE + RATE BARS":noRateBars(noSource(html)),
  "24 REMOVE AVATARS + ROLLING DIGITS":noRollingDigits(noAvatars),
  "25 REMOVE AVATARS + CHART":noChart(noAvatars),
  "26 REMOVE AVATARS + SOURCE PANEL":noSource(noAvatars),
  "27 REMOVE AVATARS + RATE BARS":noRateBars(noAvatars),
  "28 REMOVE AVATARS + VISUAL EFFECTS":noVisualEffects(noAvatars),
  "29 REMOVE AVATARS + ROLLING + CHART":noChart(noRollingDigits(noAvatars)),
  "30 REMOVE AVATARS + ROLLING + SOURCE":noSource(noRollingDigits(noAvatars)),
  "31 REMOVE AVATARS + ROLLING + RATE BARS":noRateBars(noRollingDigits(noAvatars)),
  "32 REMOVE AVATARS + ROLLING + ALL SVG":noAllSvg(noRollingDigits(noAvatars)),
  "33 REMOVE AVATARS + ROLLING + VISUAL EFFECTS":noVisualEffects(noRollingDigits(noAvatars)),
  "34 REMOVE AVATARS + ROLLING + CHART + SOURCE":noSource(noChart(noRollingDigits(noAvatars))),
  "35 REMOVE AVATARS + ROLLING + CHART + SOURCE + BARS":noRateBars(noSource(noChart(noRollingDigits(noAvatars)))),
  "36 ALL MAJOR COMPONENTS SIMPLIFIED":allSimple
 };
}

/* MULTI-ROUND COMPONENT BENCHMARK */
async function runDiagnostics(getData){
 const totalStart=process.hrtime.bigint(),measurements=20,warmups=2;
 console.log("[MULTI DIAGNOSTICS] Getting current dashboard data...");
 const data=await getData(),html=await buildHtml(data),fonts=await getFonts(),variants=diagnosticVariants(html),names=Object.keys(variants),options={width:W,height:H,format:"raw",fonts},results={};
 console.log(`[MULTI DIAGNOSTICS] ${names.length} variants | ${warmups} warmups + ${measurements} measured frames each | ${W}x${H}`);
 console.log("[MULTI DIAGNOSTICS] Every variant will be warmed before any timed measurements.");
 const memoryBefore=process.memoryUsage(),cpuStart=process.cpuUsage();
 for(const name of names){
  try{
   let lastOutput;
   for(let i=0;i<warmups;i++)lastOutput=await render(variants[name],options);
   const size=lastOutput?.byteLength??lastOutput?.length??0;
   if(size!==W*H*4)throw Error(`Warm-up returned ${size} bytes; expected ${W*H*4}`);
   results[name]={status:"ready",renderTimes:[],bufferTimes:[],totalTimes:[],frameSizeBytes:size};
   console.log(`[MULTI WARMUP] READY | ${name}`);
  }catch(e){
   results[name]={status:"failed",error:e.message};
   console.error(`[MULTI WARMUP] FAILED | ${name} | ${e.message}`);
  }
 }
 const active=names.filter(n=>results[n]?.status==="ready");
 console.log(`[MULTI DIAGNOSTICS] ${active.length}/${names.length} variants ready. Starting alternating rounds...`);
 for(let round=0;round<measurements;round++){
  const ordered=active.slice(round%active.length).concat(active.slice(0,round%active.length));
  for(const name of ordered){
   const result=results[name];
   try{
    const start=process.hrtime.bigint();
    const output=await render(variants[name],options);
    const rendered=process.hrtime.bigint();
    const frame=Buffer.from(output);
    const converted=process.hrtime.bigint();
    if(frame.length!==W*H*4)throw Error(`Invalid RGBA frame: ${frame.length}; expected ${W*H*4}`);
    result.renderTimes.push(elapsed(start,rendered));
    result.bufferTimes.push(elapsed(rendered,converted));
    result.totalTimes.push(elapsed(start,converted));
   }catch(e){
    result.status="failed";
    result.error=e.message;
    console.error(`[MULTI MEASURE] FAILED | ${name} | ${e.message}`);
   }
  }
  console.log(`[MULTI PROGRESS] Round ${round+1}/${measurements} | ${active.length} variants`);
 }
 const baseline=results["00 BASELINE · ORIGINAL"],baselineMs=baseline?.renderTimes?.length?stats(baseline.renderTimes).averageMs:null;
 for(const name of names){
  const r=results[name];
  if(r.status!=="ready")continue;
  const renderStats=stats(r.renderTimes),bufferStats=stats(r.bufferTimes),totalStats=stats(r.totalTimes);
  r.status="completed";
  r.measuredFrames=r.renderTimes.length;
  r.renderTime=renderStats;
  r.bufferConversion=bufferStats;
  r.totalTime=totalStats;
  r.estimatedFPS=renderStats.averageMs>0?+(1000/renderStats.averageMs).toFixed(2):0;
  r.timeSavedMs=baselineMs==null?null:+(baselineMs-renderStats.averageMs).toFixed(2);
  r.improvementPercent=baselineMs==null?null:+((baselineMs-renderStats.averageMs)/baselineMs*100).toFixed(2);
  delete r.renderTimes;delete r.bufferTimes;delete r.totalTimes;
  console.log(`[MULTI RESULT] ${name} | render=${renderStats.averageMs}ms | p95=${renderStats.p95Ms}ms | FPS=${r.estimatedFPS} | saved=${r.timeSavedMs}ms`);
 }
 const completed=names.filter(n=>results[n]?.status==="completed").map(name=>({name,...results[name]}));
 const sorted=[...completed].sort((a,b)=>a.renderTime.averageMs-b.renderTime.averageMs);
 const baselineResult=results["00 BASELINE · ORIGINAL"],baselineRender=baselineResult?.renderTime;
 const best=sorted[0],worst=sorted.at(-1),memoryAfter=process.memoryUsage(),cpuUsed=process.cpuUsage(cpuStart);
 const categoryGroups={
  avatarTests:["00 BASELINE · ORIGINAL","01 REMOVE LUCAN AVATAR SOURCE","02 REMOVE VYSTATS AVATAR SOURCE","03 REMOVE BOTH AVATAR SOURCES","04 HIDE BOTH AVATAR ELEMENTS","05 REMOVE ALL IMAGE ELEMENTS"],
  chartTests:["00 BASELINE · ORIGINAL","06 REMOVE CHART CONTENT","07 SIMPLIFY CHART CONTENT"],
  rateBarTests:["00 BASELINE · ORIGINAL","08 REMOVE RATE BARS","09 SIMPLIFY RATE BARS"],
  sourceTests:["00 BASELINE · ORIGINAL","10 REMOVE SOURCE PANEL CONTENT","11 SIMPLIFY SOURCE PANEL"],
  rollingDigitTests:["00 BASELINE · ORIGINAL","12 REMOVE ROLLING DIGITS"],
  svgTests:["00 BASELINE · ORIGINAL","13 REMOVE ALL SVG ICONS","14 REPLACE SVG ICONS WITH PLACEHOLDERS","15 REMOVE ALL SVG INCLUDING CHART"],
  effectsTests:["00 BASELINE · ORIGINAL","16 REMOVE BOX SHADOWS AND TEXT SHADOWS","17 REMOVE FILTERS","18 REMOVE ALL VISUAL EFFECTS","19 REMOVE GRADIENTS","20 REMOVE BORDER RADII","21 REMOVE TRANSFORMS"],
  combinations:["23 REMOVE SOURCE + RATE BARS","24 REMOVE AVATARS + ROLLING DIGITS","25 REMOVE AVATARS + CHART","26 REMOVE AVATARS + SOURCE PANEL","27 REMOVE AVATARS + RATE BARS","28 REMOVE AVATARS + VISUAL EFFECTS","29 REMOVE AVATARS + ROLLING + CHART","30 REMOVE AVATARS + ROLLING + SOURCE","31 REMOVE AVATARS + ROLLING + RATE BARS","32 REMOVE AVATARS + ROLLING + ALL SVG","33 REMOVE AVATARS + ROLLING + VISUAL EFFECTS","34 REMOVE AVATARS + ROLLING + CHART + SOURCE","35 REMOVE AVATARS + ROLLING + CHART + SOURCE + BARS","36 ALL MAJOR COMPONENTS SIMPLIFIED"]
 };
 const groups={};
 for(const[group,list]of Object.entries(categoryGroups))groups[group]=list.filter(n=>results[n]?.status==="completed").map(name=>({name,averageMs:results[name].renderTime.averageMs,p95Ms:results[name].renderTime.p95Ms,estimatedFPS:results[name].estimatedFPS,timeSavedMs:results[name].timeSavedMs,improvementPercent:results[name].improvementPercent}));
 const duration=elapsed(totalStart);
 return{
  renderer:"takumi-js",
  mode:"comprehensive-alternating-dashboard-component-benchmark",
  resolution:`${W}x${H}`,
  targetFPS:FPS,
  targetFrameTimeMs:+FRAME_MS.toFixed(3),
  totalVariants:names.length,
  warmupFramesPerVariant:warmups,
  measuredFramesPerVariant:measurements,
  measurementOrder:"All variants are warmed first. Each measurement round rotates the starting variant to reduce ordering and timing bias. Render and Buffer conversion are timed separately.",
  baseline:{averageRenderMs:baselineRender?.averageMs??null,medianRenderMs:baselineRender?.medianMs??null,p95RenderMs:baselineRender?.p95Ms??null,estimatedFPS:baselineResult?.estimatedFPS??null},
  fastestVariant:best?{name:best.name,averageRenderMs:best.renderTime.averageMs,p95RenderMs:best.renderTime.p95Ms,estimatedFPS:best.estimatedFPS,timeSavedMs:best.timeSavedMs,improvementPercent:best.improvementPercent}:null,
  slowestVariant:worst?{name:worst.name,averageRenderMs:worst.renderTime.averageMs,estimatedFPS:worst.estimatedFPS}:null,
  rankedResults:sorted.map((r,i)=>({rank:i+1,name:r.name,averageRenderMs:r.renderTime.averageMs,medianRenderMs:r.renderTime.medianMs,p95RenderMs:r.renderTime.p95Ms,minRenderMs:r.renderTime.minMs,maxRenderMs:r.renderTime.maxMs,bufferAverageMs:r.bufferConversion.averageMs,totalAverageMs:r.totalTime.averageMs,estimatedFPS:r.estimatedFPS,timeSavedMs:r.timeSavedMs,improvementPercent:r.improvementPercent})),
  categoryComparisons:groups,
  allResults:results,
  runtime:{durationMs:+duration.toFixed(2),durationMinutes:+(duration/60000).toFixed(2),cpuUserMs:+(cpuUsed.user/1000).toFixed(2),cpuSystemMs:+(cpuUsed.system/1000).toFixed(2),memoryBeforeMiB:{heap:mib(memoryBefore.heapUsed),external:mib(memoryBefore.external),rss:mib(memoryBefore.rss)},memoryAfterMiB:{heap:mib(memoryAfter.heapUsed),external:mib(memoryAfter.external),rss:mib(memoryAfter.rss)}},
  interpretation:{targetFrameTimeMs:+FRAME_MS.toFixed(3),targetFPS:FPS,baselineTargetMet:baselineRender?baselineRender.averageMs<=FRAME_MS:null,bestTargetMet:best?best.renderTime.averageMs<=FRAME_MS:null,warning:"A faster variant identifies rendering cost associated with the changed component. Individual savings are not additive. The benchmark uses the same fixed HTML snapshot and does not measure data fetching or HTML generation."},
  note:"Avatar source tests replace image sources with a tiny transparent image; the separate hide-avatar test hides the image elements. All individual component tests change one thing from the original dashboard. Combination tests stack changes. The output Buffer conversion is measured separately from Takumi's render call. A 20-frame sample is more useful than 15 but still has some variance; compare median and P95 as well as average."
 };
}

/* TAKUMI ENGINE COST TEST */
const minimalTestHtml="<!doctype html><html><head><meta charset=utf-8><style>html,body{margin:0;width:1280px;height:720px;overflow:hidden;background:#080d1b;color:#fff;font-family:Arial,sans-serif}</style></head><body><div>Takumi baseline</div></body></html>";
const simpleTestHtml="<!doctype html><html><head><meta charset=utf-8><style>*{box-sizing:border-box}html,body{margin:0;width:1280px;height:720px;overflow:hidden;background:#080d1b;color:#fff;font-family:Arial,sans-serif}.page{width:1280px;height:720px;padding:30px;display:grid;grid-template-columns:1fr 1fr;grid-template-rows:100px 1fr;gap:20px}.panel{background:linear-gradient(145deg,#151f38,#0b1224);border:1px solid #26375b;border-radius:16px;padding:24px;box-shadow:0 10px 30px #0008}.number{font-size:64px;font-weight:900;color:#25e5c0}.label{font-size:20px;font-weight:800;color:#c4d2f3}</style></head><body><div class=page><div class=panel><div class=label>LIVE SUBSCRIBERS</div><div class=number>81,234,567</div></div><div class=panel><div class=label>SUBSCRIBERS PER SECOND</div><div class=number>+12.45</div></div><div class=panel><div class=label>LIVE DASHBOARD</div><div class=number>15 FPS</div></div><div class=panel><div class=label>RENDER ENGINE</div><div class=number>TAKUMI</div></div></div></body></html>";
async function measureTakumiHtml(html,fonts,frames=20){const options={width:W,height:H,format:"raw",fonts},times=[],bufferTimes=[];let outputSize=0;for(let i=0;i<2;i++){const warm=await render(html,options),frame=Buffer.from(warm);if(frame.length!==W*H*4)throw Error(`Takumi warm-up returned ${frame.length} bytes; expected ${W*H*4}`);outputSize=frame.length;}for(let i=0;i<frames;i++){const start=process.hrtime.bigint(),output=await render(html,options),rendered=process.hrtime.bigint(),frame=Buffer.from(output),converted=process.hrtime.bigint();if(frame.length!==W*H*4)throw Error(`Takumi test returned invalid RGBA size: ${frame.length}`);times.push(elapsed(start,rendered));bufferTimes.push(elapsed(rendered,converted));}const timing=stats(times),buffer=stats(bufferTimes);return{status:"completed",measuredFrames:times.length,renderTime:timing,bufferConversion:buffer,estimatedFPS:timing.averageMs>0?+(1000/timing.averageMs).toFixed(2):0,frameSizeBytes:outputSize};}
async function runTakumiCostDiagnostics(getData){const totalStart=process.hrtime.bigint(),measurements=20;console.log("[TAKUMI COST] Preparing tests...");const fonts=await getFonts(),data=await getData(),prepTimes=[];let fullHtml=await buildHtml(data);for(let i=0;i<measurements;i++){const start=process.hrtime.bigint();fullHtml=await buildHtml(data);prepTimes.push(elapsed(start));}const preparation=stats(prepTimes),tests={minimalHtml:minimalTestHtml,simpleDashboard:simpleTestHtml,fullDashboard:fullHtml},results={};for(const[name,html]of Object.entries(tests)){console.log(`[TAKUMI COST] Measuring ${name}...`);try{results[name]=await measureTakumiHtml(html,fonts,measurements);console.log(`[TAKUMI COST] ${name} | ${results[name].renderTime.averageMs}ms | ${results[name].estimatedFPS} FPS`);}catch(e){results[name]={status:"failed",error:e.message};console.error(`[TAKUMI COST] ${name} FAILED | ${e.message}`);}}const full=results.fullDashboard?.renderTime?.averageMs,minimal=results.minimalHtml?.renderTime?.averageMs,simple=results.simpleDashboard?.renderTime?.averageMs;return{renderer:"takumi-js",mode:"isolated-engine-and-html-preparation-cost",resolution:`${W}x${H}`,targetFPS:FPS,targetFrameTimeMs:+FRAME_MS.toFixed(3),warmupFramesPerTest:2,measuredFramesPerTest:measurements,results,htmlPreparation:{status:"completed",measuredBuilds:prepTimes.length,timing:preparation,includesAvatarAndTemplateCache:"Avatar and template caches are warmed before timed builds."},comparisons:{simpleOverMinimalMs:minimal!=null&&simple!=null?+(simple-minimal).toFixed(2):null,fullOverMinimalMs:minimal!=null&&full!=null?+(full-minimal).toFixed(2):null,fullOverSimpleMs:simple!=null&&full!=null?+(full-simple).toFixed(2):null,fullRenderPlusPreparationMs:full!=null?+(full+preparation.averageMs).toFixed(2):null},totalTestDurationMs:+elapsed(totalStart).toFixed(2),note:"Minimal, simple, and full dashboard HTML are tested at the same output resolution. Takumi rendering and Buffer conversion are timed separately. The full dashboard uses a fixed HTML snapshot."};}

function attach(app,getData){
 app.get("/api/renderer/preview.png",async(req,res)=>{if(benchmarkActive)return res.status(503).send("Benchmark running; retry shortly");try{console.log("[PREVIEW REQUEST]",new Date().toISOString());const data=await getData();console.log("[PREVIEW DATA]",JSON.stringify({lucanUpdated:data?.lucan?.updated,mineUpdated:data?.mine?.updated,lucanSources:Object.keys(data?.lucan?.sctools||{}),mineSources:Object.keys(data?.mine?.sctools||{})}));const png=await renderDashboard(data);res.set({"Content-Type":"image/png","Cache-Control":"no-store, no-cache, must-revalidate"}).send(png);console.log(`[PREVIEW SENT] ${png.length} bytes`);}catch(e){console.error("[PREVIEW ROUTE]",e.stack||e.message);if(!res.headersSent)res.status(500).send(e.stack||e.message);}});
 app.get("/api/renderer/benchmark",async(req,res)=>{if(benchmarkActive)return res.status(409).json({error:"Benchmark already running"});benchmarkActive=true;try{res.set("Cache-Control","no-store, no-cache, must-revalidate");res.json(await freshBenchmark(getData));}catch(e){console.error("[TAKUMI BENCHMARK]",e.stack||e.message);if(!res.headersSent)res.status(500).json({error:"Benchmark failed",message:e.message});}finally{benchmarkActive=false;}});
 app.get("/api/renderer/diagnostics",async(req,res)=>{if(benchmarkActive)return res.status(409).json({error:"Another benchmark is running"});benchmarkActive=true;try{const job=queue.then(()=>runDiagnostics(getData));queue=job.catch(e=>console.error("[DIAGNOSTIC QUEUE]",e.message));res.set("Cache-Control","no-store, no-cache, must-revalidate");res.json(await job);}catch(e){console.error("[RENDER DIAGNOSTICS]",e.stack||e.message);if(!res.headersSent)res.status(500).json({error:"Diagnostics failed",message:e.message});}finally{benchmarkActive=false;}});
 app.get("/api/renderer/multi-diagnostics",async(req,res)=>{if(benchmarkActive)return res.status(409).json({error:"Another benchmark is running"});benchmarkActive=true;try{const job=queue.then(()=>runDiagnostics(getData));queue=job.catch(e=>console.error("[MULTI DIAGNOSTIC QUEUE]",e.message));res.set("Cache-Control","no-store, no-cache, must-revalidate");res.json(await job);}catch(e){console.error("[MULTI DIAGNOSTICS]",e.stack||e.message);if(!res.headersSent)res.status(500).json({error:"Multi diagnostics failed",message:e.message});}finally{benchmarkActive=false;}});
 app.get("/api/renderer/takumi-cost",async(req,res)=>{if(benchmarkActive)return res.status(409).json({error:"Another benchmark is running"});benchmarkActive=true;try{const job=queue.then(()=>runTakumiCostDiagnostics(getData));queue=job.catch(e=>console.error("[TAKUMI COST QUEUE]",e.message));res.set("Cache-Control","no-store, no-cache, must-revalidate");res.json(await job);}catch(e){console.error("[TAKUMI COST]",e.stack||e.message);if(!res.headersSent)res.status(500).json({error:"Takumi cost benchmark failed",message:e.message});}finally{benchmarkActive=false;}});
}
module.exports={renderDashboard,renderRawFrame,attach};
