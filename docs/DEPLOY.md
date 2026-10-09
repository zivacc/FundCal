# 部署与运维

FundCal 在用户 `ziva` 的 Mac mini（`ZivaMacmini.local`）运行静态服务和 SQLite API，经 Cloudflare Tunnel 提供公网访问。

- 项目目录：`/Users/ziva/Documents/FundCal`
- 公网入口：`https://f.z-c.me`
- 运行时：Node.js 24；当前服务使用 `/Users/ziva/.nvm/versions/node/v24.14.1/bin/node`
- 部署核验：2026-10-09，迁移源提交 `e2fa47f6`，Node24 上 351 项测试通过，生产 Tunnel 为 healthy。

```text
浏览器 → https://f.z-c.me → Cloudflare Tunnel
                              ├─ /api/* → 127.0.0.1:3457 → data/fundcal.db
                              └─ 其余路径 → 127.0.0.1:3456 → 公共静态资源
```

Oracle Cloud、阿里云 ECS、Workers/KV 和 D1/R2 方案属于历史资料，见 [`archive/docs/`](../archive/docs/)。

## 本地开发与运行

开发、安装和验证使用 Node.js 24。使用目标 Node 的目录作为 `PATH` 前缀，再执行完整 `npm ci`；不要省略开发依赖，当前 API 运行时需要其中的 `pinyin-pro`。

```bash
cd /Users/ziva/Documents/FundCal
export PATH="/Users/ziva/.nvm/versions/node/v24.14.1/bin:$PATH"
npm ci
npm run dev
```

`npm run dev` 一次启动静态服务 `http://localhost:3456` 和 API `http://localhost:3457`，前端自动连接 API。单独运行使用 `npm run serve` 和 `npm run api`；部署服务由下面的 LaunchAgent 管理。

两个服务默认只监听 `127.0.0.1`。静态服务仅开放前端 HTML、JS、CSS、图表库、图标及明确列出的公共 JSON，不提供目录浏览；数据库、仓库配置、测试、脚本、日志和原始导入文件不能通过静态端口读取。新增公共资源时更新 [`scripts/serve-static.js`](../scripts/serve-static.js) 的白名单，不要用仓库根目录通用文件服务器替代它。

```bash
npm test
node --test scripts/list-query.test.js
```

## Cloudflare Tunnel

使用远程管理的 `fundcal` Tunnel。`f.z-c.me` 的 ingress 按顺序匹配：

| Hostname | Path | Origin |
|---|---|---|
| `f.z-c.me` | `^/api(/|$)` | `http://127.0.0.1:3457` |
| `f.z-c.me` | 其余路径 | `http://127.0.0.1:3456` |

Tunnel 的其他主机规则独立保留。DNS、边缘认证、缓存和 ingress 由 Cloudflare 管理；仓库内的本地测试不能代替公网核验。

前端 `getFeeApiBase()` 会将 `localhost` / `127.0.0.1` 连接到 `http://localhost:3457/api/fund`，普通域名使用同源 `/api/fund`；NAV 请求使用 `/api/nav/*`。

Tunnel token 保存在项目目录之外的 `/Users/ziva/.config/FundCal/fundcal-tunnel.token`。目录权限为 `0700`，文件为 `0600`；运行时通过 `--token-file` 读取；token 内容不写入 Git、前端、plist 或命令行参数。cloudflared 二进制位于 `/Users/ziva/.local/bin/cloudflared`。

`POST /api/fund/:code/crawl` 仅允许本机直连，同时校验 loopback、Host、Origin、Fetch Metadata 和代理头。通过 Tunnel 或外站发起的抓取返回 403；公共页面可查询已有数据。手动补数使用本机页面或 CLI。同代码并发请求合并，最多同时抓取 2 只，超限返回 429；任务超时终止并释放槽位。

## macOS 服务管理

三个用户 LaunchAgent 分别管理静态服务、API 和 Tunnel。已安装的 label、plist 和日志配置如下：

| 服务 | Label / plist 文件名 | 日志文件名 |
|---|---|---|
| 静态 | `me.z-c.fundcal.static` / `me.z-c.fundcal.static.plist` | `static.stdout.log`、`static.stderr.log` |
| API | `me.z-c.fundcal.api` / `me.z-c.fundcal.api.plist` | `api.stdout.log`、`api.stderr.log` |
| Tunnel | `me.z-c.fundcal.tunnel` / `me.z-c.fundcal.tunnel.plist` | `tunnel.stdout.log`、`tunnel.stderr.log` |

plist 目录为 `/Users/ziva/Library/LaunchAgents/`，日志目录为 `/Users/ziva/Library/Logs/FundCal/`。服务使用绝对路径、`RunAtLoad` 和 `KeepAlive`。Node 服务的工作目录为项目目录，直接运行 `scripts/serve-static.js 3456`、`scripts/serve-fund-api.js 3457`，不依赖交互 shell 或 nvm 初始化。Tunnel 的工作目录为 `/Users/ziva/.config/FundCal`，通过 `/usr/bin/caffeinate -i` 包装 cloudflared，防止闲置休眠。

这些是用户登录会话服务：用户 `ziva` 登录后启动，异常退出后自动重启；退出登录会停止，重启机器后需重新登录。锁屏与退出登录不同，但机器休眠或离线期间公网访问不可用。

查看状态和重启：

```bash
launchctl print "gui/$(id -u)/me.z-c.fundcal.static"
launchctl print "gui/$(id -u)/me.z-c.fundcal.api"
launchctl print "gui/$(id -u)/me.z-c.fundcal.tunnel"

launchctl kickstart -k "gui/$(id -u)/me.z-c.fundcal.static"
launchctl kickstart -k "gui/$(id -u)/me.z-c.fundcal.api"
launchctl kickstart -k "gui/$(id -u)/me.z-c.fundcal.tunnel"
```

停止服务使用 `bootout`，恢复使用 `bootstrap`。例如 API：

```bash
launchctl bootout "gui/$(id -u)" /Users/ziva/Library/LaunchAgents/me.z-c.fundcal.api.plist
launchctl bootstrap "gui/$(id -u)" /Users/ziva/Library/LaunchAgents/me.z-c.fundcal.api.plist
```

## 例行数据更新

数据流见 [`data-flow.md`](data-flow.md)。迁移安装服务不代表已安装日更任务；旧 Linux cron 文件不应直接照搬到 mini。

每周基础信息与费率更新：

```bash
npm run sync:fund-basic
npm run crawl:all -- --force
npm run merge-rules
node scripts/nav/parse-share-class.js
npm run build-all
npm run health-check
```

常规日更：

```bash
npm run sync:fund-nav -- --all
npm run replay-failed
npm run crawl:eastmoney-nav -- --missing
npm run build-all
npm run health-check
```

单只调试：

```bash
node scripts/crawl-fund-fee.js 000001
node scripts/crawl-fund-fee.js 000001 --keep-json
```

这些命令可能访问外部数据源并写入数据库；服务验证不需要全库抓取或重建。Tushare CLI 从项目根目录 `.env` 或进程环境读取配置，文件不入库。迁移时源项目没有 `.env` 文件，后续使用 Tushare 前应检查凭据配置。

```text
TUSHARE_TOKEN=xxx
TUSHARE_API_URL=http://api.tushare.pro
TUSHARE_GAP_MS=200
TUSHARE_MAX_RETRIES=5
```

Wind 本地配置同样不入库；其配置恢复和 DB 日更接入是两件事，见 [`wind-data-source.md`](wind-data-source.md)。

## 备份与验证

运行中的 SQLite 使用备份接口生成一致快照，不要仅复制主数据库文件而漏掉 WAL。例如系统 SQLite CLI：

```bash
sqlite3 -readonly data/fundcal.db ".backup '/path/to/backup/fundcal-YYYYMMDD.db'"
sqlite3 -readonly /path/to/backup/fundcal-YYYYMMDD.db 'PRAGMA quick_check;'
```

保留快照的 SHA256、代码提交和主要表行数。数据库、WAL/SHM、晨星原始文件、凭据和日志均不属于公共静态资源或 Git 提交。

部署完成后核验本机与公网首页、JS/CSS/vendor、列表分页、单基金费率、晨星历史、基金 NAV 和指数搜索。使用 `/api/fund/list?page=1&size=5` 验证分页；指数搜索端点为 `/api/nav/index-search-index`。数据库、`.env`、`.git` 和脚本路径的 GET/HEAD 应返回 404，公网抓取 POST 应返回 403。

2026-10-09 实际核验：数据库快照 SHA256、`quick_check=ok` 及八张主要表行数一致；351 项测试通过。静态/API 分别监听 `127.0.0.1:3456`、`127.0.0.1:3457`，三个 LaunchAgent 运行，Tunnel 注册两条 QUIC 连接且状态 healthy。本机与 mini 侧公网各 22 项检查通过，源机独立公网 26 项检查通过；浏览器页面正常渲染，未发现控制台错误。

## 故障排查

| 现象 | 检查 |
|---|---|
| 本机 3456 打不开 | 查看静态 LaunchAgent 状态和日志；若进程运行却无日志或监听，检查 Node 的 macOS Documents 文件访问授权 |
| API 502 | 查看 API LaunchAgent 状态、日志及 `127.0.0.1:3457` 的响应 |
| 本机正常但公网不可用 | 查看 Tunnel LaunchAgent 日志、Cloudflare 连接状态和 ingress |
| 页面加载慢 | 查看 Network 中分页、索引、NAV 请求的耗时，区分本机查询与公网传输 |
| Tushare 拉取失败 | 检查 `.env` / 环境变量及限流错误，不输出 token |
| 净值缺失 | 按数据更新流程使用东财兜底；不要仅因部署验证就补数 |
| 体检报错 | `npm run health-check -- --out data/health.md` 后检查报告 |

Parquet 冷存储属于未实施的候选方案，见 [`ADR 0002 草案`](decisions/0002-parquet-cold-storage-DRAFT.md)。
