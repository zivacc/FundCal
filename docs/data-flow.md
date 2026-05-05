# 数据流程与同步机制

本文档描述 FundCal 的数据来源、合并规则、定时更新方案与脚本职责划分。
所有数据最终落地于 SQLite (`data/fundcal.db`)，由前端和构建脚本消费。

---

## 1. 数据来源

| 来源 | 抓取方式 | 写入主表 | 频率建议 |
|---|---|---|---|
| **Tushare Pro API** | HTTP POST (`tushare-client.js`) | `fund_basic`, `fund_nav` | 每日 (nav 增量) / 每周 (basic) |
| **天天基金 / 东方财富网页** | HTML 抓取 (`crawl-fund-fee.js`) | `fund_meta`, `fund_fee_segments`, `fund_stage_returns` | 每周 |
| **搜狐基金 (浮动费率覆盖)** | HTML (`fetchSohuOperationFees`) | `fund_meta.mgmt_fee` 等 | 跟随 crawler |
| **海外 1234567 (中港互认 968)** | HTML | `fund_meta` | 跟随 crawler |

> **不再使用**：`data/funds/<code>.json` 中转文件。爬虫现已直写 DB，旧 JSON 文件保留作灾备 / 审计。

---

## 2. 数据库 schema 概览

```
fund_basic       (ts_code PK)        权威基础信息 (合并后)
  ├─ name, fund_type, management, benchmark, found_date  ← 由 apply-merge-rules 写入
  └─ status, market, custodian                           ← 由 sync-fund-basic 写入

fund_meta        (ts_code PK, 外键 fund_basic)
  ├─ source ∈ {tushare, crawler, both}                   ← 标识双源覆盖情况
  ├─ tracking_target, *_fee, net_asset_*, …             ← crawler 独占字段
  ├─ name_crawler, fund_type_crawler, …                  ← crawler 影子列 (审计 / 兜底)
  ├─ name_tushare, fund_type_tushare, …                  ← tushare 影子列 (审计 / 兜底)
  ├─ share_class                                         ← 份额类别 A/B/C/D/E/H/I/R/Y/A/B 等 (从 name 解析)
  └─ found_date_normalized                               ← ISO 标准化日期 (YYYY-MM-DD)

fund_nav         (ts_code, end_date) PK    每日净值
  ├─ unit_nav, accum_nav, accum_div, adj_nav, ann_date, net_asset
  └─ source ∈ {1: tushare, 2: eastmoney}     ← 标识 nav 行来源, 便于审计 / 优先级

fund_fee_segments (ts_code, kind, seq) PK  分段费率 (crawler)
  kind ∈ {subscribe_front, purchase_front, purchase_back, redeem, sell}

fund_stage_returns (ts_code, period) PK    阶段涨幅 (crawler)
  period ∈ {今年来, 近1周, 近1月, 近3月, 近6月, 近1年, 近2年, 近3年, 近5年, 成立来}

sync_log         同步日志 (审计 + 失败重放游标)
```

---

## 3. 字段裁决矩阵

`apply-merge-rules.js` 在每次数据刷新后跑一次，按下表把影子列裁决为 `fund_basic` 权威值。

| 字段 | 主源 | 兜底 | 归一化 | 备注 |
|---|---|---|---|---|
| `name` | crawler | tushare | trim | 全名 (带 "混合/债券/货币") 比简称友好 |
| `fund_type` | crawler | tushare | — | crawler 提供细分类 ("混合型-偏股") |
| `management` | crawler | tushare | trim | 全名优于简称 |
| `benchmark` | crawler | tushare | `×`→`*`, 折叠空格, 全角括号→半角 | 多数差异是格式 |
| `found_date` | crawler | tushare | YYYYMMDD (basic) / YYYY-MM-DD (meta) | tushare 经常给的是后期变更日 |
| `status` | tushare | — | — | crawler 不抓; 唯一源 |
| `market` | tushare | — | — | 唯一源 |
| `custodian` | tushare | — | — | 唯一源 |
| 费率 / 分段 / 业绩 / 跟踪标的 / 规模 | crawler | — | — | 唯一源 |
| `nav` | tushare | — | — | 唯一源 |

> **关键约束**：`sync-fund-basic.js` 不再覆写 `name / fund_type / management / benchmark / found_date`；
> 新基金 INSERT 时全字段写入作初值，已有基金仅 UPDATE `status / market / custodian` (`COALESCE` 保护)。
> 这确保 crawler-first 裁决不会被后续 tushare 同步无意覆盖。

---

## 4. 完整数据流

```
┌──────────────┐                ┌──────────────────┐
│ Tushare API  │                │ 第三方网页 (爬虫)  │
└──────┬───────┘                └─────┬────────────┘
       │                              │
       v                              v
[A] sync-fund-basic.js          [B] crawl-fund-fee.js
       │                              │   (直写 DB, 不再走 JSON 中转)
       │ 写 fund_basic                │
       │ (新基金全字段, 旧基金仅       │
       │  status/market/custodian)    │ 写 fund_meta + 影子列
       │ 写 fund_meta._tushare 影子   │ 替换 fund_fee_segments
       │                              │ 替换 fund_stage_returns
       v                              v
┌─────────────────────────────────────────┐
│       fund_basic / fund_meta            │
│   双源数据 + 影子列均已就位             │
└────────────┬────────────────────────────┘
             │
             v
[C] apply-merge-rules.js
  按矩阵裁决, 写 fund_basic 权威字段
             │
             v
[D] sync-fund-nav.js (增量)
  按 fund_basic.status IN ('L','I') 拉净值
  限流自动指数退避 (HTTP 429 / -2001)
             │
             v
       fund_nav (30M+ 行)
             │
             v
[E] build-allfund-from-db.js
  生成 data/allfund/{allfund.json, funds/<code>.json,
       search-index.json, list-index.json}
             │
             v
[F] 静态资源 → 前端 / Cloudflare Pages
```

---

## 5. 脚本清单

### 数据同步层

| 脚本 | 作用 | 关键参数 |
|---|---|---|
| [scripts/nav/sync-fund-basic.js](../scripts/nav/sync-fund-basic.js) | 拉 Tushare 基金清单 (O+E 市场) | `--market O`, `--market E` |
| [scripts/nav/sync-fund-nav.js](../scripts/nav/sync-fund-nav.js) | 拉 Tushare 场外净值 (`fund_nav` API, 增量) | `--codes`, `--type`, `--all`, `--all --include-dead`, `--full`, `--concurrency` |
| [scripts/nav/sync-fund-daily.js](../scripts/nav/sync-fund-daily.js) | 拉 Tushare 场内日线 (`fund_daily` API, 用于 ETF/LOF; close→unit_nav) | `--codes`, `--all`, `--all --include-dead`, `--full`, `--concurrency` |
| [scripts/nav/sync-trade-calendar.js](../scripts/nav/sync-trade-calendar.js) | 拉 Tushare 交易日历 (`trade_cal` API, SSE) → `trade_calendar` 表 | `--full`, `--start`, `--end` |
| [scripts/nav/crawl-eastmoney-nav.js](../scripts/nav/crawl-eastmoney-nav.js) | 天天基金 lsjz 接口补 nav (LOF / Reits / 子类 — tushare 给 0 行的场外基金) | `--codes`, `--missing`, `--full`, `--concurrency`, `--limit` |
| [scripts/crawl-fund-fee.js](../scripts/crawl-fund-fee.js) | 爬单只基金费率 (直写 DB) | `<code> [--keep-json]` |
| [scripts/crawl-all-fund-fee.js](../scripts/crawl-all-fund-fee.js) | 爬全量基金费率 | `--force`, `--concurrency=N`, `--limit=N`, `--keep-json` |

### 合并 / 审计层

| 脚本 | 作用 |
|---|---|
| [scripts/nav/apply-merge-rules.js](../scripts/nav/apply-merge-rules.js) | 按裁决矩阵把影子列写回 `fund_basic` |
| [scripts/nav/health-check.js](../scripts/nav/health-check.js) | 10 项体检 (空 status / 错误率 / nav 新鲜度...) |
| [scripts/nav/replay-failed-syncs.js](../scripts/nav/replay-failed-syncs.js) | 从 `sync_log` 取最近失败任务重跑 |
| [scripts/nav/fix-empty-status.js](../scripts/nav/fix-empty-status.js) | 用 crawler 在线信号推断空 status → 'L' |
| [scripts/nav/parse-share-class.js](../scripts/nav/parse-share-class.js) | 从 name 解析份额类别写入 `fund_meta.share_class` |
| [scripts/nav/cleanup-redundant-of.js](../scripts/nav/cleanup-redundant-of.js) | 清理同 code 的 .OF 冗余 nav 行 (场内已有充足数据时) |

### 出资源层

| 脚本 | 作用 |
|---|---|
| [scripts/build-allfund-from-db.js](../scripts/build-allfund-from-db.js) | DB → `data/allfund/*` 静态分片 + 索引 |
| [scripts/build-trade-calendar.js](../scripts/build-trade-calendar.js) | `trade_calendar` 表 → `data/allfund/trade-calendar.json` (前端用) |
| [scripts/build-search-index.js](../scripts/build-search-index.js) | 单独构建搜索索引 |
| [scripts/build-feeder-index.js](../scripts/build-feeder-index.js) | 构建联接基金索引 |
| [scripts/build-fund-stats.js](../scripts/build-fund-stats.js) | 构建统计数据 |

### 历史 / 灾备

| 脚本 | 状态 |
|---|---|
| [scripts/migrate-crawler-to-db.js](../scripts/migrate-crawler-to-db.js) | **已弃用** (爬虫已直写 DB)。仅作从 `data/funds/*.json` 备份重建 DB 的灾备脚本保留 |
| [scripts/build-allfund.js](../scripts/build-allfund.js) | **已弃用**。被 `build-allfund-from-db.js` 替代 |
| [scripts/migrate-segments.js](../scripts/migrate-segments.js) | 一次性 schema 迁移已完成 |

---

## 6. 推荐运行顺序

### 例行更新 (每周 + 每日组合)

```bash
# === 每周 (周一 02:00 建议) ===
node scripts/nav/sync-fund-basic.js              # ① Tushare 清单
node scripts/crawl-all-fund-fee.js --force       # ② Crawler 元数据 / 费率 / 业绩
node scripts/nav/apply-merge-rules.js            # ③ 裁决合并
node scripts/nav/health-check.js                 # ④ 体检

# === 每日 (建议 18:00 后) ===
node scripts/nav/sync-fund-nav.js --all          # ⑤ 场外净值增量 (fund_nav API)
node scripts/nav/sync-fund-daily.js --all        # ⑥ 场内 ETF/LOF 日线增量 (fund_daily API)
node scripts/nav/replay-failed-syncs.js          # ⑦ 重放近期失败
node scripts/build-allfund-from-db.js            # ⑧ 生成静态资源
node scripts/nav/health-check.js --out data/health-latest.md  # ⑨ 体检报告留档
```

> 当前**手工执行**。定时编排 (cron / 任务计划 / GitHub Actions) 待后续单独议。

### 灾难恢复

```bash
# 从历史 data/funds/*.json 备份重建 fund_meta
node scripts/migrate-crawler-to-db.js

# 然后跑裁决 + 重新 build
node scripts/nav/apply-merge-rules.js
node scripts/build-allfund-from-db.js
```

---

## 7. 限流与重试

`scripts/nav/tushare-client.js` 内置:

- **全局节流**: 默认请求间隔 200ms (env `TUSHARE_GAP_MS`); 触发限流时翻倍, 上限 5s; 成功时 10% 衰减回收
- **重试**: 5 次 (env `TUSHARE_MAX_RETRIES`)
- **限流退避**: HTTP 429 / -2001 / "每分钟" / "请求速度过快" / "频率" 关键词 → 指数退避 5s → 10s → 20s → 40s → 80s
- **网络错误**: 普通退避 2s × 重试次数

### 调环境变量

```ini
TUSHARE_GAP_MS=200            # 基础间隔
TUSHARE_MAX_GAP_MS=5000       # 限流上调上限
TUSHARE_MAX_RETRIES=5
TUSHARE_RATE_LIMIT_BASE_MS=5000  # 限流首次退避
TUSHARE_RETRY_BASE_MS=2000       # 普通错误退避基数
```

---

## 8. 健康检查 10 项

`health-check.js` 输出 markdown / JSON 报告并按等级返回退码:

| 项 | 等级阈值 |
|---|---|
| C1 fund_basic 全景 | ✅ 总是 |
| C2 空 status (source=both) | >0 → FAIL |
| C3 空 fund_type | >100 → WARN |
| C4 status=L 但无 nav | >50 → FAIL, >0 → WARN |
| C5 nav 数据新鲜度 (最新 < 今天-5 工作日) | FAIL |
| C6 crawler 数据新鲜度 (最新 < 今天-30 天) | WARN |
| C7 source=both 子表完整性 | >100 缺失 → WARN |
| C8 近 24h sync_log 错误率 | >20% FAIL, >5% WARN |
| C9 字段合并冲突 (apply-merge-rules 待跑) | >1000 → WARN |
| C10 nav 覆盖率 (status=L 总占比) | <95% → WARN |

退码 `0=OK, 1=WARN, 2=FAIL`，便于 cron 告警。

---

## 9. 场外 nav 双源 (tushare 主, eastmoney 兜底)

**业务约定**: 本项目只服务**场外公募基金** (.OF 后缀)。`codeToTsCode` 同 code 多行时 .OF 优先。

### 数据源对比

| 维度 | Tushare `fund_nav` | Eastmoney `lsjz` |
|---|---|---|
| 响应速度 | 200-500ms | ~16ms |
| 限流 | 严格 (429 频繁) | 几乎无 |
| 认证 | 需 token | 无 |
| 复权 (adj_nav) | ✅ | ❌ (用 LJJZ 累计净值近似) |
| LOF 场外 | ❌ 整段 0 行 | ✅ 完整 |
| Reits / 子类 | ⚠️ 部分 | ✅ 较完整 |
| 协议保证 | 官方 SLA | 网页接口, 可能改 |
| 单页 | 全量 / 分段 (10000 上限) | 固定 20 行/页 |

### 策略

- **主源 = tushare** (`sync-fund-nav.js`): 普通 OF 公募, 含复权
- **兜底 = eastmoney** (`crawl-eastmoney-nav.js --missing`): tushare 给 0 行的基金 (LOF / Reits / 部分子类)
- **fund_nav.source 列**: 1=tushare, 2=eastmoney; 数据完全一致 (经实测对比)

### 场内基金 (.SH/.SZ) 不入库

ETF / LOF 等场内基金, tushare 在 .OF 端不给 nav (给在 .SH/.SZ 经 `fund_daily` 接口),
但 .SH/.SZ 是**场内市价**与场外申赎净值不同 (LOF 套利窗口下偏离 5-30%), 业务不可用。

→ 我们**只用场外 .OF** 数据. eastmoney 提供的 LOF 净值是真实场外申赎净值, 对得上业务需求。

## 10. 已知历史欠账 (待修)

| 问题 | 数量 (体检 2026-04-30 基线) | 修复路径 |
|---|---|---|
| 空 status (source=both) | 2,498 | 重跑 `sync-fund-basic`; 若 tushare 仍返回空, 用 nav 覆盖率 / crawler 存在性做启发 |
| status=L 无 nav | 522 | `replay-failed-syncs.js` (限流修复后大部分自动恢复) |
| L 状态 tushare-only | 14 | 永久差异 (H/E/B/R 等冷门份额类), 接受 |
| sync_log 错误率 32.7% | 22k+ HTTP 429 | tushare-client 限流退避已修, 跑 replay 即可清账 |

---

## 11. 部署与生产环境

参见 [DEPLOY.md](DEPLOY.md)。Cloudflare D1+R2 迁移规划见 [cloudflare-migration.md](cloudflare-migration.md)。
