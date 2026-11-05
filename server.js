const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PORT = process.env.PORT || 3000;
const DIR = __dirname;

const PROFILES = [
 { key: 'zhong', name: 'Zhong', handle: '@zhong', id: 'UCyagEfIN1okQ-s996XAqCFQ', accent: '#7187ff' },
 { key: 'fede', name: 'Fede Vigevani', handle: '@fedevigevani', id: 'UCoQm-PeHC-cbJclKJYJ8LzA', accent: '#bd82ff' }
];

const state = { creators: {}, updated: null, error: null };
const api = id => `https://api.socialcounts.org/youtube-live-subscriber-count/${encodeURIComponent(id)}`;

// Realistic browser headers to prevent blocks, rate-limiting, and 403 errors
const BROWSER_HEADERS = {
 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
 'Accept': 'application/json, text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
 'Accept-Language': 'en-US,en;q=0.9',
 'Cache-Control': 'no-cache',
 'Pragma': 'no-cache',
 'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
 'Sec-Ch-Ua-Mobile': '?0',
 'Sec-Ch-Ua-Platform': '"Windows"',
 'Sec-Fetch-Dest': 'empty',
 'Sec-Fetch-Mode': 'cors',
 'Sec-Fetch-Site': 'same-origin'
};

async function stats(p) {
 try {
  const r = await fetch(api(p.id), { headers: BROWSER_HEADERS });
  const body = await r.text();

  if (!r.ok) {
   console.error(`[${p.name}] HTTP ${r.status}`, {
    server: r.headers.get('server'),
    contentType: r.headers.get('content-type'),
    cfMitigated: r.headers.get('cf-mitigated'),
    response: body.slice(0, 300)
   });
   throw Error(`HTTP ${r.status}`);
  }

  const data = JSON.parse(body);
  if (!data.counters) throw Error('Invalid counters');

  state.creators[p.key] = {
   ...state.creators[p.key],
   ...data,
   name: p.name,
   id: p.id,
   error: null
  };
  return true;
 } catch (e) {
  console.error(`[${p.name}]`, e.message);
  if (state.creators[p.key]) state.creators[p.key].error = e.message;
  return false;
 }
}

async function avatar(p) {
 try {
  const r = await fetch(`https://www.youtube.com/channel/${p.id}`, { headers: BROWSER_HEADERS });
  if (!r.ok) throw Error(`HTTP ${r.status}`);

  const html = await r.text();
  const tag = html.match(/<meta\b(?=[^>]*\bproperty=["']og:image["'])[^>]*>/i)?.[0];
  let url = tag?.match(/\bcontent=["']([^"']+)["']/i)?.[1];

  if (!url) throw Error('Avatar not found');

  // Properly unescape HTML entities in URLs (e.g., &amp; -> &)
  url = url.replace(/&amp;/g, '&');

  state.creators[p.key] = { ...state.creators[p.key], avatar: url };
 } catch (e) {
  console.error(`[${p.name} avatar]`, e.message);
 }
}

let busy = false;

async function refresh() {
 if (busy) return;
 busy = true;

 try {
  const results = await Promise.all(PROFILES.map(stats));
  if (results.some(Boolean)) state.updated = new Date().toISOString();
  state.error = results.every(Boolean) ? null : 'One or more channels failed to update';
 } finally {
  busy = false;
 }
}

const server = http.createServer((req, res) => {
 res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
 res.setHeader('Access-Control-Allow-Origin', '*');

 if (req.url === '/api/stats') {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  return res.end(JSON.stringify({
   profiles: PROFILES.map(({ key, name, handle, accent }) => ({ key, name, handle, accent })),
   creators: state.creators, updated: state.updated, error: state.error
  }));
 }

 if (req.url === '/health') {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  return res.end(JSON.stringify({ ok: true, updated: state.updated, error: state.error }));
 }

 if (req.url === '/' || req.url === '/index.html') {
  try {
   res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
   return res.end(fs.readFileSync(path.join(DIR, 'index.html')));
  } catch (e) {
   res.writeHead(500);
   return res.end('Frontend unavailable');
  }
 }

 res.writeHead(404);
 res.end('Not found');
});

server.listen(PORT, '0.0.0.0', async () => {
  console.log(`Server running on port ${PORT}`);
  await refresh();
  // Fetch initial avatars right away on startup so they aren't missing
  await Promise.all(PROFILES.map(avatar));
  
  setInterval(refresh, 5000);
  setInterval(() => PROFILES.forEach(avatar), 21600000);
});
