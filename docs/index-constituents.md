# 指数完整成分权重

2026-09-28 起，默认主源为中证/国证官方完整权重下载，Wind 保留为独有指数和缺口来源。

[2026-09-29 Wind补数记录](audits/2026-09-29-wind-constituents.md)：13次新请求，新增8个指数、569条完整权重，明确权重期为2026-08-31；覆盖237/852。其余缺口与积分统计限制见记录。

[同日万得自编指数优先批次](audits/2026-09-29-wind-priority.md)：12次新请求，万得全A/可转债仍无有效权重；其余缺口新增8个指数、483条完整权重（2026-08-31），累计覆盖245/852。

[同日补数至积分不足](audits/2026-09-29-wind-credit-exhaust.md)：26次新请求（最后1次额度拒绝），新增20个指数、1205条完整权重（2026-08-31），累计覆盖265/852；消费红利及已缓存部分明细等待后续补数。

[2026-10-01定时补数](audits/2026-10-01-wind-constituents.md)：52次新请求（最后1次额度拒绝），新增51个指数、4932条完整权重（2026-08-31），包含补齐深证成指/500等权；累计覆盖316/852，下次从国企数字经济931529.CSI继续。

[2026-10-02定时补数](audits/2026-10-02-wind-constituents.md)：14次新请求，新增13个指数、1010条完整权重（2026-08-31），累计覆盖329/852。智选科创价值50（950228.SH）请求120秒超时，按服务故障规则停止；本次未确认积分用尽，保留该断点。

[2026-10-03定时补数](audits/2026-10-03-wind-constituents.md)：950228.SH单项探针再次120秒超时，停止当日后续请求，无新增；只读审计确认覆盖仍为329/852、缺口523，存量快照与权重未变。未确认积分用尽，保留断点和每日任务。

[2026-10-03 Tushare代理实测](audits/2026-10-03-tushare-constituents-assessment.md)：逐一测试523个缺口的2026年8月权重，407个返回数据；扣除1个名单差异及2个证券标识待核验项，得到404个候选、50,696条权重。HTTP/MCP均实取成功，发现代码大小写影响返回结果；候选尚需完整性校验及独立来源适配，本轮未导入，正式覆盖率不变。

[2026-10-03 Tushare正式导入及Wind续补](audits/2026-10-03-tushare-import-wind-retry.md)：上述404个候选补齐名称、验证分页终点后全部入库，新增50,696条权重，覆盖733/852、缺口119。Wind另发5次请求，未取得可入库快照，富时中国A50（830009.XI）120秒超时后停止，未确认积分耗尽。

[2026-10-03 余额确认后继续补数](audits/2026-10-03-wind-credit-281.md)：14次逻辑请求，新增5个完整指数、300条权重，覆盖738/852、缺口114。714032.MI明确返回网络服务不可用后停止，未确认积分耗尽；704843.MI已缓存300/411条有效片段。

[2026-10-04定时补数](audits/2026-10-04-wind-constituents.md)：10次逻辑请求，新增5个完整指数、310条权重，覆盖743/852、缺口109。两个MSCI片段定向补取后仍不完整；商飞产业995069.SSI返回网络服务不可用后停止，未确认积分耗尽。

[2026-10-05定时补数](audits/2026-10-05-wind-constituents.md)：24次逻辑请求，新增15个完整指数、1,226条权重，覆盖758/852、缺口94。SPHCMSHP.SPI和721638.MI分别缓存100/143、300/391条有效明细，待单次补页；718711LG.MI返回网络错误后停止，未确认积分耗尽。

[2026-10-06定时补数](audits/2026-10-06-wind-constituents.md)：SPHCMSHP.SPI单项尾页探针返回网络错误，立即停止，无新增。只读审计确认覆盖仍为758/852、缺口94，存量未变；已保留原请求、错误信封和全部缓存，未确认积分耗尽。

[2026-10-07定时补数](audits/2026-10-07-wind-constituents.md)：19次逻辑请求，新增16个完整指数、1,393条权重，覆盖774/852、缺口78；包含复用400条缓存后补齐的两个指数。h00009.SH缓存300/380条，h00038.SH返回网络错误后停止，未确认积分耗尽。

2026-09-29补充：[Parallels掘金SDK实测](gm-index-constituents.md)已证明部分指数可取完整日频权重；同时发现10份既有Wind快照的日期标签与实际权重期可能不一致，不能将其认作已核实的9月28日权重。详见该报告的日期疑点，当前覆盖报告按原标签排序仍有这一限制。没有核实到任何公开服务承诺匿名、不限频率、永久稳定；采用串行、缓存与断点续跑，避免依赖这种承诺。

## 来源核验

| 来源 | 已核实能力 | 限制及接入状态 |
| --- | --- | --- |
| [中证官方 XLS](https://oss-ch.csindex.com.cn/static/html/csindex/public/uploads/file/autofile/closeweight/000300closeweight.xls) | 匿名下载完整权重；沪深300 300条、科创50 50条、科创创业50 50条 | 已接入；探针文件真实日期2026-08-31，不能冒充9月28日数据 |
| [国证官方权重下载](https://www.cnindex.com.cn/sample-detail/download-history?indexcode=399006) | 创业板指完整100条，权重合计100.03%（公开舍入值） | 已接入股票文件；探针真实日期2026-08-31；网页版100个成分中只有前10个公开权重，不能用网页版替代 |
| [东财成分数据页](https://data.eastmoney.com/other/index/sz50.html) | 网页调用 `RPT_INDEX_TS_COMPONENT`，选择器含13个常见指数；沪深300/上证50/科创50探针全部权重非空、合计接近100% | 暂不导入：`MAXTRADEDATE` 是最新交易日，尚不能确认是权重生效日期；不能覆盖本库全部指数 |
| [东财量化接口](https://emt.18.cn/api/quant-help/data/indices.html) | `stk_get_index_constituents` | 需账户/Token；[官方FAQ](https://emt.18.cn/api/quant-help/faq/index.html)列明该接口5分钟1000次、24小时20000次，不是不限速 |
| [同花顺 SuperMind](https://quant.10jqka.com.cn/view/help/4?from=ifind) | `get_index_weight`；部分等权指数不返回权重 | 平台接口，未实测账户授权；另一个产品[iFinD的FAQ](https://quantapi.51ifind.com/gwstatic/static/ds_web/quantapi-web/help-center/faq.html)有账户/QPS限制，不可混为匿名公开接口 |
| [通达信量化平台](https://help.tdx.com.cn/quant/docs/markdown/mindoc-1hho7blr2j340/mindoc-1hhoaleti08f0/mindoc-1hhob9ldbiqak.html) | 文档提供 `get_index_weight` | 未实测；不能推断普通行情协议或[Mac后台 SDK](https://help.tdx.com.cn/quant/docs/markdown/mindoc-1hjbgqpdhv114.html)同样提供这一能力，后台 SDK 还涉及 Key |
| [Wind](wind-data-source.md) | 已接入完整成分及汇总验证 | 备用/独有指数单独调用；本轮因额度不足停止，原数据保留 |
| [Tushare index_weight](https://tushare.pro/document/2?doc_id=96) | 月度权重；用户指定代理已实测并导入404个缺口 | 以独立 `tushare` 来源存储；API完整结果与分页终点校验，保留真实日期与身份资料；本次未改为常规日更 |

东财公开接口（仅研究核验，未作为入库适配器）：

```text
https://datacenter-web.eastmoney.com/api/data/v1/get
reportName=RPT_INDEX_TS_COMPONENT
columns=ALL
filter=(TYPE="1")
pageNumber=1&pageSize=1000
sortColumns=SECURITY_CODE&sortTypes=1
```

TYPE=1/2/4 分别为沪深300、上证50、科创50。该接口的日期口径未确认前，只保存探针原文，不生成有确定日期的正式快照。

## 运行与存储

```bash
# 主源：默认仅已有行情或基金跟踪的指数，按库内发行机构路由
npm run sync:index-constituents -- --end 2026-09-28
npm run sync:index-constituents -- --end 2026-09-28 --resume
# 适配修复后重验已有不完整文件和未支持标的，不重抓已缓存原文件
npm run sync:index-constituents -- --end 2026-09-28 --resume --retry-incomplete
# 只读正式库、下载并验证文件，不建表、不写业务数据
npm run sync:index-constituents -- --end 2026-09-28 --codes 000300.SH,399006.SZ --dry-run
# 仅明确缺口/独有指数才用 Wind，不自动消耗额度
npm run sync:index-constituents-wind -- --end 2026-09-28 --codes 8841431.WI
npm run report:index-constituents
```

官方脚本使用独立 SQLite 连接，只迁移/写入 `index_constituent_snapshot` 与 `index_constituent_weight`。既有基金、净值、指数行情均不修改。官方 XLS/XLSX 使用[官方 SheetJS 0.20.3](https://docs.sheetjs.com/docs/getting-started/installation/nodejs/)解析，依赖地址与完整性在 package-lock 中固定；没有改动前端 SheetJS。

请求默认串行，下载间隔2秒，`--gap-ms 5000`可进一步降低频率（CLI允许500..60000毫秒）。这不是已获上游许可的频率；403/429须停止该来源，不能靠换域名、代理或身份规避。2026-09-28中证批次在188个范围结果后遇到403，随后原已成功的沪深300文件也返回相同拦截页，已停止中证下载；这是实际观察到的访问限制，不应称为“不限速接口”。独立的国证来源可单独处理。

私有原文件 `.bin`、URL/抓取时间/文件 SHA256 回执、运行状态位于 `data/wind/constituents/<截止日>-official/`（延续原忽略目录）。数据库存回执路径和 SHA256，回执再指向原文件 SHA256。截止日限制快照日期上限，不保证下载接口提供任意历史日期；文件晚于截止日则拒绝。缓存按截止日和来源代码保存、校验 hash 后复用，不在同一截止日静默刷新文件。官方状态与 Wind 状态分开，同代码集合续跑；dry-run 进度独立。两种写入脚本共用锁，HTTP 403/429、网络或服务故障会停下保存进度，不持续冲击接口。404/410记录缺口后继续。退出码0=范围全部通过、2=处理完仍有缺口、1=阻断。

每个指数/日期/来源独立事务、幂等导入；同源同日数据变化报冲突，不静默覆写。原 Wind 最新快照与较旧官方月末快照并存；覆盖报告先选最新真实日期，同日再选官方，旧官方数据不会压过新 Wind 数据。该选择目前用于报告，尚无成分 API/页面。用户已在Codex本会话设置北京时间每日16:00的缺口补数任务，2026-10-01首次续跑；每次补到Wind积分不足，全部完整权重补齐后停用。这是固定范围的断点补数，不是重抓已有快照的日更，也未安装仓库中的旧Linux调度配置。

`validation_basis` 是幂等迁移列，已有快照默认为 `provider_totals`；扩展API校验类型时事务重建快照父表，保留行、索引、触发器和子表引用：

- `provider_totals`：Wind 返回独立成分数量/权重总数，与完整明细核对。
- `official_full_file`：完整权重下载文件是全体样本，验证文件内全部行、无重复、每行权重有效、日期一致且合计距100%不超过0.1个百分点。中证逐行核验指数代码及交易所，国证以官方响应文件名核验所请求指数，仅接受明确的股票代码范围。`expected_count` 为文件行数；兼容旧schema的 `declared_weight_sum_pct` 保存文件计算总和，**此模式不是上游另行声明的汇总**。
- `api_full_result`：Tushare完整月度API结果，按准确代码、实际日期、证券身份、名称、权重和去重核验，再用同日 `offset=明细行数, limit=1` 空页确认接口结果已耗尽。代码仅转换大小写，不借用其他版本。计数与合计来自完整响应，不声称是独立提供方汇总；已知外部名单冲突仍拒绝。名称资料与权重分别保存来源，不能借名称资料改变权重日期。截止2026-10-03只完成本批入库及复用适配，尚未新增常规同步CLI。

不从不完整名单、前十大权重、ETF持仓推算，不将舍入后的权重归一化。非股票国证文件/未知交易所或证券代码暂拒绝；国证文件省略交易所时，旧4/8开头证券不能凭前缀认作北交所股票（也可能是新三板）。中证有明确交易所的港股数字代码补足5位，已有后缀须与交易所一致。不同收益版本按精确代码取数，不借用关联价格指数成分。某个指数有完整快照不代表所有历史日期都有完整权重。

首次 Wind 导入前有 SQLite 一致性全库备份 `data/wind/constituents/fundcal-before-20260928.db`；官方补数前另保存21个既有快照与4860行权重到 `before-official-20260928.json`。真实覆盖、剩余缺口以 `data/wind/constituents/coverage.json` 为准。
