import { BENCHMARK_CANDIDATES, DEFAULT_BENCHMARK, resolveDefaultBenchmark } from '../../core/benchmarks.js';

/** 恢复旧选择时补齐基准；复用同代码项，不因容量限制丢弃已有对比项。 */
export function ensureBenchmarkSelection(selected, fundType) {
  const existing = selected.find(item => item.isBenchmark);
  const preferred = resolveDefaultBenchmark({ fundType });
  const candidate = BENCHMARK_CANDIDATES.find(item => item.tsCode === preferred && item.available)
    || BENCHMARK_CANDIDATES.find(item => item.tsCode === DEFAULT_BENCHMARK);
  const code = existing?.code || candidate.tsCode;
  const benchmark = existing || selected.find(item => item.code === code)
    || { code, name: candidate.label, kind: 'index' };
  return [...selected.filter(item => item.code !== code).map(({ isBenchmark, ...item }) => item),
    { ...benchmark, isBenchmark: true }];
}

/** 切换时合并已在比较列表中的同代码项，保留基准颜色。 */
export function replaceBenchmarkSelection(selected, candidate) {
  const existing = selected.find(item => item.isBenchmark);
  return [...selected.filter(item => !item.isBenchmark && item.code !== candidate.tsCode), {
    code: candidate.tsCode, name: candidate.label, kind: 'index',
    color: existing?.color, isBenchmark: true,
  }];
}
