/**
 * Cloudflare Worker 入口
 * - API 路由：/api/fund/* → 从 KV 读取数据
 * - 静态数据拦截：/data/allfund/*.json → 从 KV 读取（兼容前端直接 fetch）
 * - 其他请求由 Workers Static Assets 自动处理（不会到达此 Worker）
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  ...CORS_HEADERS,
};

const FUND_LIST_URL = 'http://fund.eastmoney.com/js/fundcode_search.js';
const ALL_CODES_CACHE_KEY = 'cache:all-codes';
const ALL_CODES_TTL = 5 * 60;

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

function parseAllFundCodesFromJs(text) {
  const set = new Set();
  const re = /"(\d{6})"/g;
  let m;
  while ((m = re.exec(text)) !== null) set.add(m[1]);
  return [...set].sort();
}

/* ========== API 路由处理 ========== */

async function handleFundFee(code, env) {
  const data = await env.FUND_DATA.get(`fund:${code}`, { type: 'json' });
  if (!data) return jsonResponse({ error: '基金未缓存', code }, 404);
  return jsonResponse(data);
}

async function handleCodes(env) {
  const data = await env.FUND_DATA.get('meta:codes', { type: 'json' });
  return jsonResponse({ codes: data || [] });
}

async function handleAllCodes(env) {
  const cached = await env.FUND_DATA.get(ALL_CODES_CACHE_KEY, { type: 'json' });
  if (cached) return jsonResponse({ codes: cached });

  try {
    const res = await fetch(FUND_LIST_URL, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    const codes = parseAllFundCodesFromJs(text);
    await env.FUND_DATA.put(ALL_CODES_CACHE_KEY, JSON.stringify(codes), { expirationTtl: ALL_CODES_TTL });
    return jsonResponse({ codes });
  } catch {
    return jsonResponse({ error: '获取基金列表失败' }, 502);
  }
}

async function handleSearchIndex(env) {
  const data = await env.FUND_DATA.get('meta:search-index', { type: 'json' });
  return jsonResponse(data || []);
}

async function handleFeederIndex(env) {
  const data = await env.FUND_DATA.get('meta:feeder-index', { type: 'json' });
  return jsonResponse(data || { feederByMasterKey: {}, codeToFeeder: {} });
}

async function handleStats(env) {
  const data = await env.FUND_DATA.get('meta:fund-stats', { type: 'json' });
  return jsonResponse(data || { total: 0, trackingFundCount: 0, tracking: [], manager: [], benchmark: [] });
}

/* ========== 静态数据文件拦截 ========== */

const DATA_FILE_TO_KV = {
  'search-index.json': 'meta:search-index',
  'feeder-index.json': 'meta:feeder-index',
  'fund-stats.json': 'meta:fund-stats',
  'fund-stats-detail.json': 'meta:fund-stats-detail',
  'list-index.json': 'meta:list-index',
  'code-name-map.json': 'meta:code-name-map',
  'overseas-codes.json': 'meta:overseas-codes',
};

async function handleDataFile(filename, env) {
  const kvKey = DATA_FILE_TO_KV[filename];
  if (!kvKey) {
    return jsonResponse({ error: 'Not Found' }, 404);
  }
  const data = await env.FUND_DATA.get(kvKey);
  if (!data) return jsonResponse({ error: 'Not Found' }, 404);
  return new Response(data, { status: 200, headers: JSON_HEADERS });
}

async function handleShardedFund(code, env) {
  const data = await env.FUND_DATA.get(`fund:${code}`);
  if (!data) return jsonResponse({ error: 'Not Found' }, 404);
  return new Response(data, { status: 200, headers: JSON_HEADERS });
}

/* ========== 主路由 ========== */

async function handleRequest(request, env) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (request.method !== 'GET') {
    return jsonResponse({ error: 'Method Not Allowed' }, 405);
  }

  // API 路由：/api/fund/*
  const apiPrefix = '/api/fund';
  if (path.startsWith(apiPrefix)) {
    const sub = path.slice(apiPrefix.length);

    if (sub === '/all-codes' || sub === '/all-codes/') return handleAllCodes(env);
    if (sub === '/search-index' || sub === '/search-index/') return handleSearchIndex(env);
    if (sub === '/feeder-index' || sub === '/feeder-index/') return handleFeederIndex(env);
    if (sub === '/stats' || sub === '/stats/') return handleStats(env);
    if (sub === '/codes' || sub === '/codes/') return handleCodes(env);

    const feeMatch = sub.match(/^\/(\d{6})\/fee\/?$/);
    if (feeMatch) return handleFundFee(feeMatch[1], env);

    return jsonResponse({ error: 'Not Found' }, 404);
  }

  // 拦截 data/allfund/funds/:code.json（前端分片加载）
  const shardMatch = path.match(/^\/data\/allfund\/funds\/(\d{6})\.json$/);
  if (shardMatch) return handleShardedFund(shardMatch[1], env);

  // 拦截 data/allfund/*.json（前端直接 fetch 静态数据文件）
  const dataMatch = path.match(/^\/data\/allfund\/([^/]+\.json)$/);
  if (dataMatch) return handleDataFile(dataMatch[1], env);

  // 非 API、非数据文件的请求到达此处说明静态资源未匹配
  return new Response('Not Found', { status: 404 });
}

export default {
  async fetch(request, env, ctx) {
    return handleRequest(request, env);
  },
};
