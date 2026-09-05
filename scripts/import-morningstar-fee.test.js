import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRecord,
  decodeXmlText,
  normalizeNumber,
  normalizeYesNo,
  parseRowXml,
} from './import-morningstar-fee.js';

test('parseRowXml preserves sparse XLSX columns and decodes XML', () => {
  const row = parseRowXml('<row r="4"><c r="A4" t="str"><v>A&amp;B</v></c><c r="C4" t="str"><v>2025-01-02</v></c></row>');
  assert.equal(row.rowNumber, 4);
  assert.equal(row.values[0], 'A&B');
  assert.equal(row.values[1], undefined);
  assert.equal(row.values[2], '2025-01-02');
  assert.equal(decodeXmlText('沪深&lt;300&gt;'), '沪深<300>');
});

test('Morningstar value normalization keeps percentage points and missing values', () => {
  assert.equal(normalizeNumber('10.16'), 10.16);
  assert.equal(normalizeNumber('1,234.50'), 1234.5);
  assert.equal(normalizeNumber('—'), null);
  assert.equal(normalizeYesNo('是'), 1);
  assert.equal(normalizeYesNo('否'), 0);
});

test('buildRecord maps all 29 source columns', () => {
  const row = [
    '示例基金A', '000001', '2020-01-02', '大盘成长',
    '1.50', '20', '1.10', '25', '0.80', '0.20', '0.10',
    '0.40', '30', '0.35', '0.05', '12.30', '120.5', '100.0',
    '8.1', '20.2', '35.3', '-10.0', '-20.0', '-30.0',
    '示例基金', '否', '否', '是', '否',
  ];
  const record = buildRecord(row, '2025-12-31');
  assert.equal(record.code, '000001');
  assert.equal(record.total_fee_pct, 1.5);
  assert.equal(record.estimated_transaction_cost_pct, 0.35);
  assert.equal(record.is_index, 1);
  assert.equal(record.as_of_date, '2025-12-31');
});
