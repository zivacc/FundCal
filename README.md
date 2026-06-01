# 基金费率计算器 FundCal

多基金费率对比工具：输入或拉取基金费率，在同一张图上展示不同基金在各持有期限下的累计费用曲线，并自动标注交叉点。

**在线体验**：[https://f.z-c.me](https://f.z-c.me/) — PC 开发机 + Cloudflare Tunnel 暴露

> **部署模式**: 本机 `npm run dev` 起 `localhost:3456/3457`, 由 Cloudflare Tunnel (`cloudflared`) 反代到公网域名, 零端口暴露。历史的 Oracle Cloud / 阿里云 ECS / Cloudflare Workers+KV / D1+R2 方案已归档至 [`archive/docs/`](archive/docs/)。

---

## 核心功能


| 功能          | 说明                                                                        |
| ----------- | ------------------------------------------------------------------------- |
| **费率计算**    | 支持买入费率（含申购折扣）、分段卖出费率（7/30/90/180/365/730天+永久段）、年化运作费率（管理费+托管费+销售服务费，按日累计） |
| **多基金图表对比** | 同一图表展示多条费用曲线，支持自定义显示天数范围                                                  |
| **交叉点标注**   | 自动计算并标出曲线交叉点，显示交叉日的累计费率与折算年化费率                                            |
| **按代码拉取费率** | 输入 6 位基金代码，自动从数据中加载该基金的完整费率信息                                             |
| **搜索联想**    | 支持按基金代码、名称、拼音首字母搜索，实时下拉匹配                                                 |
| **按指数选基金**  | 点击「指数」按钮，按跟踪标的批量浏览和添加基金                                                   |
| **批量导入/导出** | 支持从文本、CSV、Excel、`.ziva` 快照文件导入基金，也可导出当前状态                                 |
| **缓存基金列表**  | 浏览全部已缓存基金，支持搜索、筛选、排序、分页                                                   |
| **统计分析**    | 按跟踪标的、基金公司、业绩基准三个维度聚合统计，支持搜索和展开详情                                         |
| **联接基金穿透**  | 自动识别联接基金与母基金关系，支持穿透比较                                                     |


---

## 快速开始

```bash
# Windows: 双击 start.bat
# Mac / Linux: chmod +x start.sh && ./start.sh
# 任意: npm run dev
```

浏览器访问 `http://localhost:3456`。一次启动:
- 静态文件服务 (3456) — 浏览器访问入口
- API 服务 (3457) — `/api/fund/*` + `/api/nav/*` 同一进程

---

## 部署模式

| 模式 | 数据来源 | 适用场景 |
|---|---|---|
| **本地开发** | `localhost:3457` API | 开发调试, 实时爬取 |
| **CF Tunnel** | 同源 `/api/fund` + `/api/nav` (Tunnel 反代到本机) | 公网访问, 零端口暴露 |

前端环境自动识别 ([`js/data/fund-api.js`](js/data/fund-api.js) `getFeeApiBase()`):

- `localhost` / `127.0.0.1` → `http://localhost:3457/api/fund`
- 其他域名 → 同源 `/api/fund`

详细见 [docs/DEPLOY.md](docs/DEPLOY.md)。

---

## 项目结构

前端是单页应用 (SPA) — 入口 `index.html` 通过 hash 路由 (`#/calc`、`#/list`、`#/index`、`#/nav`、`#/stats`) 切换 5 个页面, 模块按需懒加载 (见 [`js/core/router.js`](js/core/router.js))。

```
FundCal/
│
├── index.html                          SPA 入口 (5 个 hash 路由)
│
├── js/
│   ├── core/
│   │   ├── config.js                   全局配置 (FUND_FEE_API_BASE)
│   │   ├── router.js                   SPA hash 路由 + 模块懒加载
│   │   ├── code-kind.js                fund / index key 判别 (6 位数字 → fund, ts_code → index)
│   │   ├── benchmarks.js               业绩基准定义
│   │   └── theme.js / theme-toggle.js  深色主题
│   ├── data/
│   │   ├── fund-api.js                 /api/fund/* 客户端 + 静态 fallback
│   │   ├── nav-api.js                  /api/nav/* 客户端
│   │   ├── idb-cache.js                IndexedDB SWR + ETag 304 短路
│   │   ├── nav-cache.js                NAV 序列内存缓存
│   │   └── trade-calendar.js           交易日历加载/查询
│   ├── domain/                         纯函数业务层 (有单测)
│   │   ├── fee-calculator.js           分段卖出 / 年化 / 交叉点
│   │   ├── nav-stats.js                收益率 / 波动率 / 回撤 / INDICATORS 注册表
│   │   ├── nav-align.js                多序列 union / 对齐
│   │   ├── nav-statistics.js / nav-range-stats.js   统计与区间统计
│   │   └── calc-defaults.js            费率默认值
│   ├── pages/
│   │   ├── calc/                       #/calc 费率计算 (卡片 / 图表 / 交叉点 / 导入)
│   │   ├── list/                       #/list 缓存基金列表
│   │   ├── index-picker/               #/index 按指数选基金
│   │   ├── nav/                        #/nav 多基金/指数 NAV 比较 + 指标
│   │   └── stats/                      #/stats 三维统计聚合
│   ├── components/                     可复用 UI (typeahead / 详情表 / 阶段收益图)
│   └── utils/                          dom / format / color / search 工具
│
├── css/                                深色主题样式
│
├── data/
│   ├── fundcal.db                      ★ SQLite 主真相源 (fund_basic / fund_meta /
│   │                                     fund_nav / fund_fee_segments / fund_stage_returns /
│   │                                     index_basic / index_daily / sync_log)
│   ├── allfund/                        小静态分片 (灾备 / 纯静态站点)
│   │   ├── search-index.json           搜索索引 (code / name / 拼音首字母, 3.2 MB)
│   │   ├── feeder-index.json           联接基金 / 母基金索引 (624 KB)
│   │   ├── fund-stats.json             三维统计聚合 (1.6 MB)
│   │   ├── index-search-index.json     指数搜索池 (1.3 KB)
│   │   ├── overseas-codes.json         中港互认基金代码 (2 KB)
│   │   ├── feeder-master-overrides.json  联接名覆盖配置
│   │   └── trade-calendar.json         A 股交易日历 (95 KB)
│   └── funds/                          [空, 灾备] 旧 crawler JSON 中转, 现 crawler 直写 DB
│
│   注: 旧的胖产物 allfund.json (75 M) / list-index.json (26 M) /
│       fund-stats-detail.json (21 M) / funds/<code>.json (26k 个) 已下线 → archive/data-allfund/。
│       生产前端改走 /api/fund/list 与 /api/fund/stats/detail。
│
├── scripts/
│   ├── dev-server.js                   本地一键 (静态 3456 + API 3457)
│   ├── serve-fund-api.js               API 服务 (端口 3457, fund + nav 共 1 进程)
│   ├── fund-api.js                     /api/fund/* 路由 (list / codes / search-index /
│   │                                   stats / stats/detail / {code} / {code}/crawl)
│   ├── crawl-fund-fee.js               爬虫: 单只费率 / 费用 / 业绩 (直写 DB)
│   ├── crawl-all-fund-fee.js           爬虫: 全量
│   ├── build-allfund-from-db.js        DB → data/allfund/* 静态分片 + 索引
│   ├── build-feeder-index.js           构建联接基金索引
│   ├── build-fund-stats.js             构建三维统计聚合
│   ├── build-trade-calendar.js         构建交易日历
│   ├── migrate-crawler-to-db.js        [灾备] 从历史 data/funds/*.json 重建 DB
│   ├── aliyun-deploy.sh / deploy.sh    服务器部署
│   └── nav/
│       ├── db.js                       SQLite 连接 + schema (含幂等迁移)
│       ├── nav-api.js                  /api/nav/* 路由 (stats / compare /
│       │                               index-search-index / {code} + history + range)
│       ├── http-cache.js               max-age + ETag 304 短路
│       ├── tushare-client.js           Tushare API 客户端 (限流退避)
│       ├── sync-fund-basic.js          Tushare 基金清单
│       ├── sync-fund-nav.js            Tushare 基金净值 (增量)
│       ├── sync-fund-daily.js          [审计] 场内 nav, 默认不跑
│       ├── sync-trade-calendar.js      Tushare 交易日历
│       ├── sync-index-basic.js         Tushare 指数清单
│       ├── sync-index-daily.js         Tushare 指数日线
│       ├── crawl-em-index.js           东财指数日线 (港股 / 美股 / 全收益)
│       ├── crawl-eastmoney-nav.js      东财基金净值 (兜底 / 补全)
│       ├── import-custom-index.js      导入自定义指数
│       ├── link-fund-to-index.js       基金 ↔ 跟踪指数关联
│       ├── apply-merge-rules.js        字段裁决 (crawler 优先矩阵)
│       ├── parse-share-class.js        从 name 解析份额类别
│       ├── cleanup-redundant-of.js     清理 .OF 冗余 nav 行
│       ├── fix-empty-status.js         status 推断
│       ├── health-check.js             10 项数据健康体检
│       ├── replay-failed-syncs.js      重放 sync_log 失败任务
│       └── query-nav.js                净值查询 CLI
│
├── archive/
│   ├── scripts/                        已弃脚本 (upload-kv / build-allfund 旧 / build-search-index / check-allfund)
│   ├── docs/                           已弃部署文档 (DEPLOY-ORACLE / cloudflare-migration)
│   └── data-allfund/                   历史胖产物 (allfund.json 75M, funds/<code>.json 26k 个)
├── docs/
│   ├── data-flow.md                    数据流 + 字段裁决矩阵 + schema
│   ├── DEPLOY.md                       PC dev + CF Tunnel 部署
│   ├── audit-data-flow.md              数据流审计 (P0 已修历史记录)
│   └── decisions/                      ADR 决策日志 (重大技术决策)
├── start.bat / start.sh                一键启动
└── package.json
```

---

## 数据流：双源 → 合并 → 使用

详细文档请参阅 [docs/data-flow.md](docs/data-flow.md)。

```
Tushare API ──→ sync-fund-basic / sync-fund-nav ──┐
                                                   v
                                          ┌────────────────┐
天天基金 / 东财 ──→ crawl-fund-fee ──────→│ fundcal.db     │
                  (直写 DB)                │ (主真相源)     │
                                          └────────┬───────┘
                                                   │
                                          apply-merge-rules
                                          (按裁决矩阵合并)
                                                   │
                                                   v
                                          build-allfund-from-db
                                                   │
                                                   v
                                       data/allfund/* 静态分片
                                                   │
                                                   v
                                       前端 / API / Pages / Workers
```

### 字段裁决矩阵（摘要）

| 字段 | 主源 | 兜底 |
|---|---|---|
| name / fund_type / management / benchmark / found_date | crawler | tushare |
| status / market / custodian | tushare | — |
| 费率 / 业绩 / 跟踪标的 / 规模 | crawler | — |
| nav | tushare | — |

完整矩阵和 schema 见 [docs/data-flow.md §3](docs/data-flow.md)。

### 例行更新流程

```bash
# === 每周（基础信息 + 元数据 + 合并）===
npm run sync:fund-basic              # ① Tushare 清单
npm run crawl:all -- --force         # ② Crawler 元数据/费率/业绩（直写 DB）
npm run merge-rules                  # ③ 字段裁决合并
npm run health-check                 # ④ 体检

# === 每日（净值增量 + 静态资源）===
npm run sync:fund-nav -- --all       # ⑤ 净值增量
npm run replay-failed                # ⑥ 重放近期失败
npm run build-all                    # ⑦ 重建静态资源
```

### 单只爬取调试

```bash
node scripts/crawl-fund-fee.js 000001 110011                # 直写 DB
node scripts/crawl-fund-fee.js 000001 --keep-json           # 同时保留旧 JSON
```

### 体检与失败重放

```bash
npm run health-check -- --out data/health.md   # 输出 markdown 报告
npm run replay-failed -- --dry --limit 100     # 干跑前 100 个失败任务
npm run replay-failed                          # 实际重跑近 7 天失败
```

---

## API 接口

本地 API 服务 (`node scripts/serve-fund-api.js`, 默认端口 3457) 同时承载 `/api/fund/*` 与 `/api/nav/*` 两组路由。生产由 Nginx 反代 + 微缓存 + Cloudflare 边缘 ETag 304 短路。

### `/api/fund/*` (基金费率 / 元数据)

| 接口 | 说明 |
|---|---|
| `GET /api/fund/list?page=&size=&sort=&q=&fundType=&fundManager=&subscribe=&redeem=&floatingFee=&buyFeeMin=&buyFeeMax=&annualFeeMin=&annualFeeMax=&trackingTarget=` | **服务端分页列表** (新, 列表页用)。`sort` 取值见 [`scripts/list-query.js`](scripts/list-query.js) `SORT_EXPR` 白名单 |
| `GET /api/fund/list?fields=summary\|full` | 全量列表 (旧, 灾备 / 兼容旧调用) |
| `GET /api/fund/filter-options` | 全维度筛选 tag + 频次 (`fundType` / `fundManager` / `subscribe` / `redeem`) |
| `GET /api/fund/codes` | 基金代码列表 |
| `GET /api/fund/search-index` | 搜索索引 (code / name / 拼音首字母) |
| `GET /api/fund/stats` | 三维统计聚合 (按跟踪标的 / 基金公司 / 业绩基准) |
| `GET /api/fund/stats/detail?dim=&label=` | 单组明细 |
| `GET /api/fund/{code}` 或 `/{code}/fee` | 单基金完整结构 |
| `POST /api/fund/{code}/crawl` | 触发爬虫直写 DB (子进程 exitCode=0 即成功) |
| `GET /api/fund/all-codes` | 远程拉天天基金完整代码列表 (5 min cache) |

### `/api/nav/*` (净值 / 指数)

| 接口                                | 说明                                                  |
| --------------------------------- | --------------------------------------------------- |
| `GET /api/nav/stats`              | DB 整体统计                                         |
| `GET /api/nav/index-search-index` | 指数搜索池 (ts_code / name / fullname / isPrice)     |
| `GET /api/nav/{code}`             | 最新净值                                             |
| `GET /api/nav/{code}/history`     | 历史净值 (`?start=&end=&limit=`)                     |
| `GET /api/nav/{code}/range`       | 数据日期范围                                        |
| `GET /api/nav/compare?codes=...`  | 多基金 / 指数 NAV 比较 + 统计 + 指标 (见下)            |

### `/api/nav/compare` 协议

`codes` 参数支持混合形式:

- 6 位纯数字 (如 `000001`) → 场外基金, 后端走 `fund_nav` (拼 `.OF`)
- ts_code 形式 (如 `HSI.HI` / `NDX.GI` / `000300.SH`) → 指数, 后端走 `index_daily`

判别由 [`js/core/code-kind.js`](js/core/code-kind.js) `isFundCode` / `isIndexKey` 实现, 前后端共用同一套约定; 未识别 key 由调用方决定如何处理 (默认报错暴露上游 bug)。

查询参数:

- `start=YYYYMMDD&end=YYYYMMDD` (可选) — 日期窗口
- `interval=daily|weekly|monthly` (默认 daily) — 降采样, 周 / 月取窗口最后一个有值点
- `indicators=ma20,ma60,drawdown` (可选) — P1.D 指标, 解析见 [`js/domain/nav-stats.js`](js/domain/nav-stats.js) `parseIndicators`, 未知名静默丢弃
- 一次最多 20 只

返回 `{ codes, range:{start,end}, series:[{code,kind,name,dates,navs,adjNavs,...indicators}], stats:[{code,kind,name,...statsFields}] }`。基金 `adjNavs = adj_nav ?? unit_nav` (复权优先), 指数 `navs === adjNavs === close` (无复权概念)。统计基于 `adjNavs` 日收益率序列, 由 `computeStats` 给出年化波动率 / 最大回撤 / 累计收益等。

---

## 联接基金穿透

系统自动识别**名称或基金类型（fundType）**中含「联接」的基金（如「指数型-ETF联接」），构建联接基金 ↔ 母基金的关联索引；母基金 key 仍由名称中「联接」前半段解析，名称中无「联接」时不会入联接分组（避免误匹配）。

- **索引文件**：`data/allfund/feeder-index.json`
- **覆盖配置**：`data/allfund/feeder-master-overrides.json`（联接名与场内名不一致时使用）

---

## npm scripts 速查

### 开发 / 服务

| 命令                | 说明                                       |
| ----------------- | ---------------------------------------- |
| `npm run dev`     | 本地一键 (静态 3456 + API 3457)              |
| `npm run serve`   | 仅静态文件服务 (3456)                         |
| `npm run api`     | 仅 API 服务 (3457, fund + nav)              |
| `npm test`        | 跑全部 `*.test.js` 单测                       |

### 资源构建 (DB → 静态分片)

| 命令                              | 说明                                       |
| ------------------------------- | ---------------------------------------- |
| `npm run build-all`             | 全量构建 (allfund + feeder + stats + 交易日历)   |
| `npm run build-allfund`         | 单跑 `build-allfund-from-db.js` (产 search-index / list-index / single-fund 分片) |
| `npm run build-feeder-index`    | 联接基金索引                                |
| `npm run build-fund-stats`      | 三维统计聚合                                |
| `npm run build-trade-calendar`  | 交易日历                                  |

### 数据同步 (Tushare / 东财)

| 命令                              | 说明                                       |
| ------------------------------- | ---------------------------------------- |
| `npm run sync:fund-basic`       | Tushare 基金清单                            |
| `npm run sync:fund-nav`         | Tushare 基金净值 (增量)                      |
| `npm run sync:fund-daily`       | [审计] 场内 nav, 默认不跑                      |
| `npm run sync:trade-cal`        | Tushare 交易日历                            |
| `npm run sync:index-basic`      | Tushare 指数清单                            |
| `npm run sync:index-daily`      | Tushare 指数日线                            |
| `npm run crawl:em-index`        | 东财指数日线 (港股 / 美股 / 全收益)               |
| `npm run crawl:eastmoney-nav`   | 东财基金净值 (兜底 / 补全)                      |
| `npm run crawl:all`             | 爬虫全量基金费率 (直写 DB)                     |
| `npm run import:custom-index`   | 导入自定义指数                              |

### 数据治理

| 命令                       | 说明                                       |
| ------------------------ | ---------------------------------------- |
| `npm run merge-rules`    | 应用字段裁决矩阵 (crawler 优先)                |
| `npm run health-check`   | 10 项数据健康体检                            |
| `npm run replay-failed`  | 重放近期 `sync_log` 失败任务                  |
| `npm run query:nav`      | 净值 / 范围 CLI 查询                          |
| `npm run migrate:crawler`| [灾备] 从 `data/funds/*.json` 重建 DB         |

> 已归档脚本 (`build-allfund.js` / `build-search-index.js` / `check-allfund.js` / `upload-kv.js`) 移到了 `archive/scripts/`, `package.json` 里以 `__legacy_` 前缀保留占位。详见 [`docs/audit-data-flow.md`](docs/audit-data-flow.md)。


---

## 部署

当前模式: **PC dev + Cloudflare Tunnel** → [docs/DEPLOY.md](docs/DEPLOY.md)

历史方案 (Oracle Cloud / 阿里云 ECS / Workers+KV / D1+R2) 已归档至 [`archive/docs/`](archive/docs/), 不再维护。

## 相关文档

- [docs/data-flow.md](docs/data-flow.md) — 数据流 + 字段裁决矩阵 + schema
- [docs/audit-data-flow.md](docs/audit-data-flow.md) — 数据流审计 (P0 已修历史)
- [docs/decisions/](docs/decisions/) — ADR 决策日志

