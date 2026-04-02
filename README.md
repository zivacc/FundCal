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
│   ├── allfund/
│   │   ├── allfund.json           ★ 全量基金聚合（~49MB，已入库）
│   │   ├── search-index.json      搜索索引（code/name/拼音首字母）
│   │   ├── feeder-index.json      联接基金/母基金索引
│   │   ├── fund-stats.json        统计数据（按标的/公司/基准聚合）
│   │   ├── feeder-master-overrides.json  联接名覆盖配置
│   │   └── overseas-codes.json    中港互认基金代码
│   └── funds/                     ★ 单只基金缓存（26000+ 文件，不入库）
│       ├── index.json             已缓存代码列表
│       └── {code}.json            单只基金费率 JSON
│
├── scripts/
│   ├── dev-server.js              本地开发启动器（静态 + API 并行）
│   ├── serve-fund-api.js          API 服务（端口 3457）
│   ├── crawl-fund-fee.js          爬虫：单只/多只基金费率
│   ├── crawl-all-fund-fee.js      爬虫：全量基金费率
│   ├── build-allfund.js           聚合 data/funds/ → allfund.json
│   ├── build-search-index.js      生成 search-index.json
│   ├── build-feeder-index.js      生成 feeder-index.json
│   ├── build-fund-stats.js        生成 fund-stats.json
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

## 数据流：爬取 → 构建 → 使用

```
天天基金/东方财富网页
        ↓ crawl-fund-fee.js / crawl-all-fund-fee.js
  data/funds/{code}.json（单只基金费率）
        ↓ build-allfund.js
  data/allfund/allfund.json（全量聚合）
        ↓ build-search-index / build-feeder-index / build-fund-stats
  search-index.json / feeder-index.json / fund-stats.json（索引与统计）
        ↓
  前端页面 / API 服务 / GitHub Pages
```

### 爬取数据

```bash
# 单只/多只
node scripts/crawl-fund-fee.js 000001 110011

# 全量（~26000只，默认 100 路并发）
node scripts/crawl-all-fund-fee.js
# 可选参数：--force --concurrency=15 --delay=50 --retry=2 --limit=N
```

每只基金的缓存文件包含：代码、名称、买入费率、分段卖出费率、年化运作费率、申赎状态、跟踪标的、基金公司、业绩基准等。

### 构建索引

```bash
npm run build-all          # 一键构建所有索引

# 或分步执行：
node scripts/build-allfund.js         # 聚合 → allfund.json
npm run build-search-index            # 搜索索引
npm run build-feeder-index            # 联接基金索引
npm run build-fund-stats              # 统计数据
```

### 更新 GitHub Pages 数据

```bash
# 爬取 + 构建 + 推送
node scripts/crawl-all-fund-fee.js
node scripts/build-allfund.js
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
| `npm run build-all`          | 构建所有索引                   |
| `npm run build-search-index` | 构建搜索索引                   |
| `npm run build-feeder-index` | 构建联接基金索引                 |
| `npm run build-fund-stats`   | 构建统计数据                   |


---

## 部署指南

详见 [docs/DEPLOY.md](docs/DEPLOY.md)，涵盖：

- 本地开发配置
- 阿里云 ECS 部署（一键脚本 / 手动）
- GitHub Pages 部署
- Git 同步工作流
- 域名 + HTTPS 配置
- 故障排查

