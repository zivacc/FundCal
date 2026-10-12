import test from 'node:test';
import assert from 'node:assert/strict';
import { indexDetailHref } from './index-links.js';

test('index detail links preserve exact domestic, overseas and lowercase database codes', () => {
  for (const code of ['000300.SH', 'HSI.HI', 'AU9999.SGE', 'h30590.CSI', 'n00905.CSI']) {
    assert.equal(indexDetailHref(code), `#/index-detail/${encodeURIComponent(code)}`);
  }
});

test('index detail links reject fund codes, paths and malformed keys', () => {
  for (const code of ['', null, undefined, '004434', '004434.OF', '沪深300', '000300.SH/extra', '000300.SH?bad', '<script>.SH', '000300.SH ']) {
    assert.equal(indexDetailHref(code), '');
  }
});
