# 源机 → mini 数据库同步

源机正式库为 `/Users/ziva/projects/FundCal/data/fundcal.db`；mini 为 `/Users/ziva/Documents/FundCal/data/fundcal.db`。同步方向固定为源机向 mini 发布，数据库同步与 GitHub 代码部署分开。2026-10-12 的 mini 只通过 Codex 设备连接可达，没有 SSH 监听或 SSH 私钥；因此当前连接不能直接运行远程 rsync。

## 已准备的工具

使用 Node24，在源机生成包含已提交 WAL 数据的一致性快照、完整表行数、最新净值日期、schema 摘要及 SHA256：

```bash
node scripts/prepare-mini-db.mjs \
  --source data/fundcal.db \
  --out data/repair-mini-sync-YYYYMMDD-HHMM
```

默认同时输出 `fundcal.db.gz`，用于本次 HTTPS 断点续传。`--no-gzip` 只生成原始快照与清单，适合后续 rsync 增量传输；避免把已重新压缩的整个 gzip 流当作高效的增量源。输出使用私有目录，禁止复用已有快照目录，除非显式 `--reuse`。该选项仅检查已经生成的快照，不会重新读取源库。

`scripts/sqlite-content-fingerprint.mjs DB` 为每张表按主键排序计算逻辑内容指纹，可以检测目标库中行数不变的独有更新。此命令可能需要扫描全库，宜用于发布基线与冲突核验，而非高频轮询。

`scripts/mini-db-transfer-server.mjs DIR TOKEN_FILE PORT` 是临时传输工具，只监听 `127.0.0.1`，随机 256 位 Bearer 认证，只允许清单、基线摘要和 gzip 快照，支持 GET/HEAD、单段 Range，拒绝目录、非清单路径与符号链接。凭据不属于源代码、审计或日志。使用第三方临时隧道前需要本次明确传输授权；该授权不代表已安装持续发布服务或允许未来持续暴露入口。同步后关闭隧道和服务、删除临时认证配置。测试覆盖 WAL 快照、同数量的数据冲突、认证边界和断点续传。

## mini 发布步骤

1. 下载至项目忽略的 `data/repair-mini-sync-*`，同时核验压缩文件和解压快照 SHA256、quick_check、清单全部表行数及真实日期。
2. 复用代码部署器 `/Users/ziva/.config/FundCal/deploy/deploy.lock` 的现有 inode 和继承文件描述符持锁机制。下载与校验阶段不需要停止服务；只在切换期间持锁，避免与代码部署同时停启 API。
3. 停止 API，确认退出、端口关闭、没有数据写入作业或其他打开的写连接；再核验 mini 当前库与发布基线一致。如果存在 mini 独有改动，停止发布并审核，不能静默覆盖。
4. 保留旧库和相关 WAL/SHM 的可恢复备份，记录切换断点；在同一文件系统原子替换正式库。启动 API，核验基金列表、净值、指数权重、服务状态及私有路径拒绝访问。失败恢复旧库和服务。
5. 保留传输/应用审计，删除临时认证文件，关闭临时传输入口。

不能直接把在线 `fundcal.db`、WAL 和 SHM 分别用普通 rsync 覆盖到生产目录，也不能用 `--inplace` 写生产库。[SQLite 官方备份说明](https://www.sqlite.org/backup.html)说明一致性备份接口的用途。

公共静态分片和 JSON 是独立构建产物。本次换库不会重建 mini 中的 Git 跟踪 JSON：直接重建会使工作区 dirty，阻断现有自动代码部署。后续自动发布完整静态产物时，需要先协调生成产物的版本或独立输出目录，不能用 git reset 丢弃它们。

## 自动化方案

| 方案 | 能力 | 当前条件 |
|---|---|---|
| SQLite 官方 `sqlite3_rsync` | 事务一致、按数据库页增量传输；源库可继续写，副本同步期间只读 | 两端需要安装工具和可用 SSH；当前未具备 |
| Online Backup + 普通 rsync | 先生成固定快照，再对暂存文件做块增量；支持保留中断文件 | 需要 SSH 或已有私有 rsync 通道；当前未具备 |
| SQL `.dump` / 手写逐表 UPSERT | 全量 SQL 大；增量必须覆盖更新、删除、schema、来源字段和事务边界 | 现有流水线没有完整变更日志，不作为默认发布方法 |
| Codex 设备会话 + 临时 HTTPS 快照 | 能完成本次传输及切换，保留校验与恢复 | 已准备；尚未安装持续自动同步计划 |

[SQLite 官方 sqlite3_rsync 文档](https://www.sqlite.org/rsync.html)明确支持在线一致性副本和页面增量，但远端仍使用 SSH，需要两端安装。3.50.0 起移除了两端必须为 WAL、相同页大小的限制；跨版本需留意协议兼容性。副本数据库头可能不同，因此验证内容时不能一概要求整文件 SHA 相同。当前快照传输则必须要求整文件 SHA 一致。

建议后续建立固定私有传输通道后，由源机数据批次成功及审计通过触发发布，另设定时失败重试：保留上一成功基线、没有新数据就跳过、遇到目标独有更新或校验失败就停止。`sqlite3_rsync` 优先；普通 rsync 只同步原始一致性快照至固定暂存文件，并通过上述发布步骤切换。可参考[rsync 官方手册](https://download.samba.org/pub/rsync/rsync.1)。本次未开放 SSH、安装新网络权限或添加尚不能工作的数据同步计划。
