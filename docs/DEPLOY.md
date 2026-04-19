# 部署与运维指南

同一份代码支持四种部署方式：本地开发、GitHub Pages 纯静态托管、Cloudflare Workers（推荐）、阿里云 ECS 服务器。

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
# 本地爬取并构建
node scripts/crawl-all-fund-fee.js
node scripts/build-allfund.js
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
node scripts/build-allfund.js
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
# 爬取 + 构建
node scripts/crawl-all-fund-fee.js
node scripts/build-allfund.js
npm run build-all

# 上传到 KV
npm run upload-kv

# 如果前端代码也有变更，重新部署
npm run deploy:workers
```

> 仅更新数据时只需 `upload-kv`，不需要重新 `deploy:workers`。
> 前端代码变更（HTML/CSS/JS）才需要重新部署。

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

## 四、阿里云 ECS 服务器部署

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

## 五、域名与 HTTPS（可选，仅阿里云 ECS）

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

## 六、Git 同步工作流

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
| `data/allfund/funds/*.json` | 否 | 分片文件（由 build-allfund.js 生成，不入库） |
| `data/funds/*.json` | 否 | 单只基金缓存（26000+ 文件，仅本地/服务器使用） |
| `data/smpp/*.json` | 是 | 排排网代码映射（构建时自动取最新文件） |
| `node_modules/` | 否 | 依赖目录 |
| `dist/` | 否 | Workers 构建产物（由 build:workers 生成） |

`data/funds/` 不入库，同步方式：

```bash
# SCP 上传
scp -r data/funds root@你的公网IP:/var/www/fundcal/data/

# 或在服务器上直接爬取
cd /var/www/fundcal
node scripts/crawl-all-fund-fee.js
node scripts/build-allfund.js
npm run build-all
```

---

## 七、环境配置说明

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

## 八、故障排查

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

## 九、命令速查

| 场景 | 命令 |
|------|------|
| **本地开发** | |
| 一键启动 | `start.bat` / `start.sh` / `npm run dev` |
| 仅启动 API | `npm run api` |
| 仅启动静态服务 | `npm run serve` |
| **数据构建** | |
| 爬取全量基金 | `node scripts/crawl-all-fund-fee.js` |
| 聚合数据 | `node scripts/build-allfund.js` |
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
