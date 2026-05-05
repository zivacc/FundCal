/**
 * FundCal 全局配置
 *
 * === 纯静态模式（默认，GitHub Pages 即用） ===
 * 无需任何配置！前端自动从仓库中的静态 JSON 文件读取数据：
 *   - data/allfund/allfund.json     → 全部基金费率
 *   - data/allfund/search-index.json → 搜索索引
 *   - data/allfund/feeder-index.json → 联接基金索引
 *   - data/allfund/fund-stats.json   → 统计数据
 *
 * === 使用远程 API（可选，性能更好） ===
 * 取消下方注释并填入你的阿里云服务器地址：
 *   window.FUND_FEE_API_BASE = 'http://你的阿里云公网IP/api/fund';
 * 前端会优先调用 API，API 不可用时自动回退到静态文件。
 *
 * === 本地开发 ===
 * 无需配置，自动使用 http://localhost:3457/api/fund
 */

//window.FUND_FEE_API_BASE = 'https://fundcal.ziva.cc.cd/api/fund';
