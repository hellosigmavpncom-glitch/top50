
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3000;
const CHANNELS = [
  { id: 'UCyagEfIN1okQ-s996XAqCFQ', name: 'Zhong' },
  { id: 'UCoQm-PeHC-cbJclKJYJ8LzA', name: 'Fede Vigevani' }
];

const API = 'https://ests.sctools.org/api/get/channel/';
const HTML = path.join(__dirname, 'index.html');

async function getChannels() {
  const ids = CHANNELS.map(c => c.id).join(',');
  const response = await fetch(API + ids, {
    headers: { 'Accept': 'application/json' },
    signal: AbortSignal.timeout(12000)
  });

  if (!response.ok) {
    throw new Error(`SCTools returned HTTP ${response.status}`);
  }

  const data = await response.json();
  const channels = Array.isArray(data) ? data : [data];

  if (channels.length !== 2) {
    throw new Error('Unexpected SCTools response');
  }

  return channels.map((channel, i) => {
    if (!channel?.info || !channel?.stats) {
      throw new Error(`Missing statistics for ${CHANNELS[i].name}`);
    }

    return {
      info: channel.info,
      stats: channel.stats,
      averages: channel.averages || {},
      nextUpdate: channel.nextUpdate ?? null
    };
  });
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

  if (req.url === '/api/stats') {
    res.setHeader('Content-Type', 'application/json');

    try {
      const channels = await getChannels();
      res.writeHead(200);
      res.end(JSON.stringify({
        success: true,
        channels,
        updatedAt: Date.now()
      }));
    } catch (error) {
      console.error('[SCTools]', error.message);
      res.writeHead(502);
      res.end(JSON.stringify({
        success: false,
        error: error.message
      }));
    }
    return;
  }

  if (req.url === '/' || req.url === '/index.html') {
    fs.readFile(HTML, (error, file) => {
      if (error) {
        res.writeHead(500);
        return res.end('Could not load index.html');
      }

      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8'
      });
      res.end(file);
    });
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\nZhong vs Fede running at http://localhost:${PORT}`);
  console.log('SCTools polling starts when the dashboard requests data.');
});
