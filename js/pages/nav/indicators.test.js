/**
 * indicators.js 注册表的单测
 *
 * 纯逻辑单测 —— 不触 DOM / ECharts。
 * 覆盖：
 *   - 注册表基本 shape：每个指标都有完整必需字段
 *   - isIndicatorEnabled：state flag 读取
 *   - getEnabledIndicators：只返回当前开启的
 *   - getActiveSubplots：去重 + 按 order 排序
 *   - getSubplotIndexMap：main=0，副图从 1 开始
 *   - getIndicatorAxisIndex：按 panel 解析 axis index
 *   - getEnabledRangeStatsIndicators：只含有 rangeStats 定义且 enabled 的
 *   - INDICATORS.*.build：返回 ECharts series entries 的基本 shape
 *   - INDICATORS.*.rangeStats.single：与 computeMA 最后点一致
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  INDICATORS,
  INDICATORS_LIST,
  SUBPLOTS,
  isIndicatorEnabled,
  getEnabledIndicators,
  getActiveSubplots,
  getSubplotIndexMap,
  getIndicatorAxisIndex,
  getEnabledRangeStatsIndicators,
} from './indicators.js';
import { computeMA } from '../../domain/nav-statistics.js';

/* ============== 注册表 shape ============== */

test('INDICATORS: 每个指标必须有 id / label / persist.key / ui.checkboxId / panel / build', () => {
  for (const ind of INDICATORS_LIST) {
    assert.equal(typeof ind.id, 'string', `${ind.id}: id`);
    assert.equal(typeof ind.label, 'string', `${ind.id}: label`);
    assert.equal(typeof ind.persist?.key, 'string', `${ind.id}: persist.key`);
    assert.equal(typeof ind.ui?.checkboxId, 'string', `${ind.id}: ui.checkboxId`);
    assert.equal(typeof ind.panel, 'string', `${ind.id}: panel`);
    assert.equal(typeof ind.build, 'function', `${ind.id}: build`);
  }
});

test('INDICATORS: panel 指向 main 或存在的 subplot id', () => {
  for (const ind of INDICATORS_LIST) {
    const ok = ind.panel === 'main' || !!SUBPLOTS[ind.panel];
    assert.ok(ok, `${ind.id}: panel="${ind.panel}" 既不是 main 也不在 SUBPLOTS 里`);
  }
});

test('INDICATORS: persist.key 在注册表内全局唯一（多指标共享 state 字段会互相串）', () => {
  const seen = new Set();
  for (const ind of INDICATORS_LIST) {
    assert.ok(!seen.has(ind.persist.key), `重复 persist.key: ${ind.persist.key}`);
    seen.add(ind.persist.key);
  }
});

test('INDICATORS: id 全局唯一（range stats 按 id 建 map）', () => {
  const seen = new Set();
  for (const ind of INDICATORS_LIST) {
    assert.ok(!seen.has(ind.id), `重复 indicator id: ${ind.id}`);
    seen.add(ind.id);
  }
});

/* ============== isIndicatorEnabled / getEnabledIndicators ============== */

test('isIndicatorEnabled: 按 persist.key 读 state', () => {
  const state = { showMA20: true, showMA60: false, showDD: true };
  assert.equal(isIndicatorEnabled(state, INDICATORS.MA20), true);
  assert.equal(isIndicatorEnabled(state, INDICATORS.MA60), false);
  assert.equal(isIndicatorEnabled(state, INDICATORS.DRAWDOWN), true);
});

test('getEnabledIndicators: 只含当前开启的', () => {
  const state = { showMA20: true, showMA60: false, showDD: false };
  const en = getEnabledIndicators(state);
  const ids = en.map(i => i.id);
  assert.deepEqual(ids, ['MA20']);
});

/* ============== getActiveSubplots / getSubplotIndexMap ============== */

test('getActiveSubplots: 空 state → 空数组', () => {
  const state = { showMA20: false, showMA60: false, showDD: false };
  assert.deepEqual(getActiveSubplots(state), []);
});

test('getActiveSubplots: 只有主图指标开启 → 无副图', () => {
  const state = { showMA20: true, showMA60: true, showDD: false };
  assert.deepEqual(getActiveSubplots(state), []);
});

test('getActiveSubplots: 回撤开启 → 返回 drawdown 副图', () => {
  const state = { showMA20: false, showMA60: false, showDD: true };
  const subs = getActiveSubplots(state);
  assert.equal(subs.length, 1);
  assert.equal(subs[0].id, 'drawdown');
});

test('getSubplotIndexMap: main=0，副图从 1 开始按顺序', () => {
  const state = { showMA20: false, showMA60: false, showDD: true };
  const subs = getActiveSubplots(state);
  const map = getSubplotIndexMap(subs);
  assert.equal(map.main, 0);
  assert.equal(map.drawdown, 1);
});

test('getSubplotIndexMap: 无副图也要有 main=0', () => {
  const map = getSubplotIndexMap([]);
  assert.equal(map.main, 0);
});

/* ============== getIndicatorAxisIndex ============== */

test('getIndicatorAxisIndex: main 指标永远是 0', () => {
  const map = { main: 0, drawdown: 1 };
  assert.equal(getIndicatorAxisIndex(INDICATORS.MA20, map), 0);
  assert.equal(getIndicatorAxisIndex(INDICATORS.MA60, map), 0);
});

test('getIndicatorAxisIndex: 副图指标按 panel 查表', () => {
  const map = { main: 0, drawdown: 1 };
  assert.equal(getIndicatorAxisIndex(INDICATORS.DRAWDOWN, map), 1);
});

test('getIndicatorAxisIndex: 未知 panel → 回退到 0（防御，实际不应发生）', () => {
  assert.equal(getIndicatorAxisIndex({ panel: 'nonexistent' }, { main: 0 }), 0);
});

/* ============== getEnabledRangeStatsIndicators ============== */

test('getEnabledRangeStatsIndicators: 回撤不参与区间统计 panel（无 rangeStats）', () => {
  const state = { showMA20: true, showMA60: true, showDD: true };
  const rs = getEnabledRangeStatsIndicators(state);
  const ids = rs.map(i => i.id);
  assert.deepEqual(ids, ['MA20', 'MA60']);
});

test('getEnabledRangeStatsIndicators: 只开 MA20 → 只返回 MA20', () => {
  const state = { showMA20: true, showMA60: false, showDD: false };
  const rs = getEnabledRangeStatsIndicators(state);
  assert.equal(rs.length, 1);
  assert.equal(rs[0].id, 'MA20');
});

/* ============== build: series entry 基本 shape ============== */

test('INDICATORS.MA20.build: 返回一条 line series，xAxisIndex 跟 ctx 走', () => {
  const ctx = {
    code: '001', name: 'A', color: '#111',
    aligned: [1, 2, 3, 4, 5, 6],
    transformed: [1, 2, 3, 4, 5, 6],
    winEIdx: 5, extremaStartIdx: 0,
    xAxisIndex: 0, yAxisIndex: 0,
  };
  const out = INDICATORS.MA20.build(ctx);
  assert.equal(out.length, 1);
  assert.equal(out[0].type, 'line');
  assert.equal(out[0].name, '001 MA20');
  assert.equal(out[0].xAxisIndex, 0);
  assert.equal(out[0].yAxisIndex, 0);
  assert.ok(Array.isArray(out[0].data), 'data is array');
  assert.equal(out[0].data.length, 6);
});

test('INDICATORS.DRAWDOWN.build: 返回一条副图 line series，axis 跟 ctx 走，含 markPoint（有极值时）', () => {
  const ctx = {
    code: '001', name: 'A', color: '#111',
    aligned: [1, 1.2, 0.8, 0.9, 1.1],   // peak=1.2，谷=0.8 → 回撤约 -33%
    transformed: [],                     // 回撤不用 transformed
    winEIdx: 4, extremaStartIdx: 0,
    xAxisIndex: 1, yAxisIndex: 1,
  };
  const out = INDICATORS.DRAWDOWN.build(ctx);
  assert.equal(out.length, 1);
  assert.equal(out[0].type, 'line');
  assert.equal(out[0].xAxisIndex, 1);
  assert.equal(out[0].yAxisIndex, 1);
  assert.ok(out[0].markPoint, 'drawdown 应带 markPoint');
  assert.equal(out[0].markPoint.data.length, 1, '一个最大回撤点');
  assert.equal(out[0].markPoint.data[0].name, '最大回撤');
});

test('INDICATORS.DRAWDOWN.build: 全 null 数组 → 无 markPoint', () => {
  const ctx = {
    code: '001', name: 'A', color: '#111',
    aligned: [null, null, null],
    transformed: [],
    winEIdx: 2, extremaStartIdx: 0,
    xAxisIndex: 1, yAxisIndex: 1,
  };
  const out = INDICATORS.DRAWDOWN.build(ctx);
  // computeDrawdown on all-null returns all-null; minI stays -1 → markPoint undefined
  assert.equal(out[0].markPoint, undefined);
});

/* ============== rangeStats.single：与 computeMA 最后点一致 ============== */

test('INDICATORS.MA20.rangeStats.single: 与 computeMA(arr, 20).at(idx) 等价', () => {
  const arr = Array.from({ length: 30 }, (_, i) => i + 1);  // 1..30
  const full = computeMA(arr, 20);
  for (const idx of [19, 20, 25, 29]) {
    assert.equal(
      INDICATORS.MA20.rangeStats.single(arr, idx),
      full[idx],
      `idx=${idx}`,
    );
  }
});

test('INDICATORS.MA60.rangeStats.single: window 未满 → null', () => {
  const arr = [1, 2, 3];
  assert.equal(INDICATORS.MA60.rangeStats.single(arr, 2), null);
});
