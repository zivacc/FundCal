# 数据健康体检报告

生成时间: 2026-05-01T03:30:13.577Z
总体: **❌ FAIL** (检查 10 项)

| 项 | 等级 | 摘要 |
|---|---|---|
| C1 fund_basic 全景 | ✅ OK | 共 33501 条 |
| C2 空 status (source=both) | ✅ OK | 无 |
| C3 空 fund_type | ⚠️ WARN | 156 条 |
| C4 status=L 但无 nav | ❌ FAIL | 4961 条 |
| C5 nav 数据新鲜度 | ✅ OK | 最新 end_date=20260430，阈值=20260426 |
| C6 crawler 数据新鲜度 | ✅ OK | 最新 crawler_updated_at=2026-04-30T12:02:31.276Z，阈值=2026-04-01 |
| C7 source=both 子表完整性 | ⚠️ WARN | 无 stage_returns: 613，无 fee_segments: 0 |
| C8 近 24h sync_log 错误率 | ❌ FAIL | success=32898 error=24157 (错误率 42.3%) |
| C9 字段合并冲突 (apply-merge-rules 待跑) | ⚠️ WARN | name=0 type=0 mgmt=0 bench=3077 found=0 |
| C10 nav 覆盖率 (status=L) | ⚠️ WARN | 23381/28342 (82.50%) |

## 详情

### C1 fund_basic 全景 — ✅ OK

摘要: 共 33501 条

```json
{
  "total": 33501,
  "bySource": [
    {
      "source": "both",
      "n": 26741
    },
    {
      "source": "tushare",
      "n": 6760
    }
  ],
  "byStatus": [
    {
      "status": "D",
      "n": 4657
    },
    {
      "status": "I",
      "n": 502
    },
    {
      "status": "L",
      "n": 28342
    }
  ]
}
```

### C2 空 status (source=both) — ✅ OK

摘要: 无

```json
{
  "count": 0
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

摘要: 4961 条

```json
{
  "count": 4961,
  "sample": [
    {
      "ts_code": "005471.OF",
      "code": "005471",
      "name": "招商招财通理财债券C",
      "found_date": "20171214"
    },
    {
      "ts_code": "009563.OF",
      "code": "009563",
      "name": "工银全球股票",
      "found_date": "20210406"
    },
    {
      "ts_code": "010647.OF",
      "code": "010647",
      "name": "融通价值趋势混合C",
      "found_date": "20210428"
    },
    {
      "ts_code": "010793.OF",
      "code": "010793",
      "name": "华安成长先锋混合C",
      "found_date": "20210223"
    },
    {
      "ts_code": "010807.OF",
      "code": "010807",
      "name": "融通稳信增益6个月持有期混合A",
      "found_date": "20220125"
    },
    {
      "ts_code": "010812.OF",
      "code": "010812",
      "name": "中银战略新兴产业股票C",
      "found_date": "20201211"
    },
    {
      "ts_code": "010813.OF",
      "code": "010813",
      "name": "华安添益一年持有混合A",
      "found_date": "20210309"
    },
    {
      "ts_code": "010814.OF",
      "code": "010814",
      "name": "华安添益一年持有混合C",
      "found_date": "20210309"
    },
    {
      "ts_code": "010820.OF",
      "code": "010820",
      "name": "安信稳健回报6个月混合C",
      "found_date": "20201222"
    },
    {
      "ts_code": "010827.OF",
      "code": "010827",
      "name": "大成产业趋势混合C",
      "found_date": "20210209"
    }
  ]
}
```

### C5 nav 数据新鲜度 — ✅ OK

摘要: 最新 end_date=20260430，阈值=20260426

```json
{
  "latest": "20260430",
  "cutoff": "20260426",
  "stale": false
}
```

### C6 crawler 数据新鲜度 — ✅ OK

摘要: 最新 crawler_updated_at=2026-04-30T12:02:31.276Z，阈值=2026-04-01

```json
{
  "latest": "2026-04-30T12:02:31.276Z",
  "cutoff": "2026-04-01",
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

摘要: success=32898 error=24157 (错误率 42.3%)

```json
{
  "successCnt": 32898,
  "errorCnt": 24157,
  "errorRate": 0.4233984751555517,
  "topErrors": [
    {
      "error_message": "HTTP 429 Too Many Requests",
      "n": 24132
    },
    {
      "error_message": "HTTP 502 Bad Gateway",
      "n": 25
    }
  ]
}
```

### C9 字段合并冲突 (apply-merge-rules 待跑) — ⚠️ WARN

摘要: name=0 type=0 mgmt=0 bench=3077 found=0

```json
{
  "name_diff": 0,
  "type_diff": 0,
  "mgmt_diff": 0,
  "bench_diff": 3077,
  "founded_diff": 0
}
```

### C10 nav 覆盖率 (status=L) — ⚠️ WARN

摘要: 23381/28342 (82.50%)

```json
{
  "lTotal": 28342,
  "lWithNav": 23381,
  "coverage": 0.8249594241761343
}
```