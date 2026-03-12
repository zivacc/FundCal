/**
 * allfund 数据完整性检查脚本
 *
 * 功能：
 * 1. 扫描 data/allfund/allfund.json 中的所有基金条目
 * 2. 检查是否存在关键字段为空 / 缺失
 * 3. 检查是否存在异常费率：
 *    - 买入费率 buyFee > 5%
 *    - 任一卖出费率分段 sellFeeSegments[].rate > 5%
 *    - 年化费率 annualFee === 0 或 operationFees.total === 0
 *
 * 使用方式：
 *   node scripts/check-allfund.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ALLFUND_PATH = path.join(__dirname, '..', 'data', 'allfund', 'allfund.json');

function safePercent(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return n * 100;
}

function main() {
  if (!fs.existsSync(ALLFUND_PATH)) {
    console.error(`未找到 allfund 文件：${ALLFUND_PATH}`);
    process.exit(1);
  }

  /** @type {{codes?:string[],funds?:Record<string, any>}} */
  let allfund;
  try {
    allfund = JSON.parse(fs.readFileSync(ALLFUND_PATH, 'utf8'));
  } catch (e) {
    console.error('读取或解析 allfund.json 失败：', e);
    process.exit(1);
  }

  const codes = Array.isArray(allfund.codes) && allfund.codes.length
    ? allfund.codes
    : Object.keys(allfund.funds || {});
  const store = allfund.funds || {};

  const missingFields = [];
  const emptyValues = [];
  const abnormalRates = [];
  const zeroAnnual = [];

  const requiredFields = ['code', 'name', 'buyFee', 'annualFee', 'sellFeeSegments'];

  for (const code of codes) {
    const f = store[code];
    if (!f) {
      missingFields.push({ code, field: 'fundObject', reason: 'fund 对象缺失' });
      continue;
    }

    // 1. 关键字段缺失 / 为空
    for (const field of requiredFields) {
      if (!(field in f)) {
        missingFields.push({ code, field, reason: '字段缺失' });
        continue;
      }
      const val = f[field];
      if (val === null || val === undefined || val === '') {
        emptyValues.push({ code, field, value: val, reason: '值为空(null/undefined/空字符串)' });
      }
      if (Array.isArray(val) && val.length === 0) {
        emptyValues.push({ code, field, value: '[]', reason: '数组为空' });
      }
    }

    // 2. 费率异常：> 5%
    const buyPct = safePercent(f.buyFee);
    if (buyPct != null && buyPct > 5.0001) {
      abnormalRates.push({
        code,
        type: 'buyFee',
        value: f.buyFee,
        percent: buyPct.toFixed(4) + '%',
      });
    }

    const sellSegs = Array.isArray(f.sellFeeSegments) ? f.sellFeeSegments : [];
    for (const seg of sellSegs) {
      const pct = safePercent(seg?.rate);
      if (pct != null && pct > 5.0001) {
        abnormalRates.push({
          code,
          type: 'sellFee',
          days: seg.days,
          value: seg.rate,
          percent: pct.toFixed(4) + '%',
        });
      }
    }

    // 3. 年化费率为 0：annualFee 或 operationFees.total
    const annualFromField = Number(f.annualFee);
    const annualFromOps = f.operationFees && typeof f.operationFees.total === 'number'
      ? f.operationFees.total
      : null;

    const isZeroAnnualField = Number.isFinite(annualFromField) && annualFromField === 0;
    const isZeroAnnualOps = annualFromOps !== null && annualFromOps === 0;

    if (isZeroAnnualField || isZeroAnnualOps) {
      zeroAnnual.push({
        code,
        annualFee: annualFromField,
        operationTotal: annualFromOps,
      });
    }
  }

  const report = {
    summary: {
      totalFunds: codes.length,
      missingFields: missingFields.length,
      emptyValues: emptyValues.length,
      abnormalRates: abnormalRates.length,
      zeroAnnual: zeroAnnual.length,
    },
    missingFields,
    emptyValues,
    abnormalRates,
    zeroAnnual,
  };

  const outPath = path.join(__dirname, '..', 'data', 'allfund', 'check-report.json');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');

  console.log('===== allfund.json 完整性检查报告 =====');
  console.log(`总基金数: ${codes.length}`);
  console.log(`缺失字段条目: ${missingFields.length}`);
  console.log(`空值条目: ${emptyValues.length}`);
  console.log(`异常费率条目: ${abnormalRates.length}（> 5%）`);
  console.log(`年化费率为 0 的条目: ${zeroAnnual.length}`);
  console.log(`详细报告已写入: ${outPath}`);
}

main();
