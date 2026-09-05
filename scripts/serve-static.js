/** 仅公开前端运行资源，不把仓库目录作为可浏览文件服务器。 */
import http from 'node:http';
import path from 'node:path';
import { realpath, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ifNoneMatchHits } from './nav/http-cache.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_JSON = new Set([
  'search-index', 'index-search-index', 'feeder-index', 'fund-stats',
  'overseas-codes', 'trade-calendar',
].map(name => `/data/allfund/${name}.json`));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };

export function isPublicPath(urlPath) {
  if (urlPath.split('/').some(part => part.startsWith('.')) || /[\\\0]/.test(urlPath)) return false;
  if (urlPath === '/index.html') return true;
  if (/^\/js\/[\w/-]+\.js$/.test(urlPath)) return true;
  if (/^\/css\/[\w/-]+\.css$/.test(urlPath)) return true;
  if (/^\/vendor\/(?:chart-4\.4\.1\.umd|chartjs-plugin-annotation-3\.0\.1|echarts-5\.5\.1)\.min\.js$/.test(urlPath)) return true;
  if (/^\/pics\/(?:bronzecoinlogo|goldencoinlogo|klogo|clogo)\.png$/.test(urlPath)) return true;
  return PUBLIC_JSON.has(urlPath) || /^\/data\/allfund\/funds\/\d{6}\.json$/.test(urlPath)
    || urlPath === '/data/smpp/simuwang-code-mapping.json';
}

export function createStaticServer({ root = ROOT } = {}) {
  return http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const fail = status => { res.writeHead(status); res.end(); };
    if (!['GET', 'HEAD'].includes(req.method)) { res.setHeader('Allow', 'GET, HEAD'); fail(405); return; }
    try {
      let urlPath;
      try { urlPath = decodeURIComponent((req.url || '').split('?')[0]); }
      catch { fail(400); return; }
      if (urlPath === '/') urlPath = '/index.html';
      if (!isPublicPath(urlPath)) { fail(404); return; }
      const base = await realpath(root);
      const file = await realpath(path.join(base, urlPath));
      // 白名单文件也不能通过符号链接指向数据库或仓库内部目录。
      const relative = path.relative(base, file);
      if (relative.startsWith('..') || path.isAbsolute(relative) || !isPublicPath('/' + relative.split(path.sep).join('/'))) {
        fail(404); return;
      }
      const info = await stat(file);
      if (!info.isFile()) { fail(404); return; }
      const etag = `W/"${info.size.toString(16)}-${info.mtimeMs.toString(16)}"`;
      res.setHeader('Content-Type', TYPES[path.extname(file)] + (path.extname(file) === '.png' ? '' : '; charset=utf-8'));
      res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
      res.setHeader('ETag', etag);
      if (ifNoneMatchHits(req.headers['if-none-match'], etag)) { fail(304); return; }
      res.setHeader('Content-Length', info.size);
      res.writeHead(200);
      if (req.method === 'HEAD') { res.end(); return; }
      const stream = createReadStream(file);
      stream.on('error', () => res.destroy());
      res.on('close', () => stream.destroy());
      stream.pipe(res);
    } catch (error) {
      if (res.headersSent) res.destroy();
      else fail(['ENOENT', 'ENOTDIR', 'EACCES'].includes(error.code) ? 404 : 500);
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.argv[2] || process.env.STATIC_PORT) || 3456;
  createStaticServer().listen(port, '127.0.0.1', () => console.log(`Static: http://127.0.0.1:${port}`));
}
