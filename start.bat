@echo off
chcp 65001 >nul 2>&1
title FundCal 本地开发服务器

echo ====================================
echo   FundCal 本地开发服务器
echo ====================================
echo.

cd /d "%~dp0"

where node >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [错误] 未找到 Node.js，请先安装: https://nodejs.org
    pause
    exit /b 1
)

if not exist node_modules (
    echo [安装] 正在安装依赖...
    call npm install
    echo.
)

echo [启动] 正在启动 API 服务 (端口 3457) 和静态文件服务 (端口 3456)...
echo [提示] 打开浏览器访问 http://localhost:3456
echo [提示] 按 Ctrl+C 停止所有服务
echo.

node scripts/dev-server.js

pause
