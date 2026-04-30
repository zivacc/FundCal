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
import { createNavRouter } from './nav/nav-api.js';
import { createFundRouter } from './fund-api.js';

const PORT = parseInt(process.argv[2], 10) || 3457;
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

const navRouter = createNavRouter();
const fundRouter = createFundRouter();

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // 远程拉全量代码（旧行为）
  if (req.url && /^\/api\/fund\/all-codes\/?$/.test(req.url) && req.method === 'GET') {
    serveAllCodes(res);
    return;
  }

  // /api/nav/*
  if (req.url && req.url.startsWith('/api/nav')) {
    navRouter(req, res);
    return;
  }

  // /api/fund/*
  if (req.url && req.url.startsWith('/api/fund')) {
    const handled = await fundRouter(req, res);
    if (handled) return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: 'Not Found' }));
});

server.listen(PORT, () => {
  console.log(`Fund API: http://localhost:${PORT}/api/fund/*`);
  console.log(`NAV  API: http://localhost:${PORT}/api/nav/*`);
});
