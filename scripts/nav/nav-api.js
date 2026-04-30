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

function json(res, status, data) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
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

    json(res, 200, {
      fund_basic_count: basicCount,
      fund_nav_total_records: navCount,
      funds_with_nav: fundWithNav,
      earliest_date: earliest,
      latest_date: latest,
    });
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

    json(res, 200, {
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
    });
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

    json(res, 200, {
      code,
      ts_code: tsCode,
      name: basic?.name || null,
      count: rows.length,
      data: rows,
    });
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
      stats.push({ code, name, ...computeStats(dates, adjNavs) });
    }

    const allDates = series.flatMap(s => s.dates);
    const range = allDates.length ? { start: allDates[0], end: allDates[allDates.length - 1] } : null;

    json(res, 200, { codes, range, series, stats });
  } catch (e) {
    json(res, 500, { error: e.message });
  }
}

/** 按 interval 降采样：weekly 取每周最后一个交易日, monthly 取每月最后一个 */
function downsample(rows, interval) {
  if (interval === 'daily' || rows.length < 800) return rows;
  const out = [];
  if (interval === 'weekly') {
    let lastWeek = '';
    for (const r of rows) {
      const d = `${r.end_date.slice(0,4)}-${r.end_date.slice(4,6)}-${r.end_date.slice(6,8)}`;
      const dt = new Date(d);
      // ISO 周键
      const y = dt.getUTCFullYear();
      const onejan = new Date(Date.UTC(y, 0, 1));
      const w = Math.ceil((((dt - onejan) / 86400000) + onejan.getUTCDay() + 1) / 7);
      const key = `${y}-${w}`;
      if (key !== lastWeek && out.length) {
        // out 已含上一周末记录
      }
      // 简化：last-of-week
      if (out.length && out[out.length - 1]._wkey === key) out[out.length - 1] = { ...r, _wkey: key };
      else out.push({ ...r, _wkey: key });
      lastWeek = key;
    }
    return out.map(r => ({ end_date: r.end_date, unit_nav: r.unit_nav, adj_nav: r.adj_nav }));
  }
  if (interval === 'monthly') {
    const out2 = [];
    for (const r of rows) {
      const ym = r.end_date.slice(0, 6);
      if (out2.length && out2[out2.length - 1]._mkey === ym) out2[out2.length - 1] = { ...r, _mkey: ym };
      else out2.push({ ...r, _mkey: ym });
    }
    return out2.map(r => ({ end_date: r.end_date, unit_nav: r.unit_nav, adj_nav: r.adj_nav }));
  }
  return rows;
}

/** 计算统计指标：CAGR / 最大回撤 / 年化波动率 / Sharpe (rf=2%) */
function computeStats(dates, navs) {
  if (!navs || navs.length < 2) {
    return { startNav: null, endNav: null, totalReturn: null, cagr: null, maxDrawdown: null, volatility: null, sharpe: null };
  }
  const startNav = navs[0];
  const endNav = navs[navs.length - 1];
  const totalReturn = endNav / startNav - 1;
  // 年化复合
  const startDate = parseDate(dates[0]);
  const endDate = parseDate(dates[dates.length - 1]);
  const days = (endDate - startDate) / 86400000;
  const years = days / 365.25;
  const cagr = years > 0 ? Math.pow(endNav / startNav, 1 / years) - 1 : null;

  // 最大回撤
  let peak = navs[0], mdd = 0;
  for (const v of navs) {
    if (v > peak) peak = v;
    const dd = v / peak - 1;
    if (dd < mdd) mdd = dd;
  }

  // 日收益率
  const rets = [];
  for (let i = 1; i < navs.length; i++) {
    if (navs[i - 1] > 0) rets.push(navs[i] / navs[i - 1] - 1);
  }
  // 年化波动率
  const mean = rets.reduce((a, b) => a + b, 0) / (rets.length || 1);
  const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length || 1);
  const dailyVol = Math.sqrt(variance);
  const volatility = dailyVol * Math.sqrt(252);
  // Sharpe: (CAGR - rf) / 年化波动率
  const rf = 0.02;
  const sharpe = volatility > 0 && cagr != null ? (cagr - rf) / volatility : null;

  return {
    startNav, endNav, totalReturn,
    cagr, maxDrawdown: mdd, volatility, sharpe,
  };
}

function parseDate(s) {
  if (!s) return new Date(NaN);
  if (s.length === 8) return new Date(`${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`);
  return new Date(s);
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

    json(res, 200, {
      code,
      ts_code: tsCode,
      earliest: range.earliest,
      latest: range.latest,
      total_records: range.total,
    });
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
