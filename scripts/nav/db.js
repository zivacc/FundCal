/**
 * SQLite database module — connection, schema init, and helpers.
 * Database file: data/fundcal.db (relative to project root).
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'fundcal.db');

let _db = null;

export function getDb() {
  if (_db) return _db;

  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  _db = new Database(DB_PATH);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  _db.pragma('busy_timeout = 5000');

  initSchema(_db);
  ensureTushareShadowColumns(_db);
  ensureNavSourceColumn(_db);
  return _db;
}

/** fund_nav 加 source 列: 1=tushare, 2=eastmoney */
function ensureNavSourceColumn(db) {
  const cols = db.prepare("PRAGMA table_info(fund_nav)").all().map(r => r.name);
  if (cols.includes('source')) return;
  db.exec(`ALTER TABLE fund_nav ADD COLUMN source INTEGER DEFAULT 1`);
  db.exec(`UPDATE fund_nav SET source = 1 WHERE source IS NULL`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_fund_nav_source ON fund_nav(source)`);
  console.log('[db] fund_nav 已加 source 列, 历史行回填为 1 (tushare)');
}

/** 增量 schema 迁移: fund_meta 增加 tushare 影子列, 用于字段裁决 */
function ensureTushareShadowColumns(db) {
  const cols = db.prepare("PRAGMA table_info(fund_meta)").all().map(r => r.name);
  const wanted = [
    'name_tushare', 'fund_type_tushare', 'management_tushare',
    'benchmark_tushare', 'found_date_tushare', 'custodian_tushare', 'status_tushare', 'market_tushare',
  ];
  const missing = wanted.filter(c => !cols.includes(c));
  if (!missing.length) return;
  const tx = db.transaction(() => {
    for (const c of missing) {
      db.exec(`ALTER TABLE fund_meta ADD COLUMN ${c} TEXT`);
    }
    // 一次性回填: 把 fund_basic 当前值 (此时还是 tushare 原值, 因 crawler 不动 fund_basic) 复制到影子
    db.exec(`
      UPDATE fund_meta SET
        name_tushare       = COALESCE(name_tushare,       (SELECT b.name       FROM fund_basic b WHERE b.ts_code = fund_meta.ts_code)),
        fund_type_tushare  = COALESCE(fund_type_tushare,  (SELECT b.fund_type  FROM fund_basic b WHERE b.ts_code = fund_meta.ts_code)),
        management_tushare = COALESCE(management_tushare, (SELECT b.management FROM fund_basic b WHERE b.ts_code = fund_meta.ts_code)),
        benchmark_tushare  = COALESCE(benchmark_tushare,  (SELECT b.benchmark  FROM fund_basic b WHERE b.ts_code = fund_meta.ts_code)),
        custodian_tushare  = COALESCE(custodian_tushare,  (SELECT b.custodian  FROM fund_basic b WHERE b.ts_code = fund_meta.ts_code)),
        status_tushare     = COALESCE(status_tushare,     (SELECT b.status     FROM fund_basic b WHERE b.ts_code = fund_meta.ts_code)),
        market_tushare     = COALESCE(market_tushare,     (SELECT b.market     FROM fund_basic b WHERE b.ts_code = fund_meta.ts_code)),
        found_date_tushare = COALESCE(found_date_tushare,
          (SELECT CASE
              WHEN b.found_date IS NULL OR b.found_date='' THEN NULL
              WHEN length(b.found_date)=8 THEN substr(b.found_date,1,4)||'-'||substr(b.found_date,5,2)||'-'||substr(b.found_date,7,2)
              ELSE b.found_date END
            FROM fund_basic b WHERE b.ts_code = fund_meta.ts_code))
      WHERE source IN ('tushare','both')
    `);
  });
  tx();
  console.log(`[db] fund_meta 已加 tushare 影子列 (${missing.join(', ')}) 并回填`);
}

function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS fund_basic (
      ts_code    TEXT PRIMARY KEY,
      code       TEXT NOT NULL,
      name       TEXT,
      management TEXT,
      custodian  TEXT,
      fund_type  TEXT,
      found_date TEXT,
      status     TEXT,
      market     TEXT,
      benchmark  TEXT,
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_fund_basic_code ON fund_basic(code);
    CREATE INDEX IF NOT EXISTS idx_fund_basic_type ON fund_basic(fund_type);

    CREATE TABLE IF NOT EXISTS fund_nav (
      ts_code        TEXT NOT NULL,
      end_date       TEXT NOT NULL,
      ann_date       TEXT,
      unit_nav       REAL,
      accum_nav      REAL,
      accum_div      REAL,
      net_asset      REAL,
      total_netasset REAL,
      adj_nav        REAL,
      PRIMARY KEY (ts_code, end_date)
    );
    CREATE INDEX IF NOT EXISTS idx_fund_nav_date ON fund_nav(end_date);

    CREATE TABLE IF NOT EXISTS sync_log (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      ts_code       TEXT,
      api_name      TEXT NOT NULL,
      status        TEXT NOT NULL,
      record_count  INTEGER DEFAULT 0,
      started_at    TEXT,
      finished_at   TEXT,
      error_message TEXT
    );

    CREATE TABLE IF NOT EXISTS fund_meta (
      ts_code               TEXT PRIMARY KEY REFERENCES fund_basic(ts_code) ON DELETE CASCADE,
      code                  TEXT NOT NULL,
      source                TEXT NOT NULL CHECK(source IN ('tushare','crawler','both')),
      tracking_target       TEXT,
      trading_subscribe     TEXT,
      trading_redeem        TEXT,
      buy_fee               REAL,
      annual_fee            REAL,
      is_floating_annual_fee INTEGER,
      mgmt_fee              REAL,
      custody_fee           REAL,
      sales_service_fee     REAL,
      operation_fee_total   REAL,
      net_asset_text        TEXT,
      net_asset_amount_text TEXT,
      net_asset_as_of       TEXT,
      stage_returns_as_of   TEXT,
      crawler_updated_at    TEXT,
      found_date_normalized TEXT,
      name_crawler          TEXT,
      fund_type_crawler     TEXT,
      management_crawler    TEXT,
      benchmark_crawler     TEXT,
      found_date_crawler    TEXT,
      updated_at            TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_fund_meta_code ON fund_meta(code);
    CREATE INDEX IF NOT EXISTS idx_fund_meta_source ON fund_meta(source);

    CREATE TABLE IF NOT EXISTS fund_fee_segments (
      ts_code   TEXT NOT NULL REFERENCES fund_basic(ts_code) ON DELETE CASCADE,
      kind      TEXT NOT NULL CHECK(kind IN
                  ('subscribe_front','purchase_front','purchase_back','redeem','sell')),
      seq       INTEGER NOT NULL,
      to_days   INTEGER,
      rate      REAL,
      PRIMARY KEY (ts_code, kind, seq)
    );

    CREATE TABLE IF NOT EXISTS fund_stage_returns (
      ts_code     TEXT NOT NULL REFERENCES fund_basic(ts_code) ON DELETE CASCADE,
      period      TEXT NOT NULL,
      return_pct  REAL,
      return_text TEXT,
      PRIMARY KEY (ts_code, period)
    );

    CREATE TABLE IF NOT EXISTS trade_calendar (
      cal_date      TEXT PRIMARY KEY,
      is_open       INTEGER NOT NULL,
      pretrade_date TEXT,
      updated_at    TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_trade_calendar_open ON trade_calendar(is_open);
  `);
}

export function closeDb() {
  if (_db) {
    _db.close();
    _db = null;
  }
}

/**
 * Convert a 6-digit fund code to Tushare ts_code.
 *
 * 业务约定: 本项目只服务**场外公募基金**, 故同 code 多行时**.OF 优先**.
 * 场内 ts_code (.SH/.SZ/.BJ) 行仅用于历史/审计, 默认不取.
 *
 * Looks up fund_basic; if multiple rows for same code, prefers .OF.
 */
export function codeToTsCode(code) {
  const db = getDb();
  const rows = db.prepare(`
    SELECT ts_code FROM fund_basic WHERE code = ?
    ORDER BY CASE
      WHEN ts_code LIKE '%.OF' THEN 0
      WHEN ts_code LIKE '%.SH' OR ts_code LIKE '%.SZ' OR ts_code LIKE '%.BJ' THEN 1
      ELSE 2
    END
  `).all(code);
  if (rows.length > 0) return rows[0].ts_code;
  return `${code}.OF`;
}

/**
 * Resolve multiple 6-digit codes to ts_codes.
 * Returns Map<code, ts_code>. .OF 优先 (本项目只做场外基金).
 */
export function codesToTsCodes(codes) {
  const db = getDb();
  const result = new Map();
  const stmt = db.prepare(`
    SELECT ts_code FROM fund_basic WHERE code = ?
    ORDER BY CASE
      WHEN ts_code LIKE '%.OF' THEN 0
      WHEN ts_code LIKE '%.SH' OR ts_code LIKE '%.SZ' OR ts_code LIKE '%.BJ' THEN 1
      ELSE 2
    END
    LIMIT 1
  `);
  for (const code of codes) {
    const row = stmt.get(code);
    result.set(code, row ? row.ts_code : `${code}.OF`);
  }
  return result;
}

/**
 * Get the latest end_date in fund_nav for a given ts_code.
 * Returns null if no records exist.
 */
export function getLatestNavDate(tsCode) {
  const db = getDb();
  const row = db.prepare(
    'SELECT end_date FROM fund_nav WHERE ts_code = ? ORDER BY end_date DESC LIMIT 1'
  ).get(tsCode);
  return row ? row.end_date : null;
}

/**
 * Bulk upsert fund_nav records inside a transaction.
 *
 * @param {Array<object>} rows  Each row may include `source`. Default: 1 (tushare).
 */
export function upsertNavRecords(rows, defaultSource = 1) {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO fund_nav
      (ts_code, end_date, ann_date, unit_nav, accum_nav, accum_div, net_asset, total_netasset, adj_nav, source)
    VALUES
      (@ts_code, @end_date, @ann_date, @unit_nav, @accum_nav, @accum_div, @net_asset, @total_netasset, @adj_nav, @source)
  `);
  const tx = db.transaction((records) => {
    for (const r of records) {
      stmt.run({ ...r, source: r.source ?? defaultSource });
    }
  });
  tx(rows);
}

/**
 * Bulk upsert fund_basic records inside a transaction.
 *
 * @deprecated 用 upsertFundBasicFromTushare (新合并语义) 替代。
 * 只在灾难恢复 / 全字段强写场景保留。
 */
export function upsertFundBasicRecords(rows) {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO fund_basic
      (ts_code, code, name, management, custodian, fund_type, found_date, status, market, benchmark, updated_at)
    VALUES
      (@ts_code, @code, @name, @management, @custodian, @fund_type, @found_date, @status, @market, @benchmark, datetime('now'))
  `);
  const tx = db.transaction((records) => {
    for (const r of records) stmt.run(r);
  });
  tx(rows);
}

/**
 * 写 Tushare fund_basic 数据 (新合并语义):
 *   - 新基金: INSERT 全字段 (含 name/fund_type/... 作为初值, 让 build 立即可用)
 *   - 已有基金: 仅 UPDATE status/market/custodian/updated_at; 重叠字段 (name/fund_type/management/benchmark/found_date) 由 apply-merge-rules 裁决
 *   - 同时把 tushare 原值写入 fund_meta 影子列 (含 source 占位为 tushare 或 both)
 *
 * 返回 { inserted, updatedBasic, updatedShadow }
 */
export function upsertFundBasicFromTushare(rows) {
  const db = getDb();

  const selBasic = db.prepare('SELECT ts_code FROM fund_basic WHERE ts_code = ?');
  const insBasic = db.prepare(`
    INSERT INTO fund_basic
      (ts_code, code, name, management, custodian, fund_type, found_date, status, market, benchmark, updated_at)
    VALUES
      (@ts_code, @code, @name, @management, @custodian, @fund_type, @found_date, @status, @market, @benchmark, datetime('now'))
  `);
  const updBasic = db.prepare(`
    UPDATE fund_basic SET
      status     = COALESCE(@status,    status),
      market     = COALESCE(@market,    market),
      custodian  = COALESCE(@custodian, custodian),
      updated_at = datetime('now')
    WHERE ts_code = @ts_code
  `);
  const upsertShadow = db.prepare(`
    INSERT INTO fund_meta (
      ts_code, code, source,
      name_tushare, fund_type_tushare, management_tushare, benchmark_tushare,
      found_date_tushare, custodian_tushare, status_tushare, market_tushare,
      updated_at
    ) VALUES (
      @ts_code, @code, 'tushare',
      @name, @fund_type, @management, @benchmark,
      @found_date_iso, @custodian, @status, @market,
      datetime('now')
    )
    ON CONFLICT(ts_code) DO UPDATE SET
      name_tushare       = excluded.name_tushare,
      fund_type_tushare  = excluded.fund_type_tushare,
      management_tushare = excluded.management_tushare,
      benchmark_tushare  = excluded.benchmark_tushare,
      found_date_tushare = excluded.found_date_tushare,
      custodian_tushare  = excluded.custodian_tushare,
      status_tushare     = excluded.status_tushare,
      market_tushare     = excluded.market_tushare,
      source             = CASE
                             WHEN fund_meta.source='crawler' THEN 'both'
                             WHEN fund_meta.source IS NULL   THEN 'tushare'
                             ELSE fund_meta.source
                           END,
      updated_at         = datetime('now')
  `);

  const stats = { inserted: 0, updatedBasic: 0, updatedShadow: 0 };

  const tx = db.transaction((records) => {
    for (const r of records) {
      const exists = selBasic.get(r.ts_code);
      if (exists) {
        updBasic.run(r);
        stats.updatedBasic++;
      } else {
        insBasic.run(r);
        stats.inserted++;
      }
      const isoFound = r.found_date && /^\d{8}$/.test(r.found_date)
        ? `${r.found_date.slice(0,4)}-${r.found_date.slice(4,6)}-${r.found_date.slice(6,8)}`
        : (r.found_date || null);
      upsertShadow.run({ ...r, found_date_iso: isoFound });
      stats.updatedShadow++;
    }
  });
  tx(rows);
  return stats;
}

const SEG_KIND_MAP = {
  subscribeFrontSegments: 'subscribe_front',
  purchaseFrontSegments:  'purchase_front',
  purchaseBackSegments:   'purchase_back',
  redeemSegments:         'redeem',
  sellFeeSegments:        'sell',
};

function _normalizeIso(s) {
  if (s == null) return null;
  const t = String(s).trim();
  if (!t) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  if (/^\d{8}$/.test(t)) return `${t.slice(0,4)}-${t.slice(4,6)}-${t.slice(6,8)}`;
  return null;
}
function _normalizeCompact(s) {
  if (s == null) return null;
  const t = String(s).trim();
  if (!t) return null;
  if (/^\d{8}$/.test(t)) return t;
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t.replace(/-/g, '');
  return null;
}
function _isEmpty(v) {
  return v == null || (typeof v === 'string' && v.trim() === '');
}

/**
 * 把单条 crawler JSON 对象写入 SQLite.
 * 保留 saveFund 的「不让旧值被空值覆盖」保护语义.
 *
 * @param {object} crawler  fetchFundFee() 返回的对象
 * @returns {{ tsCode: string, action: 'insert'|'update', source: string }}
 */
export function upsertCrawlerData(crawler) {
  if (!crawler || !crawler.code) throw new Error('crawler.code 缺失');
  const db = getDb();
  const code = crawler.code;

  // 解析 ts_code: 优先现有, 否则 .OF
  const existing = db.prepare('SELECT ts_code FROM fund_basic WHERE code = ?').get(code);
  const tsCode = existing ? existing.ts_code : `${code}.OF`;

  // 当前 fund_meta 行 (用于保护字段)
  const oldMeta = db.prepare('SELECT * FROM fund_meta WHERE ts_code = ?').get(tsCode);

  const op = crawler.operationFees || {};
  const ns = crawler.netAssetScale || {};
  const ts = crawler.tradingStatus || {};

  // 字段保护: 新值为空, 旧值非空 → 保留旧值
  const guard = (newVal, oldVal) => (_isEmpty(newVal) ? oldVal : newVal);

  const newName       = crawler.name || null;
  const newFundType   = crawler.fundType || null;
  const newMgmt       = crawler.fundManager || null;
  const newBench      = crawler.performanceBenchmark || null;
  const newFoundIso   = _normalizeIso(crawler.establishmentDate);

  const tx = db.transaction(() => {
    // 1) crawler-only 时插 fund_basic stub
    if (!existing) {
      const insBasic = db.prepare(`
        INSERT INTO fund_basic
          (ts_code, code, name, management, fund_type, found_date, benchmark, status, market, updated_at)
        VALUES
          (@ts_code, @code, @name, @management, @fund_type, @found_date, @benchmark, NULL, NULL, datetime('now'))
      `);
      insBasic.run({
        ts_code: tsCode, code,
        name: newName, management: newMgmt, fund_type: newFundType,
        found_date: _normalizeCompact(crawler.establishmentDate),
        benchmark: newBench,
      });
    }

    // 2) upsert fund_meta (crawler 影子列保护性 merge)
    const upsertMeta = db.prepare(`
      INSERT INTO fund_meta (
        ts_code, code, source,
        tracking_target, trading_subscribe, trading_redeem,
        buy_fee, annual_fee, is_floating_annual_fee,
        mgmt_fee, custody_fee, sales_service_fee, operation_fee_total,
        net_asset_text, net_asset_amount_text, net_asset_as_of,
        stage_returns_as_of, crawler_updated_at, found_date_normalized,
        name_crawler, fund_type_crawler, management_crawler, benchmark_crawler, found_date_crawler,
        updated_at
      ) VALUES (
        @ts_code, @code, @source,
        @tracking_target, @trading_subscribe, @trading_redeem,
        @buy_fee, @annual_fee, @is_floating_annual_fee,
        @mgmt_fee, @custody_fee, @sales_service_fee, @operation_fee_total,
        @net_asset_text, @net_asset_amount_text, @net_asset_as_of,
        @stage_returns_as_of, @crawler_updated_at, @found_date_normalized,
        @name_crawler, @fund_type_crawler, @management_crawler, @benchmark_crawler, @found_date_crawler,
        datetime('now')
      )
      ON CONFLICT(ts_code) DO UPDATE SET
        source                = CASE
                                  WHEN fund_meta.source='tushare' THEN 'both'
                                  ELSE fund_meta.source
                                END,
        tracking_target       = COALESCE(NULLIF(excluded.tracking_target,''),       fund_meta.tracking_target),
        trading_subscribe     = COALESCE(NULLIF(excluded.trading_subscribe,''),     fund_meta.trading_subscribe),
        trading_redeem        = COALESCE(NULLIF(excluded.trading_redeem,''),        fund_meta.trading_redeem),
        buy_fee               = COALESCE(excluded.buy_fee,                          fund_meta.buy_fee),
        annual_fee            = COALESCE(excluded.annual_fee,                       fund_meta.annual_fee),
        is_floating_annual_fee= COALESCE(excluded.is_floating_annual_fee,           fund_meta.is_floating_annual_fee),
        mgmt_fee              = COALESCE(excluded.mgmt_fee,                         fund_meta.mgmt_fee),
        custody_fee           = COALESCE(excluded.custody_fee,                      fund_meta.custody_fee),
        sales_service_fee     = COALESCE(excluded.sales_service_fee,                fund_meta.sales_service_fee),
        operation_fee_total   = COALESCE(excluded.operation_fee_total,              fund_meta.operation_fee_total),
        net_asset_text        = COALESCE(NULLIF(excluded.net_asset_text,''),        fund_meta.net_asset_text),
        net_asset_amount_text = COALESCE(NULLIF(excluded.net_asset_amount_text,''), fund_meta.net_asset_amount_text),
        net_asset_as_of       = COALESCE(NULLIF(excluded.net_asset_as_of,''),       fund_meta.net_asset_as_of),
        stage_returns_as_of   = COALESCE(NULLIF(excluded.stage_returns_as_of,''),   fund_meta.stage_returns_as_of),
        crawler_updated_at    = excluded.crawler_updated_at,
        found_date_normalized = COALESCE(NULLIF(excluded.found_date_normalized,''), fund_meta.found_date_normalized),
        name_crawler          = COALESCE(NULLIF(excluded.name_crawler,''),          fund_meta.name_crawler),
        fund_type_crawler     = COALESCE(NULLIF(excluded.fund_type_crawler,''),     fund_meta.fund_type_crawler),
        management_crawler    = COALESCE(NULLIF(excluded.management_crawler,''),    fund_meta.management_crawler),
        benchmark_crawler     = COALESCE(NULLIF(excluded.benchmark_crawler,''),     fund_meta.benchmark_crawler),
        found_date_crawler    = COALESCE(NULLIF(excluded.found_date_crawler,''),    fund_meta.found_date_crawler),
        updated_at            = datetime('now')
    `);

    // 浮动费率: 仅在新 total 非 0 时刷; 否则保留旧
    const newTotal = (op.total != null && op.total !== 0) ? op.total : null;
    const newAnnual = (typeof crawler.annualFee === 'number' && crawler.annualFee !== 0) ? crawler.annualFee : newTotal;

    upsertMeta.run({
      ts_code: tsCode,
      code,
      source: existing ? 'both' : 'crawler',
      tracking_target: crawler.trackingTarget || null,
      trading_subscribe: ts.subscribe || null,
      trading_redeem: ts.redeem || null,
      buy_fee: crawler.buyFee ?? null,
      annual_fee: newAnnual,
      is_floating_annual_fee: crawler.isFloatingAnnualFee ? 1 : 0,
      mgmt_fee: op.managementFee ?? null,
      custody_fee: op.custodyFee ?? null,
      sales_service_fee: op.salesServiceFee ?? null,
      operation_fee_total: newTotal,
      net_asset_text: ns.text || null,
      net_asset_amount_text: ns.amountText || null,
      net_asset_as_of: ns.asOfDate || null,
      stage_returns_as_of: crawler.stageReturnsAsOf || null,
      crawler_updated_at: crawler.updatedAt || new Date().toISOString(),
      found_date_normalized: newFoundIso,
      name_crawler: newName,
      fund_type_crawler: newFundType,
      management_crawler: newMgmt,
      benchmark_crawler: newBench,
      found_date_crawler: newFoundIso,
    });

    // 3) fee_segments: 仅当本次有数据时替换; 否则保留旧
    let hasAnySeg = false;
    for (const k of Object.keys(SEG_KIND_MAP)) {
      if (Array.isArray(crawler[k]) && crawler[k].length > 0) { hasAnySeg = true; break; }
    }
    if (hasAnySeg) {
      const delSegs = db.prepare('DELETE FROM fund_fee_segments WHERE ts_code = ?');
      const insSeg = db.prepare(`
        INSERT INTO fund_fee_segments (ts_code, kind, seq, to_days, rate)
        VALUES (?, ?, ?, ?, ?)
      `);
      delSegs.run(tsCode);
      for (const [crKey, kind] of Object.entries(SEG_KIND_MAP)) {
        const arr = crawler[crKey];
        if (!Array.isArray(arr)) continue;
        arr.forEach((s, i) => {
          const to = s.to !== undefined ? s.to : null;
          insSeg.run(tsCode, kind, i, to == null ? null : to, s.rate ?? null);
        });
      }
    }

    // 4) stage_returns: 同样仅在有数据时替换
    if (Array.isArray(crawler.stageReturns) && crawler.stageReturns.length > 0) {
      const delStages = db.prepare('DELETE FROM fund_stage_returns WHERE ts_code = ?');
      const insStage = db.prepare(`
        INSERT INTO fund_stage_returns (ts_code, period, return_pct, return_text)
        VALUES (?, ?, ?, ?)
      `);
      delStages.run(tsCode);
      for (const sr of crawler.stageReturns) {
        if (!sr || !sr.period) continue;
        insStage.run(tsCode, sr.period, sr.returnPct ?? null, sr.returnText ?? null);
      }
    }
  });

  tx();
  return {
    tsCode,
    action: existing ? 'update' : 'insert',
    source: existing ? 'both' : 'crawler',
  };
}

/**
 * Insert a sync_log entry.
 */
export function logSync({ ts_code, api_name, status, record_count = 0, started_at, finished_at, error_message = null }) {
  const db = getDb();
  db.prepare(`
    INSERT INTO sync_log (ts_code, api_name, status, record_count, started_at, finished_at, error_message)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(ts_code, api_name, status, record_count, started_at, finished_at, error_message);
}

export { DB_PATH };
