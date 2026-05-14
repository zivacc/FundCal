# FundCal 数据流体检报告

> 生成日期：2025（基于仓库当前工作树，未跑任何修复）
> 方法：对比 `README.md` / `CLAUDE.md` / `docs/data-flow.md` 声明 vs 实际代码、DB schema、前端 fetch、静态文件、npm scripts、nginx、cron 的实际行为。
> 定位：**只读盘点**。不动代码、文档、数据。

---

## 0. TL;DR（结论先看）

1. **`docs/data-flow.md` 和 `CLAUDE.md` 基本与现状对齐**（字段裁决、双源、schema、share_class、nav.source、index 数据流都在）。
2. **`README.md` 明显落后**：缺新 API (`/api/fund/list`, `stats/detail`, `/:code/crawl`, 全部 `/api/nav/*`)、缺多数 `scripts/nav/*` 脚本、示例目录结构仍指 `js/config.js`/`js/app.js` 等已不存在的单文件。
3. **GitHub Pages 纯静态模式实际已坏**：`data/allfund/allfund.json` 和单基金分片 `data/allfund/funds/<code>.json` 都不存在（前者已归档，后者目录空），`cached-funds.html` / 比较 NAV / 统计页 / 单基金费率 fallback 都会落到 404。只有搜索索引 / feeder / fund-stats / trade-calendar / index-search 这 5 个小静态文件还能用。
4. **前端存在多处"永远走不到 / 永远 404"的死 fallback**：`data/allfund/funds/<code>.json`、`data/allfund/code-name-map.json`、旧 `allfund.json` 注释。
5. **`scripts/fund-api.js` 的 `POST /:code/crawl` 入 DB 分支同样是死路**：它从 `data/funds/<code>.json` 读，而爬虫早已直写 DB 不再产这个文件。
6. **仓库存在 ~125 MB 的归档 + 一份 ~4.5 GB 旧 DB（`data/fundcal-old.db`）**。后者在 `.gitignore` 里应该是被忽略的，但占磁盘。
7. **`scripts/stats/index.js`（stats 页）自备一份 `getFeeApiBase`**，与 `js/data/fund-api.js` 重复定义，没有单一事实来源。

---

## 1. 数据层：主真相 = SQLite

### 1.1 实际 schema（从 [scripts/nav/db.js](../scripts/nav/db.js) `initSchema` + `ensureXxx` 推导）

| 表 | 主键 | 用途 | 备注 |
|---|---|---|---|
| `fund_basic` | `ts_code` | 基金权威基础信息 | `apply-merge-rules` 裁决后 |
| `fund_meta` | `ts_code` | crawler 独占字段 + `_crawler` / `_tushare` 双侧影子 + `share_class` | `ensureTushareShadowColumns` 幂等迁移 |
| `fund_nav` | `(ts_code, end_date)` | 净值；`source` 1=tushare / 2=eastmoney | `ensureNavSourceColumn` 迁移 |
| `fund_fee_segments` | `(ts_code, kind, seq)` | 分段费率 | crawler 独占 |
| `fund_stage_returns` | `(ts_code, period)` | 阶段涨幅 | crawler 独占 |
| `trade_calendar` | `cal_date` | SSE 交易日历 | Tushare `trade_cal` |
| `sync_log` | auto id | 同步审计 + 失败重放游标 | |
| `index_basic` | `ts_code` | 指数基础信息 | 含 `primary_source` |
| `index_source_map` | `(ts_code, source)` | 一个指数 → 多源代码映射 | source ∈ tushare / eastmoney / csindex / custom |
| `index_daily` | `(ts_code, end_date)` | 指数日线 | `source` 1/2/3/6 |
| `index_fund_tracker` | `(index_ts_code, fund_ts_code)` | 指数 ⇄ 基金跟踪关系 | `link-fund-to-index` 派生 |

**发现**：
- `CLAUDE.md` 概览里列了 7 个核心表，**漏了 4 个指数表**（index_basic / index_source_map / index_daily / index_fund_tracker）。
- `docs/data-flow.md` 第 9 节有讲指数体系，但主表速查清单（第 2 节）里也漏列指数表。
- `README.md` 完全没提指数这条线。

### 1.2 仓库里的 DB 文件

| 文件 | 大小 | 状态 |
|---|---|---|
| `data/fundcal.db` | 生产 DB | 在 `.gitignore` 中（见 `.gitignore` 312 KB 推测包含忽略规则），正常 |
| `data/fundcal-old.db` | 4.5 GB | **仓库里仍有，应归档或删除** |

---

## 2. API 层：`scripts/serve-fund-api.js` + 子路由

### 2.1 实际端点全集

#### `scripts/fund-api.js` (SQLite-backed fund 路由)

| Method | Path | 返回 | 缓存 |
|---|---|---|---|
| GET | `/api/fund/list?fields=summary\|full[&source=...]` | 全库数组（summary 含 sellFeeSegments + redeemSegments） | `jsonCached maxAge=300` |
| GET | `/api/fund/codes[?source=...]` | `{codes: [...]}` | 300 |
| GET | `/api/fund/search-index` | `[{code, name, initials}]`，仅 crawler-having | 600 |
| GET | `/api/fund/stats` | `{total, trackingFundCount, tracking, manager, benchmark, fundType}` 四维 | 600 |
| GET | `/api/fund/stats/detail?dim=tracking\|manager\|benchmark\|fundType&label=...` | 单分组明细数组 | 600 |
| GET | `/api/fund/:code` 或 `/:code/fee` | 单基金完整对象 | 300 |
| POST | `/api/fund/:code/crawl` | 触发 `crawl-fund-fee.js` 子进程 + upsert 入 DB | 不缓存 |

#### `scripts/nav/nav-api.js` (SQLite-backed NAV 路由)

| Method | Path | 返回 | 缓存 |
|---|---|---|---|
| GET | `/api/nav/stats` | DB 整体统计 | 300 |
| GET | `/api/nav/:code` | 最新净值 + basic | 60 |
| GET | `/api/nav/:code/history?start=&end=&limit=&order=` | 区间净值数组 | 60 |
| GET | `/api/nav/:code/range` | 数据范围 + 记录数 | 300 |
| GET | `/api/nav/compare?codes=...[&start=&end=&interval=&indicators=]` | 多 code 对齐（fund + index 混编）| 60 |
| GET | `/api/nav/index-search-index` | 指数搜索池 | 300 |

#### `scripts/serve-fund-api.js` 顶层

| Method | Path | 返回 |
|---|---|---|
| GET | `/api/fund/all-codes` | 远程拉天天基金 `fundcode_search.js` → 6 位 code 数组，进程级 5 min 内存缓存 |

### 2.2 发现

- **`README.md` API 接口段仅列了 `/fee` / `/codes` / `/all-codes` / `/search-index` / `/feeder-index` / `/stats`**；缺上面 10+ 个端点，其中 `/api/fund/list` 是列表页的主依赖、`/api/nav/*` 是整个 NAV 页的主依赖。

---

## 3. 静态文件层：`data/allfund/`

### 3.1 实际在产的文件

| 文件 | 大小 | 产出脚本 | 前端引用处 |
|---|---|---|---|
| `search-index.json` | 3.3 MB | `build-allfund-from-db.js` | stats, list, fund-api 兜底 |
| `feeder-index.json` | 639 KB | `build-feeder-index.js` | fund-api 兜底 |
| `fund-stats.json` | 1.7 MB | `build-fund-stats.js` | stats, index-picker-modal 兜底 |
| `index-search-index.json` | 1.3 KB | `build-allfund-from-db.js` | nav-api 兜底 |
| `trade-calendar.json` | 97 KB | `build-trade-calendar.js` | `js/data/trade-calendar.js` |
| `feeder-master-overrides.json` | 250 B | **手工维护的配置** | `build-feeder-index.js` 读取 |
| `overseas-codes.json` | 2.3 KB | **手工维护的配置** | （grep 未见前端引用，可能是爬虫白名单） |
| `funds/` 目录 | **空 (0 文件)** | 应由 `build-allfund-from-db.js` 产 | fund-api / stats / json-modal 三处 fallback |

### 3.2 发现

#### P0 · 单基金分片目录实际是空的

`build-allfund-from-db.js` 第 174-192 行会写 `data/allfund/funds/<code>.json`（crawler-having 才写），但 `data\allfund\funds\` 在工作树里 0 文件。这意味着：

- GitHub Pages 上**无法获取任何单基金费率**。
- `js/data/fund-api.js` `fetchFundFeeFromAPI / fetchFundRawFromAPI` 的 fallback 永远 404。
- `js/pages/list/json-modal.js`"查看 JSON"按钮（fallback 路径）永远 404。
- `js/pages/stats/index.js` 卡片详情 fallback 永远 404。

结论：**要么**重新跑 `npm run build-allfund` 把 26 k 个分片写回仓库 / 部署的静态目录，**要么**承认 GitHub Pages 模式下单基金数据已下线，把前端 fallback 逻辑删掉并在 README / config.js 注释里更新"纯静态模式能用哪些功能"。

#### P2 · `code-name-map.json` 没人生产

[`js/pages/stats/index.js:30-55`](../js/pages/stats/index.js) 里 `ensureCodeNameMap()` `fetch('data/allfund/code-name-map.json')`，但：
- 仓库里**没有这个文件**
- `scripts/` 里**没有脚本产这个文件**
- 代码路径对 404 静默 fallback 为空对象，所以线上能跑，但这个函数是纯死路

应该或 **删掉**（去用 API 的 `/list` 或 `/search-index`）或**补一个小 build 脚本**产出这份 code→name 映射。

---

## 4. 前端数据访问路径

### 4.1 API base 解析逻辑（两处，未统一）

| 位置 | 规则 |
|---|---|
| `js/data/fund-api.js` `getFeeApiBase` | `window.FUND_FEE_API_BASE` > localhost → `http://localhost:3457/api/fund` > `*.github.io` → `null` > 其他 → `/api/fund` |
| `js/pages/stats/index.js:1-14` **重复定义同名函数** | 同上，但**没有 `.workers.dev` 分支**（fund-api.js 里有） |
| `js/data/nav-api.js` `getNavApiBase` | 用 `/api` 前缀（指向 `/api/nav/*`） |

**发现**：stats 页应改成 `import { getFeeApiBase } from '../../data/fund-api.js'`，否则未来一改 fund-api.js，stats 页漏同步。

### 4.2 每页面数据来源矩阵

| 页面 | 主路径 | 兜底 | 兜底是否可用 |
|---|---|---|---|
| `index.html` 计算器 | 用户输入 + `fetchFundFeeFromAPI` | `data/allfund/funds/<code>.json` | ❌ 目录空 |
| 指数选择弹窗 `index-picker-modal.js` | `fetchFundStatsFromAPI` → `/api/fund/stats` | `data/allfund/fund-stats.json` | ✅ |
| 基金列表页 `cached-funds.html` | `/api/fund/list?fields=summary` | `search-index.json` + 按需 `funds/<code>.json` | ⚠️ 只有 code/name，详情永远 404 |
| 统计页 `fund-stats.html` | `/api/fund/stats` + `/stats/detail` | `fund-stats.json` + `search-index.json` + `funds/<code>.json` + `code-name-map.json` | 前 2 ✅，后 2 ❌ |
| JSON 弹窗 `json-modal.js` | `/api/fund/:code/fee` | `funds/<code>.json` | ❌ |
| NAV 比较页 `cached-nav-compare.html` | `/api/nav/compare` + `/api/nav/index-search-index` | `index-search-index.json` | ⚠️ 没有 `/api/nav/compare` 的静态兜底，GH Pages 完全不可用 |
| 交易日历 | `data/allfund/trade-calendar.json` | 无 | ✅ |
| 私募映射 `fund-detail-table.js` | `data/smpp/simuwang-code-mapping.json` | 无 | ✅（`data/smpp/` 有文件） |

---

## 5. 脚本层：`scripts/` 43 文件

### 5.1 在用 / deprecated / 死代码 分类

| 脚本 | 状态 | 说明 |
|---|---|---|
| `scripts/build-allfund-from-db.js` | ✅ 主力 | DB → 小静态分片 + 单基金分片 |
| `scripts/build-feeder-index.js` | ✅ 主力 | |
| `scripts/build-fund-stats.js` | ✅ 主力 | |
| `scripts/build-trade-calendar.js` | ✅ 主力 | |
| `archive/scripts/build-allfund.js` | 🗄️ 已归档 | `build-allfund-from-db.js` 替代 |
| `archive/scripts/build-search-index.js` | 🗄️ 已归档 | 依赖下线的 `allfund.json`；search-index 改由 `build-allfund-from-db.js` 产出 |
| `archive/scripts/check-allfund.js` | 🗄️ 已归档 | 依赖下线的 `allfund.json` |
| `archive/scripts/upload-kv.js` | 🗄️ 已归档 | CF Workers / KV 已弃；`package.json` 仅保留 `__legacy_upload-kv*` 占位 |
| `scripts/build-workers.js` | ⚠️ 不确定 | `wrangler.toml` 仍在，但 `docs/cloudflare-migration.md` 说 KV 已弃。是否仍维护？ |
| `scripts/migrate-crawler-to-db.js` | 🏷️ 灾备 | 从 `data/funds/*.json` 重建 DB；但 `data/funds/` 现在是空的，所以真要灾备必须先恢复这批 JSON |
| `scripts/crawl-fund-fee.js` | ✅ 主力 | 直写 DB，`--keep-json` 才副产 JSON |
| `scripts/crawl-all-fund-fee.js` | ✅ 主力 | |
| `scripts/aliyun-deploy.sh` | ✅ 部署 | CLAUDE.md 引用 |
| `scripts/deploy.sh` | ? | `package.json` 里 `npm run deploy` 还指它，但 CLAUDE.md 推 aliyun-deploy.sh。两者关系未在文档说清。 |
| `scripts/dev-server.js` | ✅ 主力 | `npm run dev` |
| `scripts/serve-fund-api.js` | ✅ 主力 | PM2 entry |
| `scripts/fund-api.js` | ✅ 主力 | fund 路由，见下面 §5.3 死代码 |
| `scripts/simuwang-code-mapper.js` | ? | `data/smpp/*.json` 的生成器？README 未提 |
| `scripts/nav/apply-merge-rules.js` | ✅ 主力 | |
| `scripts/nav/cleanup-redundant-of.js` | ✅ 主力 | data-flow.md 列出 |
| `scripts/nav/crawl-eastmoney-nav.js` | ✅ 主力 | data-flow.md 列出 |
| `scripts/nav/crawl-em-index.js` | ✅ 主力 | data-flow.md 列出 |
| `scripts/nav/db.js` | ✅ 主力 | |
| `scripts/nav/env.js` | ✅ 主力 | env 读取 |
| `scripts/nav/fix-empty-status.js` | ✅ 主力 | cron 里跑 |
| `scripts/nav/health-check.js` | ✅ 主力 | cron 里跑 |
| `scripts/nav/http-cache.js` | ✅ 主力 | ETag / jsonCached 基建 |
| `scripts/nav/import-custom-index.js` | ✅ 主力 | |
| `scripts/nav/link-fund-to-index.js` | ✅ 主力 | 派生 `index_fund_tracker` |
| `scripts/nav/parse-share-class.js` | ✅ 主力 | cron 里跑 |
| `scripts/nav/query-nav.js` | ✅ 主力 | CLI |
| `scripts/nav/register-em-index-secids.js` | ✅ 一次性 | |
| `scripts/nav/replay-failed-syncs.js` | ✅ 主力 | cron 里跑 |
| `scripts/nav/sync-fund-basic.js` | ✅ 主力 | |
| `scripts/nav/sync-fund-daily.js` | 🏷️ 审计/调试 | CLAUDE.md 已注明默认不跑 |
| `scripts/nav/sync-fund-nav.js` | ✅ 主力 | |
| `scripts/nav/sync-index-basic.js` | ✅ 主力 | |
| `scripts/nav/sync-index-daily.js` | ✅ 主力 | |
| `scripts/nav/sync-trade-calendar.js` | ✅ 主力 | |
| `scripts/nav/tushare-client.js` | ✅ 主力 | |
| `scripts/cron/fundcal-cron` | ✅ 主力 | 生产 cron |

### 5.2 `package.json` scripts 列表 vs 实际使用

`package.json` 里定义了但文档没提（或提法不一致）的命令：

| 命令 | 关联脚本 | 文档状态 |
|---|---|---|
| `upload-kv` / `upload-kv:preview` | `upload-kv.js`（依赖已下线 allfund.json） | **应删除或标 deprecated** |
| `dev:workers` / `deploy:workers` | `build-workers.js` + wrangler | Workers 路线按 `CLAUDE.md` 已弃，但命令仍在 |
| `migrate:crawler` | `migrate-crawler-to-db.js` | 灾备用，README 没提 |
| `crawl:all` | `crawl-all-fund-fee.js` | README 没提 |
| `health-check` / `replay-failed` | 同名脚本 | README 没提 |
| `query:nav` | `query-nav.js` | README 没提 |

### 5.3 `scripts/fund-api.js` 内部死代码

`upsertSingleFundFromCrawler` 函数（[line 413](../scripts/fund-api.js)）依然从 `data/funds/<code>.json` 读：

```
if (!fs.existsSync(fp)) return { ok: false, reason: 'crawler JSON 不存在' };
```

而 `crawl-fund-fee.js` 当前默认**直写 DB 不产 JSON**（除非 `--keep-json`）。`POST /api/fund/:code/crawl` 路径的流程是：
1. spawn 子进程 `crawl-fund-fee.js <code>` ← 已入 DB
2. 再调 `upsertSingleFundFromCrawler(db, code)` 去读 JSON ← **永远失败**

**结果**：POST crawl 会报 `"爬取成功但入 DB 失败：crawler JSON 不存在"`，**但实际 DB 已经有数据了**（子进程已写）。前端 `list/index.js` line 556-563 收到 `ok:false` 会 `alert` 抓取失败。

这是个**真实的 P0 bug**：成功后用户看到失败提示。修复最小改动 = 子进程退出 0 就信任 DB 已更新，跳过 `upsertSingleFundFromCrawler` 调用。

---

## 6. 部署 / 运维配置

### 6.1 `nginx/fundcal.conf`

- ✅ 反代 `/api/` → `127.0.0.1:3457`，带 60 s micro-cache
- ✅ `/data/allfund/` 静态长缓存 (7 天)
- ✅ `deny all` 了 `/scripts/`、`/node_modules/`、`/data/funds/`、`fundcal.db`
- ✅ Cloudflare real_ip 白名单

**无发现问题**。

### 6.2 `scripts/cron/fundcal-cron`

- `18:30` sync-fund-nav
- `18:50` replay-failed
- `19:30` crawl-eastmoney-nav --missing
- `20:00` `npm run build-all`
- `20:30` health-check
- 周一 basic / crawl-all / merge-rules / parse-share-class / trade-cal / fix-empty-status
- 日志 / VACUUM / sync_log 保洁

**缺**：`sync-index-basic` / `sync-index-daily` / `link-fund-to-index` 不在 cron，指数数据完全靠手动触发或首次导入。

### 6.3 `ecosystem.config.cjs`

- ✅ 单进程 `fund-api` 指向 `scripts/serve-fund-api.js 3457`
- `max_memory_restart: 500M` 对 SQLite + 指数 compare 场景可能偏低，但目前没数据说爆过

### 6.4 `.github/workflows/deploy-pages.yml`

**GitHub Pages 会把整个仓库 push 上去，包括 `data/fundcal-old.db`（4.5 GB）和 `archive/data-allfund/*`（125 MB）**。需要检查 GitHub Actions 的 artifact 上限：通常 workflow artifact 1 GB 硬限，超过会失败。实测能否部署成功未验证，但这是个运行期 risk。

**缺 `.nojekyll`**：未检查仓库根是否有 `.nojekyll`。Jekyll 会吞 `_*` 开头的文件（当前没有，但属于潜在坑）。

---

## 7. 文档层对比

### 7.1 `README.md` 具体过时点

| 位置 | README 声明 | 实际 | 修复建议 |
|---|---|---|---|
| 项目结构段 | `js/config.js` / `js/app.js` / `js/fund-fee.js` 等单文件 | 实际按 `core/ data/ domain/ pages/ components/ utils/` 分层 | 重写该段 |
| API 接口表 | 列了 6 个端点 | 实际 fund 路由 7 + nav 路由 6 + all-codes 1 = **14 个端点** | 重写 |
| npm 命令速查 | 只列 build / crawl / dev | 缺 sync:index-basic / sync:index-daily / crawl:em-index / crawl:eastmoney-nav / import:custom-index / query:nav / replay-failed / health-check / migrate:crawler 等 | 重写 |
| 纯静态模式介绍 | 声称 GH Pages "所有功能均可用" | 列表 / 详情 / NAV 比较全不可用 | 限缩为"仅计算器 + 搜索 + 指数选择（统计维度）可用" |
| 字段裁决 | 简表 | 已有细节在 `docs/data-flow.md` | README 指向 data-flow.md 即可，不要重复维护 |
| 联接基金识别规则 | 只说含"联接" | 实际还支持 ABCD 份额后缀 + fundType 含联接 + feeder-master-overrides.json 人工覆盖 | 增补 |
| Cloudflare Workers 段 | 仍说 KV 方案 | CLAUDE.md 已注明弃用 | 与 cloudflare-migration.md 对齐 |

### 7.2 `CLAUDE.md`

- ✅ 架构图、字段裁决、限流策略、前端结构、部署路径全部正确
- ⚠️ Schema 概览表漏 4 个 index_* 表（见 §1.1）
- ⚠️ "已弃/历史" 列里只提 Cloudflare KV，漏 `build-allfund.js` / `build-search-index.js` / `check-allfund.js` / `upload-kv.js` / `data/fundcal-old.db`

### 7.3 `docs/data-flow.md`

- ✅ 内容最全、最新
- ⚠️ 脚本表里仍列 `build-search-index.js` 为"单独构建搜索索引"，但该脚本依赖已下线的 `allfund.json`，实际跑会报错或生成空索引

---

## 8. 仓库残余物（建议归档或清理）

| 路径 | 大小 | 用途 | 建议 |
|---|---|---|---|
| `data/fundcal-old.db` | 4.5 GB | 旧主 DB | 移到仓库外或删除；`.gitignore` 应已忽略 |
| `archive/data-allfund/allfund.json` | 75 MB | 下线大文件归档 | 保留 OR 迁 Git LFS |
| `archive/data-allfund/list-index.json` | 27 MB | 同上 | 同上 |
| `archive/data-allfund/fund-stats-detail.json` | 21 MB | 同上 | 同上 |
| `archive/data-allfund/check-report.json` | 17 KB | 老体检报告 | 可删 |
| `data/smpp/simuwang-code-mapping-2026-03-22.json` 等日期版 | ~600 KB 每份 | 私募映射历史版本 | 保留最新一份即可 |
| `data/funds/` 目录（空） | - | 旧 crawler JSON 中转 | 可直接删目录 |
| `dist/` 目录（空） | - | 某个构建产物 dir？ | 确认是否在用 |
| `pics/` 目录（空） | - | README 截图位？ | 确认 |
| `.agents/ .claude/ .trae/ .wrangler/` 空目录 | - | IDE / tool 残留 | 各 AI 工具占坑 |

---

## 9. 运行期 Bug 汇总（按严重度）

| # | 严重 | 现象 | 根因 | 状态 |
|---|---|---|---|---|
| 1 | **P0** | GH Pages 上基金列表 / 单基金详情 / NAV 比较 / 统计明细 **全失效** | `funds/` 空 + 无 nav 静态兜底 + README 仍说 GH Pages 全功能 | 待修（需 README 红警告或 `npm run build-allfund` 提交分片） |
| 2 | **P0** | 列表页点"补抓取" 按钮，DB 已更新但 UI 弹 `"爬取失败"` | `scripts/fund-api.js` `upsertSingleFundFromCrawler` 试图读已不存在的 `data/funds/<code>.json` | ✅ 已修：删除二次入库分支，子进程 exitCode=0 即视为成功 |
| 3 | **P1** | stats 页 `code-name-map.json` 永远 404（静默 fallback 为空） | 文件从未被任何 build 脚本生成 | ✅ 已修：`ensureCodeNameMap` 改从 IDB 缓存的 `search-index` 派生 |
| 4 | **P1** | `core/config.js` 的注释引导用户配 `FUND_FEE_API_BASE`，但注释里仍提 `allfund.json` 作为静态入口 | 注释过时 | ✅ 已修：注释更新为「静态模式仅 5 个小索引 + trade-calendar」 |
| 5 | **P2** | stats 页和 fund-api.js 各有一份 `getFeeApiBase`，未来分叉 | 重复定义 | ✅ 已修：stats 页 `import { getFeeApiBase } from '../../data/fund-api.js'` |
| 6 | **P2** | `npm run upload-kv` 会因 `allfund.json` 不存在而 hard fail | 命令未同步下线 | ✅ 已修：legacy 脚本加 `__legacy_` 前缀，不再误触发 |
| 7 | **P3** | `scripts/build-search-index.js`、`check-allfund.js` 跑起来报错 / 生成空索引 | 依赖已下线文件 | ✅ 已归档至 `archive/scripts/` |
| 8 | **P3** | GH Pages artifact 部署可能因 `data/fundcal-old.db`(4.5 GB) 超限失败 | 仓库不该跟踪这个 DB | ✅ 已删 |

---

## 10. 修复优先级建议

### 马上该修（P0）
- ✅ 移除 `POST /api/fund/:code/crawl` 里 `upsertSingleFundFromCrawler` 二次入库分支（子进程已写 DB）
- ✅ README 纯静态模式段加红警告（顶部 ⚠️ 限制说明 + 「三种部署模式」表格 + `/api/nav/*` 段尾备注）。重新提交 26k 个 `funds/<code>.json` 分片这条留作仓库体积权衡，未执行。

### 顺手修（P1~P2）
- ✅ `js/pages/stats/index.js` 删自定义 `getFeeApiBase`，改 import
- ✅ `ensureCodeNameMap()` 改用 search-index 派生（无需新增 `build-code-name-map.js`）
- ✅ `js/core/config.js` 注释更新为"静态模式仅能覆盖 5 个小索引 + trade-calendar，单基金/列表/NAV 不可用"
- ✅ `package.json` 的 `upload-kv*` / `dev:workers` / `deploy:workers` 加 `__legacy_` 前缀

### 清理（P3）
- ✅ `data/fundcal-old.db` 从仓库移出（已删）
- ✅ `scripts/build-allfund.js` / `build-search-index.js` / `check-allfund.js` / `upload-kv.js` 已迁到 `archive/scripts/`，`docs/data-flow.md` 与 `CLAUDE.md` 同步
- ✅ README 的项目结构、API 表（`/api/fund/*` + `/api/nav/*`）、npm scripts 速查全部重写到当前实际

### 增补文档（P3）
- ✅ `docs/data-flow.md` 第 11 节末尾新增「输出端: `/api/nav/compare` 混编 fund + index」流程图（sync-index-basic → sync-index-daily / crawl-em-index / import-custom-index → link-fund-to-index → 比较页）
- ✅ README 与 `docs/data-flow.md` 都给出 `/api/nav/compare` 协议小节（`isFundCode` 约定、`indicators` 解析、`adjNavs` 字段对齐、20 只上限）

---

## 附 A. 关键路径文件引用速查

- 主真相 DB schema：[`scripts/nav/db.js`](../scripts/nav/db.js) `initSchema` L79-238
- Fund API 路由：[`scripts/fund-api.js`](../scripts/fund-api.js)
- NAV API 路由：[`scripts/nav/nav-api.js`](../scripts/nav/nav-api.js)
- 静态分片生成：[`scripts/build-allfund-from-db.js`](../scripts/build-allfund-from-db.js)
- 前端 fund API 适配：[`js/data/fund-api.js`](../js/data/fund-api.js)
- 前端 NAV API 适配：[`js/data/nav-api.js`](../js/data/nav-api.js)
- 交易日历：[`js/data/trade-calendar.js`](../js/data/trade-calendar.js)
- Cron：[`scripts/cron/fundcal-cron`](../scripts/cron/fundcal-cron)
- Nginx：[`nginx/fundcal.conf`](../nginx/fundcal.conf)
- PM2：[`ecosystem.config.cjs`](../ecosystem.config.cjs)
