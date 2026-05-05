/**
 * Tushare Pro HTTP client.
 * POST JSON to the broker proxy, parse the { fields, items } response into
 * an array of plain objects, with built-in retry and rate-limiting.
 */

import { requireEnv } from './env.js';

const MAX_RETRIES = parseInt(process.env.TUSHARE_MAX_RETRIES || '5', 10);
const RETRY_DELAY_MS = parseInt(process.env.TUSHARE_RETRY_BASE_MS || '2000', 10);
const RATE_LIMIT_BASE_MS = parseInt(process.env.TUSHARE_RATE_LIMIT_BASE_MS || '5000', 10);
const BASE_GAP_MS = parseInt(process.env.TUSHARE_GAP_MS || '200', 10);
const MAX_GAP_MS = parseInt(process.env.TUSHARE_MAX_GAP_MS || '5000', 10);

// 动态节流：连续触发限流时拉大间隔，平稳后逐步回收
let currentGapMs = BASE_GAP_MS;
let nextSlotAt = 0;

async function reserveSlot() {
  const now = Date.now();
  const slot = Math.max(now, nextSlotAt);
  nextSlotAt = slot + currentGapMs;
  const wait = slot - now;
  if (wait > 0) await sleep(wait);
}

function bumpGap() {
  currentGapMs = Math.min(MAX_GAP_MS, Math.max(currentGapMs * 2, BASE_GAP_MS * 2));
}

function easeGap() {
  if (currentGapMs > BASE_GAP_MS) {
    currentGapMs = Math.max(BASE_GAP_MS, Math.floor(currentGapMs * 0.9));
  }
}

function isRateLimitError(err, status) {
  if (status === 429) return true;
  const msg = err?.message || '';
  return /HTTP 429|Too Many Requests|每分钟|请求速度过快|频率/.test(msg);
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Call a Tushare API.
 *
 * @param {string} apiName   e.g. 'fund_nav', 'fund_basic'
 * @param {object} params    API-specific parameters
 * @param {string} [fields]  Comma-separated field list (optional)
 * @returns {Promise<object[]>}  Array of row objects
 */
export async function tushare(apiName, params = {}, fields = '') {
  const token = requireEnv('TUSHARE_TOKEN');
  const apiUrl = requireEnv('TUSHARE_API_URL');

  const body = {
    api_name: apiName,
    token,
    params,
    fields,
  };

  let lastError;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    await reserveSlot();

    let httpStatus = 0;
    try {
      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30000),
      });
      httpStatus = res.status;

      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText}`);
      }

      const json = await res.json();

      if (json.code !== 0) {
        const msg = json.msg || `Tushare error code ${json.code}`;
        const err = new Error(msg);
        if (json.code === -2001 || isRateLimitError(err, 0)) {
          bumpGap();
          const delay = RATE_LIMIT_BASE_MS * Math.pow(2, attempt - 1);
          console.warn(`  ⏳ 限流(业务码): ${msg}，等待 ${delay}ms 后重试 (${attempt}/${MAX_RETRIES})，全局间隔升至 ${currentGapMs}ms`);
          await sleep(delay);
          lastError = err;
          continue;
        }
        throw err;
      }

      const { fields: columns, items } = json.data || {};
      easeGap();
      if (!columns || !items) return [];

      return items.map((row) => {
        const obj = {};
        for (let i = 0; i < columns.length; i++) {
          obj[columns[i]] = row[i];
        }
        return obj;
      });
    } catch (err) {
      lastError = err;
      const rateLimited = isRateLimitError(err, httpStatus);
      if (attempt < MAX_RETRIES) {
        let delay;
        if (rateLimited) {
          bumpGap();
          delay = RATE_LIMIT_BASE_MS * Math.pow(2, attempt - 1);
          console.warn(`  ⏳ 限流(${httpStatus || 'net'}): ${err.message}，等待 ${delay}ms 后重试 (${attempt}/${MAX_RETRIES})，全局间隔升至 ${currentGapMs}ms`);
        } else {
          delay = RETRY_DELAY_MS * attempt;
          console.warn(`  ⚠️ 请求失败: ${err.message}，${delay}ms 后重试 (${attempt}/${MAX_RETRIES})`);
        }
        await sleep(delay);
      }
    }
  }

  throw lastError;
}

/**
 * Fetch all records for a Tushare API. 默认单次请求覆盖整个日期区间；
 * 仅当返回行数触达 Tushare 10000 行硬上限时，回退到按 segmentYears 年分段拉取。
 *
 * @param {string} apiName
 * @param {object} baseParams  Must include ts_code; may include start_date/end_date
 * @param {string} fields
 * @param {number} [segmentYears=3]
 * @returns {Promise<object[]>}
 */
const TUSHARE_ROW_CAP = 10000;

export async function tushareAllPages(apiName, baseParams, fields = '', segmentYears = 3) {
  const startDate = baseParams.start_date || '19980101';
  const endDate = baseParams.end_date || formatDate(new Date());

  // 先单次请求；99% 的基金一辈子 < 10000 条
  const rows = await tushare(apiName, { ...baseParams, start_date: startDate, end_date: endDate }, fields);
  if (rows.length < TUSHARE_ROW_CAP) return rows;

  // 触达上限：分段重拉
  return fetchSegmented(apiName, baseParams, fields, startDate, endDate, segmentYears);
}

async function fetchSegmented(apiName, baseParams, fields, startDate, endDate, segmentYears) {
  const startYear = parseInt(startDate.slice(0, 4), 10);
  const endYear = parseInt(endDate.slice(0, 4), 10);
  const allRows = [];

  for (let y = startYear; y <= endYear; y += segmentYears) {
    const segStart = y === startYear ? startDate : `${y}0101`;
    const segEnd = (y + segmentYears - 1) >= endYear
      ? endDate
      : `${y + segmentYears - 1}1231`;
    if (segStart > endDate) break;

    const params = { ...baseParams, start_date: segStart, end_date: segEnd };
    const rows = await tushare(apiName, params, fields);
    allRows.push(...rows);
  }
  return allRows;
}

function formatDate(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}${mm}${dd}`;
}

export { formatDate };
