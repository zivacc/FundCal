/**
 * 本地基金费率 API：读取 data/funds/*.json 提供 GET /api/fund/:code/fee
 * 同时提供基金净值查询 API：GET /api/nav/:code 等
 * 需先运行 crawl-fund-fee.js 拉取数据。与前端同源时可直接被 fetchFundFeeFromAPI 调用。
 * 使用：node scripts/serve-fund-api.js [端口，默认 3457]
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import http from 'http';
import { createNavRouter } from './nav/nav-api.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data', 'funds');
const ALLFUND_DIR = path.join(__dirname, '..', 'data', 'allfund');
const ALLFUND_PATH = path.join(ALLFUND_DIR, 'allfund.json');
const PORT = parseInt(process.argv[2], 10) || 3457;
const FUND_LIST_URL = 'http://fund.eastmoney.com/js/fundcode_search.js';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

let allCodesCache = null;
let allCodesCacheTime = 0;
const CACHE_MS = 5 * 60 * 1000;

let allFundsData = null;

function loadAllFunds() {
  if (allFundsData) return allFundsData;
  if (!fs.existsSync(ALLFUND_PATH)) {
    allFundsData = { codes: [], funds: {} };
    return allFundsData;
  }
  try {
    const data = JSON.parse(fs.readFileSync(ALLFUND_PATH, 'utf8'));
    const funds = data.funds || {};
    const codes = data.codes || Object.keys(funds);
    allFundsData = { codes, funds };
  } catch {
    allFundsData = { codes: [], funds: {} };
  }
  return allFundsData;
}

function getFundStats() {
  const all = loadAllFunds();
  const codes = all.codes || [];
  const funds = all.funds || {};
  const total = codes.length;
  // 记录各维度统计：label -> { count, codes: string[] }
  const trackingMap = new Map();
  const managerMap = new Map();
  const benchmarkMap = new Map();
  let trackingFundCount = 0;

  const inc = (map, key, code) => {
    const k = key || '';
    const prev = map.get(k);
    if (prev) {
      prev.count += 1;
      if (code) prev.codes.push(code);
      return;
    }
    map.set(k, {
      count: 1,
      codes: code ? [code] : [],
    });
  };

  for (const code of codes) {
    const f = funds[code] || {};
    const rawTracking = (f.trackingTarget || '').trim();
    const isNoTracking =
      !rawTracking ||
      rawTracking === '该基金无跟踪标的' ||
      rawTracking.includes('该基金无跟踪标的');
    const tracking = isNoTracking ? '无跟踪标的' : rawTracking;
    const manager = (f.fundManager || '').trim() || '未知基金公司';
    const benchmark = (f.performanceBenchmark || '').trim() || '无业绩基准';
    if (!isNoTracking) trackingFundCount++;
    inc(trackingMap, tracking, code);
    inc(managerMap, manager, code);
    inc(benchmarkMap, benchmark, code);
  }

  const toArray = (map) =>
    Array.from(map.entries())
      .map(([label, info]) => ({
        label,
        count: info.count || 0,
        codes: info.codes || [],
      }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'zh-CN'));

  return {
    total,
    trackingFundCount,
    // 跟踪标的：不展示「无跟踪标的」相关项，避免图上出现无意义的大块
    tracking: toArray(trackingMap).filter(item => !item.label.includes('无跟踪标的')),
    manager: toArray(managerMap),
    benchmark: toArray(benchmarkMap),
  };
}

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

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'GET') {
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Not Found' }));
    return;
  }
  const allCodesMatch = req.url && req.url.match(/^\/api\/fund\/all-codes\/?$/);
  if (allCodesMatch) {
    serveAllCodes(res);
    return;
  }
  const searchIndexMatch = req.url && req.url.match(/^\/api\/fund\/search-index\/?$/);
  if (searchIndexMatch) {
    const searchIndexPath = path.join(ALLFUND_DIR, 'search-index.json');
    if (!fs.existsSync(searchIndexPath)) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.writeHead(200);
      res.end(JSON.stringify([]));
      return;
    }
    try {
      const body = fs.readFileSync(searchIndexPath, 'utf8');
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.writeHead(200);
      res.end(body);
    } catch (e) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: '读取失败' }));
    }
    return;
  }
  const statsMatch = req.url && req.url.match(/^\/api\/fund\/stats\/?$/);
  if (statsMatch) {
    try {
      const stats = getFundStats();
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.writeHead(200);
      res.end(JSON.stringify(stats));
    } catch (e) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: '统计失败' }));
    }
    return;
  }
  const feederIndexMatch = req.url && req.url.match(/^\/api\/fund\/feeder-index\/?$/);
  if (feederIndexMatch) {
    const feederIndexPath = path.join(ALLFUND_DIR, 'feeder-index.json');
    if (!fs.existsSync(feederIndexPath)) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.writeHead(200);
      res.end(JSON.stringify({ feederByMasterKey: {}, codeToFeeder: {} }));
      return;
    }
    try {
      const body = fs.readFileSync(feederIndexPath, 'utf8');
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.writeHead(200);
      res.end(body);
    } catch (e) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: '读取联接/母基金索引失败' }));
    }
    return;
  }
  const codesMatch = req.url && req.url.match(/^\/api\/fund\/codes\/?$/);
  if (codesMatch) {
    try {
      const all = loadAllFunds();
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.writeHead(200);
      res.end(JSON.stringify({ codes: all.codes || [] }));
    } catch (e) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: '读取失败' }));
    }
    return;
  }
  const feeMatch = req.url && req.url.match(/^\/api\/fund\/(\d{6})\/fee\/?$/);
  if (feeMatch) {
    const code = feeMatch[1];
    const all = loadAllFunds();
    const data = all.funds[code];
    if (!data) {
      res.writeHead(404);
      res.end(JSON.stringify({ error: '基金未缓存', code }));
      return;
    }
    try {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.writeHead(200);
      res.end(JSON.stringify(data));
    } catch (e) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: '读取失败' }));
    }
    return;
  }

  // --- NAV (净值) routes ---
  if (req.url && req.url.startsWith('/api/nav')) {
    navRouter(req, res);
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: 'Not Found' }));
});

server.listen(PORT, () => {
  console.log(`基金费率 API: http://localhost:${PORT}/api/fund/:code/fee`);
  console.log(`基金净值 API: http://localhost:${PORT}/api/nav/:code`);
  console.log(`数据目录: ${DATA_DIR}`);
});
