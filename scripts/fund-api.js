/**
 * SQLite-backed Fund API router.
 *
 * Routes:
 *   GET  /api/fund/list?fields=summary|full[&source=both,crawler,tushare]
 *   GET  /api/fund/codes                    — 仅 code 数组（兼容旧前端）
 *   GET  /api/fund/search-index             — [{code, name, initials}] (仅 crawler-having)
 *   GET  /api/fund/stats                    — 跟踪标的/基金公司/基准 三维聚合
 *   GET  /api/fund/:code                    — 单基金完整结构（与旧 allfund.funds[code] 同形）
 *   GET  /api/fund/:code/fee                — 兼容旧 fee 端点（实质同 :code）
 *   POST /api/fund/:code/crawl              — 触发爬虫补全 (Q1.B)
 *
 * 数据来源：fund_basic + fund_meta + fund_fee_segments + fund_stage_returns
 * 智能回退：fund_basic 非空用 fund_basic，否则用 *_crawler 影子列。
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { pinyin } from 'pinyin-pro';
import { getDb } from './nav/db.js';
import { jsonCached } from './nav/http-cache.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const SEG_KIND_TO_KEY = {
  subscribe_front: 'subscribeFrontSegments',
  purchase_front:  'purchaseFrontSegments',
  purchase_back:   'purchaseBackSegments',
  redeem:          'redeemSegments',
  sell:            'sellFeeSegments',
};

function smartPick(tushareVal, crawlerVal) {
  if (tushareVal != null && String(tushareVal).trim() !== '') return tushareVal;
  return crawlerVal;
}

function getInitials(text) {
  if (!text || typeof text !== 'string') return '';
  try {
    const arr = pinyin(text, { pattern: 'first', toneType: 'none', type: 'array' });
    return (arr || []).join('').toLowerCase();
  } catch {
    return '';
  }
}

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

/** 单基金 row → 旧 JSON 结构 */
function rowToFundObject(row, segs, stages) {
  const name = smartPick(row.name, row.name_crawler) || '';
  const fundType = smartPick(row.fund_type, row.fund_type_crawler) || '';
  const fundManager = smartPick(row.management, row.management_crawler) || '';
  const benchmark = smartPick(row.benchmark, row.benchmark_crawler) || '';

  const obj = {
    code: row.code,
    name,
    source: row.source,
    status: row.status || null,
    lifecycle: deriveLifecycle(row.status),
    needsCrawl: row.source === 'tushare',
    updatedAt: row.crawler_updated_at || '',
    trackingTarget: row.tracking_target || '',
    fundManager,
    performanceBenchmark: benchmark,
    fundType,
    tradingStatus: (row.trading_subscribe || row.trading_redeem) ? {
      subscribe: row.trading_subscribe || '',
      redeem: row.trading_redeem || '',
    } : null,
    operationFees: {
      managementFee: row.mgmt_fee ?? 0,
      custodyFee: row.custody_fee ?? 0,
      salesServiceFee: row.sales_service_fee ?? 0,
      total: row.operation_fee_total ?? 0,
    },
    buyFee: row.buy_fee ?? 0,
    annualFee: row.annual_fee ?? 0,
    isFloatingAnnualFee: !!row.is_floating_annual_fee,
    netAssetScale: row.net_asset_text ? {
      text: row.net_asset_text,
      amountText: row.net_asset_amount_text || '',
      asOfDate: row.net_asset_as_of || '',
    } : null,
    stageReturns: stages,
    stageReturnsAsOf: row.stage_returns_as_of || null,
    establishmentDate: row.found_date_normalized || '',
  };

  for (const [kind, key] of Object.entries(SEG_KIND_TO_KEY)) {
    obj[key] = (segs[kind] || []).map(s => ({ to: s.to_days, rate: s.rate }));
  }
  return obj;
}

const FULL_SELECT = `
  SELECT
    m.ts_code, m.code, m.source,
    m.tracking_target, m.trading_subscribe, m.trading_redeem,
    m.buy_fee, m.annual_fee, m.is_floating_annual_fee,
    m.mgmt_fee, m.custody_fee, m.sales_service_fee, m.operation_fee_total,
    m.net_asset_text, m.net_asset_amount_text, m.net_asset_as_of,
    m.stage_returns_as_of, m.crawler_updated_at, m.found_date_normalized,
    m.name_crawler, m.fund_type_crawler, m.management_crawler, m.benchmark_crawler,
    b.name, b.management, b.fund_type, b.benchmark, b.status
  FROM fund_meta m
  LEFT JOIN fund_basic b ON b.ts_code = m.ts_code
`;

function deriveLifecycle(status) {
  if (status === 'D') return 'terminated';
  if (status === 'I') return 'issuing';
  return 'normal';
}

function loadOne(db, code) {
  const row = db.prepare(`${FULL_SELECT} WHERE m.code = ?`).get(code);
  if (!row) return null;
  const segRows = db.prepare(`
    SELECT kind, seq, to_days, rate FROM fund_fee_segments
    WHERE ts_code = ? ORDER BY kind, seq
  `).all(row.ts_code);
  const segs = {};
  for (const s of segRows) {
    if (!segs[s.kind]) segs[s.kind] = [];
    segs[s.kind].push(s);
  }
  const stages = db.prepare(`
    SELECT period, return_pct, return_text FROM fund_stage_returns
    WHERE ts_code = ?
  `).all(row.ts_code).map(r => ({
    period: r.period,
    returnPct: r.return_pct,
    returnText: r.return_text || '',
  }));
  return rowToFundObject(row, segs, stages);
}

/** list?fields=summary|full → 大数据集，一次查全 + 内存聚合 */
function loadList(db, fields, sourceFilter) {
  let where = '';
  const params = [];
  if (sourceFilter) {
    const sources = sourceFilter.split(',').map(s => s.trim()).filter(Boolean);
    if (sources.length) {
      where = `WHERE m.source IN (${sources.map(() => '?').join(',')})`;
      params.push(...sources);
    }
  }
  const rows = db.prepare(`${FULL_SELECT} ${where} ORDER BY m.code`).all(...params);

  if (fields !== 'full') {
    // 列表页要展示赎回阶梯，summary 也带 sell/redeem 分段
    const segRows = db.prepare(`
      SELECT ts_code, kind, seq, to_days, rate FROM fund_fee_segments
      WHERE kind IN ('sell', 'redeem') ORDER BY ts_code, kind, seq
    `).all();
    const segMap = new Map();
    for (const s of segRows) {
      let bucket = segMap.get(s.ts_code);
      if (!bucket) { bucket = { sell: [], redeem: [] }; segMap.set(s.ts_code, bucket); }
      bucket[s.kind].push({ to: s.to_days, rate: s.rate });
    }
    return rows.map(row => {
      const name = smartPick(row.name, row.name_crawler) || '';
      const segs = segMap.get(row.ts_code) || { sell: [], redeem: [] };
      return {
        code: row.code,
        name,
        initials: getInitials(name),
        source: row.source,
        status: row.status || null,
        lifecycle: deriveLifecycle(row.status),
        needsCrawl: row.source === 'tushare',
        buyFee: row.buy_fee ?? 0,
        annualFee: row.annual_fee ?? 0,
        sellFeeSegments: segs.sell,
        redeemSegments: segs.redeem,
        fundType: smartPick(row.fund_type, row.fund_type_crawler) || '',
        trackingTarget: row.tracking_target || '',
        performanceBenchmark: smartPick(row.benchmark, row.benchmark_crawler) || '',
        fundManager: smartPick(row.management, row.management_crawler) || '',
        establishmentDate: row.found_date_normalized || '',
        tradingStatus: (row.trading_subscribe || row.trading_redeem) ? {
          subscribe: row.trading_subscribe || '',
          redeem: row.trading_redeem || '',
        } : null,
        updatedAt: row.crawler_updated_at || '',
      };
    });
  }

  // full：还需 segments + stage returns
  const allSegs = db.prepare(`
    SELECT ts_code, kind, seq, to_days, rate FROM fund_fee_segments ORDER BY ts_code, kind, seq
  `).all();
  const segMap = new Map();
  for (const s of allSegs) {
    if (!segMap.has(s.ts_code)) segMap.set(s.ts_code, {});
    const buckets = segMap.get(s.ts_code);
    if (!buckets[s.kind]) buckets[s.kind] = [];
    buckets[s.kind].push(s);
  }
  const allStages = db.prepare(`
    SELECT ts_code, period, return_pct, return_text FROM fund_stage_returns ORDER BY ts_code
  `).all();
  const stageMap = new Map();
  for (const r of allStages) {
    if (!stageMap.has(r.ts_code)) stageMap.set(r.ts_code, []);
    stageMap.get(r.ts_code).push({
      period: r.period, returnPct: r.return_pct, returnText: r.return_text || '',
    });
  }
  return rows.map(row => rowToFundObject(
    row,
    segMap.get(row.ts_code) || {},
    stageMap.get(row.ts_code) || [],
  ));
}

function loadSearchIndex(db) {
  // 仅 crawler-having（needsCrawl=false）的进搜索索引；占位行不参与搜索
  const rows = db.prepare(`
    SELECT m.code, m.name_crawler, b.name
    FROM fund_meta m LEFT JOIN fund_basic b ON b.ts_code = m.ts_code
    WHERE m.source IN ('both','crawler')
    ORDER BY m.code
  `).all();
  return rows.map(r => {
    const name = smartPick(r.name, r.name_crawler) || '';
    return { code: r.code, name, initials: getInitials(name) };
  });
}

function loadStats(db) {
  // 四维聚合 (tracking/manager/benchmark/fundType)，仅取 crawler-having
  const rows = db.prepare(`
    SELECT m.code, m.tracking_target,
      COALESCE(b.management, m.management_crawler) AS manager,
      COALESCE(b.benchmark, m.benchmark_crawler) AS benchmark,
      COALESCE(b.fund_type, m.fund_type_crawler) AS fund_type
    FROM fund_meta m LEFT JOIN fund_basic b ON b.ts_code = m.ts_code
    WHERE m.source IN ('both','crawler')
  `).all();

  const trackingMap = new Map();
  const managerMap = new Map();
  const benchmarkMap = new Map();
  const fundTypeMap = new Map();
  let trackingFundCount = 0;

  const inc = (map, key, code) => {
    const k = key || '';
    const prev = map.get(k);
    if (prev) { prev.count += 1; if (code) prev.codes.push(code); return; }
    map.set(k, { count: 1, codes: code ? [code] : [] });
  };

  for (const r of rows) {
    const rawTracking = (r.tracking_target || '').trim();
    const isNoTracking = !rawTracking || rawTracking.includes('该基金无跟踪标的');
    const tracking = isNoTracking ? '无跟踪标的' : rawTracking;
    const manager = (r.manager || '').trim() || '未知基金公司';
    const benchmark = (r.benchmark || '').trim() || '无业绩基准';
    const fundType = (r.fund_type || '').trim();
    if (!isNoTracking) trackingFundCount++;
    inc(trackingMap, tracking, r.code);
    inc(managerMap, manager, r.code);
    inc(benchmarkMap, benchmark, r.code);
    if (fundType) inc(fundTypeMap, fundType, r.code);
  }

  const toArray = (map) =>
    Array.from(map.entries())
      .map(([label, info]) => ({ label, count: info.count || 0, codes: info.codes || [] }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'zh-CN'));

  return {
    total: rows.length,
    trackingFundCount,
    tracking: toArray(trackingMap).filter(x => !x.label.includes('无跟踪标的')),
    manager: toArray(managerMap),
    benchmark: toArray(benchmarkMap),
    fundType: toArray(fundTypeMap),
  };
}

/**
 * 单分组明细 (替代 fund-stats-detail.json，按需查)。
 *
 * @param {*} db
 * @param {'tracking'|'manager'|'benchmark'|'fundType'} dim
 * @param {string} label  分组标签 (含 "无跟踪标的"/"未知基金公司"/"无业绩基准" 哨兵)
 * @returns {Array<{code,name,trackingTarget,fundManager,performanceBenchmark}>|null}
 */
function loadStatsDetail(db, dim, label) {
  if (label == null) return null;
  let where = '';
  let param;
  switch (dim) {
    case 'tracking':
      if (label === '无跟踪标的') {
        where = "(m.tracking_target IS NULL OR trim(m.tracking_target) = '' OR m.tracking_target LIKE '%该基金无跟踪标的%')";
      } else {
        where = 'trim(m.tracking_target) = ?'; param = label;
      }
      break;
    case 'manager':
      if (label === '未知基金公司') {
        where = "trim(COALESCE(b.management, m.management_crawler, '')) = ''";
      } else {
        where = "trim(COALESCE(b.management, m.management_crawler, '')) = ?"; param = label;
      }
      break;
    case 'benchmark':
      if (label === '无业绩基准') {
        where = "trim(COALESCE(b.benchmark, m.benchmark_crawler, '')) = ''";
      } else {
        where = "trim(COALESCE(b.benchmark, m.benchmark_crawler, '')) = ?"; param = label;
      }
      break;
    case 'fundType':
      if (!label.trim()) return null;
      where = "trim(COALESCE(b.fund_type, m.fund_type_crawler, '')) = ?"; param = label;
      break;
    default:
      return null;
  }
  const sql = `
    SELECT m.code, COALESCE(b.name, m.name_crawler) AS name,
      m.tracking_target,
      COALESCE(b.management, m.management_crawler) AS manager,
      COALESCE(b.benchmark, m.benchmark_crawler) AS benchmark
    FROM fund_meta m LEFT JOIN fund_basic b ON b.ts_code = m.ts_code
    WHERE m.source IN ('both','crawler') AND ${where}
    ORDER BY m.code
  `;
  const stmt = db.prepare(sql);
  const rows = param != null ? stmt.all(param) : stmt.all();
  return rows.map(r => ({
    code: r.code,
    name: r.name || '',
    trackingTarget: (r.tracking_target || '').trim(),
    fundManager: (r.manager || '').trim(),
    performanceBenchmark: (r.benchmark || '').trim(),
  }));
}

function loadCodes(db, sourceFilter) {
  let sql = "SELECT code FROM fund_meta WHERE source IN ('both','crawler') ORDER BY code";
  const params = [];
  if (sourceFilter) {
    const sources = sourceFilter.split(',').map(s => s.trim()).filter(Boolean);
    sql = `SELECT code FROM fund_meta WHERE source IN (${sources.map(() => '?').join(',')}) ORDER BY code`;
    params.push(...sources);
  }
  return db.prepare(sql).all(...params).map(r => r.code);
}

/** 触发 crawl-fund-fee.js 子进程；非阻塞返回 jobId（简化版：等待完成） */
function runCrawl(code) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath,
      [path.join(__dirname, 'crawl-fund-fee.js'), code],
      { cwd: ROOT, env: process.env });
    let stdout = '', stderr = '';
    child.stdout.on('data', d => stdout += d.toString());
    child.stderr.on('data', d => stderr += d.toString());
    child.on('close', (exitCode) => {
      resolve({ exitCode, stdout, stderr });
    });
    setTimeout(() => { try { child.kill(); } catch {} }, 60000);
  });
}

/**
 * NOTE: 历史 `upsertSingleFundFromCrawler` 已删除。`crawl-fund-fee.js` 子进程默认
 * 直写 DB，不再产 `data/funds/<code>.json`，所以再读 JSON 二次入库永远 reason="crawler
 * JSON 不存在"。`POST /api/fund/:code/crawl` 现在以子进程 exitCode === 0 为成功判据。
 * 参见 docs/audit-data-flow.md 表格 P0 #2。
 */

export function createFundRouter() {
  return async function fundRouter(req, res) {
    const urlPath = (req.url || '').split('?')[0];
    const qs = parseQuery(req.url || '');
    const db = getDb();

    // POST /api/fund/:code/crawl —— 爬取 + 自动入 DB
    if (req.method === 'POST') {
      const m = urlPath.match(/^\/api\/fund\/(\d{6})\/crawl\/?$/);
      if (m) {
        const code = m[1];
        try {
          const result = await runCrawl(code);
          if (result.exitCode !== 0) {
            json(res, 500, { ok: false, code, exitCode: result.exitCode, stderr: result.stderr.slice(0, 500) });
            return true;
          }
          // 子进程 exitCode === 0 即表示 crawl-fund-fee.js 已成功直写 DB（fund_basic/fund_meta/fund_fee_segments/fund_stage_returns）。
          // 历史的 upsertSingleFundFromCrawler 是从 data/funds/<code>.json 二次入库，而现在子进程默认不再产 JSON，
          // 所以已经被移除，避免 “爬取成功但入 DB 失败：crawler JSON 不存在” 的误报。
          json(res, 200, { ok: true, code, message: '爬取并入 DB 完成' });
        } catch (e) {
          json(res, 500, { ok: false, code, error: e.message });
        }
        return true;
      }
      return false;
    }

    if (req.method !== 'GET') return false;

    // GET /api/fund/list?fields=summary|full[&source=...]
    if (/^\/api\/fund\/list\/?$/.test(urlPath)) {
      try {
        const data = loadList(db, qs.fields || 'summary', qs.source || '');
        // 列表 ETL 天级更新；max-age=300 (5min) + ETag 让重访短路
        jsonCached(req, res, data, { maxAge: 300, scope: 'public' });
      } catch (e) {
        json(res, 500, { error: e.message });
      }
      return true;
    }

    // GET /api/fund/codes
    if (/^\/api\/fund\/codes\/?$/.test(urlPath)) {
      try { jsonCached(req, res, { codes: loadCodes(db, qs.source) }, { maxAge: 300, scope: 'public' }); }
      catch (e) { json(res, 500, { error: e.message }); }
      return true;
    }

    // GET /api/fund/search-index
    if (/^\/api\/fund\/search-index\/?$/.test(urlPath)) {
      try { jsonCached(req, res, loadSearchIndex(db), { maxAge: 600, scope: 'public' }); }
      catch (e) { json(res, 500, { error: e.message }); }
      return true;
    }

    // GET /api/fund/stats/detail?dim=...&label=...
    if (/^\/api\/fund\/stats\/detail\/?$/.test(urlPath)) {
      try {
        const dim = qs.dim || '';
        const label = qs.label != null ? qs.label : '';
        const data = loadStatsDetail(db, dim, label);
        if (data == null) { json(res, 400, { error: 'dim/label 参数错误', dim, label }); return true; }
        jsonCached(req, res, data, { maxAge: 600, scope: 'public' });
      } catch (e) {
        json(res, 500, { error: e.message });
      }
      return true;
    }

    // GET /api/fund/stats
    if (/^\/api\/fund\/stats\/?$/.test(urlPath)) {
      try { jsonCached(req, res, loadStats(db), { maxAge: 600, scope: 'public' }); }
      catch (e) { json(res, 500, { error: e.message }); }
      return true;
    }

    // GET /api/fund/:code  或  /api/fund/:code/fee
    const codeMatch = urlPath.match(/^\/api\/fund\/(\d{6})(?:\/fee)?\/?$/);
    if (codeMatch) {
      try {
        const data = loadOne(db, codeMatch[1]);
        if (!data) { json(res, 404, { error: '基金不存在', code: codeMatch[1] }); return true; }
        jsonCached(req, res, data, { maxAge: 300, scope: 'public' });
      } catch (e) {
        json(res, 500, { error: e.message });
      }
      return true;
    }

    return false; // 未命中
  };
}
