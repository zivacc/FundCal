/** Short-lived, authenticated, allowlisted server for device-to-device transfers. */
import http from 'node:http';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function parseRange(header, size) {
  if (header === undefined) return { start: 0, end: size - 1, partial: false };
  const match = /^bytes=(\d+)-(\d*)$/.exec(header);
  if (!match) return null;
  const start = Number(match[1]), end = match[2] ? Number(match[2]) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start || end >= size) return null;
  return { start, end, partial: true };
}
export function createTransferServer({ root, token, files = ['manifest.json', 'baseline.json', 'fundcal.db.gz'], expiresAt = Date.now() + 3600000 }) {
  if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('256-bit hex token required');
  const allowed = new Set(files.map(name => {
    if (!/^[a-zA-Z0-9_.-]+$/.test(name)) throw new Error('file allowlist must contain basenames');
    return `/${name}`;
  }));
  const expected = Buffer.from(`Bearer ${token}`);
  const server = http.createServer(async (req, res) => {
    try {
      const supplied = Buffer.from(req.headers.authorization ?? '');
      if (Date.now() >= expiresAt || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
        res.writeHead(401, { 'Cache-Control': 'no-store' }); res.end(); return;
      }
      if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); res.end(); return; }
      if (!allowed.has(req.url)) { res.writeHead(404); res.end(); return; }
      const file = path.join(root, req.url.slice(1));
      const stat = await fs.lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink() || await fs.realpath(file) !== file) { res.writeHead(404); res.end(); return; }
      const range = parseRange(req.headers.range, stat.size);
      if (!range) { res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }); res.end(); return; }
      const headers = { 'Content-Length': range.end - range.start + 1, 'Content-Type': 'application/octet-stream', 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, no-store' };
      if (range.partial) headers['Content-Range'] = `bytes ${range.start}-${range.end}/${stat.size}`;
      res.writeHead(range.partial ? 206 : 200, headers);
      if (req.method === 'HEAD') { res.end(); return; }
      const stream = createReadStream(file, { start: range.start, end: range.end });
      stream.on('error', () => res.destroy()); res.on('close', () => stream.destroy()); stream.pipe(res);
    } catch { if (!res.headersSent) { res.writeHead(404); res.end(); } else res.destroy(); }
  });
  server.headersTimeout = 15000;
  return server;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [rootArg, tokenFile, portArg] = process.argv.slice(2);
  const root = await fs.realpath(rootArg);
  const token = (await fs.readFile(tokenFile, 'utf8')).trim();
  const server = createTransferServer({ root, token });
  server.listen(Number(portArg ?? 18743), '127.0.0.1', () => console.log('authenticated transfer server listening on loopback'));
  const timer = setTimeout(() => { server.closeAllConnections(); server.close(() => process.exit(0)); }, 3600000); timer.unref();
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { server.closeAllConnections(); server.close(() => process.exit(0)); });
}
