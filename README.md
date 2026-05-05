# 基金费率计算器 FundCal

多基金费率对比工具：输入或拉取基金费率，在同一张图上展示不同基金在各持有期限下的累计费用曲线，并自动标注交叉点。

**在线体验（完整）**：[https://fundcal.zivacc.cc.cd/](https://fundcal.zivacc.cc.cd/)
**在线体验（静态）**：[https://zivacc.github.io/FundCal/](https://zivacc.github.io/FundCal/)

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

### 方式一：在线使用

直接访问 [https://zivacc.github.io/FundCal/](https://zivacc.github.io/FundCal/)，所有功能均可用（读取仓库中的静态数据）。

### 方式二：本地运行

```bash
# Windows：双击 start.bat
# Mac/Linux：
chmod +x start.sh && ./start.sh
# 或：
npm run dev
```

浏览器访问 `http://localhost:3456`。

会同时启动静态文件服务（端口 3456）和 API 服务（端口 3457）。

---

## 三种部署模式

本项目设计为**同一份代码**适配三种环境，前端自动检测运行环境：


| 模式               | 数据来源                            | 适用场景        |
| ---------------- | ------------------------------- | ----------- |
| **本地开发**         | API 服务 `localhost:3457`         | 开发调试，实时爬取数据 |
| **服务器部署**        | Nginx 反代 `/api/fund` → Node API | 公网访问，PM2 常驻 |
| **GitHub Pages** | 仓库中的静态 JSON 文件                  | 免费托管，无需服务器  |


检测逻辑（`js/config.js` 可手动覆盖）：

- `localhost` / `127.0.0.1` → 调用本地 API
- `*.github.io` → 读取静态文件
- 其他域名 → 走 Nginx 反向代理

---

## 项目结构

```
FundCal/
│
├── index.html                     主页面：费率计算器
├── cached-funds.html              缓存基金列表页
├── cached-fund-stats.html         缓存基金统计页
│
├── js/
│   ├── config.js                  全局配置（API 地址覆盖）
│   ├── app.js                     主应用（卡片、图表、交叉点、存储）
│   ├── api-adapter.js             API 适配器（API 优先，静态文件回退）
│   ├── fee-calculator.js          费率计算核心（分段卖出、年化、交叉点）
│   ├── utils.js                   通用工具（颜色、格式化、弹窗）
│   ├── search-utils.js            搜索过滤与排序
│   ├── import-utils.js            导入解析（文本/CSV/Excel/.ziva）
│   ├── index-picker.js            按指数选择基金弹窗
│   ├── fund-cache-page.js         缓存基金列表页逻辑
│   └── fund-stats-page.js         缓存基金统计页逻辑
│
├── css/
│   └── style.css                  全局样式（深色主题）
│
├── data/
│   ├── fundcal.db                 ★ SQLite 主真相源（fund_basic / fund_meta /
│   │                                 fund_nav / fund_fee_segments /
│   │                                 fund_stage_returns / sync_log）
│   ├── allfund/                   静态构建产物（DB → JSON 分片，前端读取）
│   │   ├── allfund.json           全量基金聚合（由 build-allfund-from-db.js 生成）
│   │   ├── funds/{code}.json      单基金分片（按需加载）
│   │   ├── search-index.json      搜索索引（code/name/拼音首字母）
│   │   ├── feeder-index.json      联接基金/母基金索引
│   │   ├── list-index.json        列表页 subset
│   │   ├── fund-stats.json        统计数据（按标的/公司/基准聚合）
│   │   ├── feeder-master-overrides.json  联接名覆盖配置
│   │   └── overseas-codes.json    中港互认基金代码
│   ├── funds/                     [灾备] 旧 crawler JSON（已不再写入，留作审计/灾备）
│   ├── health-baseline.md         体检报告留档
│   └── merge-audit.json           字段裁决审计
│
├── scripts/
│   ├── dev-server.js              本地开发启动器（静态 + API 并行）
│   ├── serve-fund-api.js          API 服务（端口 3457）
│   ├── crawl-fund-fee.js          爬虫：单只基金费率（直写 DB）
│   ├── crawl-all-fund-fee.js      爬虫：全量基金费率（直写 DB）
│   ├── build-allfund-from-db.js   DB → 静态分片（替代 build-allfund.js）
│   ├── build-allfund.js           [已弃用] 旧版从 data/funds/ 聚合
│   ├── build-search-index.js      生成 search-index.json
│   ├── build-feeder-index.js      生成 feeder-index.json
│   ├── build-fund-stats.js        生成 fund-stats.json
│   ├── migrate-crawler-to-db.js   [灾备] 从历史 data/funds/*.json 重建 DB
│   ├── nav/
│   │   ├── db.js                  SQLite 连接 + schema + helper
│   │   ├── tushare-client.js      Tushare API 客户端（含限流退避）
│   │   ├── sync-fund-basic.js     拉 Tushare 基金清单
│   │   ├── sync-fund-nav.js       拉 Tushare 净值（增量）
│   │   ├── apply-merge-rules.js   字段裁决（crawler 优先矩阵）
│   │   ├── health-check.js        10 项数据健康体检
│   │   ├── replay-failed-syncs.js 重放 sync_log 中失败任务
│   │   └── query-nav.js           净值查询工具
│   └── deploy.sh                  服务器部署/更新脚本
│
├── nginx/
│   └── fundcal.conf               Nginx 配置模板（含 CORS）
│
├── .github/workflows/
│   └── deploy-pages.yml           GitHub Actions 自动部署 Pages
│
├── pics/
│   └── klogo.png                  网站图标
│
├── start.bat                      Windows 一键启动
├── start.sh                       Linux/Mac 一键启动
├── ecosystem.config.cjs           PM2 服务器配置
├── package.json                   项目依赖与脚本
└── .gitignore                     Git 忽略规则
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

### 更新 GitHub Pages 数据

```bash
npm run build-all
git add -A && git commit -m "更新基金数据" && git push
```

推送后 GitHub Actions 会自动部署，几分钟内生效。

---

## API 接口

本地 API 服务（`node scripts/serve-fund-api.js`，默认端口 3457）：


| 接口                           | 说明                 |
| ---------------------------- | ------------------ |
| `GET /api/fund/{code}/fee`   | 单只基金费率             |
| `GET /api/fund/codes`        | 已缓存基金代码列表          |
| `GET /api/fund/all-codes`    | 全市场基金代码（从天天基金实时拉取） |
| `GET /api/fund/search-index` | 搜索索引               |
| `GET /api/fund/feeder-index` | 联接基金/母基金索引         |
| `GET /api/fund/stats`        | 基金统计（按标的/公司/基准）    |


> GitHub Pages 模式下不需要 API 服务，前端直接读取仓库中的静态 JSON 文件。

---

## 联接基金穿透

系统自动识别**名称或基金类型（fundType）**中含「联接」的基金（如「指数型-ETF联接」），构建联接基金 ↔ 母基金的关联索引；母基金 key 仍由名称中「联接」前半段解析，名称中无「联接」时不会入联接分组（避免误匹配）。

- **索引文件**：`data/allfund/feeder-index.json`
- **覆盖配置**：`data/allfund/feeder-master-overrides.json`（联接名与场内名不一致时使用）

---

## npm scripts 速查


| 命令                           | 说明                       |
| ---------------------------- | ------------------------ |
| `npm run dev`                | 本地开发（静态 3456 + API 3457） |
| `npm run serve`              | 仅静态文件服务                  |
| `npm run api`                | 仅 API 服务                 |
| `npm run sync:fund-basic`    | 拉 Tushare 基金清单            |
| `npm run sync:fund-nav`      | 拉 Tushare 净值（增量）          |
| `npm run crawl:all`          | 爬虫全量（直写 DB）               |
| `npm run merge-rules`        | 应用字段裁决矩阵                  |
| `npm run health-check`       | 数据健康体检                    |
| `npm run replay-failed`      | 重放失败的同步任务                 |
| `npm run build-all`          | 构建所有索引（DB → 静态资源）         |
| `npm run build-allfund`      | 构建主聚合 + 单基金分片             |
| `npm run build-search-index` | 构建搜索索引                   |
| `npm run build-feeder-index` | 构建联接基金索引                 |
| `npm run build-fund-stats`   | 构建统计数据                   |


---

## 部署指南

**生产推荐**: 阿里云 ECS + Cloudflare 反代, 域名 `fc.ziva.cc.cd`。一键部署:
```bash
sudo bash scripts/aliyun-deploy.sh init       # 装环境 + 配 nginx + 启 PM2
sudo bash scripts/aliyun-deploy.sh seed-db /path/to/fundcal.db   # 导 DB
sudo bash scripts/aliyun-deploy.sh cron       # 装定时任务
```

详细文档:
- [docs/DEPLOY.md § 五](docs/DEPLOY.md#五阿里云-ecs--cloudflare-反代-推荐生产) — **阿里云 + CF (主推)**
- [docs/DEPLOY.md](docs/DEPLOY.md) — 全部部署方式 (本地 / GitHub Pages / Cloudflare Workers)
- [docs/data-flow.md](docs/data-flow.md) — 数据流程、合并矩阵、定时同步
- [docs/cloudflare-migration.md](docs/cloudflare-migration.md) — D1+R2 备选方案 (Free tier)

