# Cloudflare 迁移方案 (D1 + R2 拆分)

> 状态: **规划中**, 不立即上线。
> 目标: 把 `~3GB` 的 SQLite 数据库 (`data/fundcal.db`) 平滑迁移到 Cloudflare 的边缘存储, 配合现有 Pages 前端。

---

## 1. 为什么不能直接上 KV?

| 限制 | 数值 | 影响 |
|---|---|---|
| 单 value 最大 | 25 MiB | 3GB DB 整库写不进单个 key |
| 单 key 最大 | 512 字节 | 不影响 |
| 总存储 | 付费版按用量计费 | 可承受, 但需切片到约 12 万个 key 才能塞下 |
| 每 key 写入并发 | 1 写/秒 | 高频更新会排队 |
| 一致性 | 最终一致 (~60 秒) | 净值类高频读可接受, 但写后立即读不可靠 |

> **结论**: KV 不适合当主存储。仅作小型索引 / 配置缓存。

---

## 2. 数据拆分原则

把数据按 **访问模式 + 大小** 切两半:

| 分类 | 存哪 | 理由 |
|---|---|---|
| **元数据 / 索引 / 关系型查询** | **D1** | 体量小 (~50–100MB), SQL 查询能力强, Workers 原生绑定 |
| **大体量、低频写、按 key 读** | **R2** | 净值历史 30M+ 行 (~2GB+), CDN 缓存友好, 单对象上限 5TB |

### 具体到本项目

| 表 / 数据 | 行数 | 大小估 | 落地 | 存储形态 |
|---|---|---|---|---|
| `fund_basic` | 30,941 | <10MB | **D1** | 表 |
| `fund_meta` | 30,941 | ~30MB (含影子列) | **D1** | 表 |
| `fund_fee_segments` | 233,495 | ~10MB | **D1** | 表 |
| `fund_stage_returns` | 261,280 | ~15MB | **D1** | 表 |
| `sync_log` | 70,000+ | ~10MB | **D1** (可截断保留 90 天) | 表 |
| `fund_nav` | 30,366,181 | **~2.3GB** | **R2** | 按 ts_code 分片 JSON |

> D1 子集合计 ~75MB, 远低于单库 10GB 上限。

---

## 3. 容量与计费速览

| 服务 | 免费额度 | Workers Paid ($5/月起) |
|---|---|---|
| **D1** | 单库 5GB, 每天 100k 行读 / 50k 行写 | 单库 **10GB**, 25M 行读 / 50k 行写 / 天 |
| **R2** | 10GB 存储, 1M class-A / 10M class-B 操作/月 | 0.015 USD/GB·月, 出口免费 |
| Pages | 每天 1 build, 100MB 单 asset 上限 | 5,000 builds/月 |
| Workers | 100k 请求/天 | 10M 请求/月 (单价低) |

3GB 数据按 R2 计 ≈ 0.05 USD/月。读出口免费，CDN 命中率高几乎零成本。

---

## 4. 迁移架构

```
浏览器 (Pages)
   │
   v
Cloudflare Worker (路由)
   ├─→ /api/funds/list                  ─→ D1: 查 fund_basic + fund_meta JOIN
   ├─→ /api/funds/<code>/meta           ─→ D1: 查 fund_meta + fee_segments + stage_returns
   ├─→ /api/funds/<code>/nav?from=&to=  ─→ R2: 取 nav/<ts_code>.json 分片
   ├─→ /api/funds/search?q=             ─→ D1: 用 LIKE 或预建 search-index 表
   └─→ /api/health                      ─→ D1: 取最近 sync_log 摘要

静态资源 (HTML/JS/CSS)
   └─ Pages 直接托管 (现状不变)
```

---

## 5. 迁移步骤 (高层)

### 阶段 A: D1 准备 (低风险, 可先做)

1. `wrangler d1 create fundcal-meta` 建库
2. 把 `data/fundcal.db` 中的元数据表 (除 `fund_nav`) `.dump` 出 SQL
3. 用 `wrangler d1 execute fundcal-meta --remote --file=meta.sql` 灌入 D1
4. 写 Worker 路由 (`worker/api.ts`) 把现有 `serve-fund-api.js` 的几个端点改为读 D1
5. Pages 项目绑定该 Worker (Functions 或外部 Worker)

### 阶段 B: R2 准备 (大头)

1. `wrangler r2 bucket create fundcal-nav` 建桶
2. 写 `scripts/export-nav-to-r2.js`:
   - 按 ts_code 分片: 每个 `.OF` 一个对象, 内容 `[{end_date, unit_nav, accum_nav, adj_nav}, ...]`
   - 估 ~25,000 个对象, 平均 ~80KB
   - 用 R2 S3 兼容 API 或 wrangler 批量上传
3. 写 Worker `/api/funds/<code>/nav` 端点: 直接 `env.NAV_BUCKET.get(<code>.json)` 返回, 加 `Cache-Control: public, max-age=3600`
4. 定时增量更新: 每日 nav sync 之后, 找出当日有更新的 ts_code, 重新生成并 PUT 单对象 (而非全量重传)

### 阶段 C: 双跑灰度

1. 前端 `js/config.js` 加开关: 新版走 D1+R2, 旧版走静态文件
2. 内部对比一周, 确认数据一致
3. 切流到 100% Cloudflare, 保留旧静态资源作回滚预案

### 阶段 D: 清理

1. 移除 `data/allfund/funds/<code>.json` 静态分片 (D1+R2 替代)
2. 保留 `data/allfund/search-index.json` 直到 D1 全文搜索方案稳定 (或继续走静态)
3. 减小 GitHub 仓库体积 (现 `data/funds/` 26k 文件迁出)

---

## 6. 增量同步策略 (D1 / R2)

每日 nav 同步完之后, 不要重传全库:

### D1 增量

把每日变更行写到本地 SQLite 后, 用 `wrangler d1 execute --remote --file=delta.sql` 灌入 D1。需要写 `scripts/export-d1-delta.js` 输出当日 UPSERT 语句。

### R2 增量

只重写**当日有 nav 更新的 ts_code 分片**:

```js
const updatedCodes = db.prepare(`
  SELECT DISTINCT ts_code FROM fund_nav
  WHERE end_date >= ? OR ann_date >= ?
`).all(today, today);
// 对每个 ts_code, 重新组装 JSON, PUT 到 R2
```

---

## 7. Workers / Pages 当前状态适配

需在 `wrangler.toml` 加绑定:

```toml
[[d1_databases]]
binding = "DB"
database_name = "fundcal-meta"
database_id = "<uuid>"

[[r2_buckets]]
binding = "NAV_BUCKET"
bucket_name = "fundcal-nav"
```

前端 `js/api-adapter.js` 改造点:

| 端点 | 现状 | 切到 D1+R2 后 |
|---|---|---|
| `GET /api/fund/{code}/fee` | 读 `data/funds/{code}.json` 或 API | 读 D1 (fund_meta + 子表 JOIN) |
| `GET /api/fund/all-codes` | 读 `data/allfund/search-index.json` | 读 D1 (`SELECT code, name FROM fund_basic`) |
| `GET /api/fund/{code}/nav` | (新增) | 读 R2 `/{code}.json` |

---

## 8. 风险 / 待决策

| 风险 | 缓解 |
|---|---|
| **D1 行级查询时间限制** (单查询 ~10s CPU) | 30k 行级 SELECT 没问题; 复杂 JOIN 上预聚合视图; 大查询切批 |
| **R2 出口冷启动 1-2 秒** | Worker 内 `cf.cacheEverything = true`; 命中后近零延迟 |
| **D1 写入限频 (50k/天 免费, 1M/天 paid)** | 每日 nav 增量 ~50–100k UPSERT, 在 paid 内安全; basic/meta 全量 ~30k 写每周一次 |
| **数据一致性 (D1 元数据 vs R2 nav)** | 同一同步任务结尾原子完成 D1 + R2 写; 健康检查端点核对最后更新时间 |
| **冷启动开销** | 加 KV 缓存常用 list 端点 (search-index ≤ 5MB, 直接整体 KV 一行存) |

---

## 9. 决策点 (后续讨论用)

1. D1 是否承担**搜索** (`name LIKE`)? 还是继续走静态 `search-index.json` (5MB, 1 个 fetch 解决)?
2. **历史 nav 全量** 是否都迁? 还是仅近 N 年? (可从 R2 拆 `recent-3y/<code>.json` + `archive/<code>.json`)
3. 灾难恢复: 本地 SQLite 是否仍是主真相源? (建议 yes, D1+R2 视为下游副本; 重建可幂等)
4. CI/CD: 用 GitHub Actions 还是 Cloudflare Workers Cron 触发同步?

---

## 10. 实施顺序 (建议)

| 阶段 | 工时估 | 风险 | 优先级 |
|---|---|---|---|
| A. D1 元数据迁入 + 一个 API 端点改造 | 1 天 | 低 | P0 |
| B. R2 nav 分片导出脚本 + 单端点改造 | 2 天 | 中 (大数据量) | P1 |
| C. 双跑灰度 + 监控 | 1 周 (运行时) | 低 | P1 |
| D. 全切 + 静态资源瘦身 | 0.5 天 | 低 | P2 |
| E. 增量同步集成到日常 pipeline | 1 天 | 低 | P2 |

> 在前置数据流程稳定之前 (空 status 修完, 限流彻底通畅), 不开始 A 阶段。
