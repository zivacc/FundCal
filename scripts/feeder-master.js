import { findPublicFund } from './fund-relations.js';
import { FUND_PAGE_SOURCE, fundPageUrl, plainText, assertFundPageIdentity, createPublicFundPageLoader } from './public-fund-page.js';

export function parseFeederMaster(html, code) {
  assertFundPageIdentity(html, code);
  const header = html.match(/<div\b[^>]*class=["'][^"']*\bfundDetail-header\b[^"']*["'][^>]*>([\s\S]*?)<div\b[^>]*class=["'][^"']*\bfundDetail-tools\b/i)?.[1];
  if (!header || !header.includes('fundDetail-tit') || !new RegExp(`<span\\b[^>]*>\\s*${code}\\s*</span>`).test(header)) throw new Error('Fund header identity mismatch');
  const codes = [];
  for (const [, attrs, label] of header.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    // ETF pages have the reverse link “查看相关ETF联接”; that is never a master relation.
    if (!/^查看相关ETF\s*[>＞»]?$/i.test(plainText(label).replace(/&gt;/gi, '>'))) continue;
    const target = attrs.match(/\bhref=["'](?:https?:)?\/\/fund\.eastmoney\.com\/(\d{6})\.html["']/i)?.[1];
    if (!target || target === code) throw new Error('Invalid target ETF link');
    codes.push(target);
  }
  if (new Set(codes).size > 1) throw new Error('Ambiguous target ETF links');
  return { code, status: codes.length ? 'available' : 'unavailable', masterCode: codes[0] || null,
    source: FUND_PAGE_SOURCE, sourceUrl: fundPageUrl(code) };
}

export function createFeederMasterLoader(options = {}) {
  const loadPage = createPublicFundPageLoader({ ...options, parse: parseFeederMaster });
  return async (db, relations) => {
    if (!relations?.isFeeder || !relations.masterMissing) return relations;
    const result = await loadPage(relations.code);
    const masterLookup = { status: result.status, source: result.source || FUND_PAGE_SOURCE,
      sourceUrl: result.sourceUrl || fundPageUrl(relations.code), fetchedAt: result.fetchedAt || null };
    if (result.status !== 'available') return { ...relations, masterLookup };
    const row = findPublicFund(db, result.masterCode);
    const master = { code: result.masterCode, name: row?.name || `目标 ETF ${result.masterCode}`,
      relation: 'master', available: Boolean(row), basis: 'eastmoney_explicit_target_etf' };
    return { ...relations, masterMissing: false, masterLookup,
      feederFunds: [master, ...relations.feederFunds.filter(item => item.code !== master.code)] };
  };
}
