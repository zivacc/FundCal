/** On-demand public disclosure adapter. Deliberately separate from fund crawls and SQLite. */
import { findPublicFund, isFofFund } from './fund-relations.js';

import { FUND_PAGE_SOURCE as SOURCE, plainText as textOnly, assertFundPageIdentity, createPublicFundPageLoader } from './public-fund-page.js';

export function parseFofHoldings(html, code) {
  assertFundPageIdentity(html, code);
  const section = html.match(/<div\b[^>]*id=["']quotationItem_DataTable["'][^>]*>([\s\S]*?)<!--\s*数据tab end/i)?.[1];
  if (!section) throw new Error('Holdings section missing');
  const blocks = [...section.matchAll(/<li\b[^>]*\bid=["']position_shares["'][^>]*>([\s\S]*?)<\/li>/gi)];
  for (const [, block] of blocks) {
    const table = block.match(/<table\b[^>]*>([\s\S]*?)<\/table>/i)?.[1];
    if (!table || !/<th\b[^>]*>\s*基金名称\s*<\/th>/i.test(table) || !/持仓占比/.test(table)) continue;
    const asOfDate = textOnly(block).match(/持仓截止日期[:：]\s*(\d{4}-\d{2}-\d{2})/)?.[1];
    if (!asOfDate || new Date(asOfDate).toISOString().slice(0, 10) !== asOfDate) throw new Error('Holdings report date missing');
    const rows = [];
    const seen = new Set();
    for (const [, row] of table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const cells = [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(m => m[1]);
      if (!cells.length) continue;
      const link = cells[0].match(/<a\b([^>]*\bhref=["'](?:https?:)?\/\/fund\.eastmoney\.com\/(\d{6})\.html["'][^>]*)>([\s\S]*?)<\/a>/i);
      const value = textOnly(cells[1] || '');
      const weightPct = /^\d+(?:\.\d+)?%$/.test(value) ? Number(value.slice(0, -1)) : null;
      if (!link || seen.has(link[2]) || weightPct == null || weightPct > 100) throw new Error('Invalid fund holdings row');
      seen.add(link[2]);
      const name = textOnly(link[1].match(/\btitle=["']([^"']*)["']/i)?.[1] || link[3]);
      rows.push({ code: link[2], name, weightPct });
    }
    if (!rows.length || rows.length > 10 || rows.reduce((sum, row) => sum + row.weightPct, 0) > 100.1) throw new Error('Invalid holdings coverage');
    return { code, status: 'available', source: SOURCE, sourceUrl: `https://fund.eastmoney.com/${code}.html`,
      asOfDate, coverage: 'top10', rows };
  }
  return { code, status: 'unavailable', source: SOURCE, sourceUrl: `https://fund.eastmoney.com/${code}.html`,
    asOfDate: null, coverage: 'top10', rows: [] };
}

export function createFofHoldingsLoader(options = {}) {
  const loadPage = createPublicFundPageLoader({ ...options, parse: parseFofHoldings });
  return async function load(db, code) {
    const fund = findPublicFund(db, code);
    if (!fund) return null;
    if (!isFofFund(fund)) return { code, status: 'not_applicable', rows: [] };
    return withAvailability(db, await loadPage(code));
  };
}

function withAvailability(db, data) {
  return { ...data, rows: data.rows.map(row => ({ ...row, available: Boolean(findPublicFund(db, row.code)) })) };
}
