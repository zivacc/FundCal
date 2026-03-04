# 基金费率计算器 - 部署与开发指南

同一份代码，既可在本地电脑调试，也可在服务器（阿里云 ECS 等）上部署。

---

## 一、本地开发（Windows / Mac / Linux）

### 快速启动

**Windows：** 双击 `start.bat`

**Mac / Linux：**
```bash
chmod +x start.sh
./start.sh
```

**或使用 npm：**
```bash
npm run dev
```

以上命令会同时启动：
- **静态文件服务**：`http://localhost:3456`（浏览器访问此地址）
- **API 服务**：`http://localhost:3457`

> 前端代码会自动检测运行环境：本地 → `localhost:3457`；服务器 → `/api/fund`（Nginx 反代），无需手动切换。

### 单独启动

```bash
npm run serve    # 仅静态文件服务（端口 3456）
npm run api      # 仅 API 服务（端口 3457）
```

### 数据构建

```bash
npm run build-all    # 一键构建所有索引（search-index + feeder-index + fund-stats）
```

---

## 二、服务器部署（阿里云 ECS）

### 1. 前置准备

1. **购买 ECS**
   - 登录 [阿里云控制台](https://ecs.console.aliyun.com)
   - 镜像：**Alibaba Cloud Linux 3** 或 **Ubuntu 22.04**
   - 规格：1 核 2G 即可
   - 系统盘 40GB 足够

2. **安全组放行端口**：22（SSH）、80（HTTP）、443（HTTPS，可选）

3. **获取公网 IP**

### 2. 上传项目（推荐使用 Git）

**首次部署（在服务器上）：**

```bash
# 安装 git（如未装）
dnf install -y git   # 或 apt install -y git

mkdir -p /var/www && cd /var/www
git clone 你的仓库地址 fundcal
cd fundcal
```

### 3. 一键初始化部署

```bash
cd /var/www/fundcal
bash scripts/deploy.sh --init
```

此命令会自动：
- 安装 Nginx、Node.js、PM2（如未装）
- 复制 Nginx 配置
- 安装 npm 依赖
- 启动 API 服务（PM2 管理）

### 4. 日常更新（git pull + 重启）

```bash
cd /var/www/fundcal
bash scripts/deploy.sh
```

此命令会自动：`git pull` → `npm install` → 重启 PM2 → 重载 Nginx

### 5. 手动操作（如不用自动脚本）

#### 安装环境

```bash
# Nginx
dnf install -y nginx    # Ubuntu: apt install -y nginx
systemctl enable nginx && systemctl start nginx

# Node.js
curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
dnf install -y nodejs   # Ubuntu: apt install -y nodejs

# PM2
npm install -g pm2
```

#### 配置 Nginx

项目已提供模板 `nginx/fundcal.conf`，直接复制即可：

```bash
cp nginx/fundcal.conf /etc/nginx/conf.d/fundcal.conf
nginx -t && systemctl reload nginx
```

#### 启动 API 服务

```bash
cd /var/www/fundcal
npm install
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup   # 按提示执行，实现开机自启
```

---

## 三、本地与服务器同步（Git 工作流）

### 推荐方案：Git + 远程仓库（GitHub / Gitee）

```
本地电脑  ←→  GitHub/Gitee  ←→  阿里云服务器
  编辑开发       版本管理中心        生产部署
```

### 初始设置

**1. 创建远程仓库**

在 [GitHub](https://github.com/new) 或 [Gitee](https://gitee.com/projects/new)（国内更快）创建新仓库。

**2. 本地关联并推送**

```powershell
# 在本地 FundCal 目录
git remote add origin https://github.com/你的用户名/fundcal.git
git branch -M main
git push -u origin main
```

**3. 服务器克隆**

```bash
# 在服务器上
cd /var/www
git clone https://github.com/你的用户名/fundcal.git
```

### 日常工作流

```
本地修改 → git add → git commit → git push
                                      ↓
服务器更新 ← bash scripts/deploy.sh（自动 git pull + 重启）
```

**本地开发完成后推送：**

```powershell
git add -A
git commit -m "描述修改内容"
git push
```

**服务器上更新：**

```bash
cd /var/www/fundcal
bash scripts/deploy.sh    # 自动拉取、安装依赖、重启服务
```

### 数据文件同步

`data/funds/` 和 `data/allfund/allfund.json` 是爬虫生成的大文件，**不纳入 Git**。
同步方式：

```bash
# 本地 → 服务器（SCP）
scp -r data/funds root@你的公网IP:/var/www/fundcal/data/
scp data/allfund/allfund.json root@你的公网IP:/var/www/fundcal/data/allfund/

# 或在服务器上直接爬取
cd /var/www/fundcal
node scripts/crawl-all-fund-fee.js
npm run build-all
```

---

## 四、可选：绑定域名与 HTTPS

1. **域名**：在阿里云添加 **A 记录** 指向 ECS 公网 IP

2. **Nginx 中写域名**：编辑 `/etc/nginx/conf.d/fundcal.conf`，将 `server_name _` 改为 `server_name fund.yourdomain.com`

3. **HTTPS（Let's Encrypt）**
   ```bash
   dnf install -y certbot python3-certbot-nginx   # Ubuntu: apt install -y
   certbot --nginx -d fund.yourdomain.com
   ```

---

## 五、项目结构速查

```
FundCal/
├── start.bat / start.sh        ← 本地一键启动
├── ecosystem.config.cjs        ← PM2 服务器配置
├── nginx/fundcal.conf          ← Nginx 配置模板
├── scripts/
│   ├── dev-server.js           ← 本地开发并发启动器
│   ├── serve-fund-api.js       ← API 服务
│   ├── deploy.sh               ← 服务器部署/更新脚本
│   ├── crawl-*.js              ← 爬虫脚本
│   └── build-*.js              ← 索引构建脚本
├── js/
│   ├── api-adapter.js          ← API 地址自动适配（本地/服务器）
│   └── ...
├── data/
│   ├── funds/                  ← 单只基金费率（.gitignore 排除）
│   └── allfund/
│       ├── allfund.json        ← 全量聚合（.gitignore 排除）
│       └── *.json              ← 索引文件（纳入 Git）
└── .gitignore
```

---

## 六、故障排查

| 现象 | 可能原因 | 处理建议 |
|------|---------|---------|
| 无法访问 80 端口 | 安全组未放行 | 检查安全组入方向规则 |
| 502 Bad Gateway | API 未启动 | `pm2 list` 检查；`pm2 restart fund-api` |
| 拉取费率失败 | API 地址不对 | 本地自动用 `localhost:3457`，服务器自动用 `/api/fund` |
| 静态资源 404 | 权限问题 | `chown -R nginx:nginx /var/www/fundcal` |
| git push 被拒 | 远程有新提交 | `git pull --rebase` 后再 push |

---

## 七、常用命令速查

| 场景 | 命令 |
|------|------|
| 本地一键启动 | `start.bat` 或 `npm run dev` |
| 构建所有索引 | `npm run build-all` |
| 服务器首次部署 | `bash scripts/deploy.sh --init` |
| 服务器更新 | `bash scripts/deploy.sh` |
| 查看 API 日志 | `pm2 logs fund-api` |
| 重启 API | `pm2 restart fund-api` |
| 本地推送 | `git add -A && git commit -m "..." && git push` |
