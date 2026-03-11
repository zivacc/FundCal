/**
 * 基于 data/allfund/allfund.json 生成缓存基金统计数据 data/allfund/fund-stats.json，
 * 并为 tracking 维度补充拼音首字母 initials 字段，供前端按「跟踪指数名称 / 首字母」搜索使用。
 *
 * 使用方式：
 *   node scripts/build-fund-stats.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pinyin } from 'pinyin-pro';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ALLFUND_DIR = path.join(__dirname, '..', 'data', 'allfund');
const ALLFUND_PATH = path.join(ALLFUND_DIR, 'allfund.json');
const FUND_STATS_PATH = path.join(ALLFUND_DIR, 'fund-stats.json');

function getInitials(text) {
  if (!text || typeof text !== 'string') return '';
  try {
    const arr = pinyin(text, { pattern: 'first', toneType: 'none', type: 'array' });
    return (arr || []).join('').toLowerCase();
  } catch {
    return '';
  }
}

/** 按跟踪标的、基金公司、业绩基准、基金类型聚合统计 */
function buildStats(allfund) {
  /** @type {{codes:string[],funds:Record<string, any>}} */
  const data = allfund;
  const codes = Array.isArray(data.codes) ? data.codes : Object.keys(data.funds || {});
  const store = data.funds || {};

  const trackingMap = new Map();  // label -> {label,count,codes:Set}
  const managerMap = new Map();
  const benchmarkMap = new Map();
  const fundTypeMap = new Map();

  let total = 0;
  let trackingFundCount = 0;

  for (const code of codes) {
    const f = store[code];
    if (!f) continue;
    total += 1;

    const trackingTarget = (f.trackingTarget || '').trim();
    const fundManager = (f.fundManager || '').trim();
    const performanceBenchmark = (f.performanceBenchmark || '').trim();
    const fundType = (f.fundType || '').trim();

    const isNoTracking = !trackingTarget || trackingTarget === '该基金无跟踪标的' || trackingTarget.includes('该基金无跟踪标的');
    if (!isNoTracking) {
      trackingFundCount += 1;
      const key = trackingTarget;
      let entry = trackingMap.get(key);
      if (!entry) {
        entry = { label: key, count: 0, codes: new Set() };
        trackingMap.set(key, entry);
      }
      if (!entry.codes.has(code)) {
        entry.codes.add(code);
        entry.count += 1;
      }
    }

    if (fundManager) {
      const key = fundManager;
      let entry = managerMap.get(key);
      if (!entry) {
        entry = { label: key, count: 0, codes: new Set() };
        managerMap.set(key, entry);
      }
      if (!entry.codes.has(code)) {
        entry.codes.add(code);
        entry.count += 1;
      }
    }

    if (performanceBenchmark) {
      const key = performanceBenchmark;
      let entry = benchmarkMap.get(key);
      if (!entry) {
        entry = { label: key, count: 0, codes: new Set() };
        benchmarkMap.set(key, entry);
      }
      if (!entry.codes.has(code)) {
        entry.codes.add(code);
        entry.count += 1;
      }
    }

    if (fundType) {
      const key = fundType;
      let entry = fundTypeMap.get(key);
      if (!entry) {
        entry = { label: key, count: 0, codes: new Set() };
        fundTypeMap.set(key, entry);
      }
      if (!entry.codes.has(code)) {
        entry.codes.add(code);
        entry.count += 1;
      }
    }
  }

  const toSortedArray = (m) => {
    return Array.from(m.values())
      .map(e => ({ label: e.label, count: e.count, codes: Array.from(e.codes) }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'zh-CN'));
  };

  const tracking = toSortedArray(trackingMap).map(item => ({
    ...item,
    initials: getInitials(item.label),
  }));

  const manager = toSortedArray(managerMap);
  const benchmark = toSortedArray(benchmarkMap);
  const fundType = toSortedArray(fundTypeMap);

  return {
    total,
    trackingFundCount,
    tracking,
    manager,
    benchmark,
    fundType,
  };
}

function main() {
  if (!fs.existsSync(ALLFUND_PATH)) {
    console.error(`未找到 allfund 文件：${ALLFUND_PATH}，请先运行 build-allfund.js`);
    process.exit(1);
  }

  let allfund;
  try {
    allfund = JSON.parse(fs.readFileSync(ALLFUND_PATH, 'utf8'));
  } catch (e) {
    console.error('读取或解析 allfund.json 失败：', e);
    process.exit(1);
  }

  const stats = buildStats(allfund);
  fs.mkdirSync(ALLFUND_DIR, { recursive: true });
  fs.writeFileSync(FUND_STATS_PATH, JSON.stringify(stats), 'utf8');
  console.log(`已生成 ${FUND_STATS_PATH}，total=${stats.total}，trackingFundCount=${stats.trackingFundCount}。`);
}

main();

