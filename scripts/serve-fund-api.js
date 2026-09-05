/**
 * 基金 API HTTP server。
 * 路由分派：
 *   /api/fund/*  → fund-api.js (SQLite 后端)
 *   /api/nav/*   → nav-api.js  (SQLite NAV)
 *   /api/fund/all-codes  → 远程拉天天基金完整代码列表（保留旧行为）
 *
 * 使用：node scripts/serve-fund-api.js [端口，默认 3457]
 */

import http from 'http';
import { isLocalManagementRequest } from './local-access.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseQuery, InvalidQueryError } from './http-query.js';
import { createNavRouter } from './nav/nav-api.js';
import { createFundRouter } from './fund-api.js';

const FUND_LIST_URL = 'http://fund.eastmoney.com/js/fundcode_search.js';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

let allCodesCache = null;
let allCodesCacheTime = 0;
const CACHE_MS = 5 * 60 * 1000;

function parseAllFundCodesFromJs(text) {
  const set = new Set();
  const re = /"(\d{6})"/g;
  let m;
  while ((m = re.exec(text)) !== null) set.add(m[1]);
  return [...set].sort();
}

function serveAllCodes(res) {
  const now = Date.now();
  if (allCodesCache && now - allCodesCacheTime < CACHE_MS) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.writeHead(200);
    res.end(JSON.stringify({ codes: allCodesCache }));
    return;
  }
  const req = http.get(FUND_LIST_URL, { headers: { 'User-Agent': UA } }, (innerRes) => {
    let body = '';
    innerRes.on('data', chunk => { body += chunk; });
    innerRes.on('end', () => {
      try {
        allCodesCache = parseAllFundCodesFromJs(body);
        allCodesCacheTime = Date.now();
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.writeHead(200);
        res.end(JSON.stringify({ codes: allCodesCache }));
      } catch (e) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: '解析失败' }));
      }
    });
  });
  req.on('error', () => {
    res.writeHead(502);
    res.end(JSON.stringify({ error: '获取基金列表失败' }));
  });
  req.setTimeout(15000, () => { req.destroy(); });
}

/** 路由可注入，HTTP 回归测试不访问实际数据库或抓取服务。 */
export function createApiServer({
  navRouter = createNavRouter(),
  fundRouter = createFundRouter(),
  onError = error => console.error('[API]', error),
} = {}) {
  return http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, If-None-Match');
    res.setHeader('Access-Control-Expose-Headers', 'ETag, Cache-Control');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    try {
      req.query = parseQuery(req.url || '');
      const urlPath = (req.url || '').split('?')[0];

      if (req.method === 'POST' && /^\/api\/fund\/\d{6}\/crawl\/?$/.test(urlPath) && !isLocalManagementRequest(req)) {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.writeHead(403);
        res.end(JSON.stringify({ error: '抓取仅允许本机直连，请在本机页面操作或运行 crawl 命令' }));
        return;
      }
      // 远程拉全量代码（旧行为）
      if (/^\/api\/fund\/all-codes\/?$/.test(urlPath) && req.method === 'GET') {
        serveAllCodes(res);
        return;
      }
      if (/^\/api\/nav(?:\/|$)/.test(urlPath)) {
        await navRouter(req, res);
        return;
      }
      if (/^\/api\/fund(?:\/|$)/.test(urlPath)) {
        if (await fundRouter(req, res)) return;
      }
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Not Found' }));
    } catch (error) {
      const invalidQuery = error instanceof InvalidQueryError;
      if (!invalidQuery) onError(error);
      if (res.writableEnded || res.destroyed) return;
      if (res.headersSent) { res.destroy(); return; }
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.writeHead(invalidQuery ? 400 : 500);
      res.end(JSON.stringify({ error: invalidQuery ? error.message : 'Internal Server Error' }));
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = parseInt(process.argv[2], 10) || 3457;
  createApiServer().listen(port, '127.0.0.1', () => {
    console.log(`Fund API: http://localhost:${port}/api/fund/*`);
    console.log(`NAV  API: http://localhost:${port}/api/nav/*`);
  });
}
