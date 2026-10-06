import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { handleRequest } from './lib/rooms.js';
import { MemoryStore } from './lib/memory-store.js';

const store = new MemoryStore();
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) {
      const chunks = [];
      let length = 0;
      for await (const chunk of req) {
        length += chunk.length;
        if (length > 10000) {
          res.writeHead(413, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: '請求過大' }));
          return;
        }
        chunks.push(chunk);
      }
      const response = await handleRequest(new Request(url, {
        method: req.method,
        headers: req.headers,
        ...(['GET', 'HEAD'].includes(req.method) ? {} : { body: Buffer.concat(chunks) }),
      }), store);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
      return;
    }
    const files = { '/': 'index.html', '/app.js': 'app.js', '/style.css': 'style.css', '/wolf-icon.png': 'wolf-icon.png' };
    const file = files[url.pathname];
    if (!file) { res.writeHead(404); res.end('Not found'); return; }
    res.setHeader('Content-Type', file.endsWith('.png') ? 'image/png' : file.endsWith('.js') ? 'text/javascript; charset=utf-8' : file.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.end(await readFile(new URL('./public/' + file, import.meta.url)));
  } catch {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: '服務暫時無法使用' }));
  }
});
server.listen(process.env.PORT || 3000, '0.0.0.0', () => console.log('森夜狼人殺 · http://localhost:' + (process.env.PORT || 3000)));
