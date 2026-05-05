# 部署与运维指南

支持多种部署方式, **生产环境推荐: 阿里云 ECS + Cloudflare 反代** (见 [§ 五](#五阿里云-ecs--cloudflare-反代-推荐生产)).

| 方式 | 适用场景 | 数据迁移 | 运维成本 |
|---|---|---|---|
| 本地开发 | 开发/调试 | 0 | 0 |
| GitHub Pages | 静态展示 (无 API) | 仅 build-all 产物 | 0 |
| Cloudflare Workers + KV | 旧版 (已弃) | KV 全量写超 Free 额度 | — |
| Cloudflare D1 + R2 | Free tier 边缘部署 | 6-7 天分批写 D1 | 中 |
| **阿里云 ECS + CF 反代** | **生产推荐** | **0 (sqlite 直接用)** | **低** |

---

## 一、本地开发

### 一键启动

| 系统 | 方式 |
|------|------|
| Windows | 双击 `start.bat` |
| Mac / Linux | `chmod +x start.sh && ./start.sh` |
| 任意系统 | `npm run dev` |

启动后会同时运行：

- **静态文件服务**：`http://localhost:3456`（浏览器打开此地址）
- **API 服务**：`http://localhost:3457`（前端自动连接）

### 单独启动

```bash
npm run serve    # 仅静态文件服务（端口 3456）
npm run api      # 仅 API 服务（端口 3457）
```

### 构建索引

```bash
npm run build-all    # 一键构建 search-index + feeder-index + fund-stats
```

> 前端会自动检测 `localhost` 环境并使用 `http://localhost:3457/api/fund`，无需手动配置。

---

## 二、GitHub Pages 部署（推荐，免费）

### 原理

前端页面由 GitHub Pages 托管，数据直接从仓库中的静态 JSON 文件读取，**完全不需要后端服务器**。

```
用户浏览器
    ↓
GitHub Pages (zivacc.github.io/FundCal/)
    ↓ 直接读取
仓库中的静态 JSON
  - data/allfund/allfund.json      → 全量基金数据
  - data/allfund/search-index.json → 搜索索引
  - data/allfund/feeder-index.json → 联接基金索引
  - data/allfund/fund-stats.json   → 统计数据
```

### 开启步骤

1. 打开 [仓库 Settings → Pages](https://github.com/zivacc/FundCal/settings/pages)
2. **Source** 选择 **GitHub Actions**
3. 保存

每次推送到 `main` 分支，`.github/workflows/deploy-pages.yml` 会自动部署。

### 更新数据

```bash
# 同步 + 构建 (新流程, 详见 docs/data-flow.md)
npm run sync:fund-basic
npm run crawl:all -- --force
npm run merge-rules
npm run sync:fund-nav -- --all
npm run build-all

# 推送到 GitHub（自动触发部署）
git add -A
git commit -m "更新基金数据"
git push
```

### 可选：连接远程 API

如果希望 GitHub Pages 调用阿里云上的 API（获得更快的响应），编辑 `js/config.js`：

```javascript
window.FUND_FEE_API_BASE = 'http://你的阿里云公网IP/api/fund';
```

前端会优先调用 API，API 不可用时自动回退到静态文件。

---

## 三、Cloudflare Workers 部署（推荐）

全球 CDN 加速 + 免费额度足够个人使用，页面和 API 部署在同一个 Worker 中。

### 架构

```
用户浏览器
    ↓ Cloudflare 全球边缘节点
Worker (src/worker.js)
    ├── 静态资源 ← dist/ 目录（HTML/CSS/JS/图片）
    ├── /api/fund/* ← Cloudflare KV（基金数据）
    └── /data/allfund/*.json ← Cloudflare KV（索引文件）
```

### 1. 前提

- 已有 Cloudflare 账号（免费即可）
- 本地已安装 Node.js

### 2. 登录 Wrangler

```bash
npx wrangler login       # 浏览器会跳转授权
npx wrangler whoami       # 验证登录成功
```

### 3. 创建 KV 命名空间

```bash
npx wrangler kv namespace create FUND_DATA
npx wrangler kv namespace create FUND_DATA --preview
```

记下输出的两个 namespace ID，填入 `wrangler.toml`：

```toml
name = "fundcal"
main = "src/worker.js"
compatibility_date = "2024-12-01"

[assets]
directory = "./dist"

[[kv_namespaces]]
binding = "FUND_DATA"
id = "你的_production_namespace_id"
preview_id = "你的_preview_namespace_id"
```

### 4. 上传数据到 KV

```bash
# 确保已有 allfund.json（如没有，先爬取并构建）
npm run build-allfund
npm run build-all

# 上传全部数据（索引 + 26000+ 只基金，约 2 分钟）
npm run upload-kv

# 或分开上传
npm run upload-kv -- --meta-only     # 仅索引文件
npm run upload-kv -- --funds-only    # 仅基金数据
```

### 5. 部署

```bash
npm run deploy:workers
```

会自动执行：`build:workers`（复制前端文件到 `dist/`）→ `wrangler deploy`（上传静态资源 + Worker 代码）。

部署成功后访问：`https://你的worker名.workers.dev`

### 6. 绑定自定义域名（推荐，大陆访问加速）

`.workers.dev` 域名在中国大陆访问较慢，建议绑定自定义域名：

1. 在 Cloudflare Dashboard 添加你的域名，修改域名注册商的 DNS 服务器为 Cloudflare 提供的地址
2. 等待域名状态变为 Active
3. Workers & Pages → `fundcal` → Settings → Domains & Routes → Add → Custom Domain
4. 输入域名（如 `fund.yourdomain.com`），Cloudflare 自动配置 DNS 和 SSL

### 7. 更新数据

```bash
# 同步 + 合并 + 构建 (详见 docs/data-flow.md)
npm run sync:fund-basic
npm run crawl:all -- --force
npm run merge-rules
npm run sync:fund-nav -- --all
npm run build-all

# 上传到 KV
npm run upload-kv

# 如果前端代码也有变更，重新部署
npm run deploy:workers
```

> 仅更新数据时只需 `upload-kv`，不需要重新 `deploy:workers`。
> 前端代码变更（HTML/CSS/JS）才需要重新部署。
>
> **注意**: 当前 KV 上传的是静态分片 (allfund / search-index 等)。
> 主数据库 `fundcal.db` 体积已达 ~3GB, 不能上 KV (单值 25MB 上限)。
> 后续 D1 + R2 边缘存储方案见 [cloudflare-migration.md](cloudflare-migration.md)。

### 8. 本地调试

```bash
npm run dev:workers      # 本地启动 Wrangler 开发服务器（含 KV 模拟）
```

### 故障排查

| 现象 | 可能原因 | 处理 |
|------|---------|------|
| `assets.directory does not exist` | 未先构建 dist | 使用 `npm run deploy:workers`（自动构建） |
| `npm ci` 报锁文件不同步 | package-lock.json 过期 | `npm install` 更新锁文件后提交 |
| 列表页数据为 0 | KV 未上传或 list-index.json 缺失 | `npm run upload-kv -- --meta-only` |
| 基金详情 404 | 基金数据未上传到 KV | `npm run upload-kv -- --funds-only` |
| 排排网比较不可用 | 映射文件未部署 | 确认 `data/smpp/` 下有映射文件后重新 `deploy:workers` |
| `FUND_DATA has both a namespace ID and a preview ID` | wrangler v4 要求显式指定 | 脚本已自动处理，确保用 `npm run upload-kv` |

---

## 四、阿里云 ECS 服务器部署 (旧版手动流程)

> **新生产部署请优先看 [§ 五](#五阿里云-ecs--cloudflare-反代-推荐生产)**, 这一节保留作灾备/手动覆盖。

### 1. 准备

1. **购买 ECS**：镜像选 Alibaba Cloud Linux 3 或 Ubuntu 22.04，1 核 2G 即可，系统盘 40GB
2. **安全组放行端口**：22（SSH）、80（HTTP）、443（HTTPS，可选）
3. 记下**公网 IP**

### 2. 首次部署（一键）

```bash
ssh root@你的公网IP

# 安装 git 并克隆
dnf install -y git          # Ubuntu: apt install -y git
mkdir -p /var/www && cd /var/www
git clone https://github.com/zivacc/FundCal.git fundcal
cd fundcal

# 一键初始化
bash scripts/deploy.sh --init
```

`deploy.sh --init` 会自动完成：
- 安装 Nginx、Node.js、PM2（如未装）
- 复制 `nginx/fundcal.conf` 到 `/etc/nginx/conf.d/`
- `npm install` 安装依赖
- PM2 启动 API 服务（端口 3457）
- 重载 Nginx

完成后访问 `http://你的公网IP` 即可使用。

### 3. 日常更新

```bash
cd /var/www/fundcal
bash scripts/deploy.sh
```

自动执行：`git pull` → `npm install` → PM2 重启 → Nginx 重载

### 4. 手动操作（不用自动脚本时）

#### 安装环境

```bash
# Nginx
dnf install -y nginx              # Ubuntu: apt install -y nginx
systemctl enable nginx && systemctl start nginx

# Node.js 20
curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
dnf install -y nodejs             # Ubuntu: apt install -y nodejs

# PM2
npm install -g pm2
```

#### 配置 Nginx

```bash
cp nginx/fundcal.conf /etc/nginx/conf.d/fundcal.conf
nginx -t && systemctl reload nginx
```

`nginx/fundcal.conf` 已包含：
- 静态文件服务（root → `/var/www/fundcal`）
- `/api/` 反向代理到 `127.0.0.1:3457`
- CORS 头（允许 GitHub Pages 等跨域调用）
- 安全规则（禁止访问 `scripts/`、`node_modules/`、隐藏文件）

#### 启动 API 服务

```bash
cd /var/www/fundcal
npm install
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup     # 按提示执行生成的命令，实现开机自启
```

#### PM2 常用命令

```bash
pm2 list                 # 查看进程
pm2 logs fund-api        # 查看日志
pm2 restart fund-api     # 重启
pm2 stop fund-api        # 停止
```

---

## 五、阿里云 ECS + Cloudflare 反代 (推荐生产)

> **本节是当前主推生产部署方案**。
> 域名: `fc.ziva.cc.cd`  ECS: `47.96.20.252` (Ubuntu 22.04, 2 vCPU / 2 GiB / 40 GiB)

### 架构

```
用户 → fc.ziva.cc.cd (Cloudflare 代理 / 缓存 / HTTPS / DDoS)
        ↓ 回源 HTTP
   47.96.20.252:80 (Nginx)
        ├─→ /                → /var/www/fundcal/index.html (Pages 静态)
        ├─→ /data/allfund/*  → /var/www/fundcal/data/allfund/ (CF 长缓存)
        ├─→ /api/fund/*      → 127.0.0.1:3457 (PM2: fund-api)
        └─→ /healthz         → 200 OK
                              ↓
                         data/fundcal.db (3GB SQLite, 32M+ nav 行)
```

### 1. ECS 准备 (一次性)

#### 1.1 安全组
开通入方向规则:
- 22 (SSH, 仅你的 IP)
- 80 (HTTP, 0.0.0.0/0 — Cloudflare 回源)
- 443 (HTTPS, 0.0.0.0/0, 可选)

> 严格起见可只放行 [Cloudflare IP 段](https://www.cloudflare.com/ips/) 到 80/443, 防止源站直连。

#### 1.2 时区
```bash
sudo timedatectl set-timezone Asia/Shanghai
```

#### 1.3 swap (2 GiB RAM 紧, 加 swap 防 OOM)
```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

### 2. 部署 (一键)

```bash
ssh root@47.96.20.252

# clone 仓库
sudo apt update && sudo apt install -y git
sudo mkdir -p /var/www
sudo chown $USER:$USER /var/www
cd /var/www
git clone https://github.com/zivacc/FundCal.git fundcal
cd fundcal

# 配 .env (必填)
cat > .env <<'EOF'
TUSHARE_TOKEN=xxx_你的_token_xxx
TUSHARE_API_URL=http://api.tushare.pro
TUSHARE_GAP_MS=200
EOF

# 一键部署 (装 node/nginx/pm2, 配 nginx, 启 pm2)
sudo bash scripts/aliyun-deploy.sh init
```

### 3. 数据库导入

#### 方式 A: 从本地传 (省时, 推荐)
```bash
# 本地 (Windows / git-bash):
# 先 checkpoint WAL 防止文件不一致
sqlite3 data/fundcal.db 'PRAGMA wal_checkpoint(TRUNCATE);'
# 用 scp 传到服务器 (3GB, 视带宽 ~10-30 分钟)
scp data/fundcal.db root@47.96.20.252:/var/www/fundcal/data/

# 服务器侧:
sudo bash scripts/aliyun-deploy.sh seed-db /var/www/fundcal/data/fundcal.db
```

#### 方式 B: 在服务器上重新拉
```bash
cd /var/www/fundcal
npm run sync:fund-basic
npm run sync:fund-nav -- --all       # 慢, 数小时, 带限流
npm run crawl:all -- --force         # 几小时
npm run merge-rules
npm run build-all
```

### 4. Cloudflare 配置

#### 4.1 DNS 记录
登录 Cloudflare Dashboard → ziva.cc.cd → DNS → Records → Add:

| Type | Name | Content | Proxy | TTL |
|---|---|---|---|---|
| A | fc | 47.96.20.252 | **Proxied (橙云)** | Auto |

#### 4.2 SSL/TLS 模式
SSL/TLS → Overview:
- 推荐 **Flexible** (CF→源 HTTP, 简单, 浏览器→CF 仍 HTTPS)
- 或 **Full** (源装自签证书, CF→源 HTTPS, 更安全)

#### 4.3 缓存 (强烈建议)
SSL/TLS → Edge Certificates → 启用 "Always Use HTTPS"。

Caching → Configuration:
- Browser Cache TTL: 1 day
- Caching Level: Standard

Page Rules (免费 3 条):
| Match | Settings |
|---|---|
| `fc.ziva.cc.cd/data/allfund/*` | Cache Level: Cache Everything; Edge TTL: 1 day |
| `fc.ziva.cc.cd/api/fund/*/fee` | Cache Level: Cache Everything; Edge TTL: 30 min |
| `fc.ziva.cc.cd/*.js` | Cache Level: Cache Everything; Edge TTL: 7 days |

### 5. 装定时任务

```bash
sudo bash scripts/aliyun-deploy.sh cron
```

定时计划 (服务器时区 Asia/Shanghai):
- **每日**: 18:30 sync-fund-nav, 18:50 replay-failed, 19:30 eastmoney 兜底, 20:00 build-all, 20:30 health-check
- **每周一**: 02:00 sync-fund-basic, 02:30 crawl-all, 05:00 apply-merge-rules, 05:30 parse-share-class, 06:00 sync-trade-cal, 06:30 fix-empty-status
- **每周日 03:00**: SQLite VACUUM
- **每月 1 号 04:00**: 删 90 天前 sync_log
- **每天 00:00**: 删 14 天前日志

完整定义见 [scripts/cron/fundcal-cron](../scripts/cron/fundcal-cron)。

### 6. 验证

```bash
# 服务器侧
curl http://localhost/healthz                # 应返回 ok
curl http://localhost/api/fund/000001/fee    # 应返回 JSON

# 公网侧
curl http://47.96.20.252/healthz             # 直连
curl https://fc.ziva.cc.cd/healthz           # CF 代理

# 状态总览
sudo bash scripts/aliyun-deploy.sh status
```

### 7. 日常维护

| 操作 | 命令 |
|---|---|
| 拉新代码 + 重启 | `sudo bash scripts/aliyun-deploy.sh update` |
| 查看 PM2 日志 | `pm2 logs fund-api --lines 100` |
| 重启 API | `pm2 restart fund-api` |
| 重载 Nginx | `sudo bash scripts/aliyun-deploy.sh nginx` |
| 看体检报告 | `cat /var/www/fundcal/data/health-latest.md` |
| 查近期同步日志 | `tail -100 /var/www/fundcal/logs/sync-nav.log` |
| 手动跑一次同步 | `cd /var/www/fundcal && npm run sync:fund-nav -- --all` |

### 8. 流量与成本估算

| 项 | 估算 |
|---|---|
| ECS (闲置已购) | 0 |
| 阿里云出口流量 (按使用) | < 5 元/月 (CF 边缘缓存命中后) |
| Cloudflare Free 套餐 | 0 |
| Tushare API | 已有 token |
| **合计** | **~5 元/月** |

> 关键: Cloudflare 缓存命中率必须 > 80%, 否则带宽费用上升。

### 9. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 源服务器挂 = 站挂 (单点) | PM2 自动重启 + Cloudflare Always Online |
| 内存 2 GiB 紧 | 已加 2GB swap, PM2 max_memory_restart=500M |
| 国内访问绕境外 CF POP | 测速 `mtr fc.ziva.cc.cd`; 必要时关 CF 代理直连 |
| 源 IP 暴露被 DDoS | 安全组只开 CF IP 段; SSH 限自己 IP |
| 流量计费爆发 | 大文件强缓存 + 监控阿里云告警 |
| DB 损坏 | 每周 VACUUM + 异地备份 (`scp data/fundcal.db` 回本地) |

---

## 六、域名与 HTTPS（可选，仅阿里云 ECS 直连）

1. **域名解析**：在阿里云「域名解析」添加 A 记录，指向 ECS 公网 IP

2. **Nginx 绑定域名**：编辑 `/etc/nginx/conf.d/fundcal.conf`，`server_name _` 改为 `server_name fund.yourdomain.com`

3. **申请 HTTPS 证书**：

```bash
# Alibaba Cloud Linux / CentOS
dnf install -y certbot python3-certbot-nginx
certbot --nginx -d fund.yourdomain.com

# Ubuntu
apt install -y certbot python3-certbot-nginx
certbot --nginx -d fund.yourdomain.com
```

证书会自动续期。

---

## 七、Git 同步工作流

### 架构

```
本地电脑  ──git push──→  GitHub  ←──git pull──  阿里云服务器
 (开发)                 (版本中心)               (生产)
      \                     ↓
       \             GitHub Pages (静态托管)
        \
         └── npm run upload-kv ──→  Cloudflare KV (数据)
         └── npm run deploy:workers → Cloudflare Workers (页面+API)
```

### 日常流程

**本地改完推送：**

```bash
git add -A
git commit -m "描述修改"
git push
```

**服务器更新：**

```bash
cd /var/www/fundcal
bash scripts/deploy.sh
```

### 数据文件说明

| 文件 | 是否入库 | 说明 |
|------|:---:|------|
| `data/allfund/allfund.json` | 是 | 全量聚合（~73MB），GitHub Pages 直接读取，也是 KV 上传的数据源 |
| `data/allfund/search-index.json` | 是 | 搜索索引 |
| `data/allfund/list-index.json` | 是 | 列表页索引（含跟踪标的、基金公司等完整字段） |
| `data/allfund/feeder-index.json` | 是 | 联接基金索引 |
| `data/allfund/fund-stats.json` | 是 | 统计数据 |
| `data/allfund/fund-stats-detail.json` | 是 | 统计详情 |
| `data/allfund/funds/*.json` | 否 | 分片文件（由 build-allfund-from-db.js 生成，不入库） |
| `data/fundcal.db` | 是/否 | SQLite 主真相源（按部署需要决定是否入库） |
| `data/funds/*.json` | 否 | [灾备] 旧 crawler JSON（已不再写入） |
| `data/smpp/*.json` | 是 | 排排网代码映射（构建时自动取最新文件） |
| `node_modules/` | 否 | 依赖目录 |
| `dist/` | 否 | Workers 构建产物（由 build:workers 生成） |

### 数据同步策略 (新流程)

`data/fundcal.db` 是主真相源。生产环境推荐**在服务器上直接同步**，避免传输 ~3GB 数据库:

```bash
cd /var/www/fundcal
npm run sync:fund-basic              # Tushare 基金清单
npm run crawl:all -- --force         # 爬虫全量 (直写 DB)
npm run merge-rules                  # 字段裁决合并
npm run sync:fund-nav -- --all       # 净值增量
npm run replay-failed                # 重放失败任务
npm run health-check                 # 体检
npm run build-all                    # 出静态资源
```

如需把本地 DB 推送到服务器:

```bash
# 注意: WAL 模式下需先 checkpoint
sqlite3 data/fundcal.db 'PRAGMA wal_checkpoint(TRUNCATE);'
scp data/fundcal.db root@你的公网IP:/var/www/fundcal/data/
```

> 旧 `data/funds/*.json` 已不再使用 (爬虫直写 DB), 仅作灾备。无需同步。

---

## 八、环境配置说明

### js/config.js

全局配置文件，控制 API 基地址。大多数情况下**无需修改**（自动检测）。

```javascript
// 四种环境自动适配：
// - localhost        → http://localhost:3457/api/fund
// - *.github.io      → 读取静态文件（不走 API）
// - *.workers.dev    → /api/fund（同源 Worker 处理）
// - 其他域名         → /api/fund（Nginx 反代或 Worker）

// 手动覆盖（可选）：
// window.FUND_FEE_API_BASE = 'http://你的服务器IP/api/fund';
```

### ecosystem.config.cjs

PM2 配置，服务器部署时使用。默认运行 `serve-fund-api.js`，端口 3457。

### nginx/fundcal.conf

Nginx 配置模板，包含静态服务、API 反代、CORS、安全规则。部署时复制到 `/etc/nginx/conf.d/`。

---

## 九、故障排查

| 现象 | 可能原因 | 处理 |
|------|---------|------|
| 无法访问 80 端口 | 安全组未放行 | 检查阿里云安全组入方向规则 |
| 502 Bad Gateway | API 未启动 | `pm2 list` → `pm2 restart fund-api` |
| 拉取费率失败 | API 地址不对 | 检查 `js/config.js`，或确认环境自动检测是否正确 |
| 静态资源 404 | 文件权限 | `chown -R nginx:nginx /var/www/fundcal` |
| GitHub Pages 数据旧 | 未推送更新 | `git push` 后等待 Actions 部署完成（2-3 分钟） |
| git push 被拒 | 远程有新提交 | `git pull --rebase` 后再 push |
| 统计页数据异常 | fund-stats.json 未重建 | `npm run build-fund-stats` 后重新推送 |

---

## 十、命令速查

| 场景 | 命令 |
|------|------|
| **本地开发** | |
| 一键启动 | `start.bat` / `start.sh` / `npm run dev` |
| 仅启动 API | `npm run api` |
| 仅启动静态服务 | `npm run serve` |
| **数据构建** | |
| 拉 Tushare 清单 | `npm run sync:fund-basic` |
| 爬取全量基金 | `npm run crawl:all -- --force` |
| 字段裁决合并 | `npm run merge-rules` |
| 拉净值（增量） | `npm run sync:fund-nav -- --all` |
| 重放失败任务 | `npm run replay-failed` |
| 数据健康体检 | `npm run health-check` |
| 聚合数据 | `npm run build-allfund` |
| 构建所有索引 | `npm run build-all` |
| **Cloudflare Workers** | |
| 登录 Wrangler | `npx wrangler login` |
| 上传全部数据到 KV | `npm run upload-kv` |
| 仅上传索引到 KV | `npm run upload-kv -- --meta-only` |
| 仅上传基金到 KV | `npm run upload-kv -- --funds-only` |
| 部署 Worker + 静态资源 | `npm run deploy:workers` |
| 本地调试 Worker | `npm run dev:workers` |
| **阿里云 ECS** | |
| 服务器首次部署 | `bash scripts/deploy.sh --init` |
| 服务器更新 | `bash scripts/deploy.sh` |
| 查看 API 日志 | `pm2 logs fund-api` |
| 重启 API | `pm2 restart fund-api` |
| **Git** | |
| 推送更新 | `git add -A && git commit -m "..." && git push` |
