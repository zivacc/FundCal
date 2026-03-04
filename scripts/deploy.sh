#!/usr/bin/env bash
# FundCal 服务器端部署/更新脚本
# 用法（在服务器上）：
#   首次部署：  bash scripts/deploy.sh --init
#   日常更新：  bash scripts/deploy.sh
set -e

DEPLOY_DIR="/var/www/fundcal"
REPO_REMOTE="${FUNDCAL_GIT_REMOTE:-origin}"

cd "$DEPLOY_DIR"

if [ "$1" = "--init" ]; then
  echo "=== 首次部署 ==="

  if ! command -v nginx &>/dev/null; then
    echo "[安装] Nginx..."
    if command -v dnf &>/dev/null; then
      dnf install -y nginx
    else
      apt update && apt install -y nginx
    fi
    systemctl enable nginx
  fi

  if ! command -v node &>/dev/null; then
    echo "[安装] Node.js..."
    if command -v dnf &>/dev/null; then
      curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
      dnf install -y nodejs
    else
      curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
      apt install -y nodejs
    fi
  fi

  if ! command -v pm2 &>/dev/null; then
    echo "[安装] PM2..."
    npm install -g pm2
  fi

  echo "[配置] 复制 Nginx 配置..."
  cp nginx/fundcal.conf /etc/nginx/conf.d/fundcal.conf
  nginx -t && systemctl reload nginx

  echo "[安装] npm 依赖..."
  npm install

  echo "[启动] PM2 启动 API 服务..."
  pm2 start ecosystem.config.cjs
  pm2 save

  echo ""
  echo "=== 部署完成 ==="
  echo "访问: http://$(hostname -I | awk '{print $1}')"
  exit 0
fi

echo "=== 更新部署 ==="
echo "[拉取] git pull..."
git pull "$REPO_REMOTE" main

echo "[安装] npm 依赖..."
npm install

echo "[重启] PM2 重启 API..."
pm2 restart fund-api || pm2 start ecosystem.config.cjs

echo "[重载] Nginx..."
cp nginx/fundcal.conf /etc/nginx/conf.d/fundcal.conf
nginx -t && systemctl reload nginx

echo ""
echo "=== 更新完成 ==="
