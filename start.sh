#!/usr/bin/env bash
# FundCal 本地开发一键启动脚本（Linux/Mac）
set -e

cd "$(dirname "$0")"

if ! command -v node &>/dev/null; then
  echo "[错误] 未找到 Node.js，请先安装: https://nodejs.org"
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "[安装] 正在安装依赖..."
  npm install
fi

echo "===================================="
echo "  FundCal 本地开发服务器"
echo "===================================="
echo ""
echo "[提示] 打开浏览器访问 http://localhost:3456"
echo "[提示] 按 Ctrl+C 停止所有服务"
echo ""

node scripts/dev-server.js
