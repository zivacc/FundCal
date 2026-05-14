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
import { isFundCode, KIND } from '../../js/core/code-kind.js';
import { computeETag, ifNoneMatchHits, jsonCached } from './http-cache.js';

// 测试入口仍从此模块导入，保留 re-export
export { computeETag, ifNoneMatchHits };

function json(res, status, data) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.writeHead(status);
  res.end(JSON.stringify(data));
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
 * 多基金/指数净值比较 + 统计指标
 * GET /api/nav/compare?codes=000001,110011,HSI.HI,NDX.GI[&start=YYYYMMDD&end=YYYYMMDD][&interval=daily|weekly|monthly]
 *
 * codes 接受混合形式: 6 位数字 → 场外基金 (.OF); 含字母/点的串 → 指数 ts_code
 * 后端按 key 派发到 fund_nav (source=1/2) / index_daily, 字段对齐到统一 series 结构。
 *
 * 返回:
 * {
 *   codes: [...],
 *   range: { start, end },
 *   series: [{ code, name, kind:'fund'|'index', dates, navs, adjNavs }],
 *   stats:  [{ code, name, kind, ...statsFields }]
 * }
 *
 * 说明:
 * - 基金: navs=unit_nav, adjNavs=adj_nav ?? unit_nav (复权优先)
 * - 指数: navs=adjNavs=close (无复权概念, 两字段同值)
 * - 统计基于 adjNavs 日收益率序列, 前端对齐
 */
/** 按 (start?, end?) 维度缓存 4 种 SQL 形态的 prepared stmt; key=db+sql. */
const _stmtCache = new WeakMap();
function cachedStmt(db, sql) {
  let bucket = _stmtCache.get(db);
  if (!bucket) { bucket = new Map(); _stmtCache.set(db, bucket); }
  let stmt = bucket.get(sql);
  if (!stmt) { stmt = db.prepare(sql); bucket.set(sql, stmt); }
  return stmt;
}

function buildDateConds(qs) {
  const conds = [];
  const params = [];
  if (qs.start) { conds.push('end_date >= ?'); params.push(qs.start); }
  if (qs.end)   { conds.push('end_date <= ?'); params.push(qs.end); }
  return { whereTail: conds.length ? ' AND ' + conds.join(' AND ') : '', params };
}

function loadFundSeries(db, code, qs, interval) {
  const tsCode = codeToTsCode(code);
  const { whereTail, params } = buildDateConds(qs);
  const sql = `SELECT end_date, unit_nav, adj_nav FROM fund_nav
               WHERE ts_code = ?${whereTail} ORDER BY end_date ASC`;
  const rows = cachedStmt(db, sql).all(tsCode, ...params);
  const basic = cachedStmt(db, 'SELECT name FROM fund_basic WHERE code = ?').get(code);
  const sampled = downsample(rows, interval);
  return {
    name: basic?.name || code,
    dates:   sampled.map(r => r.end_date),
    navs:    sampled.map(r => r.unit_nav),
    adjNavs: sampled.map(r => r.adj_nav ?? r.unit_nav),
  };
}

function loadIndexSeries(db, tsCode, qs, interval) {
  const { whereTail, params } = buildDateConds(qs);
  const sql = `SELECT end_date, close FROM index_daily
               WHERE ts_code = ?${whereTail} ORDER BY end_date ASC`;
  const rows = cachedStmt(db, sql).all(tsCode, ...params);
  const basic = cachedStmt(db, 'SELECT name FROM index_basic WHERE ts_code = ?').get(tsCode);
  // 把 close 既当 unit_nav 又当 adj_nav 喂给 downsample, 复用同一函数 (指数无复权概念)
  const shaped = rows.map(r => ({ end_date: r.end_date, unit_nav: r.close, adj_nav: r.close }));
  const sampled = downsample(shaped, interval);
  const closes = sampled.map(r => r.unit_nav);
  return {
    name: basic?.name || tsCode,
    dates:   sampled.map(r => r.end_date),
    navs:    closes,
    adjNavs: closes,
  };
}

function handleNavCompare(req, res) {
  try {
    const db = getDb();
    const qs = parseQuery(req.url);
    const rawCodes = (qs.codes || '').split(',').map(s => s.trim()).filter(Boolean);
    if (!rawCodes.length) { json(res, 400, { error: 'codes 必填' }); return; }
    if (rawCodes.length > 20) { json(res, 400, { error: '一次最多对比 20 只' }); return; }

    const interval = qs.interval || 'daily';
    const indicators = parseIndicators(qs.indicators);
    const series = [];
    const stats = [];
    const codes = [];

    for (const raw of rawCodes) {
      const isFund = isFundCode(raw);
      const kind = isFund ? KIND.FUND : KIND.INDEX;
      const loaded = isFund ? loadFundSeries(db, raw, qs, interval)
                            : loadIndexSeries(db, raw, qs, interval);
      codes.push(raw);
      series.push({ code: raw, kind, name: loaded.name, dates: loaded.dates, navs: loaded.navs, adjNavs: loaded.adjNavs });
      stats.push({ code: raw, kind, name: loaded.name, ...computeStats(loaded.dates, loaded.adjNavs, { interval }) });
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

/**
 * 指数搜索索引: GET /api/nav/index-search-index
 * 返回 [{ code: ts_code, name, fullname, kind: 'index', isPrice }]
 *
 * - code 字段直接是 ts_code (如 "HSI.HI"); 与 fund 的 6 位 code 共存于同一前端搜索池
 * - isPrice: 通过 fullname 是否含"全收益"判断 (无该字样默认认为是价格指数)
 * - 仅返回 index_daily 中实际有数据的指数 (避免 zombie 项)
 */
function handleIndexSearchIndex(req, res) {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT b.ts_code, b.name, b.fullname
      FROM index_basic b
      WHERE EXISTS (SELECT 1 FROM index_daily d WHERE d.ts_code = b.ts_code)
      ORDER BY b.ts_code
    `).all();
    const list = rows.map(r => ({
      code: r.ts_code,
      name: r.name || r.ts_code,
      fullname: r.fullname || '',
      kind: 'index',
      isPrice: !/全收益/.test(r.fullname || ''),
    }));
    jsonCached(req, res, list, { maxAge: 300 });
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

    // GET /api/nav/index-search-index
    if (/^\/api\/nav\/index-search-index\/?$/.test(urlPath)) {
      handleIndexSearchIndex(req, res);
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
