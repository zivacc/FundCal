#!/usr/bin/env node
/**
 * 东方财富 push2his 兜底拉指数日线 → index_daily (source=2).
 *
 * 适用范围: tushare 不覆盖的指数 (海外: NDX/SPX/HSI; 中债部分; 港股科技; 黄金等).
 * secid 规则:
 *   1.xxx   上交所
 *   0.xxx   深交所
 *   100.xxx 海外指数
 *   116.xxx 港股
 *   105.xxx 美股个股
 *
 * source 列定义: 1=tushare, 2=eastmoney, 3=csindex (待实现), 6=custom
 *
 * 用法 (前提: index_source_map 已有 source='eastmoney' 的映射):
 *   node scripts/nav/crawl-em-index.js --codes 100.NDX,100.SPX,100.HSI    # 直接 secid
 *   node scripts/nav/crawl-em-index.js --tracked       # 仅同步被基金跟踪 + tushare 无覆盖的
 *   node scripts/nav/crawl-em-index.js --all-em        # source_map 中所有 eastmoney 源
 *   node scripts/nav/crawl-em-index.js --full          # 全量
 *
 * 注册 secid 映射示例:
 *   sqlite3 data/fundcal.db "INSERT INTO index_basic(ts_code,code,name,publisher,category,market,primary_source)
 *     VALUES('NDX.GI','NDX','纳斯达克100指数','NASDAQ','海外股票','GLOBAL','eastmoney');
 *     INSERT INTO index_source_map(ts_code,source,source_code) VALUES('NDX.GI','eastmoney','100.NDX');"
 */

import {
  getDb, closeDb,
  upsertIndexDailyRecords, getLatestIndexDailyDate, logSync,
} from './db.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0';
const HEADERS = { 'User-Agent': UA, 'Referer': 'https://quote.eastmoney.com/' };
const REQUEST_GAP_MS = parseInt(process.env.EASTMONEY_GAP_MS || '50', 10);
const MAX_RETRIES = 3;

let nextSlotAt = 0;
async function reserveSlot() {
  const now = Date.now();
  const slot = Math.max(now, nextSlotAt);
  nextSlotAt = slot + REQUEST_GAP_MS;
  const wait = slot - now;
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
}

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { secids: [], tracked: false, allEm: false, full: false, concurrency: 3 };
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--codes': opts.secids = (args[++i] || '').split(',').map(c => c.trim()).filter(Boolean); break;
      case '--tracked': opts.tracked = true; break;
      case '--all-em': opts.allEm = true; break;
      case '--full': opts.full = true; break;
      case '--concurrency':
      case '-c': opts.concurrency = Math.max(1, parseInt(args[++i], 10) || 3); break;
    }
  }
  return opts;
}

function resolveSourceCodes(opts) {
  const db = getDb();
  if (opts.secids.length) {
    // 用户直接给 secid; 假设已在 source_map 注册或将动态绑定
    return opts.secids.map(secid => ({ source_code: secid, ts_code: null }));
  }
  if (opts.tracked) {
    const rows = db.prepare(`
      SELECT m.ts_code, m.source_code FROM index_source_map m
      JOIN index_fund_tracker t ON t.index_ts_code = m.ts_code
      WHERE m.source = 'eastmoney' AND m.is_active = 1
    `).all();
    return rows;
  }
  if (opts.allEm) {
    const rows = db.prepare(`
      SELECT ts_code, source_code FROM index_source_map
      WHERE source = 'eastmoney' AND is_active = 1
    `).all();
    return rows;
  }
  console.log('用法见文件头注释');
  process.exit(0);
}

async function fetchEm(secid, beg, end) {
  const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secid}` +
    `&fields1=f1,f2,f3,f4,f5&fields2=f51,f52,f53,f54,f55,f56,f57,f58` +
    `&klt=101&fqt=1&beg=${beg}&end=${end}&lmt=10000`;
  let lastErr;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    await reserveSlot();
    try {
      const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(30000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const klines = json?.data?.klines || [];
      return klines;
    } catch (e) {
      lastErr = e;
      if (attempt < MAX_RETRIES) await new Promise(r => setTimeout(r, 500 * attempt));
    }
  }
  throw lastErr;
}

function parseKline(line) {
  // f51-f58: 日期, 开, 收, 高, 低, 成交量, 成交额, 振幅
  const parts = line.split(',');
  if (parts.length < 7) return null;
  const date = parts[0].replace(/-/g, '');
  if (!/^\d{8}$/.test(date)) return null;
  const open = parseFloat(parts[1]);
  const close = parseFloat(parts[2]);
  const high = parseFloat(parts[3]);
  const low = parseFloat(parts[4]);
  const vol = parseFloat(parts[5]);
  const amount = parseFloat(parts[6]);
  if (!Number.isFinite(close)) return null;
  return {
    end_date: date,
    open: Number.isFinite(open) ? open : null,
    high: Number.isFinite(high) ? high : null,
    low: Number.isFinite(low) ? low : null,
    close,
    pre_close: null,
    pct_chg: null,
    vol: Number.isFinite(vol) ? vol : null,
    amount: Number.isFinite(amount) ? amount : null,
    source: 2,
  };
}

async function syncOne(item, idx, total, fullMode) {
  const { ts_code, source_code: secid } = item;
  const prefix = `[${String(idx + 1).padStart(String(total).length, ' ')}/${total}]`;
  if (!ts_code) {
    console.warn(`${prefix} ${secid} — 无 ts_code 绑定 (跳过, 请先 INSERT index_basic + register source_map)`);
    return 0;
  }

  let beg = '19900101';
  if (!fullMode) {
    const latest = getLatestIndexDailyDate(ts_code);
    if (latest) {
      const y = parseInt(latest.slice(0, 4), 10);
      const m = parseInt(latest.slice(4, 6), 10) - 1;
      const d = parseInt(latest.slice(6, 8), 10);
      const next = new Date(y, m, d + 1);
      beg = `${next.getFullYear()}${String(next.getMonth() + 1).padStart(2, '0')}${String(next.getDate()).padStart(2, '0')}`;
    }
  }
  const endStr = (() => {
    const d = new Date();
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  })();
  if (beg > endStr) {
    console.log(`${prefix} ${ts_code} (${secid}) — 已是最新`);
    return 0;
  }

  const startedAt = new Date().toISOString();
  try {
    const klines = await fetchEm(secid, beg, endStr);
    if (!klines.length) {
      console.log(`${prefix} ${ts_code} (${secid}) — 无新数据`);
      logSync({
        ts_code, api_name: 'eastmoney_kline', status: 'success',
        record_count: 0, started_at: startedAt, finished_at: new Date().toISOString(),
      });
      return 0;
    }
    const records = klines.map(line => {
      const parsed = parseKline(line);
      if (!parsed) return null;
      return { ts_code, ...parsed };
    }).filter(Boolean);
    upsertIndexDailyRecords(records, 2);
    logSync({
      ts_code, api_name: 'eastmoney_kline', status: 'success',
      record_count: records.length, started_at: startedAt, finished_at: new Date().toISOString(),
    });
    console.log(`${prefix} ${ts_code} (${secid}) +${records.length} 条`);
    return records.length;
  } catch (e) {
    console.error(`${prefix} ${ts_code} (${secid}) ❌ ${e.message}`);
    logSync({
      ts_code, api_name: 'eastmoney_kline', status: 'error',
      started_at: startedAt, finished_at: new Date().toISOString(), error_message: e.message,
    });
    return 0;
  }
}

async function main() {
  const opts = parseArgs();
  const items = resolveSourceCodes(opts);

  console.log(`🌐 东财指数日线兜底 (push2his)`);
  console.log(`   指数: ${items.length}, 并发: ${opts.concurrency}, 模式: ${opts.full ? '全量' : '增量'}`);

  if (!items.length) { closeDb(); return; }

  let total = 0, success = 0, error = 0;
  const start = Date.now();
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const i = cursor++;
      try {
        const n = await syncOne(items[i], i, items.length, opts.full);
        total += n; success++;
      } catch (e) {
        error++;
        console.error(`worker error: ${e.message}`);
      }
    }
  }
  await Promise.all(Array.from({ length: opts.concurrency }, worker));

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`\n✅ 完成: 成功 ${success} / 失败 ${error}, +${total} 行, 耗时 ${elapsed}s`);
  closeDb();
}

main().catch(e => { console.error('💥', e); closeDb(); process.exit(1); });
