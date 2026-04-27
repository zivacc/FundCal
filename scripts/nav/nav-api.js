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
