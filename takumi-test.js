
const fs = require("node:fs/promises");
const { render } = require("takumi-js");
const { googleFonts } = require("takumi-js/helpers");

const BASE = process.env.DASHBOARD_URL || "http://127.0.0.1:3000";
const esc = v => String(v ?? "—").replace(/[&<>"']/g, c => ({
  "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
}[c]));
const num = v => Number.isFinite(Number(v)) ? Math.floor(Number(v)).toLocaleString("en-US") : "—";

function setText(html, id, value) {
  const re = new RegExp(`(<[^>]+id="${id}"[^>]*>)[\\s\\S]*?(<\\/[^>]+>)`);
  return html.replace(re, `$1${esc(value)}$2`);
}

function setImage(html, id, url) {
  if (!url) return html;
  const re = new RegExp(`<img([^>]*id="${id}"[^>]*)>`);
  return html.replace(re, (_, attrs) =>
    `<img${attrs.replace(/\ssrc="[^"]*"/, "")} src="${esc(url)}">`);
}

function sourceTable(st, fw) {
  const rows = [
    ["SUBSCRIBERS", [st.estSubscribers, st.apiSubscribers, fw.estimatedSubscribers, fw.apiSubscribers]],
    ["TOTAL VIEWS", [st.estViews, st.apiViews, fw.estimatedViews, fw.viewCount]],
    ["VIDEOS", [st.estVideos, st.apiVideos, fw.estimatedVideos, fw.videoCount]]
  ];
  const heads = ["SCTools Est.", "SCTools API", "FreeWebTools Est.", "FreeWebTools API"];
  return `<div class="src-h"><span>▤ &nbsp; DATA SOURCES</span>
    <span class="src-status">● LIVE · BOTH PROVIDERS</span></div>
    <div class="mtx"><div></div>${heads.map(x=>`<div class="mh">${x}</div>`).join("")}
    ${rows.map(([name, values]) =>
      `<div class="mg">${name}</div>${values.map((v,i)=>
        `<div class="cell"><span class="vl ${i%2?"api":"fw"}">${num(v)}</span></div>`
      ).join("")}`
    ).join("")}</div>`;
}

async function main() {
  const response = await fetch(`${BASE}/api/stats?t=${Date.now()}`, {
    headers: { "cache-control": "no-cache" }
  });
  if (!response.ok) throw Error(`Stats API returned ${response.status}`);

  const { lucan: l = {}, mine: m = {} } = await response.json();
  const st = l.sctools || {}, fw = l.freewebtools || {};
  const mst = m.sctools || {}, mfw = m.freewebtools || {};

  const subs = st.linearSubscribers ?? st.estSubscribers ??
    fw.estimatedSubscribers ?? st.apiSubscribers ?? fw.apiSubscribers;
  if (!Number.isFinite(Number(subs))) throw Error("Lucan subscriber count unavailable");

  let html = await fs.readFile("index.html", "utf8");

  // Remove browser-only JavaScript. Takumi renders HTML/CSS, not JS.
  html = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");

  // Keep the original design, with a fixed 1280x720 render viewport.
  html = html.replace("</head>", `<style>
    html,body{width:1280px!important;height:720px!important;min-width:1280px!important;min-height:720px!important}
    .pg{width:99%!important;height:720px!important}
  </style></head>`);

  const remaining = Math.max(0, 60000000 - Number(subs));
  const progress = Math.min(100, Number(subs) / 60000000 * 100);
  const rate = Number(st.hourly ?? fw.hourly ?? 0) / 3600;

  const values = {
    lucanName: l.channel?.name || "Lucan Pevidor",
    lucanHandle: l.channel?.handle || "@LucanPevidor",
    mineName: m.channel?.name || "VYStats",
    mineHandle: m.channel?.handle || "@vystatsyt",
    lucanCount: num(subs),
    lucanRemaining: num(remaining),
    lucanRate: Math.abs(rate).toFixed(2),
    lucanRateSign: rate < 0 ? "−" : "+",
    stLinearText: num(st.linearSubscribers ?? st.estSubscribers),
    stHourlyText: num(st.hourly ?? fw.hourly),
    stDailyText: num(st.daily ?? fw.daily),
    mineEstSubs: num(mst.estSubscribers ?? mfw.estimatedSubscribers),
    mineApiSubs: num(mst.apiSubscribers ?? mfw.apiSubscribers),
    mineEstViews: num(mst.estViews),
    mineApiViews: num(mst.apiViews),
    mineEstVideos: num(mst.estVideos),
    mineApiVideos: num(mst.apiVideos),
    goalPercent: progress.toFixed(1) + "%",
    updated: "TAKUMI STATIC PREVIEW",
    status: "● SNAPSHOT"
  };

  for (const [id, value] of Object.entries(values))
    html = setText(html, id, value);

  html = setImage(html, "lucanAvatar", l.channel?.avatar);
  html = setImage(html, "mineAvatar", m.channel?.avatar);

  html = html.replace(
    /<section class="sources-panel" id="srcCard"><\/section>/,
    `<section class="sources-panel" id="srcCard">${sourceTable(st, fw)}</section>`
  );

  html = html.replace(
    /id="goalProgress"/,
    `id="goalProgress" style="width:${progress.toFixed(2)}%"`
  );

  html = html.replace(
    /<div class="rate-bars" id="rateBars"><\/div>/,
    `<div class="rate-bars" id="rateBars">${
      Array.from({length:12},(_,i)=>
        `<span style="height:${18+i*4}px;opacity:${0.6+i/30}"></span>`
      ).join("")
    }</div>`
  );

  const png = await render(html, {
    width: 1280,
    height: 720,
    format: "png",
    fonts: googleFonts([
      { name: "Inter", weight: "700..900" }
    ])
  });

  await fs.writeFile("takumi-preview.png", png);
  console.log(`Created takumi-preview.png (${png.length} bytes)`);
}

main().catch(err => {
  console.error("TAKUMI TEST FAILED:", err);
  process.exitCode = 1;
});
