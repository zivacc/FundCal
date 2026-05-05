# 数据健康体检报告

生成时间: 2026-04-30T11:55:27.778Z
总体: **❌ FAIL** (检查 10 项)

| 项 | 等级 | 摘要 |
|---|---|---|
| C1 fund_basic 全景 | ✅ OK | 共 30941 条 |
| C2 空 status (source=both) | ❌ FAIL | 2498 条本应有 status 却为空 |
| C3 空 fund_type | ⚠️ WARN | 156 条 |
| C4 status=L 但无 nav | ❌ FAIL | 522 条 |
| C5 nav 数据新鲜度 | ✅ OK | 最新 end_date=20260429，阈值=20260425 |
| C6 crawler 数据新鲜度 | ✅ OK | 最新 crawler_updated_at=2026-04-28T09:10:18.922Z，阈值=2026-03-31 |
| C7 source=both 子表完整性 | ⚠️ WARN | 无 stage_returns: 613，无 fee_segments: 0 |
| C8 近 24h sync_log 错误率 | ❌ FAIL | success=52317 error=25429 (错误率 32.7%) |
| C9 字段合并冲突 (apply-merge-rules 待跑) | ⚠️ WARN | name=20784 type=23134 mgmt=1137 bench=8007 found=210 |
| C10 nav 覆盖率 (status=L) | ✅ OK | 23381/23903 (97.82%) |

## 详情

### C1 fund_basic 全景 — ✅ OK

摘要: 共 30941 条

```json
{
  "total": 30941,
  "bySource": [
    {
      "source": "both",
      "n": 26741
    },
    {
      "source": "tushare",
      "n": 4200
    }
  ],
  "byStatus": [
    {
      "status": "(空)",
      "n": 2498
    },
    {
      "status": "D",
      "n": 4043
    },
    {
      "status": "I",
      "n": 497
    },
    {
      "status": "L",
      "n": 23903
    }
  ]
}
```

### C2 空 status (source=both) — ❌ FAIL

摘要: 2498 条本应有 status 却为空

```json
{
  "count": 2498
}
```

### C3 空 fund_type — ⚠️ WARN

摘要: 156 条

```json
{
  "count": 156
}
```

### C4 status=L 但无 nav — ❌ FAIL

摘要: 522 条

```json
{
  "count": 522,
  "sample": [
    {
      "ts_code": "005471.OF",
      "code": "005471",
      "name": "招商招财通C",
      "found_date": "20181011"
    },
    {
      "ts_code": "009563.OF",
      "code": "009563",
      "name": "工银全球配置港币",
      "found_date": "20210406"
    },
    {
      "ts_code": "010647.OF",
      "code": "010647",
      "name": "融通价值趋势C",
      "found_date": "20210428"
    },
    {
      "ts_code": "010793.OF",
      "code": "010793",
      "name": "华安成长先锋C",
      "found_date": "20210223"
    },
    {
      "ts_code": "010807.OF",
      "code": "010807",
      "name": "融通稳信增益6个月持有A",
      "found_date": "20220125"
    },
    {
      "ts_code": "010812.OF",
      "code": "010812",
      "name": "中银战略新兴产业C",
      "found_date": "20201211"
    },
    {
      "ts_code": "010813.OF",
      "code": "010813",
      "name": "华安添益一年持有A",
      "found_date": "20210309"
    },
    {
      "ts_code": "010814.OF",
      "code": "010814",
      "name": "华安添益一年持有C",
      "found_date": "20210309"
    },
    {
      "ts_code": "010820.OF",
      "code": "010820",
      "name": "安信稳健回报6个月持有C",
      "found_date": "20201222"
    },
    {
      "ts_code": "010827.OF",
      "code": "010827",
      "name": "大成产业趋势C",
      "found_date": "20210209"
    }
  ]
}
```

### C5 nav 数据新鲜度 — ✅ OK

摘要: 最新 end_date=20260429，阈值=20260425

```json
{
  "latest": "20260429",
  "cutoff": "20260425",
  "stale": false
}
```

### C6 crawler 数据新鲜度 — ✅ OK

摘要: 最新 crawler_updated_at=2026-04-28T09:10:18.922Z，阈值=2026-03-31

```json
{
  "latest": "2026-04-28T09:10:18.922Z",
  "cutoff": "2026-03-31",
  "stale": false
}
```

### C7 source=both 子表完整性 — ⚠️ WARN

摘要: 无 stage_returns: 613，无 fee_segments: 0

```json
{
  "bothNoStage": 613,
  "bothNoFee": 0
}
```

### C8 近 24h sync_log 错误率 — ❌ FAIL

摘要: success=52317 error=25429 (错误率 32.7%)

```json
{
  "successCnt": 52317,
  "errorCnt": 25429,
  "errorRate": 0.3270779204074808,
  "topErrors": [
    {
      "error_message": "HTTP 429 Too Many Requests",
      "n": 22926
    },
    {
      "error_message": "您请求速度过快",
      "n": 2478
    },
    {
      "error_message": "HTTP 502 Bad Gateway",
      "n": 25
    }
  ]
}
```

### C9 字段合并冲突 (apply-merge-rules 待跑) — ⚠️ WARN

摘要: name=20784 type=23134 mgmt=1137 bench=8007 found=210

```json
{
  "name_diff": 20784,
  "type_diff": 23134,
  "mgmt_diff": 1137,
  "bench_diff": 8007,
  "founded_diff": 210
}
```

### C10 nav 覆盖率 (status=L) — ✅ OK

摘要: 23381/23903 (97.82%)

```json
{
  "lTotal": 23903,
  "lWithNav": 23381,
  "coverage": 0.9781617370204577
}
```