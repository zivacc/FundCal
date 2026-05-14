/**
 * FundCal 全局配置
 *
 * === 推荐：使用远程 API（生产部署） ===
 * 取消下方注释并填入你的服务器地址：
 *   window.FUND_FEE_API_BASE = 'https://你的域名/api/fund';
 * 前端优先调用 /api/fund 与 /api/nav，命中边缘缓存则零回源。
 *
 * === 本地开发 ===
 * 无需配置，自动使用 http://localhost:3457/api/fund 与 /api/nav。
 *
 * === 纯静态模式（GitHub Pages 等） ===
 * 当 hostname 以 `.github.io` 结尾时，API base 自动为 null，前端仅能覆盖以下
 * 5 个小静态索引 + 交易日历：
 *   - data/allfund/search-index.json       → 搜索索引
 *   - data/allfund/feeder-index.json       → 联接基金索引
 *   - data/allfund/fund-stats.json         → 统计聚合
 *   - data/allfund/index-search-index.json → 指数搜索
 *   - data/allfund/overseas-codes.json     → 海外指数代码
 *   - data/allfund/trade-calendar.json     → A 股交易日历
 * 单基金费率详情 / 基金列表 / NAV 比较在纯静态模式下不可用，详见
 * docs/audit-data-flow.md。历史 allfund.json / funds/<code>.json 已下线。
 */

//window.FUND_FEE_API_BASE = 'https://fundcal.ziva.cc.cd/api/fund';
