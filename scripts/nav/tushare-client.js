/**
 * Tushare Pro HTTP client.
 * POST JSON to the broker proxy, parse the { fields, items } response into
 * an array of plain objects, with built-in retry and rate-limiting.
 */

import { requireEnv } from './env.js';

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;
const REQUEST_GAP_MS = 300;

let lastRequestTime = 0;

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
    const now = Date.now();
    const gap = REQUEST_GAP_MS - (now - lastRequestTime);
    if (gap > 0) await sleep(gap);
    lastRequestTime = Date.now();

    try {
      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30000),
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText}`);
      }

      const json = await res.json();

      if (json.code !== 0) {
        const msg = json.msg || `Tushare error code ${json.code}`;
        if (json.code === -2001 || (json.msg && json.msg.includes('每分钟'))) {
          console.warn(`  ⏳ 频率限制，等待 ${RETRY_DELAY_MS * attempt}ms 后重试 (${attempt}/${MAX_RETRIES})`);
          await sleep(RETRY_DELAY_MS * attempt);
          lastError = new Error(msg);
          continue;
        }
        throw new Error(msg);
      }

      const { fields: columns, items } = json.data || {};
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
      if (attempt < MAX_RETRIES) {
        const delay = RETRY_DELAY_MS * attempt;
        console.warn(`  ⚠️ 请求失败: ${err.message}，${delay}ms 后重试 (${attempt}/${MAX_RETRIES})`);
        await sleep(delay);
      }
    }
  }

  throw lastError;
}

/**
 * Fetch all records for a paginated Tushare API by splitting the date range
 * into yearly segments. Used for fund_nav which has a 10000-row limit.
 *
 * @param {string} apiName
 * @param {object} baseParams  Must include ts_code; may include start_date/end_date
 * @param {string} fields
 * @param {number} [segmentYears=3]  How many years per segment
 * @returns {Promise<object[]>}
 */
export async function tushareAllPages(apiName, baseParams, fields = '', segmentYears = 3) {
  const startDate = baseParams.start_date || '19980101';
  const endDate = baseParams.end_date || formatDate(new Date());

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
