import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { indexReturnType } from '../../js/domain/index-return.js';
export { indexReturnType };

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SKILL = path.join(ROOT, '.agents/skills/wind-mcp-skill');
export const WIND_SOURCE = 4;
export const isUnavailableWindInstrument = error => /未识别到有效的金融标的/.test(error?.message || String(error));

export function windTables(outer) {
  if (outer.ok === false || outer.isError) throw new Error(`${outer.code || 'backend_error'}: ${outer.message || JSON.stringify(outer.content)}`);
  const tables = [];
  function visit(value) {
    if (!value || typeof value !== 'object') return;
    if (value.error) throw new Error(`backend_error: ${JSON.stringify(value.error)}`);
    if (Array.isArray(value.columns) && Array.isArray(value.rows)) {
      const names = value.columns.map(c => c.name);
      if (new Set(names).size !== names.length) throw new Error('Duplicate Wind columns');
      tables.push({ ...value, records: value.rows.map(row => {
        if (!Array.isArray(row) || row.length !== names.length) throw new Error('Wind row/column mismatch');
        return Object.fromEntries(names.map((name, i) => [name, row[i]]));
      }) });
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      if (key === 'text' && typeof child === 'string') {
        try { visit(JSON.parse(child)); } catch (e) {
          if (!(e instanceof SyntaxError)) throw e;
        }
      } else visit(child);
    }
  }
  visit(outer);
  return tables;
}

export async function callWindIndex(tool, params, { cacheDir = path.join(ROOT, 'data/wind/raw') } = {}) {
  const hash = createHash('sha256').update(JSON.stringify({ tool, params })).digest('hex');
  await mkdir(cacheDir, { recursive: true });
  const cachedPath = path.join(cacheDir, `${hash}.json`);
  try {
    const cached = JSON.parse(await readFile(cachedPath, 'utf8'));
    windTables(cached.response);
    return cached;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const requestFile = `scripts/request-${randomUUID()}.json`;
  await writeFile(path.join(SKILL, requestFile), JSON.stringify(params));
  let result;
  try {
    result = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['scripts/cli.mjs', 'call', 'index_data', tool, `@${requestFile}`], {
        cwd: SKILL, env: { ...process.env, WIND_SKILL_AUTO_UPDATE: '0' }, stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '', stderr = '', failure;
      const timer = setTimeout(() => { failure = new Error('Wind request timeout (120s)'); child.kill('SIGKILL'); }, 120000);
      child.stdout.on('data', chunk => {
        stdout += chunk;
        if (stdout.length > 64 * 1024 * 1024) { failure = new Error('Wind response exceeds 64 MiB'); child.kill('SIGKILL'); }
      });
      child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-2000); });
      child.on('error', error => { clearTimeout(timer); reject(error); });
      child.on('close', code => {
        clearTimeout(timer);
        if (failure) return reject(failure);
        try {
          const response = JSON.parse(stdout);
          windTables(response);
          if (code !== 0) throw new Error(`Wind CLI exit ${code}: ${stderr}`);
          resolve({ requestedAt: new Date().toISOString(), tool, params, response });
        } catch (e) { reject(e); }
      });
    });
  } finally { await unlink(path.join(SKILL, requestFile)).catch(() => {}); }
  await writeFile(cachedPath, JSON.stringify(result));
  return result;
}

export function normalizeWindKline(outer, tsCode, begin, end) {
  const tables = windTables(outer);
  if (!tables.length) throw new Error('Wind Kline response has no table');
  if (tables.length !== 1) throw new Error('Unexpected multiple Kline tables');
  const table = tables[0];
  const names = table.columns.map(c => c.name);
  if (!names.includes('TIME') || !names.includes('MATCH')) throw new Error('Wind Kline missing TIME/MATCH');
  const number = (value, required = false) => {
    if (value == null || value === '' || value === 'INVALID') {
      if (required) throw new Error('Missing index close');
      return null;
    }
    if ((typeof value !== 'number' && typeof value !== 'string') || !Number.isFinite(Number(value))) throw new Error('Invalid Wind number');
    return Number(value);
  };
  const seen = new Set();
  const missingCloseDates = [];
  const rows = table.records.map(raw => {
    // Preserve the provider's trading date; historical offsets are not always +08:00.
    const date = String(raw.TIME).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) throw new Error(`Invalid Wind date: ${raw.TIME}`);
    if (date < begin || date > end) throw new Error(`Wind date outside requested interval: ${date}`);
    if (seen.has(date)) throw new Error(`Duplicate Wind trading date: ${date}`);
    seen.add(date);
    if(raw.MATCH==null || raw.MATCH==='' || raw.MATCH==='INVALID') {
      missingCloseDates.push(date);return null;
    }
    const close = number(raw.MATCH, true);
    if (close <= 0) throw new Error('Nonpositive index close');
    return { ts_code: tsCode, end_date: date.replaceAll('-', ''), close,
      open: number(raw.OPEN), high: number(raw.HIGH), low: number(raw.LOW),
      // Volume unit is not declared by this tool. Keep raw fields in the private receipt.
      vol: null, amount: table.unit?.['TURNOVER 单位：'] === '元' ? number(raw.TURNOVER) : null,
      pre_close: null, pct_chg: null, source: WIND_SOURCE };
  }).filter(Boolean).sort((a, b) => a.end_date.localeCompare(b.end_date));
  rows.missingCloseDates=missingCloseDates.sort();
  return rows;
}

export function ensureIndexReturnLinks(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS index_return_links (
    index_ts_code TEXT NOT NULL REFERENCES index_basic(ts_code),
    return_ts_code TEXT NOT NULL REFERENCES index_basic(ts_code),
    source TEXT NOT NULL DEFAULT 'wind',
    verified_at TEXT NOT NULL,
    PRIMARY KEY(index_ts_code, return_ts_code)
  )`);
}

/** Add missing observations only. Other sources and existing observations are retained. */
export function insertWindRows(db, rows) {
  const stmt = db.prepare(`INSERT INTO index_daily
    (ts_code,end_date,open,high,low,close,pre_close,pct_chg,vol,amount,source)
    VALUES (@ts_code,@end_date,@open,@high,@low,@close,@pre_close,@pct_chg,@vol,@amount,@source)
    ON CONFLICT(ts_code,end_date) DO NOTHING`);
  return db.transaction(() => rows.reduce((n, row) => n + stmt.run(row).changes, 0))();
}

export function selectTotalReturnCandidates(base, candidates) {
  // An explicitly verified total-return series is usable itself, even when
  // the provider leaves its associated-code field empty (e.g. 000012.SH).
  if (indexReturnType(base) === 'total') return [base];
  const allowed = new Set(String(base['全收益指数代码'] || '').split(/[;,；]/).map(s => s.trim().toUpperCase()).filter(Boolean));
  const full = base['证券全称'] || '';
  const stem = full.replace(/(?:全收益|净收益|价格)?指数$/, '');
  const names = new Set([`${stem}全收益指数`, `${stem}总回报指数`, `${stem}收益指数`, `${stem}全收益`, `${stem}R`, `${full}R`, `${full}全收益`, `${full}股息累计指数`, `${full}(总股息累计指数)`, `${full}（总股息累计指数）`]);
  return candidates.filter(row => {
    if (!allowed.has(String(row['Wind代码']).toUpperCase()) || indexReturnType(row) !== 'total') return false;
    if (row['Wind代码'].toUpperCase() === base['Wind代码'].toUpperCase()) return true;
    // Exact family match excludes FX, industry, style and strategy variants.
    if(names.has(row['证券全称'])) return true;
    // Some publishers use a renamed family or an R suffix. An unambiguous
    // provider association must also agree in publisher and base date.
    const currencyWords=['人民币','港币','美元','欧元','英镑','加元','日元','澳元','HKD','CNY','USD','EUR','GBP','CAD','JPY','AUD'];
    const addsCurrency=currencyWords.some(word=>String(row['证券全称']).includes(word)&&!full.includes(word));
    if(allowed.size===1 && !addsCurrency && base['发布机构'] && base['基期']
      && row['发布机构']===base['发布机构'] && row['基期']===base['基期']) return true;
    const currency=full.match(/\((HKD|CNY|USD)\)$/)?.[1];
    if(currency && String(row['Wind代码']).includes(currency)) {
      const plainStem=full.replace(/\((HKD|CNY|USD)\)$/,'').replace(/指数$/,'');
      return row['证券全称']===`${plainStem}全收益指数`;
    }
    return false;
  });
}
