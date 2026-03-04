/**
 * 本地开发一键启动：同时运行静态文件服务（3456）+ API 服务（3457）
 * 用法：node scripts/dev-server.js
 */

import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const STATIC_PORT = process.env.STATIC_PORT || 3456;
const API_PORT = process.env.API_PORT || 3457;

function run(label, cmd, args, options = {}) {
  const child = spawn(cmd, args, {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: true,
    ...options,
  });
  child.stdout.on('data', (d) => process.stdout.write(`[${label}] ${d}`));
  child.stderr.on('data', (d) => process.stderr.write(`[${label}] ${d}`));
  child.on('close', (code) => {
    console.log(`[${label}] 进程退出，代码 ${code}`);
  });
  return child;
}

console.log('=== FundCal 本地开发服务器 ===');
console.log(`静态文件: http://localhost:${STATIC_PORT}`);
console.log(`API 服务: http://localhost:${API_PORT}/api/fund/:code/fee`);
console.log('按 Ctrl+C 停止所有服务\n');

const api = run('API', 'node', ['scripts/serve-fund-api.js', String(API_PORT)]);
const serve = run('静态', 'npx', ['serve', '.', '-p', String(STATIC_PORT), '-s']);

process.on('SIGINT', () => {
  api.kill();
  serve.kill();
  process.exit(0);
});

process.on('SIGTERM', () => {
  api.kill();
  serve.kill();
  process.exit(0);
});
