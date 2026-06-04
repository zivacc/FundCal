# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

FundCal — 基金费率计算器: 多基金费用对比 + 交叉点分析 + 净值历史 + 业绩比较。

Stack: Node.js 18+ (ES modules), better-sqlite3, vanilla JS frontend (no build framework)。
**部署模式**: PC dev + Cloudflare Tunnel (历史的 Oracle Cloud / 阿里云 ECS / Workers+KV / D1+R2 已归档至 `archive/docs/`)。

主要文档:
- [README.md](README.md) — 功能 / 项目结构 / npm 命令速查
- [docs/data-flow.md](docs/data-flow.md) — **数据架构** (双源 / 字段裁决 / Schema)
- [docs/DEPLOY.md](docs/DEPLOY.md) — PC dev + CF Tunnel 部署
- [docs/decisions/](docs/decisions/) — ADR 决策日志 (重大技术决策)

## 常用命令

```bash
# 开发
npm run dev                     # 一键: 静态服务 (3456) + API (3457)
npm run api                     # 仅 API (3457)
npm run serve                   # 仅静态 (3456)

# 测试 (用 node --test, *.test.js 自动发现)
npm test                        # 跑所有测试 (scripts/**/*.test.js + js/**/*.test.js)
node --test scripts/list-query.test.js      # 单文件
node --test --test-name-pattern='align'     # 按测试名过滤

# 数据流水线 (见下面架构说明)
npm run sync:fund-basic         # Tushare 基金清单
npm run sync:fund-nav -- --all  # Tushare 净值增量 (全部 status=L/I)
npm run crawl:all -- --force    # 天天基金爬虫 (费率/规模/业绩, 直写 DB)
npm run merge-rules             # 应用字段裁决矩阵
npm run crawl:eastmoney-nav -- --missing  # 兜底补 LOF/Reits/子类
npm run sync:trade-cal          # 交易日历
npm run sync:index-basic        # Tushare 指数清单
npm run sync:index-daily        # Tushare 指数日线
npm run crawl:em-index          # 东财指数日线 (港股 / 美股 / 全收益)
npm run replay-failed           # 重放失败任务
npm run health-check            # 体检 (10 项)

# 构建静态资源 (DB → data/allfund/*)
npm run build-all               # allfund + search-index + feeder-index + fund-stats + trade-calendar
```

## 架构: 双源数据 + 字段裁决 + 静态构建

```
Tushare API ──→ sync-fund-basic ──→ fund_basic + fund_meta._tushare 影子
                sync-fund-nav   ──→ fund_nav (source=1)

天天基金 ────→ crawl-fund-fee ──→ fund_meta + fund_meta._crawler 影子
                                  fund_fee_segments / fund_stage_returns
                                  (直写 DB, 已弃 data/funds/*.json 中转)

天天基金 lsjz ─→ crawl-eastmoney-nav ──→ fund_nav (source=2, 兜底 LOF/子类)

Tushare 指数 ──→ sync-index-basic/daily, crawl-em-index ──→ index_basic + index_daily

       ↓
apply-merge-rules.js  (按裁决矩阵把影子列写进 fund_basic 权威字段)
       ↓
build-allfund-from-db.js → data/allfund/* 静态分片
       ↓
前端: 列表/搜索 → /api/fund/list (服务端分页); 其他页面 → 静态分片 + /api/* 单只查询
```

### 字段裁决矩阵 (核心规则)

| 字段 | 主源 | 兜底 |
|---|---|---|
| name / fund_type / management / benchmark / found_date | **crawler** | tushare |
| status / market / custodian | **tushare** | (唯一源) |
| 费率 / 分段 / 业绩 / 跟踪标的 / 规模 | **crawler** | (唯一源) |
| nav | **tushare → eastmoney 兜底** | source 列标识 |

**关键约束**:
- `sync-fund-basic.js` **不覆写** name/fund_type/management/benchmark/found_date — 只 UPSERT status/market/custodian。新基金 INSERT 全字段作初值, 已有基金的重叠字段交给 `apply-merge-rules` 裁决, 防止误覆盖。
- 业务**只服务场外基金 .OF**, `codeToTsCode` 同 code 多行时 `.OF` 优先, `.SH/.SZ/.BJ` 行保留作审计但不取 nav。
- `fund_nav.source`: 1=tushare, 2=eastmoney; 数据完全一致 (实测对比), eastmoney 仅补 tushare 给 0 行的 LOF / Reits / 子类。

### Schema 概览 ([data/fundcal.db](data/fundcal.db), SQLite)

```
fund_basic         (ts_code PK)        权威基础信息 (apply-merge-rules 裁决后)
fund_meta          (ts_code PK)        crawler 独占字段 + 双侧影子列 (_crawler / _tushare)
                                       + share_class (从 name 解析)
fund_nav           (ts_code, end_date) 净值, source 1/2
fund_fee_segments  (ts_code, kind, seq) 分段费率 (crawler)
fund_stage_returns (ts_code, period)   阶段涨幅 (crawler)
trade_calendar     (cal_date PK)       交易日历 (Tushare trade_cal)
sync_log           id PK               同步审计 + 失败重放游标 (>30 天可删)

# 指数体系 (2026)
index_basic        (ts_code PK)        指数权威信息 (含 publisher / index_type / base_date)
index_source_map   (ts_code, source)   多源代码映射 (tushare / eastmoney / csindex / custom)
index_daily        (ts_code, end_date) 指数 OHLC + 涨跌幅, source 1/2/3/6
index_fund_tracker (index_ts_code, fund_ts_code) 指数 ⇄ 基金跟踪关系
```

详细字段定义见 [scripts/nav/db.js](scripts/nav/db.js) `initSchema()`。schema 演进通过 `ensureTushareShadowColumns()` / `ensureNavSourceColumn()` 等幂等迁移函数。

## API 路由

[scripts/serve-fund-api.js](scripts/serve-fund-api.js) 端口 3457, 路由分派:

- `/api/fund/list` — **嗅探参数**: 有 `page` / `q` / `sort` → 服务端分页 ([scripts/list-query.js](scripts/list-query.js) SQL builder); 无 → 旧全量路径 (灾备)
- `/api/fund/filter-options` — 筛选 tag + 频次 (一次性, IDB SWR 缓存)
- `/api/fund/{code}` / `/{code}/fee` / `POST /{code}/crawl` — 单只查询/触发爬虫
- `/api/fund/search-index` / `codes` / `stats` / `stats/detail` — 搜索 / 聚合
- `/api/nav/{code}` / `history` / `range` / `compare` — 净值; `/api/nav/compare` 支持 fund (`000001`) + index (`HSI.HI`) 混合 codes

服务端分页决策见 [docs/decisions/0001-server-side-pagination-not-duckdb.md](docs/decisions/0001-server-side-pagination-not-duckdb.md)。

## 限流 / 重试

[scripts/nav/tushare-client.js](scripts/nav/tushare-client.js) 内置:
- 全局动态节流: 触发限流时翻倍间隔 (上限 5s), 成功时 10% 衰减回收
- HTTP 429 / -2001 业务码 / "每分钟" / "频率" → 指数退避 (5s→10s→20s→40s→80s)
- 默认 5 次重试

`TUSHARE_GAP_MS` / `TUSHARE_MAX_RETRIES` / `TUSHARE_RATE_LIMIT_BASE_MS` 等环境变量调参。

[scripts/nav/crawl-eastmoney-nav.js](scripts/nav/crawl-eastmoney-nav.js) 注意: eastmoney lsjz API **单页硬上限 20 行** (PAGE_SIZE > 199 服务器拒返 0 行)。

## 前端结构

- 无构建框架, 纯 ES modules + 静态 HTML
- **SPA + hash 路由**: 单一 `index.html`, [js/core/router.js](js/core/router.js) 按 `#/calc · #/list · #/index · #/nav · #/stats · #/fund` 切换 6 个页面, 对应 `pages/<route>/index.js` 模块**按需懒加载** (`import()`, 仅首次激活时拉取并初始化)。新增页面: 在 `ROUTES` 加一行 + `index.html` 加 `[data-route]` 容器/tab。
- [js/](js/) 按职责分: `core/` 配置/路由/主题, `data/` API 适配 + nav 缓存 + 交易日历, `domain/` 业务计算 (fee/nav-stats/nav-align), `pages/` 各页面入口, `components/` 共享组件, `utils/` 工具
- 测试用 `*.test.js` 跟实现并排, `node --test` 跑
- 环境自动检测 ([js/data/fund-api.js](js/data/fund-api.js) `getFeeApiBase()`):
  - `localhost` / `127.0.0.1` → `http://localhost:3457/api/fund`
  - 其他域名 → 同源 `/api/fund` (CF Tunnel 反代到本机)

### 列表页 ([js/pages/list/](js/pages/list/))

- 服务端分页模式: 每次状态变更 (搜索 / 排序 / 筛选 / 翻页) → fetch `/api/fund/list?page=...`
- AbortController 防竞态; 不持有 allFunds 全集, 只持有当前页 rows
- `selectedCompare` 是 `Map<code, name>` (保持插入顺序 + 自带 name)
- 筛选 tag 来自 `/api/fund/filter-options`, fundManager 默认 top-50 + 搜索框过滤

## 重要约定 / 易错点

- **不要恢复 .SH/.SZ nav 同步**: 已删, 业务只用场外。`scripts/nav/sync-fund-daily.js` 保留作审计/调试, 但默认不跑。
- **不要让 sync-fund-basic 覆写重叠字段**: 见上"关键约束"。改回 `INSERT OR REPLACE` 全字段会破坏 crawler-first 裁决。
- **新增 schema 列**: 在 [scripts/nav/db.js](scripts/nav/db.js) 加 `ensureXxxColumn()` 幂等迁移函数, 不要假设 schema 已有。
- **新增数据源**: nav 类加 `source` 整数标记 (现有 1=tushare, 2=eastmoney; index_daily 用 3=csindex, 6=custom)。指数同源思路: 见 [docs/data-flow.md § 9](docs/data-flow.md)。
- **新增 list 排序字段**: 在 [scripts/list-query.js](scripts/list-query.js) `SORT_EXPR` 白名单加, 同时更新前端 [js/pages/list/index.js](js/pages/list/index.js) `parseSortValue` 的 valid 集和 keyMap。
- **更新数据源时**: 优先看 [docs/data-flow.md](docs/data-flow.md) 流程图, 不要绕开 `apply-merge-rules` 直写 fund_basic。
- **测试**: `js/domain/*.test.js` 和 `scripts/list-query.test.js` 是纯函数单测, 加新业务函数 / SQL builder 务必带测试。
- **新加时间序列数据 (K线/股票/复杂指标)**: 优先考虑 Parquet 列存而非塞进 SQLite, 详见未来的 ADR 0002 草案。

## 已弃 / 历史

- `archive/docs/DEPLOY-ORACLE.md` — Oracle Cloud Free 部署文档
- `archive/docs/cloudflare-migration.md` — D1+R2 边缘存储方案
- `archive/scripts/build-allfund.js` — 旧 (从 data/funds/*.json 聚合); 用 [scripts/build-allfund-from-db.js](scripts/build-allfund-from-db.js)
- `archive/scripts/build-search-index.js` — 依赖下线的 `data/funds/*.json`
- `archive/scripts/check-allfund.js` — 依赖下线的 `allfund.json`
- `archive/scripts/upload-kv.js` — Cloudflare Workers + KV 全量已弃
- `scripts/migrate-crawler-to-db.js` — 一次性迁移已完成; 仅作灾备
- `data/funds/<code>.json` — 旧 crawler 中转; 现 crawler 直写 DB
- VPS / Cloudflare Workers 部署遗留 (`aliyun-deploy.sh` / `deploy.sh` / `nginx/` / `ecosystem.config.cjs` / `src/worker.js` / `wrangler.toml` / `build-workers.js`) **已删** — 当前只用 CF Tunnel 模式
