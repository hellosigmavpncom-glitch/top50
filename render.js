
const { createCanvas, loadImage } = require("@napi-rs/canvas");

const WIDTH = 1280;
const HEIGHT = 720;
const canvas = createCanvas(WIDTH, HEIGHT);
const ctx = canvas.getContext("2d");
const avatarCache = new Map();

const C = {
  bg: "#080d19",
  panel: "#111a2b",
  panel2: "#151f33",
  border: "#25334b",
  text: "#f2f5ff",
  muted: "#8492aa",
  purple: "#9b7bff",
  blue: "#6c91ff",
  teal: "#39d6c0",
  green: "#4bd6a0"
};

const number = v => Number(v || 0);
const fmt = v => number(v).toLocaleString("en-US");
const short = v => {
  v = number(v);
  if (v >= 1e9) return (v / 1e9).toFixed(2) + "B";
  if (v >= 1e6) return (v / 1e6).toFixed(2) + "M";
  if (v >= 1e3) return (v / 1e3).toFixed(1) + "K";
  return fmt(v);
};

function roundRect(x, y, w, h, r = 16, fill = C.panel, stroke = C.border) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

function text(value, x, y, size = 16, color = C.text, weight = 500, align = "left") {
  ctx.font = `${weight} ${size}px Inter, Arial, sans-serif`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = "middle";
  ctx.fillText(String(value ?? ""), x, y);
}

function line(x1, y1, x2, y2, color = C.border, width = 1) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
}

function getStats(person) {
  const s = person?.sctools || {};
  const f = person?.freewebtools || {};
  const fe = f?.estimation || {};
  return {
    estimated: number(s.linearCount ?? s.estCount ?? fe.estimated_count),
    api: number(s.apiCount ?? f.subscriberCount),
    viewsEstimated: number(s.viewCount ?? f.viewCount),
    viewsApi: number(f.viewCount),
    videosEstimated: number(s.videoCount ?? f.videoCount),
    videosApi: number(f.videoCount),
    hourly: number(s.averages?.hourly),
    daily: number(s.averages?.daily)
  };
}

function avatarUrl(person) {
  return person?.channel?.avatar ||
    person?.sctools?.info?.avatar ||
    person?.info?.avatar ||
    person?.freewebtools?.thumbnail ||
    "";
}

async function getAvatar(url) {
  if (!url) return null;
  if (!avatarCache.has(url)) {
    avatarCache.set(url, loadImage(url).catch(() => null));
  }
  return avatarCache.get(url);
}

function drawAvatar(img, x, y, size, accent) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
  ctx.clip();
  if (img) {
    ctx.drawImage(img, x, y, size, size);
  } else {
    ctx.fillStyle = C.panel2;
    ctx.fillRect(x, y, size, size);
    text("?", x + size / 2, y + size / 2, 30, accent, 700, "center");
  }
  ctx.restore();
  ctx.beginPath();
  ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
  ctx.strokeStyle = accent;
  ctx.lineWidth = 2;
  ctx.stroke();
}

function drawBackground() {
  const g = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
  g.addColorStop(0, "#0b1222");
  g.addColorStop(0.55, "#080e1b");
  g.addColorStop(1, "#101126");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  const glow = ctx.createRadialGradient(850, 180, 10, 850, 180, 650);
  glow.addColorStop(0, "rgba(93,87,190,0.13)");
  glow.addColorStop(1, "rgba(93,87,190,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
}

function drawHeader() {
  text("LIVE CHANNEL TRACKER", 28, 30, 12, C.muted, 700);
  text("Lucan vs VYStats", 28, 67, 28, C.text, 750);
  ctx.beginPath();
  ctx.arc(1220, 34, 5, 0, Math.PI * 2);
  ctx.fillStyle = C.green;
  ctx.fill();
  text("LIVE", 1205, 34, 11, C.green, 700, "right");
  line(28, 94, 1252, 94);
}

function drawProfile(person, img, x, y, name, handle, accent) {
  roundRect(x, y, 390, 145);
  drawAvatar(img, x + 18, y + 18, 78, accent);
  text(name, x + 112, y + 43, 22, C.text, 700);
  text(handle, x + 112, y + 70, 13, accent, 600);
  text("Jesus loves you! I hope every video makes you smile!", x + 18, y + 116, 11, C.muted);
  roundRect(x + 278, y + 15, 94, 25, 12, "#20203e", null);
  text("ROAD TO 60M", x + 325, y + 28, 10, C.purple, 700, "center");
}

function drawMiniStats(person, x, y, title, accent) {
  const s = getStats(person);
  roundRect(x, y, 390, 150);
  text(title, x + 18, y + 23, 13, accent, 700);
  const cols = [
    ["SUBSCRIBERS", s.estimated, s.api],
    ["VIEWS", s.viewsEstimated, s.viewsApi],
    ["VIDEOS", s.videosEstimated, s.videosApi]
  ];
  cols.forEach((c, i) => {
    const cx = x + 18 + i * 122;
    text(c[0], cx, y + 54, 9, C.muted, 700);
    text(short(c[1]), cx, y + 83, 19, C.text, 700);
    text("EST", cx, y + 108, 9, C.muted);
    text(short(c[2]), cx, y + 130, 13, C.teal, 600);
    text("API", cx + 38, y + 108, 9, C.muted);
  });
}

function drawChart(x, y, w, h, color) {
  const points = [0.66, 0.62, 0.69, 0.55, 0.59, 0.46, 0.5, 0.35, 0.4, 0.27, 0.31, 0.2];
  const coords = points.map((p, i) => ({
    x: x + (i / (points.length - 1)) * w,
    y: y + p * h
  }));
  const fill = ctx.createLinearGradient(0, y, 0, y + h);
  fill.addColorStop(0, color + "55");
  fill.addColorStop(1, color + "00");
  ctx.beginPath();
  ctx.moveTo(coords[0].x, y + h);
  coords.forEach(p => ctx.lineTo(p.x, p.y));
  ctx.lineTo(coords[coords.length - 1].x, y + h);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();

  ctx.beginPath();
  coords.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.stroke();
}

function drawMainCard(x, y, w, h, title, value, subtitle, accent, chart = false) {
  roundRect(x, y, w, h);
  text(title, x + 20, y + 28, 12, C.muted, 700);
  text(value, x + 20, y + 83, 31, C.text, 750);
  text(subtitle, x + 20, y + 117, 12, accent, 600);
  if (chart) drawChart(x + 20, y + 150, w - 40, 90, accent);
}

function drawSources(data) {
  const y = 555;
  roundRect(28, y, 1224, 125);
  text("DATA SOURCE COMPARISON", 48, y + 23, 12, C.muted, 700);

  const headers = ["SOURCE", "SUBSCRIBERS", "TOTAL VIEWS", "VIDEOS"];
  const xs = [48, 340, 650, 960];
  headers.forEach((h, i) => text(h, xs[i], y + 49, 10, C.muted, 700));

  const rows = [
    ["SCTools Est.", data?.lucan?.sctools?.linearCount],
    ["SCTools API", data?.lucan?.sctools?.apiCount],
    ["FreeWebTools Est.", data?.lucan?.freewebtools?.estimation?.estimated_count],
    ["FreeWebTools API", data?.lucan?.freewebtools?.subscriberCount]
  ];

  rows.forEach((r, i) => {
    const yy = y + 70 + i * 13;
    text(r[0], xs[0], yy, 10, i < 2 ? C.blue : C.purple, 600);
    text(fmt(r[1]), xs[1], yy, 10, C.text);
  });
}

async function renderDashboard(data = {}) {
  const lucan = data.lucan || {};
  const mine = data.mine || {};
  const ls = getStats(lucan);
  const ms = getStats(mine);
  const lucanImg = await getAvatar(avatarUrl(lucan));
  const mineImg = await getAvatar(avatarUrl(mine));

  drawBackground();
  drawHeader();

  drawProfile(lucan, lucanImg, 28, 112, "Lucan", "@LucanPevidor", C.blue);
  drawMiniStats(mine, 28, 270, "MY CHANNEL · VYSTATS", C.purple);

  drawMainCard(440, 112, 260, 270, "LIVE SUBSCRIBERS", fmt(ls.estimated), "SCTOOLS LINEAR ESTIMATE", C.blue, true);
  drawMainCard(710, 112, 260, 270, "SUBSCRIBERS GAINED / SEC", "+0", "LIVE AVERAGE", C.purple);
  const remaining = Math.max(0, 60000000 - ls.estimated);
  const progress = Math.min(100, (ls.estimated / 60000000) * 100);
  drawMainCard(980, 112, 272, 270, "SUBSCRIBERS TO 60M", fmt(remaining), `${progress.toFixed(2)}% COMPLETE`, C.teal);

  roundRect(460, 320, 220, 8, 4, "#25334b", null);
  roundRect(460, 320, 220 * progress / 100, 8, 4, C.blue, null);

  drawSources(data);

  text("UPDATED " + new Date().toLocaleTimeString("en-US"), 30, 700, 10, C.muted);
  text("RENDERER PREVIEW · 1280 × 720", 1250, 700, 10, C.muted, 500, "right");

  return canvas.toBuffer("image/png");
}

function attach(app, getData) {
  app.get("/api/renderer/preview.png", async (req, res) => {
    try {
      const data = await getData();
      const png = await renderDashboard(data);
      res.set("Cache-Control", "no-store");
      res.type("png").send(png);
    } catch (err) {
      console.error("Renderer error:", err.message);
      res.status(500).json({ error: "Renderer failed" });
    }
  });
}

module.exports = { renderDashboard, attach };
