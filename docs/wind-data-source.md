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

用户重新配置 Key 后，档案与日线接口均已成功实测，并已开始向项目正式库补入历史数据。取数不再触发重装。新增独立补数 CLI，尚未加入常规自动日更编排；实际批次状态以本机 `data/wind/sync-status.json` 为准。

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

**全收益指数已实际取得历史数据**：`get_index_basicinfo` 取得关联代码，再使用返回的标准代码调用 `get_index_kline`。例如沪深300全收益在本地保存为 `h00300.CSI`，按档案返回的 `H00300.CSI` 查询，取得 2004-12-31 至 2026-09-07 的 5,267 条日线。首次用小写代码的探针返回 5,255 行，与正式回执重叠点位一致，但缺少 2026 年 3 月的 12 个日期；正式导入采用档案返回的代码。不同版本可用起点不同，成功回执的 `cli_meta.completeness=not_asserted` 不能解释为所有交易日都完整。

`aftype` 的前复权/后复权/不复权选项不是价格指数、全收益指数、净收益指数的选择器。必须核实目标序列自身的名称和收益口径，不通过修改复权参数或本地推算冒充官方全收益指数。

| 用户关注的指数 | 已核实的标准代码 | Wind 档案返回的收益处理方式 |
| --- | --- | --- |
| 万得全A | `881001.WI`，万得全A指数 | 全收益指数；关联全收益代码为自身 |
| 万得微盘股 | `8841431.WI`，万得微盘股日频等权指数 | 全收益指数；关联全收益代码为自身 |
| 万得可转债等权 | `889033.WI`，万得可转债等权指数 | 全价指数；档案未返回全收益关联代码 |

产品证据：[万得指数介绍](https://www.wind.com.cn/portal/zh/WindIndex/index.html)、[万得指数官方检索](https://www.windindices.com/indices/zh/Search)、[微盘指数详情](https://www.windindices.com/indices/zh/IndexF9/1a073179a3f0bebf923a0259cee963e4)、[Wind 可转债编制方案的第三方托管副本](https://www.scribd.com/document/901557921/万得可转债系列指数编制方案)。官网产品存在与 Alice Market 服务开放是两层事实。

## FundCal 使用约定

万得自编指数，以及用户明确指定使用 Wind 的其他指数，在研究、代码核验和口径核验时优先使用本项目 `wind-mcp-skill` 作为权威取数入口。基金现有 Tushare/东财字段裁决保持现行规则。

已实现的独立数据操作：

```bash
npm run sync:index-wind -- --end 2026-09-07 --discover-only  # 仅核验档案和关联
npm run sync:index-wind -- --end 2026-09-07                 # 补入缺失日线
npm run sync:index-wind -- --end 2026-09-07 --resume        # 续跑同一截止日
npm run report:index-returns                              # 读取 DB，输出基金缺口 JSON
npm run build-index-search                                # 仅重建公共指数搜索目录
```

范围为已有日线或基金跟踪关系的指数及上述三个 Wind 自编指数，排除黄金交易所等非指数标的。档案身份要求代码相同，且名称匹配本地全称或中文名称。全收益候选必须有 Wind 返回的明确关联与全收益口径，再核验同系列名称；兼容恒生“股息累计指数”和国证“R”等正式命名。单一关联但名称变更的版本另要求发布机构、基期一致，且不能新引入不同币种；多个关联仍严格区分币种及范围，不能把沪深300普通加权版本配给等权指数。`index_return_links` 保存关联及核验时间；API 与静态目录共用构建函数，仅向搜索暴露有日线的指数和可用全收益版本。前端区分价格、全收益、净收益、全价。

`index_daily.source=4` 标记 Wind 新行；`source=6` 仍为自定义导入。日线按代码/日期补缺，原有来源和已有观测不覆盖。先比较重叠日期：任何点位相对偏差超过 0.1% 时整条序列不拼接，记录冲突。此阈值只是防止明显错配，不代表认定不同来源历史口径完全一致。缺收盘价的日期保留为空缺，记录排除数量，不填零或插值；重复日期、非法值和越界日期仍拒绝导入。成交量未声明单位时不导入；成交额只在回执声明为元时导入，日期保留提供方交易日，不做时区换日。

原始成功回执按请求散列缓存，包含查询参数、取数时间、原始单位和返回体，保存在被忽略的 `data/wind/raw/`。同一历史请求复用快照，`--resume` 跳过已处理结果；它不是历史修订检查器，也不重试已标记为空、实体不可用或冲突的结果。解析规则修正后可用 `--resume --retry-invalid` 从回执重新验证此前被判定为非法的结果。服务临时不可用时暂停，20 秒后只重试原请求一次，再失败则终止，不切换服务规避。认证或额度错误直接终止。成功部分和已核验关联即使中断也保留。

基金缺口统计只包含有跟踪标的的场外 `.OF` 份额，每个份额一行。把“版本存在但没有日线”“档案待核验”“未返回关联代码”“同口径版本待确认”“基金跟踪关系未匹配”分开，**不能把这些类别统称为指数公司没有全收益产品**。覆盖只表示至少有一条日线，须同时查看每个版本实际起止日。

技能安装本身不赋予公开再分发许可；若要把 Wind 数据纳入公网 API 或公共静态产物，须核对账号适用的数据使用范围。

调用参数须以安装目录下的领域契约为准。技能 CLI 从自身目录运行；自动执行器使用该目录 `scripts/request-<唯一后缀>.json` 传参，调用后清理。

## 补数前审计（2026-09-08）

只读审计正式库：12,468 条指数档案，159 条有日线，共 590,186 行；451 条指数有基金跟踪关系。补数前覆盖率保存在被忽略的 `data/wind/coverage-before.json`。已有行情指数中，103 条能在本地档案找到全称匹配的全收益候选（包含同一指数不同挂牌代码，不能视为 103 条独立收益指数）；候选在 `data/wind/total-return-candidates.json`，尚未确认或入库。

首批范围为已有行情的指数、万得全A/微盘股/可转债等权及对应全收益版本。不能把名称匹配候选直接认定为 Wind 关联映射。首次宽泛查询沪深300关联代码时，服务还返回了 100 条包含行业、策略、不同币种的同名相关指数，且 `cli_meta.completeness=not_asserted`。后续须精确查询关联字段或核验目标标准代码、全称、币种和收益口径，再获取日线。

原有基金跟踪关系本轮不作自动名称重配；原始 590,186 行非 Wind 日线的 SHA256 指纹在 `data/wind/preexisting-daily-digest.json`，用于验证补缺操作没有更改既有观测。最终计数与各指数缺口见本机 `data/wind/fund-coverage-report.json`。

## 本轮结果（2026-09-08）

查询截止 2026-09-07，处理 857 个代码，810 个成功补入共 **2,436,384 行**；12 个标的不可用、13 个与已有点位冲突、21 个返回空表、1 个有重复日期。原有 590,186 行指纹不变。公共指数搜索从 159 条扩展至 831 条，常用全收益版本及三个 Wind 指数可在基准选择器使用。修正了旧选择器把 `932050.CSI`（浦东绿色50ESG）误标为中证全指的问题，改用已核验的 `h00985.CSI` 全收益版本。

万得全A与微盘股均覆盖 1999-12-30 至 2026-09-07，分别 6,467 / 6,466 行；万得可转债等权覆盖 2017-12-29 至 2026-09-07，共 2,107 行。

有跟踪标的的 6,344 个场外份额中，4,482 个已有关联全收益日线；1,862 个列入核验清单：已知版本缺日线 123、Wind 未返回代码 115、跟踪关系未匹配 1,503、非指数不适用 52、同口径待确认 4、档案待核验 65。该清单不等于“这些基金所跟踪的指数都没有全收益产品”。
