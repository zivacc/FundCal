# ADR 0002 — Parquet 列存作冷数据 + 高性能分析引擎 (DRAFT)

- **日期**: 2026-05-25
- **状态**: **DRAFT** (未决, 未落地; 等真实触发场景再确认)
- **影响范围**: `scripts/nav/` 读路径, `data/` 目录布局, `package.json` 依赖

## 背景

当前 `data/fundcal.db` 3.7 GB, **97% 体积是 `fund_nav` 表 (3450 万行)**, 其中 **51% 是 2023 年以前的冷数据**。VACUUM 实测只回收 590 KB (db 没碎片化, 体积就是真实数据)。

未来可能加入：A 股 K 线 (估 ~1.9 GB 同尺度)、复杂技术指标 (MA/MACD/RSI 滚动窗口)、因子数据。这些都是**时间序列分析负载**, 天然适合列存。

## 引擎选择

| 候选 | 评估 | 选不选 |
|---|---|---|
| **DuckDB** | 嵌入式 OLAP, 能 `ATTACH` SQLite 直查, 能 `read_parquet()`, SQL 接口熟悉, `@duckdb/node-api` Node 绑定 | ✅ 推 |
| Polars | Rust 列存, 性能强 | ❌ DataFrame API 心智成本高, 与现有 SQL 代码不兼容 |
| 纯 Arrow + parquetjs | 没有 SQL 层, 自己组装 | ❌ 重造轮子 |
| ClickHouse 嵌入式 | 部署复杂 | ❌ |
| TimescaleDB | 独立 Postgres 服务 | ❌ 违反"嵌入式无服务"原则 |

**结论：DuckDB**。理由：跨引擎 SQL 一行搞定, 嵌入式无服务, 与 SQLite 共存零摩擦。

## 架构

### 数据布局

```
data/
├── fundcal.db          (SQLite 主存储, 写入唯一通道, ~1 GB 上限)
│   ├── fund_basic / fund_meta / fund_fee_segments / fund_stage_returns   元信息小表
│   ├── fund_nav        ← 仅保留近 3 年
│   ├── index_basic / index_source_map / index_fund_tracker               元信息小表
│   ├── index_daily     ← 仅保留近 3 年
│   └── trade_calendar / sync_log
│
└── parquet/            (Parquet 列存, 冷数据 + 未来高频时间序列)
    ├── nav/
    │   ├── 2010.parquet
    │   ├── 2011.parquet
    │   └── ...                  按年分片归档
    ├── index_daily/
    │   ├── 2010.parquet
    │   └── ...
    └── stock_ohlc/              未来 A 股 K 线, 一开始就 Parquet, 不入 SQLite
        └── 600000/
            └── 2020.parquet
```

### 写路径（不变）

- Tushare / 爬虫脚本继续写 SQLite (`better-sqlite3` 同步, 稳定)
- **不存在"双写"问题**: 写入唯一通道始终是 SQLite
- 归档是**单独的批处理**, 不影响实时写入

### 归档脚本

`scripts/archive-nav-to-parquet.js` (新建):

```
1. SELECT ... FROM fund_nav WHERE end_date < cutoff (N-3 年)
2. 按年分组写入 data/parquet/nav/YYYY.parquet
3. 校验 Parquet 行数 == 选出行数
4. DELETE FROM fund_nav WHERE end_date < cutoff
5. VACUUM 收回空间 (SQLite 这次会真的缩小, 因为有真实删除)
```

**单向、定期、可重入**, 失败回滚靠备份。

### 读路径（按时间路由）

抽象在 `scripts/nav/nav-reader.js` (新模块):

```js
async function readNavHistory(tsCode, { start, end }) {
  const cutoff = '20230101';
  if (start >= cutoff) {
    return sqliteReader(tsCode, start, end);          // 全热区
  }
  if (end < cutoff) {
    return duckdbParquetReader(tsCode, start, end);   // 全冷区
  }
  return duckdbCrossReader(tsCode, start, end);       // 跨区
}
```

DuckDB 跨引擎 SQL 示例：

```sql
ATTACH 'data/fundcal.db' AS sqlite (TYPE SQLITE);

SELECT * FROM sqlite.fund_nav
  WHERE ts_code = ? AND end_date >= '20230101'
UNION ALL
SELECT * FROM read_parquet('data/parquet/nav/*.parquet')
  WHERE ts_code = ? AND end_date < '20230101'
ORDER BY end_date;
```

**关键洞察**：两个引擎，**没有双向同步问题**。归档是单向追加 (cold)，写入是单向更新 (hot)，物理上不重叠。

## 收益预估

| 维度 | 现状 | MVP 后 |
|---|---|---|
| SQLite 体积 | 3.7 GB | ~1 GB (砍掉 51% < 2023 nav) |
| Parquet 体积 (新增) | 0 | ~250 MB (5-10× 列存压缩) |
| **总占盘** | 3.7 GB | **~1.25 GB** (省 66%) |
| 单基金 history (热, 近 3 年) | 5 ms | 5 ms (不变) |
| 单基金 history (冷) | 5 ms | 30-50 ms (Parquet 解码 + 跨引擎) |
| 跨基金多年滚动聚合 | 慢 (行存) | **10-100×** (列存) |

## 工作量

**MVP**（1-2 天）：
1. `scripts/archive-nav-to-parquet.js` — 归档脚本 + 测试
2. `scripts/nav/nav-reader.js` — 统一读 API + 时间路由 + 测试
3. 改 `scripts/nav/nav-api.js` `history` / `compare` 端点调 nav-reader
4. CI 验证: 归档前后单基金完整 history 一致

**扩展**（按需求触发）：
- 加股票 K 线: 一开始就直接走 Parquet, 设计相同 reader
- 加复杂指标 (MACD / RSI 滚动): DuckDB SQL 窗口函数直接出

## 风险与缓解

| 风险 | 缓解 |
|---|---|
| DuckDB Node 绑定 Windows 兼容性 | 先 `npm i @duckdb/node-api` 验证装包; 不行用 wasm 版 |
| 归档脚本 bug 导致冷数据丢失 | 归档前 `cp fundcal.db backup.db`; 校验 Parquet 行数 = 删行数后才 commit |
| Parquet schema 演化 | 一次规划清楚 (ts_code/end_date/unit_nav/accum_nav/...); Parquet 自带 schema 元数据 |
| 跨引擎事务一致性 | 写入唯一通道 = SQLite, 无跨引擎事务, 不存在 |
| 多一套引擎心智成本 | 抽象在 nav-reader, 业务代码无感知 |
| 备份策略变复杂 | 备份脚本同时 cp `fundcal.db` + `parquet/`; Parquet 是不可变文件, rsync 增量极小 |

## 当前决定 (DRAFT 阶段)

**不立即落地**。理由：
1. 当前列表 / 搜索 / 筛选刚做完, 用户感知问题已解决
2. fund_nav 体积大不影响实际查询性能 (PK 索引点查毫秒级)
3. 占盘 3.7 GB 在本地 PC 不是 hard constraint
4. 未触发 K 线 / 复杂指标真实需求 → Karpathy "不为假设性需求重构"

**触发条件 (满足任一即重启此 ADR)**：
- 加 A 股 / 指数 K 线全量数据 → 一开始就走 Parquet, 顺便落 MVP
- fund_nav 增长到 SQLite 单文件难管理 (~8 GB+)
- 用户需要跨基金多年滚动指标分析, SQLite 行存吃不下

## 当前能做的最小动作

- ✅ 已做: [CLAUDE.md](../../CLAUDE.md) 加约定 "新加时间序列数据优先 Parquet, 不塞 SQLite"
- ✅ 已做: 本 ADR 草案就位, 触发条件明确, 重启时直接更新状态

## 与 ADR 0001 的关系

ADR 0001 决策"保持 SQLite + 服务端分页"是针对**当前痛点**(列表慢)。
ADR 0002 是针对**未来扩展性**, 不冲突: ADR 0002 落地后 ADR 0001 的服务端分页 SQL 仍然走 SQLite (元信息 + 热区 nav), 只有大批量分析 query 会落到 DuckDB+Parquet。
