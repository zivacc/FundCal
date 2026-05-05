#!/usr/bin/env bash
# =============================================================================
# FundCal Aliyun ECS 一键部署脚本
# =============================================================================
# 目标环境:
#   实例: ecs.e-c1m1.large (2 vCPU / 2 GiB RAM / 40 GiB ESSD)
#   OS:   Ubuntu 22.04
#   IP:   47.96.20.252
#   域名: fc.ziva.cc.cd (Cloudflare 代理)
#
# 用法 (在服务器上, root 或 sudo 执行):
#   首次部署:    sudo bash scripts/aliyun-deploy.sh init
#   日常更新:    sudo bash scripts/aliyun-deploy.sh update
#   仅 nginx:    sudo bash scripts/aliyun-deploy.sh nginx
#   装定时任务:  sudo bash scripts/aliyun-deploy.sh cron
#   导入数据:    sudo bash scripts/aliyun-deploy.sh seed-db /path/to/fundcal.db
#   查看状态:    bash scripts/aliyun-deploy.sh status
# =============================================================================
set -euo pipefail

DEPLOY_DIR="/var/www/fundcal"
DEPLOY_USER="${SUDO_USER:-$USER}"
NODE_VERSION="20"
DOMAIN="fc.ziva.cc.cd"
NGINX_CONF_SRC="${DEPLOY_DIR}/nginx/fundcal.conf"
NGINX_CONF_DST="/etc/nginx/conf.d/fundcal.conf"
CRON_SRC="${DEPLOY_DIR}/scripts/cron/fundcal-cron"
CRON_DST="/etc/cron.d/fundcal"
LOG_DIR="${DEPLOY_DIR}/logs"
DATA_DIR="${DEPLOY_DIR}/data"

cmd="${1:-help}"

log()  { echo -e "\033[1;32m[$(date +%H:%M:%S)]\033[0m $*"; }
warn() { echo -e "\033[1;33m[!]\033[0m $*"; }
err()  { echo -e "\033[1;31m[✗]\033[0m $*" >&2; }

require_root() {
  if [ "$EUID" -ne 0 ]; then
    err "需要 root. 用 sudo 跑."
    exit 1
  fi
}

install_node() {
  if command -v node &>/dev/null; then
    local ver
    ver=$(node --version | sed 's/v//' | cut -d. -f1)
    if [ "$ver" -ge "$NODE_VERSION" ]; then
      log "Node.js $(node --version) 已装"
      return
    fi
  fi
  log "装 Node.js ${NODE_VERSION}.x..."
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_VERSION}.x" | bash -
  apt install -y nodejs
}

install_nginx() {
  if command -v nginx &>/dev/null; then
    log "Nginx 已装"
  else
    log "装 Nginx..."
    apt update
    apt install -y nginx
    systemctl enable nginx
  fi
}

install_pm2() {
  if command -v pm2 &>/dev/null; then
    log "PM2 已装"
  else
    log "装 PM2..."
    npm install -g pm2
  fi
}

install_sqlite() {
  if command -v sqlite3 &>/dev/null; then
    log "sqlite3 已装"
  else
    log "装 sqlite3..."
    apt install -y sqlite3
  fi
}

setup_directories() {
  mkdir -p "$DEPLOY_DIR" "$LOG_DIR" "$DATA_DIR"
  chown -R "$DEPLOY_USER":"$DEPLOY_USER" "$DEPLOY_DIR"
}

deploy_nginx() {
  if [ ! -f "$NGINX_CONF_SRC" ]; then
    err "$NGINX_CONF_SRC 不存在; 先 clone 仓库到 $DEPLOY_DIR"
    exit 1
  fi
  log "部署 Nginx 配置..."
  cp "$NGINX_CONF_SRC" "$NGINX_CONF_DST"
  # 删 default site 防冲突
  rm -f /etc/nginx/sites-enabled/default
  nginx -t
  systemctl reload nginx
  log "Nginx 已重载"
}

deploy_cron() {
  if [ ! -f "$CRON_SRC" ]; then
    err "$CRON_SRC 不存在"
    exit 1
  fi
  log "装定时任务..."
  cp "$CRON_SRC" "$CRON_DST"
  chmod 644 "$CRON_DST"
  systemctl restart cron
  log "Cron 已装. 查看: cat $CRON_DST"
}

start_pm2() {
  cd "$DEPLOY_DIR"
  log "用 PM2 启动 fund-api..."
  if pm2 describe fund-api &>/dev/null; then
    pm2 restart fund-api --update-env
  else
    pm2 start ecosystem.config.cjs
  fi
  pm2 save
  if [ ! -f /etc/systemd/system/pm2-root.service ] && [ ! -f "/etc/systemd/system/pm2-${DEPLOY_USER}.service" ]; then
    log "配 PM2 开机自启..."
    pm2 startup systemd -u "$DEPLOY_USER" --hp "$(getent passwd "$DEPLOY_USER" | cut -d: -f6)"
  fi
}

cmd_init() {
  require_root

  log "=== FundCal 首次部署 (Aliyun ECS) ==="

  if [ ! -f "$DEPLOY_DIR/package.json" ]; then
    err "$DEPLOY_DIR 没找到仓库. 先 clone:"
    err "  sudo mkdir -p $DEPLOY_DIR"
    err "  sudo chown $DEPLOY_USER:$DEPLOY_USER $DEPLOY_DIR"
    err "  cd $DEPLOY_DIR && git clone <repo-url> ."
    exit 1
  fi

  install_node
  install_nginx
  install_pm2
  install_sqlite
  setup_directories

  cd "$DEPLOY_DIR"
  log "装 npm 依赖..."
  sudo -u "$DEPLOY_USER" npm install --omit=dev

  if [ ! -f "$DATA_DIR/fundcal.db" ]; then
    warn "$DATA_DIR/fundcal.db 不存在!"
    warn "  从本地传:  scp data/fundcal.db root@47.96.20.252:$DATA_DIR/"
    warn "  或重新拉:  cd $DEPLOY_DIR && npm run sync:fund-basic && npm run sync:fund-nav -- --all"
  fi

  if [ ! -f "$DEPLOY_DIR/.env" ]; then
    warn "$DEPLOY_DIR/.env 不存在! 必须配 TUSHARE_TOKEN."
    warn "  在 $DEPLOY_DIR 下建 .env:"
    warn "    TUSHARE_TOKEN=xxx"
    warn "    TUSHARE_API_URL=http://api.tushare.pro"
  fi

  deploy_nginx
  start_pm2

  log "=== 部署完成 ==="
  log "下一步:"
  log "  1. Cloudflare DNS:  添加 A 记录 fc.ziva.cc.cd → 47.96.20.252 (代理开启 - 橙云)"
  log "  2. Cloudflare SSL:  设为 'Flexible' 或 'Full'"
  log "  3. 装定时任务:      sudo bash scripts/aliyun-deploy.sh cron"
  log "  4. 测试:            curl http://47.96.20.252/healthz"
  log "  5. 通过域名:        curl https://fc.ziva.cc.cd/healthz"
}

cmd_update() {
  require_root
  cd "$DEPLOY_DIR"
  log "=== 拉新代码并重启 ==="
  sudo -u "$DEPLOY_USER" git pull origin main
  sudo -u "$DEPLOY_USER" npm install --omit=dev
  pm2 restart fund-api --update-env
  deploy_nginx
  log "=== 更新完成 ==="
}

cmd_seed_db() {
  require_root
  local src="${1:-}"
  if [ -z "$src" ] || [ ! -f "$src" ]; then
    err "用法: $0 seed-db /path/to/fundcal.db"
    exit 1
  fi
  log "导入 DB: $src → $DATA_DIR/fundcal.db"
  if [ -f "$DATA_DIR/fundcal.db" ]; then
    log "备份现有 DB..."
    cp "$DATA_DIR/fundcal.db" "$DATA_DIR/fundcal.db.bak.$(date +%Y%m%d-%H%M%S)"
  fi
  cp "$src" "$DATA_DIR/fundcal.db"
  chown "$DEPLOY_USER":"$DEPLOY_USER" "$DATA_DIR/fundcal.db"
  pm2 restart fund-api 2>/dev/null || true
  log "DB 已导入. 验证: sqlite3 $DATA_DIR/fundcal.db 'SELECT COUNT(*) FROM fund_basic;'"
}

cmd_status() {
  echo "── 系统资源 ──"
  free -h | head -2
  df -h "$DEPLOY_DIR" | tail -1
  echo ""
  echo "── PM2 进程 ──"
  pm2 list 2>/dev/null || echo "(pm2 未启)"
  echo ""
  echo "── Nginx 状态 ──"
  systemctl is-active nginx && echo "nginx: running" || echo "nginx: STOPPED"
  echo ""
  echo "── DB 概况 ──"
  if [ -f "$DATA_DIR/fundcal.db" ]; then
    ls -lh "$DATA_DIR/fundcal.db"
    sqlite3 "$DATA_DIR/fundcal.db" "SELECT 'fund_basic', COUNT(*) FROM fund_basic; SELECT 'fund_nav', COUNT(*) FROM fund_nav; SELECT 'last_sync', MAX(finished_at) FROM sync_log;"
  else
    echo "(无 DB)"
  fi
  echo ""
  echo "── 最近同步日志 ──"
  ls -t "$LOG_DIR"/*.log 2>/dev/null | head -3
}

cmd_help() {
  cat <<EOF
FundCal Aliyun 部署脚本

子命令:
  init       首次部署 (装 node/nginx/pm2/sqlite + 配 nginx + 启 pm2)
  update     拉代码 + npm install + pm2 重启 + nginx 重载
  nginx      仅重新部署 Nginx 配置并 reload
  cron       装定时任务 (/etc/cron.d/fundcal)
  seed-db F  导入 SQLite DB 到 $DATA_DIR/fundcal.db (F = 源文件路径)
  status     查看系统/PM2/DB 状态
  help       这页

环境:
  DEPLOY_DIR=$DEPLOY_DIR
  DOMAIN=$DOMAIN

部署前确认:
  1. 仓库已 clone 到 $DEPLOY_DIR
  2. .env 配 TUSHARE_TOKEN + TUSHARE_API_URL
  3. data/fundcal.db 已就位 (本地传或服务器同步)
EOF
}

case "$cmd" in
  init)    cmd_init ;;
  update)  cmd_update ;;
  nginx)   require_root; deploy_nginx ;;
  cron)    require_root; deploy_cron ;;
  seed-db) cmd_seed_db "${2:-}" ;;
  status)  cmd_status ;;
  help|*)  cmd_help ;;
esac
