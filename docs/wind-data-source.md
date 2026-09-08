# Wind 金融技能与指数数据源

核对日期：2026-09-08。

## 安装与当前状态

已在本项目安装官方的两个技能，供项目中的 agent 使用：

- [wind-find-finance-skill](../.agents/skills/wind-find-finance-skill/SKILL.md)：金融能力发现入口，不直接取数。
- [wind-mcp-skill](../.agents/skills/wind-mcp-skill/SKILL.md)：通过本地 Node CLI 调用 Wind 的七类 MCP 数据服务。

安装入口：[Wind Alice Market](https://aifinmarket.wind.com.cn/skill.md)。
上游：[Wind-Information-Co-Ltd/wind-skills](https://github.com/Wind-Information-Co-Ltd/wind-skills)。
首次安装提交：`91d5c152f121f568aec5ecacd71e090e10de982c`。
两个目录首次使用 Codex skill-installer 从该提交安装，没有全局安装或新增项目 npm 依赖。2026-09-08 实际取数后，上游更新器触发了项目重装并写入 `skills-lock.json`，删除了技能目录内的本地 Key 配置。项目现已在取数 CLI 和两个更新器入口默认禁用自动更新（仅显式 `WIND_SKILL_AUTO_UPDATE=1` 才启用）；这是对上游的本地修复，升级时须保留并先备份凭据。

首次安装时，Node.js v24.16.0 实跑了 `index_data.get_index_basicinfo`，查询万得全A的档案和关联收益指数代码。CLI 返回：

```json
{
  "ok": false,
  "code": "AUTH_ERROR",
  "message": "WIND_API_KEY 未配置（CLI 已完整检查：用户全局配置 > Skill 本地配置 > 环境变量）"
}
```

后续用户配置 Key 后，`get_index_basicinfo` 已成功返回沪深300档案，证明认证和该工具可用。但后台重装删除了 `.agents/skills/wind-mcp-skill/config.json`；第二次请求再次返回上述 `AUTH_ERROR`。目前等待在本机重新保存 Key；修复后的默认查询不再触发重装。

现状：**档案接口曾验证成功，指数日线与全收益历史尚未取回或导入**。现有 API 和日更流水线尚未接入 Wind。

## API Key

在 [Wind 开发者中心](https://aifinmarket.wind.com.cn/#/user/overview) 获取 Key。项目配置文件为 `.agents/skills/wind-mcp-skill/config.json`，JSON 格式：

```json
{"wind_api_key":"<在本机填写真实 Key>"}
```

该路径已加入 `.gitignore`，不应提交或放入前端。CLI 源码的实际读取顺序为：

1. `~/.wind-aifinmarket/config` 中的 `WIND_API_KEY`。
2. 本项目技能目录内的 `config.json`。
3. 进程环境变量 `WIND_API_KEY`。

入口网页与当前 CLI 对优先顺序的描述存在差异，以安装版本源码为准。CLI 不会自动加载项目根目录的 `.env`。已有全局 Key 时，它会优先于项目 Key。

静态服务的隐藏路径限制同时阻止 `.agents/` 访问；Git 忽略规则不替代 HTTP 访问控制。

## 股票、基金、指数能力

| 对象 | 官方契约明确列出的数据 | 主要工具 |
| --- | --- | --- |
| 个股（A股、港股、美股） | 最新行情、分钟线、多周期历史 K 线、公司档案、三大报表科目、财务比率、估值及历史分位、股本股东、分红及公司事件、技术与风险指标、条件选股 | `stock_data` 下的 `get_stock_*`、`get_risk_metrics`、`search_stocks` |
| 基金（含 ETF、LOF） | 产品档案、费率、经理、跟踪指数；单位/累计/复权净值；收益、排名、回撤、夏普、跟踪误差；规模与持有人；披露持仓、行业配置；报告期财务与分红；条件选基 | `fund_data` 下的 `get_fund_*`、`search_funds` |
| 场内基金 | 另支持最新成交行情、分钟行情、多周期 K 线、ETF/LOF 折溢价及 IOPV 等 | `get_fund_price_indicators`、`get_fund_quote`、`get_fund_kline`、`get_fund_performance` |
| 指数/板块 | 最新点位、分钟线、历史 K 线、档案与基日、发布机构、成份数量、关联全收益/净收益指数代码、加权 PE/PB/股息率等基本面、技术指标 | `index_data` 下的六个工具 |
| 财报原文 | 上市公司公告、年报、季报、招股书的文本检索 | `financial_docs.get_company_announcements` |

财报结构化科目通过 `get_stock_fundamentals` 查询；基金利润、收入、管理费/托管费支出和分红通过 `get_fund_financials` 查询。报告期费用金额与费率是不同字段，不能直接互换。

场外 `.OF` 基金的净值走 `get_fund_performance`，不走 ETF/LOF 行情 K 线。基金持仓随报告披露更新，不代表实时完整组合。指数档案工具明确不含成份明细与权重；不能因为 Wind 金融终端有这些功能，就宣称本 skill 的档案接口也直接支持。

其他服务包括债券档案/行情估值/发行人财务、财经新闻、宏观/行业/汇率 EDB 指标，以及跨标的聚合计算。各类数据的具体覆盖期、字段与账户权限仍须实测。

契约来源：[股票](../.agents/skills/wind-mcp-skill/references/stock.md)、[基金](../.agents/skills/wind-mcp-skill/references/fund.md)、[指数](../.agents/skills/wind-mcp-skill/references/index.md)、[公告](../.agents/skills/wind-mcp-skill/references/financial-docs.md)。

## 全收益指数与特色指数

**全收益指数有明确的查询路径**：`get_index_basicinfo` 明确支持取得关联的全收益、净收益指数代码；随后使用返回的标准代码调用 `get_index_kline` 获取序列。文档没有提供逐指数可用清单，所以历史点位是否可取、起始日期及账号权限需要配置 Key 后验证。

`aftype` 的前复权/后复权/不复权选项不是价格指数、全收益指数、净收益指数的选择器。必须核实目标序列自身的名称和收益口径，不通过修改复权参数或本地推算冒充官方全收益指数。

| 用户关注的指数 | 已核实的产品层面信息 | 本 skill 当前验证状态 |
| --- | --- | --- |
| 万得全A | Wind 官网明确介绍该自编宽基指数 | Key 需在自动重装修复后恢复；标准代码、档案、日线及关联收益版本待接口验证 |
| 万得微盘股 | 万得指数官网检索列出 `8841431.WI`；详情检索结果名称为“万得微盘股日频等权指数” | 官网名称与简称有差异，正式入库前以档案与编制方案确认，日线权限待验证 |
| 万得可转债等权 | Wind 编制方案列出此产品，并区分转债加权、转债等权、正股加权和正股等权 | 标准代码、当前版本、收益口径和日线权限待验证，不以其他转债等权指数替代 |

产品证据：[万得指数介绍](https://www.wind.com.cn/portal/zh/WindIndex/index.html)、[万得指数官方检索](https://www.windindices.com/indices/zh/Search)、[微盘指数详情](https://www.windindices.com/indices/zh/IndexF9/1a073179a3f0bebf923a0259cee963e4)、[Wind 可转债编制方案的第三方托管副本](https://www.scribd.com/document/901557921/万得可转债系列指数编制方案)。官网产品存在与 Alice Market 服务开放是两层事实。

## FundCal 使用约定

万得自编指数，以及用户明确指定使用 Wind 的其他指数，在研究、代码核验和口径核验时优先使用本项目 `wind-mcp-skill` 作为权威取数入口。基金现有 Tushare/东财字段裁决保持现行规则。

后续接入日更流水线前，按以下顺序推进：

1. 使用准确名称查询 `get_index_basicinfo`，核实标准 Wind 代码、发布机构、收益类型与关联代码。
2. 首只指数用一个短日期区间验证 `get_index_kline`，确认非空数据、日期范围、单位和返回结构，再逐只验证其他指数；认证、额度或服务错误时停止扩散请求。
3. 分开保存价格、全收益、净收益以及不同加权版本的身份。保留查询时间、请求区间、源代码和来源说明，避免串接不同口径序列。
4. 单独实现和验证 Wind 适配器、来源编号及注册映射，再接入日更。当前 `source=6` 是自定义导入，不能悄悄将其改称 Wind；现有 `index_daily` 每个代码/日期只存一行，也不具备多源并存与自动优先裁决能力。

技能安装本身不赋予公开再分发许可；若要把 Wind 数据纳入公网 API 或公共静态产物，须核对账号适用的数据使用范围。

调用参数须以安装目录下的领域契约为准。技能 CLI 从自身目录运行；自动执行器使用该目录 `scripts/request-<唯一后缀>.json` 传参，调用后清理。Key 配好后应先完成上述只读取数验证，再安排独立的数据接入批次。

## 补数前审计（2026-09-08）

只读审计正式库：12,468 条指数档案，159 条有日线，共 590,186 行；451 条指数有基金跟踪关系。补数前覆盖率保存在被忽略的 `data/wind/coverage-before.json`。已有行情指数中，103 条能在本地档案找到全称匹配的全收益候选（包含同一指数不同挂牌代码，不能视为 103 条独立收益指数）；候选在 `data/wind/total-return-candidates.json`，尚未确认或入库。

首批范围为已有行情的指数、万得全A/微盘股/可转债等权及对应全收益版本。不能把名称匹配候选直接认定为 Wind 关联映射。首次宽泛查询沪深300关联代码时，服务还返回了 100 条包含行业、策略、不同币种的同名相关指数，且 `cli_meta.completeness=not_asserted`。后续须精确查询关联字段或核验目标标准代码、全称、币种和收益口径，再获取日线。

本轮尚未写入任何指数数据，亦未修改公共搜索索引或原有基金跟踪关系。
