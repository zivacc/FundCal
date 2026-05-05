/**
 * NAV 统计指标（纯函数，无 DOM 依赖）
 *
 * 输入约定：
 * - values: number[]  净值/收益数组，可能含 null（缺失，为对齐补齐时引入）
 * - dates : string[]  YYYYMMDD（紧凑格式），与 values 同长且一一对应
 *
 * 这一层只负责对齐后的"算"，不负责"取数"或"对齐"。
 */

/**
 * 简单移动平均（SMA）。
 * 前 n-1 个位置返回 null（窗口未填满）。
 * @param {Array<number|null>} values
 * @param {number} n  窗口长度，n>=1
 * @returns {Array<number|null>}
 */
export function computeMA(values, n) {
  const len = values.length;
  const out = new Array(len).fill(null);
  if (n < 1 || len === 0) return out;
  let sum = 0;
  let count = 0;
  for (let i = 0; i < len; i++) {
    const v = values[i];
    if (v != null) { sum += v; count++; }
    if (i >= n) {
      const drop = values[i - n];
      if (drop != null) { sum -= drop; count--; }
    }
    if (i >= n - 1 && count === n) out[i] = sum / n;
  }
  return out;
}

/**
 * 单点 SMA。语义与 computeMA 一致（窗口必须满 n 个非空值才返回数字），
 * 但只计算 idx 这一个点 —— O(n) 而非 O(N)。
 * 当 idx < n-1 或窗口内有 null 时返回 null。
 *
 * 用途：区间统计 panel 拖动时只需"区间末点"的 MA 数值，不需要整条曲线。
 *
 * @param {Array<number|null>} values
 * @param {number} idx  目标位置（0-based）
 * @param {number} n    窗口长度
 * @returns {number|null}
 */
export function computeMASingle(values, idx, n) {
  if (!Array.isArray(values) || n < 1) return null;
  if (idx < n - 1 || idx >= values.length) return null;
  let sum = 0;
  for (let i = idx - n + 1; i <= idx; i++) {
    const v = values[i];
    if (v == null) return null;
    sum += v;
  }
  return sum / n;
}

/**
 * 历史峰值回撤序列（百分比，负值）。
 * 与首只可用净值开始计算 peak；null 输入返回 null（不画"伪 0%"基线）。
 * @param {Array<number|null>} values
 * @returns {Array<number|null>}  长度同 values；null 区段保持 null
 */
export function computeDrawdown(values) {
  const len = values.length;
  const out = new Array(len).fill(null);
  let peak = null;
  for (let i = 0; i < len; i++) {
    const v = values[i];
    if (v == null) continue; // 保留 null：基金成立前 / 数据缺失段
    if (peak == null || v > peak) peak = v;
    out[i] = peak > 0 ? (v / peak - 1) * 100 : 0;
  }
  return out;
}

/**
 * 把净值序列按 *值* 模式变换（与 *坐标轴* 模式正交）。
 *
 * 设计：
 * - 这里只做 "用什么数 plot" 的决策；
 * - "怎么 plot 这条数线"（线性 vs 对数刻度）由 ECharts `yAxis.type` 单独决定。
 *   两者解耦，避免出现 "对数模式" + "百分比" 这种含义模糊的组合。
 *
 * 模式：
 * - 'nav' : 原始净值（保留 null）
 * - 'pct' : 相对基准日的"比例" v/base（恒正，可直接走 log 轴）；
 *           Y 轴格式化器再把比例 r 显示为 ((r-1)*100).toFixed(...) + '%'。
 *
 * 历史兼容：'raw' 视作 'nav'，'log' 视作 'nav'（旧 log 模式已废弃，
 * 现在请同时把 axisScale 设为 'log' 并把 valueMode 设成 'nav' 或 'pct'）。
 *
 * @param {string[]} dates                   YYYYMMDD 格式
 * @param {Array<number|null>} navs          与 dates 等长
 * @param {'nav'|'pct'|'raw'|'log'} mode
 * @param {string|null} [baselineDate]       'YYYY-MM-DD' 或 null
 * @returns {Array<number|null>}             与 navs 等长
 */
export function transformByMode(dates, navs, mode, baselineDate) {
  // 旧名兼容
  if (mode === 'raw' || mode === 'log' || mode === 'nav') return navs.slice();

  // pct：返回比例 v/base（恒正），不再乘 100 / 不再减 1
  let baseIdx = 0;
  if (baselineDate) {
    const target = String(baselineDate).replace(/-/g, '');
    const found = dates.findIndex(d => d >= target);
    baseIdx = found === -1 ? 0 : found;
  }
  // 若基准日 nav 为空，向后推到第一个非空点，避免整段返回 null
  while (baseIdx < navs.length && navs[baseIdx] == null) baseIdx++;
  const base = navs[baseIdx];
  if (base == null || !(base > 0)) return navs.map(() => null);
  return navs.map(v => v != null ? v / base : null);
}

/**
 * 给 log Y 轴挑选一个让 tick 密度接近线性轴的 logBase。
 *
 * ECharts log 轴的 tick 间隔严格按 logBase^k 来落点；默认 logBase=10
 * 在金融净值数据（典型范围 0.5..3）下只能得到 1 个 split。
 *
 * 算法：让 ratio = max/min；目标 tick 数 N=6；理想 base = ratio^(1/N)；
 * 然后 round 到一个"漂亮"值（1.2 / 1.5 / 2 / e / 3 / 5 / 10）方便阅读。
 *
 * @param {number[][]} seriesValues
 * @returns {number}  适用于 yAxis.logBase 的数；范围 1.2..10
 */
export function pickLogBase(seriesValues) {
  let lo = Infinity;
  let hi = -Infinity;
  for (const arr of seriesValues || []) {
    if (!Array.isArray(arr)) continue;
    for (const v of arr) {
      if (v == null || !Number.isFinite(v) || v <= 0) continue;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo >= hi) return 10;
  const ratio = hi / lo;
  const ideal = Math.pow(ratio, 1 / 6); // 想要 ~6 个 tick
  const candidates = [1.2, 1.5, 2, Math.E, 3, 5, 10];
  for (const c of candidates) if (c >= ideal) return c;
  return 10;
}

/**
 * 由 *变换后* 的序列推算适合 yAxis 的 [min, max]。
 *
 * - 线性轴：在 data range 上加 5% 加性 padding；
 * - 对数轴：取严格正值的 min/max，并各乘 0.99 / 1.01 形成乘法 padding。
 *
 * @param {Array<Array<number|null>>} seriesValues  多条序列变换后的值
 * @param {'linear'|'log'} axisScale
 * @returns {{min: number|undefined, max: number|undefined}}
 */
export function computeYAxisBounds(seriesValues, axisScale) {
  let lo = Infinity;
  let hi = -Infinity;
  for (const arr of seriesValues || []) {
    if (!Array.isArray(arr)) continue;
    for (const v of arr) {
      if (v == null || !Number.isFinite(v)) continue;
      if (axisScale === 'log' && !(v > 0)) continue;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return { min: undefined, max: undefined };
  if (axisScale === 'log') {
    return { min: lo * 0.99, max: hi * 1.01 };
  }
  // 线性：5% 加性 padding，保持 0 在视野内不被压死
  const span = hi - lo;
  const pad = span > 0 ? span * 0.05 : Math.abs(hi) * 0.05 || 1;
  return { min: lo - pad, max: hi + pad };
}
