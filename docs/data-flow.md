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
  生成 data/allfund/{funds/<code>.json, search-index.json,
       index-search-index.json}
  (旧 allfund.json / list-index.json 已下线 → archive/)
             │
             v
[F] /api/fund/* (主路径) + 小静态产物 (灾备)
    生产前端走 API + nginx 微缓存 + Cloudflare 边缘缓存
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
| [scripts/nav/sync-index-basic.js](../scripts/nav/sync-index-basic.js) | 拉 Tushare `index_basic` (SSE/SZSE/CSI/SW/MSCI/CICC/OTH) → `index_basic` + `index_source_map` | `--market`, `--markets` |
| [scripts/nav/sync-index-daily.js](../scripts/nav/sync-index-daily.js) | 拉 Tushare `index_daily` 日线 → `index_daily` (source=1) | `--codes`, `--tracked`, `--all`, `--full`, `-c` |
| [scripts/nav/crawl-em-index.js](../scripts/nav/crawl-em-index.js) | 东财 push2his 兜底拉指数日线 → `index_daily` (source=2) | `--codes` (secid), `--tracked`, `--all-em`, `--full` |
| [scripts/nav/import-custom-index.js](../scripts/nav/import-custom-index.js) | 自定义源 (CSV/JSON) 导入指数日线 → `index_daily` (source=6) | `--ts-code`, `--file`, `--format` |
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
| [scripts/build-allfund-from-db.js](../scripts/build-allfund-from-db.js) | DB → `data/allfund/*` 静态分片 + 索引（含 search-index、feeder-index、fund-stats） |
| [scripts/build-trade-calendar.js](../scripts/build-trade-calendar.js) | `trade_calendar` 表 → `data/allfund/trade-calendar.json` (前端用) |
| [scripts/build-feeder-index.js](../scripts/build-feeder-index.js) | 构建联接基金索引 |
| [scripts/build-fund-stats.js](../scripts/build-fund-stats.js) | 构建统计数据 |

### 历史 / 灾备

| 脚本 | 状态 |
|---|---|
| [scripts/migrate-crawler-to-db.js](../scripts/migrate-crawler-to-db.js) | **已弃用** (爬虫已直写 DB)。仅作从 `data/funds/*.json` 备份重建 DB 的灾备脚本保留 |
| [archive/scripts/build-allfund.js](../archive/scripts/build-allfund.js) | **已归档**。被 `build-allfund-from-db.js` 替代 |
| [archive/scripts/build-search-index.js](../archive/scripts/build-search-index.js) | **已归档**。依赖下线的 `data/funds/*.json`；search-index 改由 `build-allfund-from-db.js` 产出 |
| [archive/scripts/check-allfund.js](../archive/scripts/check-allfund.js) | **已归档**。依赖下线的 `allfund.json` |
| [archive/scripts/upload-kv.js](../archive/scripts/upload-kv.js) | **已归档**。Cloudflare Workers + KV 全量模式已弃（见 `docs/cloudflare-migration.md`） |
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

## 11. 指数 (index_*) 表与多源策略

跟基金 nav 同样的"主源 + 兜底"思路, 但跨更多源 (Tushare 不覆盖中债 / 海外约 27%)。

### Schema 速览

```
index_basic       (ts_code PK)         指数基础信息
  ├─ name / fullname / publisher / category / market / index_type
  ├─ base_date / base_point / list_date / weight_rule / description
  └─ primary_source                    当前主拉源 (tushare/eastmoney/csindex/custom)

index_source_map  (ts_code, source) PK 多源代码映射
  ├─ source_code                       该源用的代码 (e.g. 000300.SH / 100.NDX / 932000)
  ├─ is_active
  └─ notes

index_daily       (ts_code, end_date) PK 日线 (open/high/low/close/pct_chg/vol/amount)
  └─ source ∈ {1: tushare, 2: eastmoney, 3: csindex, 6: custom}

index_fund_tracker (index_ts_code, fund_ts_code) PK  基金跟踪关系 (派生)
```

### 数据源分级 (按推荐优先级)

| 优先级 | 源 | 覆盖 | 接口 / 脚本 |
|---|---|---|---|
| **P1** | Tushare `index_daily` | A 股主流 ~73% | `sync-index-basic` + `sync-index-daily` |
| **P2** | 东财 push2his (secid) | 海外 / 中债综合 / 港股 / 黄金 | `crawl-em-index` |
| **P3** | csindex.com.cn 官方 | CSI/CBI 权威 (备选) | (待实现) |
| **P6** | 自定义 (CSV/JSON 导入) | 内部编制 / 私有数据 | `import-custom-index` |

### 多源策略 (新指数怎么入库)

```
1. (一次性) 用 sync-index-basic 拉 Tushare 全 markets, 自动注册 source='tushare' 映射
2. (单只) 对 Tushare 不覆盖的指数, 手动 INSERT 到 index_basic + index_source_map:
     - 海外 / 港股 / 中债 → 注册 source='eastmoney' + secid (如 100.NDX)
     - 内部编制 → primary_source='custom', 用 import-custom-index 导入
3. 日常: sync-index-daily --tracked + crawl-em-index --tracked, 拉被基金跟踪的指数
4. 日线写入时 source 列标识来源, query 端可优先 source=1 → 2 → 6 fallback
```

### 输出端: `/api/nav/compare` 混编 fund + index

指数链路接到比较页 (`#/nav`) 的整条数据流:

```
            sync-index-basic ───→ index_basic
                                       │
            sync-index-daily ───→ index_daily (source=1, Tushare)
            crawl-em-index   ───→ index_daily (source=2, 东财)
            import-custom-index ─→ index_daily (source=6, 自定义)
                                       │
         link-fund-to-index ───→ index_fund_tracker (基金 ↔ 指数关系)
                                       │
                                       v
                           /api/nav/compare?codes=000001,HSI.HI,...
                                       │
                          ┌────────────┴────────────┐
                          │ isFundCode(key) 判别     │
                          │  6 位纯数字 → fund      │
                          │  ts_code (含 .)  → index │
                          └────────────┬────────────┘
                                       │
                          ┌────────────┴────────────┐
                  fund 走 fund_nav            index 走 index_daily
                  (拼 .OF, adj_nav 优先)      (close 同时映射 navs/adjNavs)
                          └────────────┬────────────┘
                                       v
                  统一 series 结构 → computeStats → enrichSeriesIndicators
                                       │
                                       v
                           前端图表 + 区间统计 + 指标
```

**协议要点** (后端实现见 [`scripts/nav/nav-api.js`](../scripts/nav/nav-api.js) `handleNavCompare`):

- key 判别共用前后端的 [`js/core/code-kind.js`](../js/core/code-kind.js)。`isFundCode` = `^\d{6}$`, `isIndexKey` = ts_code 形式。未识别 key 由调用方处理 (默认报错)。
- `interval=daily|weekly|monthly` 降采样, 周 / 月取窗口最后一个有值点 (见 `nav-stats.js` `downsample`)。
- `indicators=ma20,ma60,drawdown` 由 [`js/domain/nav-stats.js`](../js/domain/nav-stats.js) `parseIndicators` 解析, 未知名静默丢弃; `enrichSeriesIndicators` 就地追加字段; INDICATORS 注册表是 `Object.freeze` 的, 防止误改。
- 统计字段统一基于 `adjNavs` (基金复权; 指数 = `close`) 做日收益率序列, 这样 fund / index 在同一张 stats 表里直接可比。
- 一次最多 20 只; 命中边缘 ETag 重访走 304。

完整端到端协议另见 [README.md `/api/nav/compare 协议`](../README.md#apinavcompare-协议)。

## 12. 列表服务端分页 API (2026-05 新增)

`/api/fund/list` 是列表页主入口。**路由层嗅探参数自动分流**:

| 调用形式 | 走向 | 用途 |
|---|---|---|
| `?page=&size=&sort=&q=&fundType=...` | 服务端分页 ([scripts/list-query.js](../scripts/list-query.js) SQL builder) | 列表页主用 |
| `?fields=summary\|full` | 旧全量路径 (返回 27k 行) | 灾备 / 兼容旧调用方 |

并行端点 `/api/fund/filter-options` 一次返回所有筛选维度 + 频次 (`fundType` / `fundManager` / `subscribe` / `redeem`)，前端 IDB SWR 缓存。

设计决策见 [decisions/0001-server-side-pagination-not-duckdb.md](decisions/0001-server-side-pagination-not-duckdb.md)。

---

## 13. 部署

参见 [DEPLOY.md](DEPLOY.md): PC dev + Cloudflare Tunnel。

历史方案 (Oracle Cloud / 阿里云 ECS / Workers+KV / D1+R2) 已归档至 [`../archive/docs/`](../archive/docs/)。
