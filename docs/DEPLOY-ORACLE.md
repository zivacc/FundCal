# Oracle Cloud Free Tier 部署指南

> 本文档详述把 FundCal 部署到 **Oracle Cloud Always Free** 的全流程。
> 目标实例: ARM Ampere A1 (4 OCPU / 24 GB RAM / 200 GB 盘) — 永久免费。
> 域名: `fc.ziva.cc.cd` (Cloudflare 代理)
> 部署脚本: [scripts/aliyun-deploy.sh](../scripts/aliyun-deploy.sh) (Oracle 通用, 仅 IP 改一下)

---

## 1. 为何选 Oracle Cloud Free

| 资源 | 阿里云 ECS (现有) | Oracle Cloud Free |
|---|---|---|
| CPU | 2 vCPU | **4 OCPU (ARM)** |
| RAM | 2 GB | **24 GB** |
| 磁盘 | 40 GB ESSD Entry (**2000 IOPS**) | 200 GB Block Volume (**10000+ IOPS** 默认) |
| 出口流量 | 按用计费 | **10 TB/月免费** |
| 公网带宽 | 100 Mbps | 480 Mbps × OCPU |
| 月成本 | 服务器 + 流量 | **0** |
| 持续性 | 一年付 | **永久免费** |

**关键**: 阿里云 ESSD Entry 2000 IOPS 上 git clone 大仓库 + sqlite WAL fsync 经常打满, Oracle ARM 起步就 10k+ IOPS, 跑 32M 行 sqlite 毫无压力。

---

## 2. 账号注册 (一次性, ~30 分钟)

### 2.1 注册

1. 访问 https://www.oracle.com/cloud/free/
2. 用 **Gmail / Outlook** 注册 (国内邮箱有时被拒)
3. **国家选 "Singapore" 或 "Japan"** (国内地区有时影响 Free 配额发放)
4. 信用卡验证 (需国际卡 Visa/MasterCard, 仅授权 1 USD 不扣)
5. 手机短信验证

### 2.2 区域选择 (重要!)

注册时选 **Home Region**, 之后**不能改**。中国访问优先级:

| Region | 大致 ping (国内) | ARM Free 资源紧张度 |
|---|---|---|
| **ap-tokyo-1** (东京) | 50-80 ms | ⚠️ 紧张 (常无库存) |
| **ap-seoul-1** (首尔) | 60-100 ms | ⚠️ 紧张 |
| **ap-osaka-1** (大阪) | 60-90 ms | ⚠️ 中 |
| ap-singapore-1 (新加坡) | 80-120 ms | ✅ 较松 |
| ap-mumbai-1 (孟买) | 150 ms+ | ✅ 松 |
| us-ashburn-1 / us-phoenix-1 | 200-300 ms | ✅ 最松 |

**建议**: 优先 **东京** → **首尔** → **大阪**, 库存抢不到再退新加坡。

### 2.3 升级账户 (可选但推荐)

注册后有 30 天试用 + Always Free。**到期前不要 "Upgrade to Paid"**, 不操作就自动转为纯 Always Free 账户。

如果一定要升, 选 **Pay As You Go**, 否则到期会限制 Always Free 资源。

---

## 3. 创建 ARM Ampere VM

### 3.1 进 Compute → Instances → Create

**Image**: Canonical Ubuntu 22.04 (Aarch64 ARM 版)

**Shape**: Ampere → VM.Standard.A1.Flex
- OCPU count: **4**
- Memory: **24 GB**
- (max free: 4 OCPU + 24 GB total, 可拆 1-4 个 VM, 但单实例性能最强)

**Networking**:
- Create new VCN (虚拟网络) — 默认配置即可
- Public subnet ✓
- Assign public IPv4 ✓

**SSH Keys**:
- 选 **Generate a key pair** → 下载私钥 `.key` 文件 (一次机会, 丢了重置)
- 或上传你已有的 `~/.ssh/id_ed25519.pub`

**Boot Volume**:
- Size: **100 GB** (默认 47 GB, 改大避免后续扩盘)
- VPU: 10 (默认即可, Free 不要改更高)

点 **Create** 等 1-2 分钟, 拿到公网 IP (例: `152.69.x.x`)。

### 3.2 抢不到资源 (Out of capacity) 怎么办

ARM Free 在东京/首尔常报 `Out of capacity`。解决:

1. **换可用域 (AD)**: 同 region 有 AD-1/AD-2/AD-3, 切一个试
2. **改时段**: 凌晨 3-5 点 (UTC+8) 库存常释放
3. **脚本轮询**: GitHub 有 [oci-arm-host-capacity](https://github.com/hitrov/oracle-oci-api-php) 自动重试
4. **退一步**: 先创 2 OCPU + 12 GB (一半资源), 也够用

---

## 4. 网络配置 (关键, 必做!)

> Oracle 默认**双层防火墙**: VCN Security List + 实例 OS iptables, 都要开 80/443 才能公网访问。

### 4.1 VCN Security List

进 VCN → Security Lists → Default Security List → Add Ingress Rules:

| Source | IP Protocol | Source Port | Destination Port | 说明 |
|---|---|---|---|---|
| 0.0.0.0/0 | TCP | All | **80** | HTTP (Cloudflare 回源) |
| 0.0.0.0/0 | TCP | All | **443** | HTTPS (可选) |
| 你的 IP/32 | TCP | All | **22** | SSH (限自己 IP 更安全) |

**严格模式**: Source 用 [Cloudflare IP 段](https://www.cloudflare.com/ips/), 防止源站直连。

### 4.2 OS 防火墙 (Ubuntu, ⚠️ 易漏)

Oracle Ubuntu 镜像默认 iptables INPUT 链只放行 22 端口, 80/443 必须手动加:

```bash
ssh -i ~/.ssh/oci_key.pem ubuntu@152.69.x.x

# 看默认规则
sudo iptables -L INPUT -n --line-numbers

# 允许 80 + 443 (在 REJECT 规则前插入)
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT

# 持久化 (重启不丢)
sudo apt install -y iptables-persistent
sudo netfilter-persistent save
```

> **不做这步, Cloudflare 回源直接超时**, 是 Oracle 新手最常见坑。

### 4.3 验证

```bash
# 本地测
curl http://152.69.x.x   # 应能连接 (即使返回 nginx 默认页或 502)
```

---

## 5. 部署 FundCal (复用阿里云脚本)

### 5.1 SSH 到机器

```bash
ssh -i ~/.ssh/oci_key.pem ubuntu@152.69.x.x

# 升 root 或全程 sudo
sudo -i
```

### 5.2 设置时区 + 主机名 + swap

```bash
timedatectl set-timezone Asia/Shanghai
hostnamectl set-hostname fundcal
# Oracle ARM 内存 24 GB 充裕, swap 仅作保险
fallocate -l 4G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

### 5.3 一键部署

```bash
apt update && apt install -y git
mkdir -p /var/www
cd /var/www
git clone https://github.com/zivacc/FundCal.git fundcal   # 用你的实际仓库 URL
cd fundcal

# 配 .env (必填)
cat > .env <<'EOF'
TUSHARE_TOKEN=xxx_你的_token_xxx
TUSHARE_API_URL=http://api.tushare.pro
TUSHARE_GAP_MS=200
EOF

# 一键 (装 node/nginx/pm2/sqlite + 配 nginx + 启 pm2)
sudo bash scripts/aliyun-deploy.sh init
```

### 5.4 导数据库

#### 方式 A: 本地 → Oracle (省事)

```bash
# 本地侧 (Windows / git-bash):
sqlite3 data/fundcal.db 'PRAGMA wal_checkpoint(TRUNCATE);'

# 用 scp 传 (3GB, ~10-30 分钟视带宽)
scp -i ~/.ssh/oci_key.pem data/fundcal.db ubuntu@152.69.x.x:/var/www/fundcal/data/

# Oracle 侧:
sudo bash scripts/aliyun-deploy.sh seed-db /var/www/fundcal/data/fundcal.db
```

#### 方式 B: 在 Oracle 上重新拉 (Tushare token 复用)

```bash
cd /var/www/fundcal
npm run sync:fund-basic                    # ~1 min
npm run sync:fund-nav -- --all             # 数小时, 限流自动退避
npm run crawl:all -- --force               # 数小时
npm run merge-rules
npm run crawl:eastmoney-nav -- --missing
npm run sync:trade-cal
npm run build-all
```

### 5.5 装定时任务

```bash
sudo bash scripts/aliyun-deploy.sh cron
```

### 5.6 Cloudflare DNS

登录 CF Dashboard → ziva.cc.cd → DNS → Records → Add:

| Type | Name | Content | Proxy | TTL |
|---|---|---|---|---|
| A | fc | **152.69.x.x** (Oracle 公网 IP) | **Proxied (橙云)** | Auto |

**注意**: 不要走 Vercel/其他 CDN, 直接 CF → Oracle 即可。

### 5.7 验证

```bash
# 服务器侧
curl http://localhost/healthz                # ok
curl http://localhost/api/fund/000001/fee    # JSON

# 公网侧 (CF 代理)
curl https://fc.ziva.cc.cd/healthz
curl https://fc.ziva.cc.cd/data/allfund/search-index.json | head

sudo bash scripts/aliyun-deploy.sh status
```

---

## 6. Oracle 特殊优化

### 6.1 ARM 性能调优 (better-sqlite3)

ARM 上 better-sqlite3 默认编译可用, 但可调缓存以利用 24 GB RAM:

```js
// scripts/nav/db.js getDb() 内, pragma 后追加:
_db.pragma('cache_size = -2000000');  // 2 GB sqlite 缓存 (单位 KB, 负值)
_db.pragma('mmap_size = 8589934592'); // 8 GB mmap (利用 24 GB 充裕内存)
```

> 当前 32M 行 nav 表 ~2.3 GB, 全表 mmap 后所有查询走内存, 速度提升 3-10 倍。

### 6.2 Block Volume 性能模式

Oracle Free Block Volume 默认 **Balanced** (10k IOPS / 480 MB/s), 已远优于阿里云 ESSD Entry。如想更快:
- Storage → Block Volumes → 选你的卷 → Performance: Higher (UHP, 60k+ IOPS)
- ⚠️ UHP 不在 Always Free, 会产生费用

Free 默认 Balanced 对本项目完全够用。

### 6.3 出口流量监控

虽然 10 TB/月免费, 仍建议设阈值告警:
- Monitoring → Alarms → Create
- Metric: `oci_compute.NetworkBytesOut`, threshold 8 TB → 邮件

### 6.4 防 Idle 回收 (历史问题)

Oracle 政策曾有 "ARM 实例 7 天 CPU 利用率 < 20% 视为空闲, 可被回收" (2022 年起松了, 但偶有触发):

```bash
# 装 cron 每日生成轻负载, 防被判定 idle
echo '*/30 * * * * root /usr/bin/find /var -type f >/dev/null 2>&1' | sudo tee /etc/cron.d/anti-idle
```

或更狠: 跑一个常驻轻量后台任务 (如低优先级哈希计算)。本项目的 cron 已有定时任务, 一般不会被回收。

---

## 7. 与阿里云方案的差异

| 项 | 阿里云配置 | Oracle 配置 |
|---|---|---|
| 部署脚本 | scripts/aliyun-deploy.sh | **同, 直接复用** |
| Nginx 配置 | nginx/fundcal.conf | **同** |
| Cron | scripts/cron/fundcal-cron | **同** |
| 防火墙 | 仅安全组 | 安全组 **+ iptables** (双层) |
| RAM | 2 GB + 2 GB swap | 24 GB |
| 磁盘 IOPS | 2000 (瓶颈) | 10000+ (默认) |
| sqlite cache_size | 默认 (~2 MB) | **可加到 2 GB** |
| sqlite mmap_size | 默认 0 | **可加到 8 GB** |
| 国内 ping (CF 边缘缓存命中后) | 极快 | 略慢 ~30-50ms |

> **建议: 阿里云仅作灾备/数据备份镜像; Oracle 跑生产**。

---

## 8. 一周稳定性 checklist

部署后跑一周, 每天看一眼:

```bash
sudo bash scripts/aliyun-deploy.sh status
# 关注:
# - free -h:           used 不超过 RAM 80%
# - df -h:             磁盘 < 80%
# - pm2 list:          fund-api 状态 online, restarts 不增
# - sqlite3 ... last_sync: cron 都按时跑完
```

监控 cron 执行情况:
```bash
tail -100 /var/www/fundcal/logs/sync-nav.log
tail -100 /var/www/fundcal/logs/build.log
cat /var/www/fundcal/data/health-latest.md
```

---

## 9. 故障排查

| 现象 | 排查 |
|---|---|
| `curl http://公网IP/healthz` 超时 | iptables 没开 80 (§ 4.2); 或 VCN Security List 没加规则 (§ 4.1) |
| `pm2 list` 显示 errored | `pm2 logs fund-api --lines 200`; 多半是 .env 缺失 / DB 路径错 |
| sqlite OOM / 死锁 | 加 cache_size + mmap_size (§ 6.1); 跑 `sqlite3 data/fundcal.db 'PRAGMA integrity_check;'` |
| 国内访问慢 | 测 `mtr fc.ziva.cc.cd` 看 CF POP 落到哪; 必要时关 CF 代理直连 (但失去 HTTPS) |
| Cloudflare 522 (源超时) | iptables / nginx 挂; `sudo bash scripts/aliyun-deploy.sh status` 检查 |
| ARM 库不兼容 | 极少, better-sqlite3 / pinyin-pro 都有 ARM 预编译 |

---

## 10. 灾备策略

### 10.1 DB 异地备份

每周从 Oracle 拉 DB 到本地 (单向):
```bash
# 本地 cron (Windows 用任务计划)
scp -i ~/.ssh/oci_key.pem ubuntu@152.69.x.x:/var/www/fundcal/data/fundcal.db \
    ~/backups/fundcal-$(date +%Y%m%d).db
```

### 10.2 Snapshot

Oracle Boot Volume 可以打 Snapshot (Always Free 配额: 5 个 / 5 GB):
- Storage → Block Volumes → Boot Volume → Create Backup
- 每月手动或脚本触发, 出问题可一键回滚

### 10.3 阿里云作冷备

阿里云保留, 但只跑数据同步不开服务:
- 每周从 Oracle 拉 DB 到阿里云
- 真出问题时, 5 分钟内切 Cloudflare DNS 到阿里云 IP

---

## 速查命令

```bash
# Oracle 上日常
ssh -i ~/.ssh/oci_key.pem ubuntu@152.69.x.x

sudo bash scripts/aliyun-deploy.sh status      # 全状态
sudo bash scripts/aliyun-deploy.sh update      # 拉新代码 + 重启
pm2 logs fund-api --lines 100                  # 看 API 日志
tail -f logs/sync-nav.log                      # 看同步日志

# 本地推 DB
sqlite3 data/fundcal.db 'PRAGMA wal_checkpoint(TRUNCATE);'
scp -i ~/.ssh/oci_key.pem data/fundcal.db ubuntu@152.69.x.x:/var/www/fundcal/data/
```

---

## 11. 边缘缓存 (Cloudflare + nginx 微缓存)

> 部署后网页响应慢 (大几兆 JSON 拉得久) 的核心解决: **CF 边缘命中 + nginx 微缓存**。
> 配置后 95% 请求由 CF 边缘吐, tunnel 只回源新分片或 ETL 后第一次。

### 11.1 nginx 已配置项 (随 [nginx/fundcal.conf](../nginx/fundcal.conf) 自动生效)

- `gzip_static on` — 优先吐预压缩 .gz, 零运行时 CPU
- `proxy_cache_path /var/cache/nginx/fundcal` — 200 MB API 微缓存 (60s) 保护 SQLite
- `/api/` 下的 GET 走 `proxy_cache api_cache`, 响应头多一个 `X-Cache-Status: HIT/MISS/BYPASS`
- `/data/allfund/*.json` 一周长缓存 (`Cache-Control: public, max-age=604800`)

部署后验证:

```bash
# 第一次 MISS, 第二次 HIT
curl -sI https://fc.ziva.cc.cd/api/fund/list | grep -iE 'x-cache|cf-cache|content-encoding'
curl -sI https://fc.ziva.cc.cd/api/fund/list | grep -iE 'x-cache|cf-cache'
```

### 11.2 预压缩静态产物 (可选, 强烈建议)

`build-all` 后跑一次, 把 search-index / fund-stats 等预压缩, 节省源端 CPU:

```bash
cd /var/www/fundcal/data/allfund
find . -name '*.json' -size +10k -exec gzip -9 -k -f {} \;
# 如装了 brotli: brotli -q 11 -k -f *.json
```

放进 cron 每天跑一次即可 (与 `npm run build-all` 串行)。

### 11.3 Cloudflare Cache Rules (仪表盘配置, 一次性)

CF Free 默认**不缓存 application/json**, 必须显式开启。

路径: **Dashboard → 域名 ziva.cc.cd → Caching → Cache Rules → Create rule**

| 规则名 | 匹配 | Cache eligibility | Edge TTL |
|---|---|---|---|
| `fundcal-static-allfund` | `(http.request.full_uri wildcard "https://fc.ziva.cc.cd/data/allfund/*")` | Eligible for cache | Override origin: **7 day** |
| `fundcal-api-list` | `(http.request.full_uri wildcard "https://fc.ziva.cc.cd/api/fund/list*")` | Eligible for cache | Override origin: **5 min** |
| `fundcal-api-stats` | `(http.request.full_uri wildcard "https://fc.ziva.cc.cd/api/fund/stats*")` | Eligible for cache | Override origin: **30 min** |
| `fundcal-api-search` | `(http.request.full_uri wildcard "https://fc.ziva.cc.cd/api/fund/search-index*")` | Eligible for cache | Override origin: **30 min** |
| `fundcal-api-fund-detail` | `(http.request.full_uri matches "https://fc\\.ziva\\.cc\\.cd/api/fund/\\d{6}(/fee)?$")` | Eligible for cache | Override origin: **1 hour** |

每条规则保存后, 仪表盘会显示已生效。

**不要**给 `/api/nav/*` 加缓存规则 — 净值是用户多基金混合查询, 命中率低且后端已用 ETag 短路。

### 11.4 ETL 后清缓存

数据更新 (crawler/sync) 跑完, 触发 CF Purge by URL, 让用户立刻看到新数据:

```bash
# 在 [scripts/cron/fundcal-cron](../scripts/cron/fundcal-cron) 或 daily ETL 末尾追加
CF_ZONE=<zone-id>
CF_TOKEN=<api-token-with-cache-purge-perm>
curl -X POST "https://api.cloudflare.com/client/v4/zones/$CF_ZONE/purge_cache" \
  -H "Authorization: Bearer $CF_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"files":[
    "https://fc.ziva.cc.cd/data/allfund/search-index.json",
    "https://fc.ziva.cc.cd/data/allfund/fund-stats.json",
    "https://fc.ziva.cc.cd/data/allfund/feeder-index.json"
  ]}'
# API 端点 (/api/fund/list 等) 走 max-age 自然失效, 无需 purge
```

### 11.5 验证清单

```bash
# 1. nginx 微缓存生效
curl -sI https://fc.ziva.cc.cd/api/fund/list | grep -i x-cache
# 第二次应该 HIT

# 2. CF 边缘缓存生效
curl -sI https://fc.ziva.cc.cd/data/allfund/search-index.json | grep -i cf-cache
# 第二次应该 HIT (重启 cloudflared 不会清边缘)

# 3. ETag/304 短路
ETAG=$(curl -sI https://fc.ziva.cc.cd/api/fund/stats | awk '/^etag:/i {print $2}' | tr -d '\r\n')
curl -sI -H "If-None-Match: $ETAG" https://fc.ziva.cc.cd/api/fund/stats | head -1
# 应该 HTTP/2 304

# 4. 浏览器 DevTools → Network: 列表页首屏 size 大幅下降
```

---

## 参考

- [Oracle Cloud Always Free](https://www.oracle.com/cloud/free/)
- [Ampere ARM 抢资源指南 (社区)](https://github.com/hitrov/oracle-oci-api-php)
- [docs/DEPLOY.md § 五](DEPLOY.md#五阿里云-ecs--cloudflare-反代-推荐生产) — 阿里云版同流程
- [docs/data-flow.md](data-flow.md) — 数据架构
- [Cloudflare Cache Rules 文档](https://developers.cloudflare.com/cache/how-to/cache-rules/)
