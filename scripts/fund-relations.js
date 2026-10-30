/** Read-only links between public fund references; no database migrations or writes. */
import fs from 'node:fs';

const feederFile = new URL('../data/allfund/feeder-index.json', import.meta.url);
let feederCache;
let feederMtime;

export function readFeederRelations() {
  try {
    const { mtimeMs } = fs.statSync(feederFile);
    if (mtimeMs !== feederMtime) {
      feederCache = JSON.parse(fs.readFileSync(feederFile, 'utf8'));
      feederMtime = mtimeMs;
    }
    return feederCache;
  } catch { return { unavailable: true }; }
}

// Preserve currency, investment horizon and hedging qualifiers. Only remove a terminal class.
export function shareFamily(name) {
  const value = String(name || '').normalize('NFKC').replace(/\s+/g, '').trim();
  const match = value.match(/^(.*(?:[\u3400-\u9fff)]|ETF))([A-Z])(?:类|份额)?$/);
  return match ? { name: match[1], shareClass: match[2] } : { name: value, shareClass: null };
}

function fundRows(db, management) {
  return db.prepare(`SELECT b.code, b.ts_code,
    COALESCE(NULLIF(b.name,''),m.name_crawler,'') AS name,
    COALESCE(NULLIF(b.management,''),m.management_crawler,'') AS management,
    COALESCE(NULLIF(b.fund_type,''),m.fund_type_crawler,'') AS fundType
    FROM fund_basic b JOIN fund_meta m ON m.ts_code=b.ts_code
    WHERE b.ts_code=b.code||'.OF' ${management == null ? '' : "AND COALESCE(NULLIF(b.management,''),m.management_crawler,'')=?"}
    ORDER BY b.code`).all(...(management == null ? [] : [management]));
}

export function findPublicFund(db, code) {
  if (!/^\d{6}$/.test(code)) return null;
  return db.prepare(`SELECT b.code, COALESCE(NULLIF(b.name,''),m.name_crawler,'') AS name,
    COALESCE(NULLIF(b.management,''),m.management_crawler,'') AS management,
    COALESCE(NULLIF(b.fund_type,''),m.fund_type_crawler,'') AS fundType
    FROM fund_basic b JOIN fund_meta m ON m.ts_code=b.ts_code
    WHERE b.ts_code=?`).get(`${code}.OF`) || null;
}

export function isFofFund(fund) {
  return Boolean(fund && /FOF|基金中基金|基金中的基金/i.test(`${fund.name} ${fund.fundType}`));
}

export function loadFundRelations(db, code, feederIndex = readFeederRelations()) {
  const fund = findPublicFund(db, code);
  if (!fund) return null;
  const family = shareFamily(fund.name);
  const shareClasses = fund.management && family.name ? fundRows(db, fund.management)
    .filter(row => /^\d{6}$/.test(row.code) && row.code !== code && shareFamily(row.name).name === family.name
      && (family.shareClass || shareFamily(row.name).shareClass))
    .map(row => ({ code: row.code, name: row.name, shareClass: shareFamily(row.name).shareClass,
      available: true, basis: 'same_manager_exact_share_name' })) : [];
  const feeder = feederIndex?.codeToFeeder?.[code];
  const isFeeder = feeder?.isFeeder ?? /联接/.test(`${fund.name} ${fund.fundType}`);
  const groups = feeder ? (Array.isArray(feeder.masterKeys) ? feeder.masterKeys.map(key => ({ key, ...feederIndex.feederByMasterKey?.[key] }))
    : [{ key: feeder.masterKey, ...feederIndex.feederByMasterKey?.[feeder.masterKey], ...feeder }]) : [];
  const references = new Map();
  for (const group of groups) {
    for (const target of [group.masterCode, ...(group.feederCodes || [])]) {
      if (!/^\d{6}$/.test(target || '') || target === code) continue;
      const row = findPublicFund(db, target);
      references.set(target, { code: target, name: row?.name || (target === group.masterCode ? group.masterName : '') || target,
        relation: target === group.masterCode ? 'master' : 'feeder', available: Boolean(row), basis: 'local_feeder_index' });
    }
  }
  return { code, shareClasses, feederFunds: [...references.values()], isFof: isFofFund(fund), isFeeder,
    masterMissing: isFeeder && ![...references.values()].some(row => row.relation === 'master'),
    feederIndexAvailable: !feederIndex?.unavailable,
    shareClassBasis: '同管理人且仅份额后缀不同的名称匹配，未将币种、期限或对冲版本合并。',
    feederBasis: '来自本地联接基金索引（精确名称匹配及已有人工映射）。' };
}
