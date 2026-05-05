/**
 * Unit tests for js/domain/nav-statistics.js
 *
 * 跑：npm test
 *
 * 覆盖：
 *   - computeMA: 窗口前 n-1 位 null、含 null 的滑窗、稳定值
 *   - computeDrawdown: 单调上升回撤为 0、峰后回撤百分比、起首 null 跳过
 *   - transformByMode: nav/raw/log 兼容、pct 比例 v/base、缺基准向后推、坏基准全 null
 *   - computeYAxisBounds: 线性加性 padding、log 乘法 padding、过滤非正值、空输入
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeMA,
  computeMASingle,
  computeDrawdown,
  transformByMode,
  computeYAxisBounds,
  pickLogBase,
} from './nav-statistics.js';

/* ============== computeMA ============== */

test('computeMA: 前 n-1 位为 null', () => {
  const out = computeMA([1, 2, 3, 4, 5], 3);
  assert.equal(out[0], null);
  assert.equal(out[1], null);
  assert.equal(out[2], 2);   // (1+2+3)/3
  assert.equal(out[3], 3);   // (2+3+4)/3
  assert.equal(out[4], 4);   // (3+4+5)/3
});

test('computeMA: 含 null 时窗口未填满 → null', () => {
  const out = computeMA([1, null, 3, 4, 5], 3);
  // i=2: 含 null，count=2，<3，返回 null
  assert.equal(out[2], null);
  // i=3: 窗口 [null, 3, 4]，count=2，<3，仍然 null
  assert.equal(out[3], null);
  // i=4: 窗口 [3,4,5]，count=3，命中
  assert.equal(out[4], 4);
});

test('computeMA: 空数组 / n<1 → 全 null 数组', () => {
  assert.deepEqual(computeMA([], 3), []);
  assert.deepEqual(computeMA([1, 2, 3], 0), [null, null, null]);
});

/* ============== computeMASingle ============== */

test('computeMASingle: 与 computeMA 在合法点上同值', () => {
  const arr = [1, 2, 3, 4, 5, 6];
  const full = computeMA(arr, 3);
  for (let i = 0; i < arr.length; i++) {
    assert.equal(computeMASingle(arr, i, 3), full[i]);
  }
});

test('computeMASingle: idx < n-1 → null', () => {
  assert.equal(computeMASingle([1, 2, 3, 4], 0, 3), null);
  assert.equal(computeMASingle([1, 2, 3, 4], 1, 3), null);
  assert.equal(computeMASingle([1, 2, 3, 4], 2, 3), 2);  // (1+2+3)/3
});

test('computeMASingle: 窗口含 null → null', () => {
  assert.equal(computeMASingle([1, null, 3, 4, 5], 2, 3), null);
  assert.equal(computeMASingle([1, null, 3, 4, 5], 4, 3), 4);
});

test('computeMASingle: 越界 / 非数组 / n<1 → null', () => {
  assert.equal(computeMASingle([1, 2, 3], 10, 2), null);
  assert.equal(computeMASingle(null, 0, 2), null);
  assert.equal(computeMASingle([1, 2, 3], 2, 0), null);
});

/* ============== computeDrawdown ============== */

test('computeDrawdown: 单调上升 → 全 0', () => {
  const out = computeDrawdown([1, 2, 3, 4]);
  assert.deepEqual(out, [0, 0, 0, 0]);
});

test('computeDrawdown: 峰后回撤为负百分比', () => {
  const out = computeDrawdown([1.0, 1.5, 0.75]);
  assert.equal(out[0], 0);
  assert.equal(out[1], 0);
  assert.ok(Math.abs(out[2] - (-50)) < 1e-9);
});

test('computeDrawdown: 起首 null 段保持 null（不画"伪 0%"基线），自首个数值起算 peak', () => {
  const out = computeDrawdown([null, null, 2, 1]);
  assert.equal(out[0], null);
  assert.equal(out[1], null);
  assert.equal(out[2], 0);              // 第一个值即首个 peak
  assert.ok(Math.abs(out[3] - (-50)) < 1e-9);
});

/* ============== transformByMode ============== */

test('transformByMode: nav 直接复制', () => {
  const navs = [1.0, 1.1, null, 1.3];
  const out = transformByMode(['20240101', '20240102', '20240103', '20240104'], navs, 'nav');
  assert.deepEqual(out, navs);
  assert.notEqual(out, navs); // 浅拷贝
});

test('transformByMode: 旧名 raw / log 视作 nav（向后兼容）', () => {
  const navs = [1.0, 2.0];
  const dates = ['20240101', '20240102'];
  assert.deepEqual(transformByMode(dates, navs, 'raw'), navs);
  assert.deepEqual(transformByMode(dates, navs, 'log'), navs);
});

test('transformByMode: pct 默认基准取首个非空，输出比例 v/base', () => {
  const dates = ['20240101', '20240102', '20240103'];
  const navs = [2.0, 2.4, 3.0];
  const out = transformByMode(dates, navs, 'pct');
  assert.deepEqual(out, [1.0, 1.2, 1.5]);
});

test('transformByMode: pct 指定基准日（YYYY-MM-DD）', () => {
  const dates = ['20240101', '20240102', '20240103'];
  const navs = [1.0, 2.0, 3.0];
  // 基准 = 第二天，所以 [0.5, 1.0, 1.5]
  const out = transformByMode(dates, navs, 'pct', '2024-01-02');
  assert.deepEqual(out, [0.5, 1.0, 1.5]);
});

test('transformByMode: pct 基准日落在缺失点，向后推到首个有值', () => {
  const dates = ['20240101', '20240102', '20240103'];
  const navs = [1.0, null, 2.0];
  const out = transformByMode(dates, navs, 'pct', '2024-01-02');
  // baseIdx 由 1 → 2，base=2.0；输出 [0.5, null, 1.0]
  assert.equal(out[0], 0.5);
  assert.equal(out[1], null);
  assert.equal(out[2], 1.0);
});

test('transformByMode: pct 基准日不存在的未来日期 → idx=0', () => {
  const dates = ['20240101', '20240102'];
  const navs = [2.0, 4.0];
  const out = transformByMode(dates, navs, 'pct', '2099-12-31');
  // findIndex(d >= 20991231) = -1 → baseIdx = 0
  assert.deepEqual(out, [1.0, 2.0]);
});

test('transformByMode: pct 全空序列 → 全 null', () => {
  const dates = ['20240101', '20240102'];
  const out = transformByMode(dates, [null, null], 'pct');
  assert.deepEqual(out, [null, null]);
});

test('transformByMode: pct 基准为非正 → 全 null', () => {
  const dates = ['20240101', '20240102'];
  const out = transformByMode(dates, [0, 1], 'pct');
  // base=0，分母无效；保留契约：全 null
  assert.deepEqual(out, [null, null]);
});

/* ============== computeYAxisBounds ============== */

test('computeYAxisBounds: 线性 5% 加性 padding', () => {
  const out = computeYAxisBounds([[1, 2, 3]], 'linear');
  // span=2, pad=0.1
  assert.ok(Math.abs(out.min - 0.9) < 1e-9);
  assert.ok(Math.abs(out.max - 3.1) < 1e-9);
});

test('computeYAxisBounds: log 1% 乘法 padding', () => {
  const out = computeYAxisBounds([[1, 100]], 'log');
  assert.ok(Math.abs(out.min - 0.99) < 1e-9);
  assert.ok(Math.abs(out.max - 101) < 1e-9);
});

test('computeYAxisBounds: log 过滤非正值', () => {
  const out = computeYAxisBounds([[-1, 0, 1, 2]], 'log');
  // 只剩 [1, 2]
  assert.ok(Math.abs(out.min - 0.99) < 1e-9);
  assert.ok(Math.abs(out.max - 2.02) < 1e-9);
});

test('computeYAxisBounds: 多序列合并 min/max', () => {
  const out = computeYAxisBounds([[1, 2], [0.5, 3], [null, 1.5]], 'linear');
  // global min=0.5, max=3, span=2.5, pad=0.125
  assert.ok(Math.abs(out.min - (0.5 - 0.125)) < 1e-9);
  assert.ok(Math.abs(out.max - (3 + 0.125)) < 1e-9);
});

test('computeYAxisBounds: 全空 / 全 null → undefined（让 ECharts 自适应）', () => {
  assert.deepEqual(computeYAxisBounds([], 'linear'), { min: undefined, max: undefined });
  assert.deepEqual(computeYAxisBounds([[null, null]], 'linear'), { min: undefined, max: undefined });
  assert.deepEqual(computeYAxisBounds([[-1, 0]], 'log'), { min: undefined, max: undefined });
});

test('computeYAxisBounds: 单点序列 (span=0) 仍给非零 padding', () => {
  const out = computeYAxisBounds([[5]], 'linear');
  // span=0，pad=|5|*0.05=0.25
  assert.ok(out.max > out.min);
  assert.ok(Math.abs(out.max - out.min - 0.5) < 1e-9);
});

test('computeYAxisBounds: 忽略 NaN / Infinity', () => {
  const out = computeYAxisBounds([[NaN, Infinity, 1, 2]], 'linear');
  assert.ok(Math.abs(out.min - 0.95) < 1e-9);
  assert.ok(Math.abs(out.max - 2.05) < 1e-9);
});

/* ============== pickLogBase ============== */

test('pickLogBase: 典型基金范围（0.5..3）选小 base', () => {
  // ratio=6, ratio^(1/6) ≈ 1.348 → 候选里 1.5 是首个 >=
  const b = pickLogBase([[0.5, 1, 2, 3]]);
  assert.equal(b, 1.5);
});

test('pickLogBase: 窄范围（1.0..1.2）选最小 base', () => {
  // ratio=1.2, ratio^(1/6) ≈ 1.031 → 候选里 1.2 是首个 >=
  const b = pickLogBase([[1.0, 1.05, 1.1, 1.15, 1.2]]);
  assert.equal(b, 1.2);
});

test('pickLogBase: 极宽范围（1..1e9）回退 10', () => {
  const b = pickLogBase([[1, 1e3, 1e6, 1e9]]);
  // ratio^(1/6) ≈ 31.6 → 超过所有候选 → 10（兜底）
  assert.equal(b, 10);
});

test('pickLogBase: 平坦数据 / 全 null / 全非正 → 10（默认）', () => {
  assert.equal(pickLogBase([[1, 1, 1]]), 10);
  assert.equal(pickLogBase([[null, null]]), 10);
  assert.equal(pickLogBase([[-1, 0]]), 10);
  assert.equal(pickLogBase([]), 10);
});

test('pickLogBase: 多序列合并 ratio', () => {
  // [0.8..1.2] 与 [1.5..2.5] 合并：lo=0.8, hi=2.5, ratio=3.125
  // ratio^(1/6) ≈ 1.211 → 候选里 1.5 是首个 >=
  const b = pickLogBase([[0.8, 1.0, 1.2], [1.5, 2.0, 2.5]]);
  assert.equal(b, 1.5);
});
