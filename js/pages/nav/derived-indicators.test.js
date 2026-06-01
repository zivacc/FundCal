import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DERIVED_INDICATORS,
  DERIVED_INDICATORS_LIST,
  REF_FIRST_FUND,
  REF_BENCHMARK,
  resolveRef,
  computeExcessSeries,
  excessModeForValueMode,
  isDerivedEnabled,
} from './derived-indicators.js';

/* ============== 注册表 shape ============== */

test('DERIVED_INDICATORS: 每项有 id/label/persist.enabledKey/panel/build', () => {
  for (const ind of DERIVED_INDICATORS_LIST) {
    assert.equal(typeof ind.id, 'string');
    assert.equal(typeof ind.label, 'string');
    assert.equal(typeof ind.persist?.enabledKey, 'string');
    assert.equal(typeof ind.panel, 'string');
    assert.equal(typeof ind.build, 'function');
  }
});

test('EXCESS: defaultEnabled = true, panel = main', () => {
  assert.equal(DERIVED_INDICATORS.EXCESS.defaultEnabled, true);
  assert.equal(DERIVED_INDICATORS.EXCESS.panel, 'main');
});

/* ============== resolveRef ============== */

const sampleSelected = [
  { code: 'HSI.HI', name: '恒生', isBenchmark: true },
  { code: '000001.OF', name: 'A 基金' },
  { code: '000002.OF', name: 'B 基金' },
];

test('resolveRef: FIRST_FUND 跳过 benchmark', () => {
  assert.equal(resolveRef(REF_FIRST_FUND, sampleSelected), '000001.OF');
});

test('resolveRef: BENCHMARK 取 isBenchmark 项', () => {
  assert.equal(resolveRef(REF_BENCHMARK, sampleSelected), 'HSI.HI');
});

test('resolveRef: 具体 code 命中 → 返回该 code', () => {
  assert.equal(resolveRef('000002.OF', sampleSelected), '000002.OF');
});

test('resolveRef: 具体 code 不在 selected → null', () => {
  assert.equal(resolveRef('999999.OF', sampleSelected), null);
});

test('resolveRef: 没基准时 BENCHMARK → null', () => {
  const noBm = [{ code: '000001.OF', name: 'A' }];
  assert.equal(resolveRef(REF_BENCHMARK, noBm), null);
});

test('resolveRef: 只有基准时 FIRST_FUND → null', () => {
  const onlyBm = [{ code: 'HSI.HI', name: 'BM', isBenchmark: true }];
  assert.equal(resolveRef(REF_FIRST_FUND, onlyBm), null);
});

test('resolveRef: 空 selected → null', () => {
  assert.equal(resolveRef(REF_FIRST_FUND, []), null);
  assert.equal(resolveRef('any', null), null);
});

/* ============== excessModeForValueMode ============== */

test('excessModeForValueMode: pct → geom, nav → arith', () => {
  assert.equal(excessModeForValueMode('pct'), 'geom');
  assert.equal(excessModeForValueMode('nav'), 'arith');
});

/* ============== computeExcessSeries ============== */

const dates = ['20240101', '20240102', '20240103', '20240104', '20240105'];

test('computeExcessSeries: 几何模式 = rA/rB, 基准日 = 1.0', () => {
  const A = [1.0, 1.1, 1.21, 1.331, 1.4641];   // +10% / day
  const B = [2.0, 2.1, 2.205, 2.31525, 2.43];  // +5% / day approx
  const out = computeExcessSeries(dates, A, B, '2024-01-01', 'geom');
  assert.equal(out.length, 5);
  // baseIdx=0: rA=1, rB=1 → 1.0
  assert.equal(out[0], 1.0);
  // idx=1: rA=1.1, rB=1.05 → 1.0476...
  assert.ok(Math.abs(out[1] - (1.1 / 1.05)) < 1e-9);
});

test('computeExcessSeries: 算术模式 = rA - rB, 基准日 = 0', () => {
  const A = [1.0, 1.1, 1.2];
  const B = [2.0, 2.1, 2.2];
  const out = computeExcessSeries(dates.slice(0, 3), A, B, '2024-01-01', 'arith');
  // baseIdx=0: 1-1 = 0
  assert.equal(out[0], 0);
  // idx=1: 1.1/1 - 2.1/2 = 1.1 - 1.05 = 0.05
  assert.ok(Math.abs(out[1] - 0.05) < 1e-9);
});

test('computeExcessSeries: 基准日之前 = null', () => {
  const A = [1.0, 1.1, 1.2, 1.3, 1.4];
  const B = [2.0, 2.1, 2.2, 2.3, 2.4];
  const out = computeExcessSeries(dates, A, B, '2024-01-03', 'geom');
  assert.equal(out[0], null);
  assert.equal(out[1], null);
  assert.equal(out[2], 1.0);
  assert.ok(out[3] != null);
});

test('computeExcessSeries: 基准日 A 为空 → 向后推', () => {
  const A = [null, null, 1.0, 1.1, 1.2];
  const B = [2.0, 2.05, 2.1, 2.15, 2.2];
  const out = computeExcessSeries(dates, A, B, '2024-01-01', 'geom');
  // 实际 baseIdx 推到 2
  assert.equal(out[0], null);
  assert.equal(out[1], null);
  assert.equal(out[2], 1.0);
});

test('computeExcessSeries: 中间点 A 或 B 为 null → 该点为 null', () => {
  const A = [1.0, null, 1.2];
  const B = [2.0, 2.1, 2.2];
  const out = computeExcessSeries(dates.slice(0, 3), A, B, '2024-01-01', 'arith');
  assert.equal(out[0], 0);
  assert.equal(out[1], null);
  assert.ok(out[2] != null);
});

test('computeExcessSeries: 整段空 / 基准日越界 → 全 null', () => {
  const A = [null, null, null];
  const B = [2.0, 2.1, 2.2];
  const out = computeExcessSeries(dates.slice(0, 3), A, B, '2024-01-01', 'geom');
  assert.deepEqual(out, [null, null, null]);

  const out2 = computeExcessSeries(dates.slice(0, 3), [1, 2, 3], [1, 2, 3], '2099-01-01', 'geom');
  assert.deepEqual(out2, [null, null, null]);
});

test('computeExcessSeries: baselineDate=null → 全 null', () => {
  const out = computeExcessSeries(dates.slice(0, 3), [1, 1, 1], [1, 1, 1], null, 'geom');
  assert.deepEqual(out, [null, null, null]);
});

/* ============== isDerivedEnabled ============== */

test('isDerivedEnabled: 读 state[persist.enabledKey]', () => {
  const ind = DERIVED_INDICATORS.EXCESS;
  assert.equal(isDerivedEnabled({ excessOn: true }, ind), true);
  assert.equal(isDerivedEnabled({ excessOn: false }, ind), false);
  assert.equal(isDerivedEnabled({}, ind), false);
});

/* ============== build (mock ctx) ============== */

test('EXCESS.build: 信息齐全 → 返回 1 条 series', () => {
  const selected = [
    { code: 'BM', name: 'Benchmark', isBenchmark: true },
    { code: 'F1', name: 'Fund 1' },
  ];
  const ctx = {
    state: {
      selected,
      excessNumRef: REF_FIRST_FUND,
      excessDenRef: REF_BENCHMARK,
      valueMode: 'pct',
    },
    series: [
      { code: 'BM', name: 'Benchmark' },
      { code: 'F1', name: 'Fund 1' },
    ],
    alignedByCode: new Map([
      ['BM', [1.0, 1.05, 1.1]],
      ['F1', [1.0, 1.1, 1.2]],
    ]),
    allDates: ['20240101', '20240102', '20240103'],
    baseline: '2024-01-01',
    theme: { accent: '#c47a3d' },
    xAxisIndex: 0, yAxisIndex: 0,
  };
  const out = DERIVED_INDICATORS.EXCESS.build(ctx);
  assert.equal(out.length, 1);
  assert.equal(out[0].type, 'line');
  assert.equal(out[0].data.length, 3);
  assert.equal(out[0].data[0], 1.0); // 基准日 geom = 1.0
});

test('EXCESS.build: 分子分母同一只 → 空', () => {
  const ctx = {
    state: {
      selected: [{ code: 'F1', name: 'Fund 1' }],
      excessNumRef: 'F1',
      excessDenRef: 'F1',
      valueMode: 'pct',
    },
    series: [{ code: 'F1', name: 'Fund 1' }],
    alignedByCode: new Map([['F1', [1, 1.1]]]),
    allDates: ['20240101', '20240102'],
    baseline: '2024-01-01',
    theme: { accent: '#000' },
    xAxisIndex: 0, yAxisIndex: 0,
  };
  assert.deepEqual(DERIVED_INDICATORS.EXCESS.build(ctx), []);
});

test('EXCESS.build: 没基准 → 空', () => {
  const ctx = {
    state: {
      selected: [{ code: 'F1', name: 'Fund 1' }],
      excessNumRef: REF_FIRST_FUND,
      excessDenRef: REF_BENCHMARK,
      valueMode: 'pct',
    },
    series: [{ code: 'F1', name: 'Fund 1' }],
    alignedByCode: new Map([['F1', [1, 1.1]]]),
    allDates: ['20240101', '20240102'],
    baseline: '2024-01-01',
    theme: { accent: '#000' },
    xAxisIndex: 0, yAxisIndex: 0,
  };
  assert.deepEqual(DERIVED_INDICATORS.EXCESS.build(ctx), []);
});

test('EXCESS.build: baseline 缺失 → 空', () => {
  const ctx = {
    state: {
      selected: [
        { code: 'BM', name: 'BM', isBenchmark: true },
        { code: 'F1', name: 'F1' },
      ],
      excessNumRef: REF_FIRST_FUND,
      excessDenRef: REF_BENCHMARK,
      valueMode: 'pct',
    },
    series: [{ code: 'BM', name: 'BM' }, { code: 'F1', name: 'F1' }],
    alignedByCode: new Map([['BM', [1, 1.1]], ['F1', [1, 1.2]]]),
    allDates: ['20240101', '20240102'],
    baseline: null,
    theme: { accent: '#000' },
    xAxisIndex: 0, yAxisIndex: 0,
  };
  assert.deepEqual(DERIVED_INDICATORS.EXCESS.build(ctx), []);
});

test('EXCESS.build: nav 模式 → 算术超额（基准日 = 0）', () => {
  const ctx = {
    state: {
      selected: [
        { code: 'BM', name: 'BM', isBenchmark: true },
        { code: 'F1', name: 'F1' },
      ],
      excessNumRef: REF_FIRST_FUND,
      excessDenRef: REF_BENCHMARK,
      valueMode: 'nav',
    },
    series: [{ code: 'BM', name: 'BM' }, { code: 'F1', name: 'F1' }],
    alignedByCode: new Map([
      ['BM', [2.0, 2.1]],
      ['F1', [1.0, 1.2]],
    ]),
    allDates: ['20240101', '20240102'],
    baseline: '2024-01-01',
    theme: { accent: '#000' },
    xAxisIndex: 0, yAxisIndex: 0,
  };
  const out = DERIVED_INDICATORS.EXCESS.build(ctx);
  assert.equal(out.length, 1);
  // 算术: F1=(1.0/1.0)=1.0, BM=(2.0/2.0)=1.0, diff=0
  assert.equal(out[0].data[0], 0);
  // idx=1: F1=1.2, BM=1.05, diff=0.15
  assert.ok(Math.abs(out[0].data[1] - 0.15) < 1e-9);
});
