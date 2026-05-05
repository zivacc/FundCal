/**
 * PM2 ecosystem 配置 — 服务器端使用
 * 启动：pm2 start ecosystem.config.cjs
 * 查看：pm2 list / pm2 logs fund-api
 * 开机自启：pm2 save && pm2 startup
 */
module.exports = {
  apps: [
    {
      name: 'fund-api',
      script: 'scripts/serve-fund-api.js',
      args: '3457',
      cwd: '/var/www/fundcal',
      node_args: '--experimental-modules',
      env: {
        NODE_ENV: 'production',
      },
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      watch: false,
      max_memory_restart: '500M',
    },
  ],
};
