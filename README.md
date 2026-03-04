# 基金费率计算器

多基金费用对比工具，支持分段卖出费率、年化按日收取费用，并标注费用曲线交叉点。

#联接穿透费率计算功能（已废弃）

#todo：关联基金比较功能（数据已就绪）

#todo：REITS的年化费率计算方式

#todo：买入分段费率

#todo：临时隐藏曲线时的比较功能

## 功能

- **一次性费用**：买入费率、分段卖出费率（7/30/90/180/365/730/永久）
- **年化费用**：管理费+托管费+销售费，按日平均收取
- **多基金对比**：同一图表展示多条费用曲线
- **交叉点标注**：标出持有到某天数后「更划算」的基金发生变化的时间点，并显示该点累计费率及折算年化费率
- **API 扩展**：`js/api-adapter.js` 预留接口，可接入自动获取基金费率

## 使用

```bash
# 使用任意静态服务器（如 npx serve）
npx serve .

# 或 Python
python -m http.server 8080
```

然后访问 `http://localhost:3456`（或对应端口）。

## 费率输入说明

- **买入费率**：如 `0.1` 或 `0.1%` 表示 0.1%
- **年化费率**：管理费+托管费+销售费合计，如 `1.5%`
- **卖出费率**：按持有天数分段，天数越大费率通常越低

## 项目结构

```
FundCal/
├── index.html
├── css/style.css
├── js/
│   ├── app.js
│   ├── fee-calculator.js
│   └── api-adapter.js      # 优先读本地 /api/fund/:code/fee
├── data/
│   ├── funds/              # 本地费率缓存（爬虫写入）
│   │   ├── index.json      # 已缓存基金代码列表
│   │   └── 000001.json     # 单只基金费率
│   └── allfund/            # 聚合与索引（脚本生成）
│       ├── allfund.json    # 全量基金聚合（由 crawl-all-fund-fee + 聚合 得到）
│       ├── search-index.json   # 联想搜索索引（code/name/拼音首字母），build-search-index.js
│       ├── feeder-index.json   # 联接(feeder)/母基金(master)索引，build-feeder-index.js
│       ├── feeder-master-overrides.json # 可选：联接名与场内名不一致时 masterKey→母基金代码
│       └── overseas-codes.json  # 中港互认基金代码列表（可选）
├── scripts/
│   ├── crawl-fund-fee.js   # 爬虫：单只/多只费率
│   ├── crawl-all-fund-fee.js # 爬虫：全量基金费率
│   ├── build-allfund.js    # 聚合 data/funds 为 data/allfund/allfund.json
│   ├── build-search-index.js  # 生成 search-index.json，供页面联想补全
│   ├── build-feeder-index.js  # 生成 feeder-index.json，供联接穿透/关联基金比较
│   └── serve-fund-api.js   # 本地 API：/api/fund/:code/fee、/codes、/search-index、/feeder-index
└── README.md
```

## 本地费率缓存（爬虫 + 调用）

费率变动不频繁，可将数据抓取到本地再供计算器或后续接口使用。

### 1. 抓取并写入本地

数据来源：天天基金 / 东方财富 `fundf10.eastmoney.com/jjfl_<代码>.html`。

```bash
# 抓取单只或多只（6 位基金代码）
node scripts/crawl-fund-fee.js 000001 110011

# 拉取全部基金（并发抓取，默认 100 路并发）
node scripts/crawl-all-fund-fee.js
# 可选：--force 全量重抓；--concurrency=15 并发数；--delay=50 启动间隔(ms)；--retry=2 失败重试次数；--limit=N 仅抓前 N 只
node scripts/crawl-all-fund-fee.js --concurrency=15 --retry=2 --limit=10
```

- 写入目录：`data/funds/`
- 单只文件：`data/funds/<代码>.json`，包含：
  - `code`：基金代码
  - `name`：基金名称
  - `buyFee`：买入费率（最优惠折扣后）
  - `sellFeeSegments`：按持有天数分段的赎回费率（含无上限段）
  - `annualFee`：年化运作费用（管理费+托管费+销售服务费合计）
  - `tradingStatus`：申购 / 赎回状态
  - `operationFees`：管理费率、托管费率、销售服务费率及合计
  - `trackingTarget`：跟踪标的（指数基金等）
  - `fundManager`：基金管理人（基金公司）
  - `performanceBenchmark`：业绩比较基准
  - `source, updatedAt`：数据来源与抓取时间
- 索引：`data/funds/index.json` 记录已缓存代码与更新时间

### 2. 本地 API 供前端调用

```bash
# 默认端口 3457，可选：node scripts/serve-fund-api.js 3458
node scripts/serve-fund-api.js
```

- 接口：`GET http://localhost:3457/api/fund/:code/fee`
- 前端 `fetchFundFeeFromAPI(code)` 会请求同源或配置的该地址，拿到数据后通过 `transformApiDataToFundConfig` 转为计算器格式

### 3. 按代码加载（页面内拉取费率）

页面顶部提供「基金代码」输入框和「拉取费率」按钮，可从本地缓存拉取该基金的费率并新增为一张基金卡片。

**使用前请确保：**

1. 该基金已存在于 `data/allfund/allfund.json`（可由 `crawl-all-fund-fee.js` 全量抓取后生成，或先 `crawl-fund-fee.js` 抓取单只再运行 `build-allfund.js` 聚合）
2. 已启动本地 API：`node scripts/serve-fund-api.js`（默认端口 3457）。API 从 `data/allfund/allfund.json` 读取费率
3. 前端能访问该 API：页面默认请求 `http://localhost:3457/api/fund`。若 API 使用其他地址或端口，可在控制台设置 `window.FUND_FEE_API_BASE = 'http://localhost:端口/api/fund'` 覆盖

输入 6 位基金代码后点击「拉取费率」或回车即可添加该基金；未找到或网络错误时会在输入框旁提示。

### 4. 联接基金 / 母基金索引（用于穿透与关联比较）

命名：**联接基金** = feeder fund，**母基金**（场内 ETF/LOF 等）= master fund。

所有名称中含「联接」的基金视为联接基金 (feeder)。构建索引后可快速查找：**某基金对应的母基金 (master)** 以及 **同一母基金下的全部联接份额 (feederCodes)**。

```bash
# 依赖 data/allfund/allfund.json（先运行 crawl-all-fund-fee 并聚合生成 allfund.json）
npm run build-feeder-index
# 或：node scripts/build-feeder-index.js
```

- 输出：`data/allfund/feeder-index.json`
- 结构：
  - `feederByMasterKey`：按母基金名称 key（联接名前半段，如「华夏沪深300ETF」）索引，每项含 `masterCode`（母基金代码，若无则为 null）、`masterName`、`feederCodes`（该母基金下的全部联接基金代码）
  - `codeToFeeder`：按基金代码索引，每项含 `masterKey`、`isFeeder`、`masterCode`、`masterName`、`feederCodes`，便于由任意一只基金反查母基金与同组联接
- API：`GET http://localhost:3457/api/fund/feeder-index` 返回上述 JSON，供前端「联接基金费率穿透」与「关联基金比较」使用。

**场内名与联接名不一致时**：部分联接基金名称中的「联接」前半段与场内母基金名称不同（例如「工银上海金ETF联接」对应场内「工银瑞信黄金ETF」518660）。可在 `data/allfund/feeder-master-overrides.json` 中配置覆盖：`"overrides": { "`工`银上海金ETF": "518660" }`（key 为联接名前半段 masterKey，value 为母基金 6 位代码）。重新运行 `npm run build-feeder-index` 后生效。