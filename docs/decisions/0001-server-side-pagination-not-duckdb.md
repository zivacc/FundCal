# ADR 0001 — 基金列表服务端分页，而非 DuckDB 全替换

- **日期**: 2026-05-24
- **状态**: 已落地
- **影响范围**: `scripts/list-query.js`, `scripts/fund-api.js`, `js/pages/list/*`, `js/data/fund-api.js`

## 背景

`#/list` 页 + 搜索联想首屏极慢。最初提出两个方向：

1. **DuckDB 全量替换 SQLite** — 用列存压缩 3.7 GB db, 顺便提升分析能力
2. **保持 SQLite + 服务端分页** — 把列表 / 搜索 / 排序 / 筛选下推到 DB

## 诊断结果

慢的根因 **不是 DB 引擎**：

| 现象 | 实测 | 根因 |
|---|---|---|
| 列表首屏 > 3 s | 一次性下载 5–10 MB `/api/fund/list?fields=summary` (27k 行) | **前端拿全集本地 filter/sort** |
| 搜索联想 > 1 s | 前端先下载 3.2 MB `search-index.json` 再本地搜 | **网络 + JSON 解析**, 与 DB 无关 |

换 DuckDB 不会让任何一个变快 0.1 ms。

## 决策

走方案 2。具体执行：

- 新增纯函数 SQL builder [`scripts/list-query.js`](../../scripts/list-query.js) (含 21 个单测) — 接受 `{page,size,sort,q,filters}` 输出 `{sql, countSql, params}`
- 主路由 `/api/fund/list` 嗅探 `page`/`q`/`sort` 参数：有 → 服务端分页路径；无 → 旧全量路径 (向后兼容)
- 新增 `/api/fund/filter-options` 一次返回所有筛选维度 + 频次，前端 IDB SWR 缓存
- 前端 [`js/pages/list/index.js`](../../js/pages/list/index.js) 改造：不再持有 `allFunds` 全集，AbortController 防竞态，每次状态变更重 fetch 当前页

## 实测数字

| 操作 | 时延 (localhost) |
|---|---|
| 列表首屏 (含 filter-options 并行) | < 300 ms |
| 搜索"易方达"+ 排序 | 140 ms |
| filter-options 完整 8.4 KB | 144 ms |

均远好于 2 s / 100 ms 目标。

## 当时被否的替代方案

| 方案 | 否的理由 |
|---|---|
| DuckDB 全量替换 SQLite | 21 处 `getDb()` 同步调用要全改 async；DuckDB Node 绑定 Windows 编译麻烦；fund_nav 大表非真痛点 (PK 索引查单基金毫秒级) |
| 前端预生成更小的 prefix-trie 搜索索引 | 治标，仍是"全量下载到客户端"思路；服务端 LIKE 已经够快 |
| 给搜索独立 API `/api/fund/search` | 跟 `list?q=` 重复；合并到 list 更紧凑 |
| 引入 Elasticsearch / Meilisearch 等 | 杀鸡用牛刀；单机 SQLite + 索引足以应付 27k 行 |
| 虚拟滚动 / 完全不分页 | 服务端仍要把 27k 行喂给前端，没解决根因 |

## 后果

正面：
- 列表 / 搜索 / 筛选都达到目标延迟
- 减少前端复杂度（删除本地 score/sort/filter ~80 行）
- 灾备路径仍保留（纯静态部署走 `search-index.json` 本地分页）
- API 同时支持服务端分页和旧全量两种调用方式，分阶段迁移

潜在风险：
- SQL builder 必须严格白名单 sort key (已用 `SORT_EXPR` map + 测试覆盖 SQL 注入)
- AbortController 防竞态在所有浏览器都支持，但要确保 `signal` 传递到位
- filter-options 维度 = 全库统计 (用户决策 A)，不会随其他筛选动态变化；若将来要"动态联动"需重新设计

## 未来如何重新评估

如果出现 DuckDB-shaped 问题再回头：
- 跨基金 / 跨指数大批量聚合分析（K线 + 因子）
- fund_nav 体积膨胀到 SQLite 单文件难管理
- 需要 OLAP 风格的 ad-hoc query

那时优先考虑 DuckDB **ATTACH SQLite + 读 Parquet 归档** 模式，而不是替换主存储。见 [ADR 0002（待写）](.) 规划中的列存归档方案。
