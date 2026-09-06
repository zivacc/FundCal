import { test } from 'node:test';
import assert from 'node:assert/strict';
import { periodStartIndex } from './period-window.js';
test('YTD starts at first data date in latest data year, including holiday gaps', () => {
  const dates = ['20241230', '20241231', '20250102', '20250103', '20250905'];
  assert.equal(periodStartIndex('YTD', dates), 2);
  assert.equal(periodStartIndex('YTD', ['20250509', '20250905']), 0);
  assert.equal(periodStartIndex('YTD', ['20241231', '20260105']), 1);
  assert.equal(periodStartIndex('YTD', []), -1);
});
test('rolling periods retain calendar-day lookback through a leap year', () => {
  assert.equal(periodStartIndex('1M', ['20240228', '20240229', '20240301', '20240330']), 1);
  assert.equal(periodStartIndex('1Y', ['20250102']), 0);
});
