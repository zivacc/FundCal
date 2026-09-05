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
 *   node scripts/nav/crawl-em-index.js --tracked       # 被基金跟踪或已有日线的指数
 *   node scripts/nav/crawl-em-index.js --tracked --resume # 跳过当日成功项
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
const REQUEST_GAP_MS = parseInt(process.env.EASTMONEY_INDEX_GAP_MS || '1000', 10);
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
  const opts = { secids: [], tracked: false, allEm: false, full: false, resume: false, concurrency: 1 };
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--codes': opts.secids = (args[++i] || '').split(',').map(c => c.trim()).filter(Boolean); break;
      case '--tracked': opts.tracked = true; break;
      case '--all-em': opts.allEm = true; break;
      case '--full': opts.full = true; break;
      case '--resume': opts.resume = true; break;
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
    return opts.secids.map(secid => db.prepare("SELECT ts_code, source_code FROM index_source_map WHERE source='eastmoney' AND source_code=?").get(secid)
      || { source_code: secid, ts_code: null });
  }
  if (opts.tracked) {
    const rows = db.prepare(`
      SELECT DISTINCT b.ts_code, m.source_code FROM index_basic b
      LEFT JOIN index_source_map m ON m.ts_code=b.ts_code AND m.source='eastmoney' AND m.is_active=1
      WHERE EXISTS (SELECT 1 FROM index_fund_tracker t WHERE t.index_ts_code=b.ts_code)
        OR EXISTS (SELECT 1 FROM index_daily d WHERE d.ts_code=b.ts_code)
    `).all();
    return rows.map(r => {
      if (r.source_code) return r;
      const [code, suffix] = r.ts_code.split('.');
      const market = suffix === 'SH' ? '1' : /^(SZ|BJ)$/.test(suffix) ? '0'
        : suffix === 'CSI' ? (code.startsWith('000') ? '1' : code.startsWith('399') ? '0' : '2') : null;
      return { ...r, source_code: market ? `${market}.${code}` : null };
    });
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
      if (json.rc !== 0 || !json.data || !Array.isArray(json.data.klines)) throw new Error(`Eastmoney ${secid}: rc=${json.rc}, no data`);
      if (json.data.code !== secid.split('.').slice(1).join('.')) throw new Error(`Index code mismatch: ${secid}`);
      const klines = json?.data?.klines || [];
      return klines;
    } catch (e) {
      lastErr = e;
      if (/rc=100/.test(e.message)) break;
      nextSlotAt = Math.max(nextSlotAt, Date.now() + 5000 * 2 ** (attempt - 1));
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
  if (!secid) throw new Error(`No public index mapping: ${ts_code}`);
  const prefix = `[${String(idx + 1).padStart(String(total).length, ' ')}/${total}]`;
  if (!ts_code) {
    throw new Error(`${secid} — 无 ts_code 绑定，请先注册 index_basic + source_map`);
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
    getDb().prepare(`INSERT INTO index_source_map(ts_code,source,source_code,is_active,notes)
      VALUES(?,'eastmoney',?,1,'Validated code against Eastmoney response')
      ON CONFLICT(ts_code,source) DO NOTHING`).run(ts_code, secid);
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
    throw e;
  }
}

async function main() {
  const opts = parseArgs();
  let items = resolveSourceCodes(opts);
  if (opts.resume) {
    const done = new Set(getDb().prepare(`SELECT DISTINCT ts_code FROM sync_log
      WHERE api_name='eastmoney_kline' AND status='success' AND finished_at >= ?`).all(new Date().toISOString().slice(0,10)).map(r => r.ts_code));
    items = items.filter(item => !done.has(item.ts_code));
  }

  console.log(`🌐 东财指数日线兜底 (push2his)`);
  console.log(`   指数: ${items.length}, 并发: ${opts.concurrency}, 模式: ${opts.full ? '全量' : '增量'}`);

  if (!items.length) { closeDb(); return; }

  let total = 0, success = 0, error = 0, consecutiveFailures = 0;
  const start = Date.now();
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const i = cursor++;
      try {
        const n = await syncOne(items[i], i, items.length, opts.full);
        total += n; success++;
        consecutiveFailures = 0;
      } catch (e) {
        error++;
        console.error(`worker error: ${e.message}`);
        if (!items[i].source_code) logSync({ts_code: items[i].ts_code, api_name: 'eastmoney_kline', status: 'error',
          finished_at: new Date().toISOString(), error_message: e.message});
        if (/fetch failed|timeout|429/i.test(e.message) && ++consecutiveFailures >= 3) {
          console.error('连续网络失败，停止请求。可稍后使用 --resume 续传。');
          cursor = items.length;
          return;
        }
      }
    }
  }
  await Promise.all(Array.from({ length: opts.concurrency }, worker));

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`\n${error ? '⚠️ 部分完成' : '✅ 完成'}: 成功 ${success} / 失败 ${error}, 未处理 ${items.length - success - error}, +${total} 行, 耗时 ${elapsed}s`);
  closeDb();
  if (error) process.exitCode = 1;
}

main().catch(e => { console.error('💥', e); closeDb(); process.exit(1); });
