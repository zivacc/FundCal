# AGENTS.md

本文件用于指导在 FundCal 仓库中的开发、审计和优化。最近核对日期：2026-09-08。架构事实以当前源码为准；历史审计记录和草案不代表已实现功能。

## 项目与工作范围

FundCal — 基金费率计算器：多基金费用对比、交叉点分析、基金列表、指数选基、净值/业绩比较、基金详情与晨星综合费率历史参考。

- 技术栈：Node.js ES modules、better-sqlite3、原生 JS 前端，无前端构建框架。
- 开发与验证基线为 **Node.js 24**，最近全量测试使用 v24.16.0。当前 better-sqlite3 12.9.0 不支持 Node.js 18；不要沿用旧的“18+”声明。切换运行时先核对锁文件、依赖 engines 和原生模块安装情况。
- 部署：本机静态服务 + API，经 Cloudflare Tunnel 提供公网访问。Oracle Cloud、阿里云 ECS、Workers/KV、D1/R2 等方案均为历史资料。
- **账本功能已全部移除**，私人数据库已迁出项目目录。没有账本页面或 API；不要因旧文档、旧缓存或归档内容而恢复相关功能、数据或测试。
- 按批次推进优化，保留现有原生 JS / Node / SQLite 主体。先复现问题，再修改、验证并独立提交；区分代码改动与全库抓取、导入、重建等数据操作。

主要文档：

- [README.md](README.md)：功能、项目结构与命令入口；部分历史说明仍待整理。
- [docs/data-flow.md](docs/data-flow.md)：双源数据、字段裁决和指数体系。
- [docs/wind-data-source.md](docs/wind-data-source.md)：项目级 Wind 技能、能力范围、认证状态及特色/全收益指数取数约定；尚未接入 DB 日更。
- [docs/DEPLOY.md](docs/DEPLOY.md)：当前启动、静态资源白名单和本机管理入口。
- [docs/optimization-progress.md](docs/optimization-progress.md)：已完成批次与待办，以此判断审计问题是否已处理。
- [docs/performance/search-loading.md](docs/performance/search-loading.md)：搜索加载链路、优化前后测量与限制。
- [docs/audits/2026-09-05/README.md](docs/audits/2026-09-05/README.md)：历史审计及原始证据，包含已删除功能和已修复问题。
- [docs/decisions/](docs/decisions/)：ADR；标有 DRAFT 的内容是候选方案。

## 常用命令

```bash
# 开发：默认只监听 127.0.0.1
npm run dev                     # 静态 3456 + API 3457
npm run serve                   # scripts/serve-static.js，静态白名单服务
npm run api                     # scripts/serve-fund-api.js，基金 + NAV API

# 测试：node --test，测试与实现并排
npm test                        # scripts/**/*.test.js + js/**/*.test.js
node --test scripts/list-query*.test.js scripts/list-search.test.js
node --test js/data/idb-cache.test.js scripts/search-index-cache.test.js
node --test --test-name-pattern='align' 'js/**/*.test.js'

# 数据流水线：这些命令会访问外部数据源和/或写入数据库
npm run sync:fund-basic
npm run sync:fund-nav -- --all
npm run crawl:all -- --force
npm run merge-rules
node scripts/nav/parse-share-class.js
npm run crawl:eastmoney-nav -- --missing
node scripts/nav/repair-fund-basics.js --run-dir data/repair-YYYYMMDD  # 补缺基础字段，随后 merge-rules
node scripts/nav/crawl-overseas-nav.js --run-dir data/repair-YYYYMMDD # 968 中港互认基金空缺 NAV
npm run sync:trade-cal
npm run sync:index-basic
npm run sync:index-daily
npm run sync:index-constituents -- --end YYYY-MM-DD  # 中证/国证官方完整权重文件，独立补数
npm run sync:index-constituents-wind -- --end YYYY-MM-DD --codes ... # Wind 独有与缺口补数
npm run report:index-constituents                   # 只读 DB，写本地覆盖报告
npm run crawl:em-index
npm run import:custom-index      # CSV 指数，source=6
npm run import:morningstar-fee   # 晨星 XLSX 历史快照，独立参考表
npm run replay-failed
npm run health-check

# DB → 明确的公共静态产物
npm run build-all               # allfund（含两类搜索索引）+ feeder-index + fund-stats + trade-calendar

# 无 Tushare 的批量补数编排，会抓取、裁决、构建并输出覆盖率报告
npm run refresh:public
npm run refresh:public -- --coverage-only  # 只读 DB，但会写覆盖率报告文件

# 本地 HTTP + 正式公共库只读 SQL 对照（需先启动 API）
node docs/performance/search-load.mjs
```

常规日更顺序：sync-fund-nav → replay-failed → crawl-eastmoney-nav --missing → build-all → health-check。基础信息/费率更新后还需执行字段裁决与份额解析，再构建。

基础字段补缺可用 `repair-fund-basics.js`（`--resume --retry-empty` 重试空结果），只写缺失字段的 crawler 影子，不刷新费率、全量抓取时间或 source 标记；再由 `apply-merge-rules` 裁决。`968` 基金从海外基本资料页取公司/类型/成立日期。`crawl-overseas-nav.js` 按页面核验标准代码与内部代码后从 MethodJZ 专用接口补空缺，`--resume` 续跑；实际验证该海外接口支持 1000 行/页，不适用于境内 lsjz。保存原始单位/累计净值，未提供复权时 `adj_nav=NULL`，原币种不换算，缺币种记录在审计中计数，不能宣称为全收益序列。说明及本轮剩余缺口见 [2026-09-11 补数报告](docs/audits/2026-09-11-fund-data-repair.md)。

[scripts/cron/fundcal-cron](scripts/cron/fundcal-cron) 仍包含 Linux `/var/www/fundcal` 路径和旧调度参数，**不是已确认安装的本机调度配置**；其中定时抓取缺少 `--force`、参数形式及失败可见性仍有审计待办，不要直接照搬安装。各 CLI 的参数格式并不统一，调用前核对解析代码。

`refresh:public` 有锁文件与阶段状态，会并行更新费率/指数，再裁决、解析份额、补基金 NAV、构建和检查；其东财 NAV 使用 `--all --resume`，范围大于常规 `--missing` 兜底。状态和覆盖率报告在 `data/public-refresh-*`，存在缺口时可能以非零状态退出，需结合报告判断。

## 部署与访问边界

- [scripts/dev-server.js](scripts/dev-server.js) 用 `process.execPath` 启动两个 Node 子进程，无 shell 包装；`STATIC_PORT` / `API_PORT` 可调整一键启动的端口。前端 localhost API 默认仍是 3457，改 API 端口时需同步配置。
- [scripts/serve-static.js](scripts/serve-static.js) 仅接受 GET/HEAD，支持 ETag/304；公开 index.html、符合规则的前端 JS/CSS、指定 vendor/图标、公共索引 JSON、单基金分片及私募代码映射。拒绝目录浏览、隐藏路径、测试文件、路径穿越和指向非公开文件的符号链接。
- **不要恢复 `serve .` 或以仓库根目录无差别对外服务**。新增公共资源或升级 vendor 文件名时核对 `isPublicPath()`，按需扩展白名单并验证实际资源可访问。`.gitignore` 不承担 HTTP 访问控制。
- 两个服务默认绑定 `127.0.0.1`。Tunnel origin 使用本机静态/API 端口；实际边缘认证、缓存和 ingress 配置不在本次本地验证范围内。
- 公共 API 的 CORS 允许跨域读取，**CORS 不是管理鉴权**。`POST /api/fund/{code}/crawl` 经 [scripts/local-access.js](scripts/local-access.js) 校验 loopback、Host、Origin、Fetch Metadata 和代理头；Tunnel/外站请求返回 403。补数使用本机页面或 CLI。
- [scripts/crawl-jobs.js](scripts/crawl-jobs.js)：同代码共享一次执行结果，最多 2 个不同代码并发，超限 429；60 秒超时终止并在必要时强制结束，限制输出并释放任务槽。CLI 批量抓取不经过这个 HTTP 并发限制。
- 数据库及 WAL/SHM、晨星原始 XLSX、日志、环境变量和本地状态不属于发布资源或代码提交内容；保留相应忽略规则。

## 数据架构：双源 + 字段裁决 + 静态构建

```text
Tushare → sync-fund-basic → fund_basic 独占字段 + fund_meta._tushare 影子
        → sync-fund-nav   → fund_nav (source=1)
天天基金 → crawl-fund-fee → fund_meta / _crawler 影子 + 费率分段 + 阶段业绩
         → lsjz 抓取     → fund_nav (source=2)
指数源   → sync-index-basic/daily、crawl-em-index、custom CSV
                        → index_basic / index_daily / index_source_map
晨星 XLSX → import-morningstar-fee → morningstar_* 独立历史参考表

重叠基础字段 → apply-merge-rules → fund_basic 权威字段
DB → build-allfund-from-db 等构建脚本 → data/allfund/* 公共分片
前端 → API 优先；指定静态索引直接读取，单基金静态分片承担灾备
```

### 字段裁决与来源约束

万得自编指数及用户指定的 Wind 指数，研究取数、标准代码和收益口径核验优先使用本项目 `.agents/skills/wind-mcp-skill/SKILL.md`。档案接口已验证成功，但上游后台重装曾删除项目 Key；项目现已默认禁用 Wind 技能自动更新，升级时保留此修复并备份凭据。恢复配置后先短区间验证，再独立推进 DB 适配。不得把技能安装视为已完成数据源接入，也不得把 K 线复权选项视为全收益指数口径。详见 [Wind 数据源说明](docs/wind-data-source.md)。

| 字段 | 主源 | 兜底 |
|---|---|---|
| name / fund_type / management / benchmark / found_date | crawler | tushare |
| status / market / custodian | tushare | 唯一源 |
| 费率 / 分段 / 业绩 / 跟踪标的 / 规模 | crawler | 唯一源 |
| NAV | 常规先 Tushare，再东财补缺 | 逐行 source 标记 |

- `sync-fund-basic.js` 不覆写已有基金的重叠字段，只更新 status/market/custodian 等独占信息；新基金 INSERT 全字段作初值。不要改回全字段 `INSERT OR REPLACE`，也不要绕过 `apply-merge-rules`。
- 基金业务只服务场外 `.OF`。六位代码可能有多市场行，使用 `codeToTsCode` / `codesToTsCodes` 的 `.OF` 优先规则；部分旧读写路径仍有审计待办，不能假设所有 SQL 已统一。指数代码如 `000300.SH` 不受此基金 NAV 限制。
- `fund_nav.source`：1=tushare、2=eastmoney；`index_daily.source` 另有 3=csindex、4=wind、6=custom。Wind 使用 `sync:index-wind -- --end YYYY-MM-DD` 独立补缺，不覆写已有行；`--resume` 续跑同一截止日。收益版本关联在 `index_return_links`，详见 [docs/wind-data-source.md](docs/wind-data-source.md)。不要根据某次样本一致就假设多源历史数据始终相同；来源优先级、水位和历史修订仍待完善。
- 爬虫直接写 DB，不再依赖 `data/funds/<code>.json` 中转；`--keep-json` 仅用于保留单次灾备输出。

### Schema 与晨星参考数据

主要定义位于 [scripts/nav/db.js](scripts/nav/db.js)：

| 表 | 主键 / 用途 |
|---|---|
| fund_basic | ts_code；裁决后的基础信息 |
| fund_meta | ts_code；crawler 字段、双源影子、份额类别 |
| fund_nav | ts_code + end_date；净值和 source |
| fund_fee_segments | ts_code + kind + seq；分段费率 |
| fund_stage_returns | ts_code + period；阶段业绩 |
| trade_calendar | cal_date；交易日历 |
| sync_log | id；同步审计和失败重放 |
| index_basic / index_source_map | ts_code / ts_code + source；指数信息与多源代码映射 |
| index_daily / index_fund_tracker | ts_code + end_date / index_ts_code + fund_ts_code；指数行情和跟踪关系 |
| index_return_links | index_ts_code + return_ts_code；Wind 核验的全收益版本关联及时间 |
| index_constituent_snapshot | id；指数 + 日期 + 来源唯一，完整快照及回执校验信息 |
| index_constituent_weight | snapshot_id + constituent_code；完整成分权重，weight_pct 为百分数 |
| morningstar_fee_snapshot | as_of_date；源文件、SHA256 和导入统计 |
| morningstar_fund_fee | as_of_date + code；各期综合费率、排名及参考指标 |

`getDb()` 会初始化 schema，并调用 `ensureTushareShadowColumns()`、`ensureNavSourceColumn()`。新增列应补幂等迁移并接入初始化；**当前 `share_class` 仍由 `scripts/nav/parse-share-class.js` 添加/填充**，不能把正式库已有列当作空库也一定具备。空库构建问题尚未全部解决。

指数成分权重由 `scripts/nav/index-constituents.js` 幂等建表/迁移，默认使用中证/国证官方完整文件，Wind `analytics_data.get_financial_data` 为独有指数和缺口补充（单独命令，不自动耗用额度）。Tushare月度权重已通过 `scripts/nav/tushare-index-constituents.js` 完成本批适配及导入，尚未新增常规同步CLI。只写入日期、代码身份、全部权重及合计通过校验的完整快照，缺权重不能按等权或ETF持仓推算。`validation_basis` 区分 Wind `provider_totals`、官方 `official_full_file` 和 Tushare `api_full_result`；后者以完整响应及分页终点验证，计数/合计来自响应本身，不冒充独立汇总，已知名单冲突拒绝。扩展此列CHECK的迁移须在外层事务之外调用，会在内部事务重建快照父表并保留子表、索引和触发器。详见 [成分数据说明](docs/index-constituents.md)。不同收益版本不自动复用；同日期同来源已有快照冲突时停止审核，跨来源独立保存。最新日期优先，同日期官方、Tushare、Wind依次优先。私有回执、备份、锁和进度继续在 `data/wind/constituents/`；`--resume` 续跑，Wind 的 `--retry-incomplete` 重验不完整结果，仍复用相同请求缓存。覆盖率以 `report:index-constituents` 为准，尚未加入日更或前端/API。

晨星导入通过系统 `unzip` 读取 XLSX，原始文件在被忽略的 `data/morningstar_full_fund_fee/`。晨星表不写入 fund_basic/fund_meta，也不参与字段裁决；`*_pct` 使用百分数单位，现行费用计算中的 rate 使用小数比例，展示/换算时勿混用。

## API 与搜索数据流

[scripts/serve-fund-api.js](scripts/serve-fund-api.js) 提供 `createApiServer()`，默认 CLI 端口 3457；模块导入不启动监听，测试可注入路由。

- `/api/fund/list`：当前以 `page / q / sort` 的真值切换分页路径，返回 `{total,page,size,rows}`；否则走旧全量数组路径。调用方始终传 `page`，仅传 size/filter 不能保证分页。
- `/api/fund/filter-options`：筛选标签与频次，经共享 IndexedDB 缓存，默认等待过期校验。
- `/api/fund/{code}`、`/{code}/fee`、`/{code}/morningstar`：单只信息、费用及晨星历史。
- `/api/fund/search-index`、`codes`、`stats`、`stats/detail`：搜索索引、代码与聚合查询。
- `/api/nav/{code}`、`/{code}/history`、`/{code}/range`、`/api/nav/compare`：净值与比较；compare 可混合基金六位代码与指数完整代码。
- `/api/nav/index-search-index`：指数搜索索引。不要写成 `/api/index-search-index`。
- 联接基金索引直接读取 `data/allfund/feeder-index.json`，没有 `/api/fund/feeder-index` 端点。

查询参数统一使用 [scripts/http-query.js](scripts/http-query.js)，正确处理中文、`+` 和值内 `=`；非法百分号/UTF-8 编码在分派前返回 400。顶层等待路由并捕获未被业务路由处理的异常，此类错误返回不含异常详情的 500。不要再引入手写 query split/decode；各业务参数的范围校验仍需分别处理。

### 搜索与缓存约定

- **联想搜索**：计算器、基金详情、净值比较通过共享数据层取得索引，在浏览器本地匹配；净值页并行加载基金与指数池。主要搜索框支持聚焦预加载。
- **列表搜索**：浏览器只持有当前页，服务端用共享 [js/utils/search.js](js/utils/search.js) 匹配代码，再 SQL 筛选/排序/分页。不要为列表首屏恢复全量基金下载。
- 搜索规则、规范化、相关度、拼音与指数别名都集中在 `js/utils/search.js`。prepared 缓存按条目对象保存，条目应视为不可变；空查询直接返回，不遍历全池。
- [js/data/idb-cache.js](js/data/idb-cache.js) 的记录为 `{key,body,etag,savedAt}`，对外返回 `{data,source}`；内存与 IDB 必须使用同一字段契约。
- 默认 freshness 为 5 分钟。只有显式设置 `staleWhileRevalidate: true` 的请求先返回过期副本并后台校验，目前基金/指数搜索启用；其他请求默认等待校验。SWR 年龄上限默认 7 天，网络失败仍可读旧缓存，不等于严格的离线过期删除策略。
- 不要再用页面永久数组缓存或失败后的空数组阻止共享缓存更新；净值合并池只在底层数组引用变化时重建。后台索引更新在下次搜索时生效。
- [scripts/search-index-cache.js](scripts/search-index-cache.js) 按 DB 连接缓存索引、JSON、ETag 和 gzip。通过 `PRAGMA data_version` + `total_changes()` 失效，CLI 服务启动时预热；304 复用响应，不重新查询全量索引、序列化和压缩。当前无关 DB 写入也会触发失效，这是已知的保守策略。
- [scripts/list-query.js](scripts/list-query.js) 从 `json_each(?)` 匹配集合 `CROSS JOIN fund_meta`，显式使用 `idx_fund_meta_code`。该索引是查询契约的一部分，测试库也要建立；修改执行计划时覆盖 source 筛选，避免回退为逐个匹配代码扫描来源集合。
- 新增排序字段时同时更新 `SORT_EXPR` 和前端 `parseSortValue` 的白名单/keyMap。保持相关度顺序、去重、计数、分页与筛选一致。

服务端分页决策见 [ADR 0001](docs/decisions/0001-server-side-pagination-not-duckdb.md)。性能数据见搜索分析报告，区分首次/重复请求、HTTP/SQL/浏览器渲染；本机微基准不能直接等同公网体验。

## 前端结构

- 单一 index.html，hash SPA，6 个页面懒加载，映射见 [js/core/router.js](js/core/router.js)：`calc → pages/calc`、`list → pages/list`、`index → pages/index-picker`、`nav → pages/nav`、`stats → pages/stats`、`fund → pages/fund-detail`。
- 新增页面时更新 ROUTES、index.html 的容器/tab，并验证模块、样式和资源符合静态白名单。
- `js/core/`：配置、路由、主题；`data/`：API、缓存、交易日历；`domain/`：费用和净值计算；`pages/`：页面；`components/`：共享组件；`utils/`：搜索和通用工具。
- `getFeeApiBase()` 支持 `window.FUND_FEE_API_BASE` 手动覆盖；localhost/127.0.0.1 默认连 `http://localhost:3457/api/fund`，普通域名同源 `/api/fund`，GitHub Pages 使用静态回退。NAV base 到 `/api` 层，端点再拼 `/nav/...`。
- 列表每次状态变化发起分页请求，用 AbortController 防竞态。`selectedCompare` 为 `Map<code,name>`；`js/pages/list/selection.js` 管理单击单选、Ctrl/⌘ 切换、Shift 本页区间及 Ctrl/⌘＋Shift 追加区间，触屏/键盘保留逐只切换。已选引用跨页保留，新结果页重置区间起点，待补全行不参与选择。选择变化同步篮子与比较按钮；外置 Playwright 回归入口为 `docs/performance/list-selection-check.mjs`。筛选标签来自 filter-options，基金公司默认 top-50 + 本地筛选。
- 全局基金篮子由 `js/components/fund-basket.js` 管理 UI/Pointer Events，`js/core/fund-transfer.js` 注册页面选中项和接收器，`js/data/basket-store.js` 保存公开基金 `{code,name}` 引用。新增基金列表需提供拖动属性/把手与选中项来源；接收页面应先准备全部数据再应用，保留基准与去重规则。页面→篮子只显示篮子接收区，单只基金还高亮“基金详情”顶栏，拖入直接按代码跳转。接收圈直径 260px，绘制和命中统一由 `js/core/fund-drop.js` 管理。篮子→计算器/NAV 的添加/替换遮罩位于篮子浮窗下方；详情页单只直接打开，多只按落点从独立列表选一只，长列表支持拖动边缘滚动。详见 [docs/fund-basket.md](docs/fund-basket.md)。
- 计算器卡片舞台在 `js/pages/calc/card-deck.js`，样式 `css/pages/_calc-deck.css`；采用弧形 3D 轨道，支持鼠标/触屏横向拖动、滚轮及键盘；窄屏中心卡片可编辑，宽屏按可用宽度将多张前排卡片正面平铺并允许编辑，后排点击前移，篮子拖动从独立把手开始。布局计算在 `js/pages/calc/deck-layout.js`；金银色材质与主题背景协调，光标驱动舞台统一光源、卡片反射及阴影，减少动态效果时固定光源。晨星隐性费率通过 `js/data/morningstar-api.js` 读取已有历史 API，最多 4 个并发、5 分钟缓存。`js/domain/implicit-fee.js` 管理百分数→小数及自动计入规则；有效隐性费率自动加入年化，旧 includeImplicitFee=false 不再阻止计入。缺失显示 —，不能直接把晨星综合费率叠加到现行年化费率。快照保存所选晨星日期/数值，不静默替换已保存参考。
- 计算器费用图使用独立尺寸的 canvas 父容器，外层按内容自然增高；仅通过命名容器查询切换基金列表位置，不再给整个图表面板设固定视口高度。`js/pages/calc/chart-layout.js` 管理色带与实际坐标轴对齐、密集标签避让和缩放后的指针坐标。普通曲线/交叉点共用一个可滚动信息窗，避免两套悬浮层抢占指针；触屏点击保留信息，图外点击/页面滚动/切页/重排清除。可选浏览器回归见 `docs/performance/calc-chart-check.mjs`，使用外置 Playwright 和独立浏览器上下文，不向项目新增浏览器依赖。
- 通用联想控件在 [js/components/typeahead.js](js/components/typeahead.js)，管理防抖、中文输入法组合态和查询令牌。扩展时保留过期结果丢弃与事件销毁逻辑。
- Chart.js、annotation、ECharts 由本地 vendor 加载；计算器导入仍使用共享 SheetJS。不要因账本已删除就移除仍被计算器使用的 Excel 能力；旧 CDN SheetJS 版本问题仍是审计待办。

## 限流、验证与后续优化

- [scripts/nav/tushare-client.js](scripts/nav/tushare-client.js) 内置动态节流、429/业务限流检测和指数退避，默认 5 次重试；通过 `TUSHARE_GAP_MS`、`TUSHARE_MAX_RETRIES`、`TUSHARE_RATE_LIMIT_BASE_MS` 等调参。
- 东财 lsjz 单页上限为 20 行，不要把增大 PAGE_SIZE 当作吞吐优化。
- 修改业务函数、SQL builder、缓存、HTTP 边界或数据写入时补对应回归。最近代码基线为 **295 项测试通过（2026-09-08）**；仅文档修改检查链接、命令和差异即可。
- 测试 DB 使用 `:memory:` 或临时目录；正式库审计/性能测量用独立 `better-sqlite3` readonly 连接。`getDb()` 会迁移，不应当作纯只读审计入口。不要为了验证代码改动顺带运行全库抓取、重建或修复。
- 搜索改动至少验证本地匹配、SQL 结果/计数/排序/分页、索引失效、gzip/304 和 SWR。访问边界改动验证公共资源及私有路径的 GET/HEAD、外站抓取拒绝和任务槽释放。
- 当前待办包括费用分段边界与 DTO 契约、局部抓取覆盖、场外代码裁决、周/月采样口径、空库迁移、来源水位与历史修订、缓存缺口、更新任务失败可见性、发布快照及页面生命周期。具体状态以优化执行记录为准，不因全量测试通过就宣称审计项全部解决。
- 新增复杂时间序列存储时参考 [ADR 0002 草案](docs/decisions/0002-parquet-cold-storage-DRAFT.md) 评估 Parquet；尚未实施，不据此直接迁移现有 SQLite 数据。

## 已弃与历史

- 账本前后端、样式、解析器及测试已删除，`data/portfolio.db*` 忽略规则保留以防旧数据重新入库。
- `archive/docs/DEPLOY-ORACLE.md`、`archive/docs/cloudflare-migration.md`：旧部署方案。
- `archive/scripts/build-allfund.js`、`build-search-index.js`、`check-allfund.js`：依赖旧 JSON 中转/胖静态产物；使用当前 DB 构建链路。
- `archive/scripts/upload-kv.js` 与 VPS/Workers 部署遗留：不属于现部署模式。
- `scripts/migrate-crawler-to-db.js`：已完成的一次性迁移，仅作灾备资料。
- `scripts/nav/sync-fund-daily.js` 保留作审计/调试，默认不跑；不要恢复场内基金 NAV 同步。
