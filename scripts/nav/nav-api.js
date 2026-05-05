/**
 * NAV (净值) API route handler for serve-fund-api.js.
 *
 * Routes:
 *   GET /api/nav/stats              — 数据库整体统计
 *   GET /api/nav/:code              — 最新净值
 *   GET /api/nav/:code/history      — 历史净值 (?start=&end=&limit=)
 *   GET /api/nav/:code/range        — 数据日期范围
 */

import { getDb, codeToTsCode } from './db.js';
import {
  downsample,
  computeStats,
  computeUnionRange,
  parseIndicators,
  enrichSeriesIndicators,
} from '../../js/domain/nav-stats.js';

function json(res, status, data) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.writeHead(status);
  res.end(JSON.stringify(data));
}

/**
 * 计算 weak ETag (FNV-1a 32-bit) for an arbitrary string body.
 * Weak 即可——我们只用它做条件请求短路，不用做 byte-equal 校验。
 *
 * @param {string} body
 * @returns {string}  形如 `W/"af7c2b13"`，始终带引号；可直接放进 ETag 头。
 */
export function computeETag(body) {
  let h = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < body.length; i++) {
    h ^= body.charCodeAt(i);
    // 32-bit FNV prime: 16777619；用 Math.imul 避免高位被丢
    h = Math.imul(h, 0x01000193);
  }
  // 转无符号 32 位再 hex
  return `W/"${(h >>> 0).toString(16).padStart(8, '0')}"`;
}

/**
 * 解析 If-None-Match 头，返回是否命中给定 etag。
 * 处理多值 (逗号分隔) 与 `*` 通配符。weak/strong 视为等价。
 *
 * @param {string|undefined} headerVal  原始 If-None-Match 值
 * @param {string} etag                 我们刚算出的 ETag (含 W/" 前缀和引号)
 * @returns {boolean}
 */
export function ifNoneMatchHits(headerVal, etag) {
  if (!headerVal || !etag) return false;
  const norm = (s) => s.trim().replace(/^W\//, '');
  const target = norm(etag);
  for (const part of headerVal.split(',')) {
    const p = part.trim();
    if (p === '*') return true;
    if (norm(p) === target) return true;
  }
  return false;
}

/**
 * 发送可缓存的 JSON 响应：
 *   - 序列化一次 → 计算 weak ETag
 *   - 命中 If-None-Match → 304 (空 body, 仍带 ETag/Cache-Control)
 *   - 否则 200 + ETag + Cache-Control: private, max-age=N, must-revalidate
 *
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse}  res
 * @param {Object} data
 * @param {Object} [opts]
 * @param {number} [opts.maxAge=60]   秒；客户端缓存窗口
 */
function jsonCached(req, res, data, opts = {}) {
  const { maxAge = 60 } = opts;
  const body = JSON.stringify(data);
  const etag = computeETag(body);
  const cc = `private, max-age=${maxAge}, must-revalidate`;

  res.setHeader('ETag', etag);
  res.setHeader('Cache-Control', cc);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (ifNoneMatchHits(req.headers && req.headers['if-none-match'], etag)) {
    res.writeHead(304);
    res.end();
    return;
  }

  res.writeHead(200);
  res.end(body);
}

function parseQuery(url) {
  const idx = url.indexOf('?');
  if (idx === -1) return {};
  const qs = {};
  for (const pair of url.slice(idx + 1).split('&')) {
    const [k, v] = pair.split('=');
    if (k) qs[decodeURIComponent(k)] = decodeURIComponent(v || '');
  }
  return qs;
}

function handleNavStats(req, res) {
  try {
    const db = getDb();
    const basicCount = db.prepare('SELECT count(*) as cnt FROM fund_basic').get().cnt;
    const navCount = db.prepare('SELECT count(*) as cnt FROM fund_nav').get().cnt;
    const fundWithNav = db.prepare('SELECT count(DISTINCT ts_code) as cnt FROM fund_nav').get().cnt;
    const earliest = db.prepare('SELECT min(end_date) as d FROM fund_nav').get().d;
    const latest = db.prepare('SELECT max(end_date) as d FROM fund_nav').get().d;

    // 整库统计换得不快：变化频率 = ETL 频率 (天级)。max-age=300 依然会靠 ETag 多拾一颗。
    jsonCached(req, res, {
      fund_basic_count: basicCount,
      fund_nav_total_records: navCount,
      funds_with_nav: fundWithNav,
      earliest_date: earliest,
      latest_date: latest,
    }, { maxAge: 300 });
  } catch (e) {
    json(res, 500, { error: '查询失败', detail: e.message });
  }
}

function handleNavLatest(code, req, res) {
  try {
    const db = getDb();
    const tsCode = codeToTsCode(code);
    const basic = db.prepare('SELECT name, fund_type, management FROM fund_basic WHERE code = ?').get(code);
    const latest = db.prepare(
      'SELECT * FROM fund_nav WHERE ts_code = ? ORDER BY end_date DESC LIMIT 1'
    ).get(tsCode);

    if (!latest) {
      json(res, 404, { error: '无净值数据', code });
      return;
    }

    // 最新净值：最多一天一变；max-age=60 加 ETag 足够。
    jsonCached(req, res, {
      code,
      ts_code: tsCode,
      name: basic?.name || null,
      fund_type: basic?.fund_type || null,
      management: basic?.management || null,
      end_date: latest.end_date,
      unit_nav: latest.unit_nav,
      accum_nav: latest.accum_nav,
      adj_nav: latest.adj_nav,
      accum_div: latest.accum_div,
      net_asset: latest.net_asset,
      total_netasset: latest.total_netasset,
    }, { maxAge: 60 });
  } catch (e) {
    json(res, 500, { error: '查询失败', detail: e.message });
  }
}

function handleNavHistory(code, req, res) {
  try {
    const db = getDb();
    const tsCode = codeToTsCode(code);
    const qs = parseQuery(req.url);

    const conditions = ['ts_code = ?'];
    const params = [tsCode];

    if (qs.start) { conditions.push('end_date >= ?'); params.push(qs.start); }
    if (qs.end)   { conditions.push('end_date <= ?'); params.push(qs.end); }

    const limit = Math.min(parseInt(qs.limit, 10) || 10000, 50000);
    const order = qs.order === 'desc' ? 'DESC' : 'ASC';

    const sql = `SELECT end_date, unit_nav, accum_nav, adj_nav, accum_div, net_asset, total_netasset
      FROM fund_nav WHERE ${conditions.join(' AND ')}
      ORDER BY end_date ${order} LIMIT ?`;
    params.push(limit);

    const rows = db.prepare(sql).all(...params);

    const basic = db.prepare('SELECT name FROM fund_basic WHERE code = ?').get(code);

    // 历史查询：序列主体不变、仅末尾可能增量。max-age=60。
    jsonCached(req, res, {
      code,
      ts_code: tsCode,
      name: basic?.name || null,
      count: rows.length,
      data: rows,
    }, { maxAge: 60 });
  } catch (e) {
    json(res, 500, { error: '查询失败', detail: e.message });
  }
}

/**
 * 多基金净值比较 + 统计指标
 * GET /api/nav/compare?codes=000001,110011[&start=YYYYMMDD&end=YYYYMMDD][&interval=daily|weekly|monthly]
 *
 * 返回：
 * {
 *   codes: [...],
 *   range: { start, end },
 *   series: [{ code, name, dates: [...], navs: [...], adjNavs: [...] }],
 *   stats:  [{ code, startNav, endNav, totalReturn, cagr, maxDrawdown, volatility, sharpe }]
 * }
 *
 * 说明：
 * - navs = adj_nav 优先（复权），无则 unit_nav
 * - 统计基于 adj_nav 日收益率序列
 * - dates 用基金各自交易日；前端做对齐
 */
function handleNavCompare(req, res) {
  try {
    const db = getDb();
    const qs = parseQuery(req.url);
    const codes = (qs.codes || '').split(',').map(s => s.trim()).filter(s => /^\d{6}$/.test(s));
    if (!codes.length) { json(res, 400, { error: 'codes 必填' }); return; }
    if (codes.length > 20) { json(res, 400, { error: '一次最多对比 20 只' }); return; }

    const interval = qs.interval || 'daily'; // daily / weekly / monthly
    const indicators = parseIndicators(qs.indicators); // P1.D: 可选预算
    const series = [];
    const stats = [];

    for (const code of codes) {
      const tsCode = codeToTsCode(code);
      const conds = ['ts_code = ?'];
      const params = [tsCode];
      if (qs.start) { conds.push('end_date >= ?'); params.push(qs.start); }
      if (qs.end)   { conds.push('end_date <= ?'); params.push(qs.end); }
      const rows = db.prepare(`
        SELECT end_date, unit_nav, adj_nav
        FROM fund_nav WHERE ${conds.join(' AND ')}
        ORDER BY end_date ASC
      `).all(...params);

      const basic = db.prepare('SELECT name FROM fund_basic WHERE code = ?').get(code);
      const name = basic?.name || code;

      // 降采样
      const sampled = downsample(rows, interval);
      const dates = sampled.map(r => r.end_date);
      const navs = sampled.map(r => r.unit_nav);
      const adjNavs = sampled.map(r => r.adj_nav ?? r.unit_nav);

      series.push({ code, name, dates, navs, adjNavs });
      stats.push({ code, name, ...computeStats(dates, adjNavs, { interval }) });
    }

    const range = computeUnionRange(series);

    // P1.D: 按请求增补 ma20 / ma60 / drawdown 等指标字段。
    // 其他名被 parseIndicators 丢弃，enrichSeriesIndicators 是 mutate-and-return。
    if (indicators.length) enrichSeriesIndicators(series, indicators);

    // compare 是页面热路径，加上 ETag 后重访问只走 304。max-age=60。
    jsonCached(req, res, { codes, range, series, stats }, { maxAge: 60 });
  } catch (e) {
    json(res, 500, { error: e.message });
  }
}

function handleNavRange(code, req, res) {
  try {
    const db = getDb();
    const tsCode = codeToTsCode(code);

    const range = db.prepare(`
      SELECT min(end_date) as earliest, max(end_date) as latest, count(*) as total
      FROM fund_nav WHERE ts_code = ?
    `).get(tsCode);

    if (!range || !range.total) {
      json(res, 404, { error: '无净值数据', code });
      return;
    }

    // 日期 range 变化极慢（天级 ETL 后才动）。max-age=300。
    jsonCached(req, res, {
      code,
      ts_code: tsCode,
      earliest: range.earliest,
      latest: range.latest,
      total_records: range.total,
    }, { maxAge: 300 });
  } catch (e) {
    json(res, 500, { error: '查询失败', detail: e.message });
  }
}

export function createNavRouter() {
  return function navRouter(req, res) {
    const urlPath = (req.url || '').split('?')[0];

    // GET /api/nav/stats
    if (/^\/api\/nav\/stats\/?$/.test(urlPath)) {
      handleNavStats(req, res);
      return;
    }

    // GET /api/nav/compare
    if (/^\/api\/nav\/compare\/?$/.test(urlPath)) {
      handleNavCompare(req, res);
      return;
    }

    // GET /api/nav/:code/history
    const historyMatch = urlPath.match(/^\/api\/nav\/(\d{6})\/history\/?$/);
    if (historyMatch) {
      handleNavHistory(historyMatch[1], req, res);
      return;
    }

    // GET /api/nav/:code/range
    const rangeMatch = urlPath.match(/^\/api\/nav\/(\d{6})\/range\/?$/);
    if (rangeMatch) {
      handleNavRange(rangeMatch[1], req, res);
      return;
    }

    // GET /api/nav/:code
    const latestMatch = urlPath.match(/^\/api\/nav\/(\d{6})\/?$/);
    if (latestMatch) {
      handleNavLatest(latestMatch[1], req, res);
      return;
    }

    json(res, 404, { error: 'NAV route not found' });
  };
}
