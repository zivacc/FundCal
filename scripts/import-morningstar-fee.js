#!/usr/bin/env node
/**
 * 导入 Morningstar 基金综合费率 XLSX 历史快照。
 *
 * 数据保存在独立的 morningstar_* 表，不写 fund_basic / fund_meta，
 * 也不参与 apply-merge-rules。XLSX 通过系统 unzip 流式读取，不新增 npm 依赖。
 *
 * 用法：
 *   npm run import:morningstar-fee
 *   npm run import:morningstar-fee -- --dry-run
 *   npm run import:morningstar-fee -- --force
 */

import { createHash } from 'crypto';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDb, closeDb } from './nav/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const DEFAULT_SOURCE_DIR = path.join(ROOT, 'data', 'morningstar_full_fund_fee');

const HEADER_ROW_1 = [
  '名称', '代码', '成立日期', '晨星分类',
  '综合费率%', '综合费率%',
  '显性费率%', '显性费率%', '显性费率%', '显性费率%', '显性费率%',
  '隐性费率%', '隐性费率%', '隐性费率%', '隐性费率%',
  '期间平均规模(亿)', '换手率%', '换手率%',
  '近一年回报%', '近三年回报%', '近五年回报%',
  '近一年最大回撤%', '近三年最大回撤%', '近五年最大回撤%',
  '基金公司', '是否ETF', '是否FOF', '是否指数', '是否指数增强',
];

const HEADER_ROW_2 = [
  null, null, null, null,
  '综合费率', '同类排名百分比',
  '显性费率', '同类排名百分比', '管理费', '托管费', '销售服务费',
  '隐性费率', '同类排名百分比', '交易成本(估)', '其他费用(估)',
  null, '换手率', '同类中值',
  null, null, null, null, null, null, null, null, null, null, null,
];

const INSERT_COLUMNS = [
  'as_of_date', 'code', 'name', 'inception_date', 'morningstar_category',
  'total_fee_pct', 'total_fee_rank_pct',
  'explicit_fee_pct', 'explicit_fee_rank_pct', 'management_fee_pct',
  'custody_fee_pct', 'sales_service_fee_pct',
  'implicit_fee_pct', 'implicit_fee_rank_pct',
  'estimated_transaction_cost_pct', 'estimated_other_expense_pct',
  'average_net_assets_billion', 'turnover_pct', 'category_median_turnover_pct',
  'return_1y_pct', 'return_3y_pct', 'return_5y_pct',
  'max_drawdown_1y_pct', 'max_drawdown_3y_pct', 'max_drawdown_5y_pct',
  'fund_company', 'is_etf', 'is_fof', 'is_index', 'is_enhanced_index',
];

const EMPTY_MARKERS = new Set(['', '—', '-', '--', 'N/A', 'n/a']);

export function decodeXmlText(value) {
  return String(value ?? '')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function columnIndex(cellRef) {
  const letters = String(cellRef || '').match(/^[A-Z]+/)?.[0];
  if (!letters) return -1;
  let n = 0;
  for (const ch of letters) n = n * 26 + ch.charCodeAt(0) - 64;
  return n - 1;
}

export function parseRowXml(rowXml) {
  const rowNumber = Number(rowXml.match(/<row\b[^>]*\br="(\d+)"/)?.[1] || 0);
  const values = [];
  const cellRe = /<c\b([^>]*)>([\s\S]*?)<\/c>/g;
  let match;
  while ((match = cellRe.exec(rowXml))) {
    const attrs = match[1];
    const body = match[2];
    const ref = attrs.match(/\br="([A-Z]+\d+)"/)?.[1];
    const idx = columnIndex(ref);
    if (idx < 0) continue;
    const type = attrs.match(/\bt="([^"]+)"/)?.[1] || 'n';
    if (type === 's') {
      throw new Error('工作簿使用 sharedStrings，当前导入器不支持；请先另存为普通 XLSX');
    }
    const raw = body.match(/<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/)?.[1]
      ?? body.match(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/)?.[1]
      ?? '';
    values[idx] = decodeXmlText(raw);
  }
  return { rowNumber, values };
}

export function normalizeText(value) {
  if (value == null) return null;
  const text = String(value).trim();
  return EMPTY_MARKERS.has(text) ? null : text;
}

export function normalizeNumber(value) {
  const text = normalizeText(value);
  if (text == null) return null;
  const number = Number(text.replace(/,/g, '').replace(/%$/, ''));
  if (!Number.isFinite(number)) throw new Error(`无法解析数值: ${text}`);
  return number;
}

export function normalizeYesNo(value) {
  const text = normalizeText(value);
  if (text == null) return null;
  if (text === '是') return 1;
  if (text === '否') return 0;
  throw new Error(`无法解析是否值: ${text}`);
}

export function normalizeDate(value) {
  const text = normalizeText(value);
  if (text == null) return null;
  const normalized = text.replace(/\//g, '-');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) throw new Error(`无法解析日期: ${text}`);
  return normalized;
}

export function buildRecord(values, asOfDate) {
  if (values.length < HEADER_ROW_1.length) {
    throw new Error(`字段不足: 期望 ${HEADER_ROW_1.length} 列，实际 ${values.length} 列`);
  }
  const code = normalizeText(values[1]);
  if (!/^\d{6}$/.test(code || '')) throw new Error(`基金代码非法: ${code ?? '(空)'}`);

  return {
    as_of_date: asOfDate,
    code,
    name: normalizeText(values[0]),
    inception_date: normalizeDate(values[2]),
    morningstar_category: normalizeText(values[3]),
    total_fee_pct: normalizeNumber(values[4]),
    total_fee_rank_pct: normalizeNumber(values[5]),
    explicit_fee_pct: normalizeNumber(values[6]),
    explicit_fee_rank_pct: normalizeNumber(values[7]),
    management_fee_pct: normalizeNumber(values[8]),
    custody_fee_pct: normalizeNumber(values[9]),
    sales_service_fee_pct: normalizeNumber(values[10]),
    implicit_fee_pct: normalizeNumber(values[11]),
    implicit_fee_rank_pct: normalizeNumber(values[12]),
    estimated_transaction_cost_pct: normalizeNumber(values[13]),
    estimated_other_expense_pct: normalizeNumber(values[14]),
    average_net_assets_billion: normalizeNumber(values[15]),
    turnover_pct: normalizeNumber(values[16]),
    category_median_turnover_pct: normalizeNumber(values[17]),
    return_1y_pct: normalizeNumber(values[18]),
    return_3y_pct: normalizeNumber(values[19]),
    return_5y_pct: normalizeNumber(values[20]),
    max_drawdown_1y_pct: normalizeNumber(values[21]),
    max_drawdown_3y_pct: normalizeNumber(values[22]),
    max_drawdown_5y_pct: normalizeNumber(values[23]),
    fund_company: normalizeText(values[24]),
    is_etf: normalizeYesNo(values[25]),
    is_fof: normalizeYesNo(values[26]),
    is_index: normalizeYesNo(values[27]),
    is_enhanced_index: normalizeYesNo(values[28]),
  };
}

function assertHeader(actual, expected, rowNumber, fileName) {
  const normalized = Array.from({ length: expected.length }, (_, i) => normalizeText(actual[i]));
  if (JSON.stringify(normalized) !== JSON.stringify(expected)) {
    throw new Error(`${fileName} 第 ${rowNumber} 行表头与预期不一致`);
  }
}

async function streamSheetRows(filePath, sheetPath, onRow) {
  const child = spawn('unzip', ['-p', filePath, sheetPath], { stdio: ['ignore', 'pipe', 'pipe'] });
  const exitPromise = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  let stderr = '';
  let buffer = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.stdout.setEncoding('utf8');

  try {
    for await (const chunk of child.stdout) {
      buffer += chunk;
      while (true) {
        const start = buffer.indexOf('<row');
        if (start < 0) {
          buffer = buffer.slice(-16);
          break;
        }
        const end = buffer.indexOf('</row>', start);
        if (end < 0) {
          if (start > 0) buffer = buffer.slice(start);
          break;
        }
        const rowXml = buffer.slice(start, end + 6);
        buffer = buffer.slice(end + 6);
        await onRow(parseRowXml(rowXml));
      }
    }
  } catch (error) {
    child.kill();
    throw error;
  }

  const exitCode = await exitPromise;
  if (exitCode !== 0) throw new Error(`unzip 读取失败 (${exitCode}): ${stderr.trim()}`);
}

async function sha256(filePath) {
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

function asOfDateFromName(fileName) {
  const compact = fileName.match(/截至(\d{8})\.xlsx$/)?.[1];
  if (!compact) throw new Error(`文件名缺少截至日期: ${fileName}`);
  return `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`;
}

async function readWorkbook(filePath, asOfDate) {
  const fileName = path.basename(filePath);
  const records = [];
  const seenCodes = new Set();
  let declaredAsOfDate = null;

  await streamSheetRows(filePath, 'xl/worksheets/sheet1.xml', ({ rowNumber, values }) => {
    if (rowNumber === 1) {
      const raw = normalizeText(values[0]);
      const match = raw?.match(/截至日期:\s*(\d{4})\/(\d{2})\/(\d{2})/);
      declaredAsOfDate = match ? `${match[1]}-${match[2]}-${match[3]}` : null;
      return;
    }
    if (rowNumber === 2) return assertHeader(values, HEADER_ROW_1, rowNumber, fileName);
    if (rowNumber === 3) return assertHeader(values, HEADER_ROW_2, rowNumber, fileName);
    if (rowNumber < 4) return;

    try {
      const record = buildRecord(values, asOfDate);
      if (seenCodes.has(record.code)) throw new Error(`基金代码重复: ${record.code}`);
      seenCodes.add(record.code);
      records.push(record);
    } catch (error) {
      throw new Error(`${fileName} 第 ${rowNumber} 行: ${error.message}`);
    }
  });

  if (declaredAsOfDate !== asOfDate) {
    throw new Error(`${fileName} 文件名日期 ${asOfDate} 与表内日期 ${declaredAsOfDate} 不一致`);
  }

  const notes = [];
  await streamSheetRows(filePath, 'xl/worksheets/sheet2.xml', ({ values }) => {
    const text = normalizeText(values[0]);
    if (text) notes.push(text);
  });
  const generatedRaw = notes.map(note => note.match(/报告生成时间为(\d{4})\/(\d{2})\/(\d{2})\s+(\d{2}:\d{2})/)).find(Boolean);
  const generatedAt = generatedRaw
    ? `${generatedRaw[1]}-${generatedRaw[2]}-${generatedRaw[3]} ${generatedRaw[4]}`
    : null;

  return { records, notes, generatedAt };
}

function importSnapshot(db, snapshot) {
  const insertSql = `
    INSERT INTO morningstar_fund_fee (${INSERT_COLUMNS.join(', ')})
    VALUES (${INSERT_COLUMNS.map(column => `@${column}`).join(', ')})
  `;
  const insertRow = db.prepare(insertSql);
  const upsertSnapshot = db.prepare(`
    INSERT INTO morningstar_fee_snapshot
      (as_of_date, source_file, source_sha256, generated_at, row_count, notes_json, imported_at)
    VALUES
      (@as_of_date, @source_file, @source_sha256, @generated_at, @row_count, @notes_json, datetime('now'))
    ON CONFLICT(as_of_date) DO UPDATE SET
      source_file   = excluded.source_file,
      source_sha256 = excluded.source_sha256,
      generated_at  = excluded.generated_at,
      row_count     = excluded.row_count,
      notes_json    = excluded.notes_json,
      imported_at   = datetime('now')
  `);
  const removeOldRows = db.prepare('DELETE FROM morningstar_fund_fee WHERE as_of_date = ?');

  db.transaction(() => {
    upsertSnapshot.run({
      as_of_date: snapshot.asOfDate,
      source_file: snapshot.fileName,
      source_sha256: snapshot.hash,
      generated_at: snapshot.generatedAt,
      row_count: snapshot.records.length,
      notes_json: JSON.stringify(snapshot.notes),
    });
    removeOldRows.run(snapshot.asOfDate);
    for (const record of snapshot.records) insertRow.run(record);
  })();
}

function parseArgs(argv) {
  const opts = { sourceDir: DEFAULT_SOURCE_DIR, dryRun: false, force: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--dir') opts.sourceDir = path.resolve(argv[++i]);
    else if (argv[i] === '--dry-run') opts.dryRun = true;
    else if (argv[i] === '--force') opts.force = true;
    else throw new Error(`未知参数: ${argv[i]}`);
  }
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const files = fs.readdirSync(opts.sourceDir)
    .filter(name => name.endsWith('.xlsx'))
    .sort()
    .map(name => path.join(opts.sourceDir, name));
  if (!files.length) throw new Error(`未找到 XLSX: ${opts.sourceDir}`);

  const db = getDb();
  let importedFiles = 0;
  let importedRows = 0;
  let skippedFiles = 0;

  try {
    for (const filePath of files) {
      const fileName = path.basename(filePath);
      const asOfDate = asOfDateFromName(fileName);
      const hash = await sha256(filePath);
      const existing = db.prepare(`
        SELECT s.source_sha256, s.row_count,
          (SELECT COUNT(*) FROM morningstar_fund_fee f WHERE f.as_of_date = s.as_of_date) AS actual_count
        FROM morningstar_fee_snapshot s WHERE s.as_of_date = ?
      `).get(asOfDate);

      if (!opts.force && existing?.source_sha256 === hash && existing.row_count === existing.actual_count) {
        console.log(`⏭  ${asOfDate} 已是最新 (${existing.row_count.toLocaleString()} 行)`);
        skippedFiles++;
        continue;
      }

      const { records, notes, generatedAt } = await readWorkbook(filePath, asOfDate);
      console.log(`📄 ${asOfDate} ${fileName}: ${records.length.toLocaleString()} 行`);
      if (!opts.dryRun) {
        importSnapshot(db, { asOfDate, fileName, hash, records, notes, generatedAt });
      }
      importedFiles++;
      importedRows += records.length;
    }

    const mode = opts.dryRun ? '校验完成' : '导入完成';
    console.log(`✅ ${mode}: ${importedFiles} 个快照, ${importedRows.toLocaleString()} 行; 跳过 ${skippedFiles} 个`);
  } finally {
    closeDb();
  }
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  main().catch(error => {
    console.error(`❌ Morningstar 导入失败: ${error.message}`);
    closeDb();
    process.exitCode = 1;
  });
}
