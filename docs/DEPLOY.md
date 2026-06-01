# 部署与运维

当前部署模式: **PC dev 主开发 + Cloudflare Tunnel 暴露**。Oracle Cloud / 阿里云 ECS / Cloudflare Workers+KV / D1+R2 历史方案已归档至 [`archive/docs/`](../archive/docs/)。

```
浏览器 → fc.ziva.cc.cd → Cloudflare Tunnel → 本机:3456/3457
                                                  ├─ 3456 静态
                                                  └─ 3457 /api/fund/* + /api/nav/*
                                                          ↓
                                                  data/fundcal.db
```

---

## 一、本地开发

### 启动

| 系统 | 方式 |
|---|---|
| Windows | 双击 `start.bat` |
| Mac / Linux | `chmod +x start.sh && ./start.sh` |
| 任意 | `npm run dev` |

`npm run dev` 一次启动：
- 静态文件服务 `http://localhost:3456` (浏览器访问入口)
- API 服务 `http://localhost:3457` (前端自动连接)

### 单独跑

```bash
npm run serve    # 仅静态 (3456)
npm run api      # 仅 API (3457, fund + nav 同一进程)
```

### 跑测试

```bash
npm test                                      # 全部 *.test.js
node --test scripts/list-query.test.js        # 单文件
node --test --test-name-pattern='align'       # 按名过滤
```

---

## 二、CF Tunnel 暴露 (当前生产模式)

CF Tunnel 把本机 `3456`/`3457` 端口反代到公网域名 `fc.ziva.cc.cd`，零开端口、零公网 IP 暴露。Tunnel 配置已就绪 (`cloudflared` service 持久化)，本文档不再重复配置流程。

**前端环境自动识别** (见 [`js/data/fund-api.js`](../js/data/fund-api.js) `getFeeApiBase()`)：

- `localhost` / `127.0.0.1` → 直连 `http://localhost:3457/api/fund`
- 其他域名 (含 `fc.ziva.cc.cd`) → 同源 `/api/fund`，由 Tunnel 路由到本机 API

CF 边缘缓存策略由 Tunnel 上游和 Page Rules 控制（域名级配置, 不在仓库内）。

---

## 三、例行数据更新

详细数据流见 [data-flow.md](data-flow.md)。

### 每周

```bash
npm run sync:fund-basic              # Tushare 基金清单
npm run crawl:all -- --force         # 爬虫元数据/费率/业绩 (直写 DB)
npm run merge-rules                  # 字段裁决合并
npm run health-check                 # 体检
```

### 每日

```bash
npm run sync:fund-nav -- --all       # 净值增量
npm run replay-failed                # 重放失败任务
npm run build-all                    # 重建静态分片 (allfund + search-index + fund-stats + feeder-index + trade-calendar)
```

### 调试单只

```bash
node scripts/crawl-fund-fee.js 000001          # 直写 DB
node scripts/crawl-fund-fee.js 000001 --keep-json   # 同时保留 JSON 灾备
```

---

## 四、环境变量

`.env` 文件 (本机, 不入库)：

```
TUSHARE_TOKEN=xxx
TUSHARE_API_URL=http://api.tushare.pro
TUSHARE_GAP_MS=200                # 限流间隔, 默认 200ms
TUSHARE_MAX_RETRIES=5             # 失败重试
```

---

## 五、备份

DB 体积 ~3.7 GB, 主要在 `fund_nav`。每周建议：

```bash
# 1) checkpoint WAL 防文件不一致
sqlite3 data/fundcal.db 'PRAGMA wal_checkpoint(TRUNCATE);'
# 2) 冷拷 (or rsync 增量到外盘 / NAS)
cp data/fundcal.db /path/to/backup/fundcal-$(date +%F).db
```

体积优化方向（fund_nav 列存归档 Parquet）见 [ADR 0002（待写）](decisions/) 草案。

---

## 六、故障排查

| 现象 | 处理 |
|---|---|
| 浏览器加载慢 | 浏览器开 devtools / Network, 看 `/api/fund/list?page=1` 时延; 后端 < 500 ms 应正常 |
| `localhost:3456` 打不开 | `npm run dev` 退出? 看终端报错 |
| API 502 (Tunnel 暴露后) | 本机 API 进程挂了 → `npm run api` 重启 |
| 拉取数据失败 | 看 `.env` `TUSHARE_TOKEN`; tushare 限流时退避会自动处理 |
| 净值缺失 | `npm run crawl:eastmoney-nav -- --missing` 用东财兜底 LOF/Reits/子类 |
| sync_log 撑大 | 月度: `DELETE FROM sync_log WHERE started_at < datetime('now', '-30 days')` |
| 体检报错 | `npm run health-check -- --out data/health.md` 出详细报告 |
