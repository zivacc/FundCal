# 数据健康体检报告

生成时间: 2026-05-06T08:04:15.914Z
总体: **❌ FAIL** (检查 10 项)

| 项 | 等级 | 摘要 |
|---|---|---|
| C1 fund_basic 全景 | ✅ OK | 共 33501 条 |
| C2 空 status (source=both) | ✅ OK | 无 |
| C3 空 fund_type | ⚠️ WARN | 156 条 |
| C4 status=L 但无 nav | ❌ FAIL | 443 条 |
| C5 nav 数据新鲜度 | ✅ OK | 最新 end_date=20260505，阈值=20260501 |
| C6 crawler 数据新鲜度 | ✅ OK | 最新 crawler_updated_at=2026-04-30T12:02:31.276Z，阈值=2026-04-06 |
| C7 source=both 子表完整性 | ⚠️ WARN | 无 stage_returns: 613，无 fee_segments: 0 |
| C8 近 24h sync_log 错误率 | ✅ OK | success=1084 error=0 (错误率 0.0%) |
| C9 字段合并冲突 (apply-merge-rules 待跑) | ⚠️ WARN | name=0 type=0 mgmt=0 bench=3077 found=0 |
| C10 nav 覆盖率 (status=L) | ✅ OK | 25958/26401 (98.32%) |

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

摘要: 443 条

```json
{
  "count": 443,
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
      "ts_code": "012489.OF",
      "code": "012489",
      "name": "招商招顺纯债D",
      "found_date": "20210527"
    },
    {
      "ts_code": "017984.OF",
      "code": "017984",
      "name": "泰康薪意保货币D",
      "found_date": "20230815"
    },
    {
      "ts_code": "020490.OF",
      "code": "020490",
      "name": "工银中高等级信用债债券D",
      "found_date": "20240105"
    },
    {
      "ts_code": "021487.OF",
      "code": "021487",
      "name": "工银瑞和3个月定开债券D",
      "found_date": "20240530"
    },
    {
      "ts_code": "021743.OF",
      "code": "021743",
      "name": "鹏扬淳享债券D",
      "found_date": "20240626"
    },
    {
      "ts_code": "021763.OF",
      "code": "021763",
      "name": "汇添金货币E",
      "found_date": "20240913"
    },
    {
      "ts_code": "021834.OF",
      "code": "021834",
      "name": "鹏扬淳利债券D",
      "found_date": "20240715"
    },
    {
      "ts_code": "022692.OF",
      "code": "022692",
      "name": "工银添益快线货币B",
      "found_date": "20241204"
    }
  ]
}
```

### C5 nav 数据新鲜度 — ✅ OK

摘要: 最新 end_date=20260505，阈值=20260501

```json
{
  "latest": "20260505",
  "cutoff": "20260501",
  "stale": false
}
```

### C6 crawler 数据新鲜度 — ✅ OK

摘要: 最新 crawler_updated_at=2026-04-30T12:02:31.276Z，阈值=2026-04-06

```json
{
  "latest": "2026-04-30T12:02:31.276Z",
  "cutoff": "2026-04-06",
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

### C8 近 24h sync_log 错误率 — ✅ OK

摘要: success=1084 error=0 (错误率 0.0%)

```json
{
  "successCnt": 1084,
  "errorCnt": 0,
  "errorRate": 0,
  "topErrors": []
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

### C10 nav 覆盖率 (status=L) — ✅ OK

摘要: 25958/26401 (98.32%)

```json
{
  "lTotal": 26401,
  "lWithNav": 25958,
  "coverage": 0.9832203325631604
}
```