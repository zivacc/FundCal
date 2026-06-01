/**
 * 派生指标注册表（跨 series 衍生层）
 * =================================
 *
 * 与 indicators.js（per-fund 指标）的关系：
 *   - INDICATORS：对**每只基金**调 build(ctx) 一次，产线一条/只
 *   - DERIVED_INDICATORS：在 per-fund 循环**之后**整体调用，跨多条 series 派生
 *
 * 首个成员：超额收益（EXCESS）
 *   - 累计形式，从基准日起算
 *   - 算法由 valueMode 决定：pct → 几何, nav → 算术
 *   - 参数：分子 ref / 分母 ref；ref 可为具体 code 或 sentinel
 *     ('FIRST_FUND' / 'BENCHMARK')，由 resolveRef 在每次渲染时解析
 *   - 信息不全（ref 解析失败 / 基准日缺失 / 任一边在基准日无数据）→ 返回 [] 不画
 *
 * 加新派生指标 = 在下方 DERIVED_INDICATORS 里加一项。
 */

/** ref sentinel 常量 —— 与 state 持久化值约定一致 */
export const REF_FIRST_FUND = 'FIRST_FUND';
export const REF_BENCHMARK = 'BENCHMARK';

/**
 * 解析 ref 到具体 code。返回 null 表示当前 selected 里没有可用目标。
 *
 * @param {string} ref            'FIRST_FUND' | 'BENCHMARK' | <ts_code>
 * @param {Array<{code,name,isBenchmark?}>} selected
 * @returns {string|null}
 */
export function resolveRef(ref, selected) {
  if (!Array.isArray(selected) || selected.length === 0) return null;
  if (ref === REF_BENCHMARK) {
    return selected.find(s => s.isBenchmark)?.code || null;
  }
  if (ref === REF_FIRST_FUND) {
    return selected.find(s => !s.isBenchmark)?.code || null;
  }
  // 具体 code：仅当当前还在 selected 里才返回
  return selected.some(s => s.code === ref) ? ref : null;
}

/**
 * 计算累计超额序列（从基准日起，pre-baseline 为 null）。
 *
 * 单位约定：
 *   - geom 模式：返回 NAV_A/base_A ÷ NAV_B/base_B
 *     恒正比例，1.0 表示持平（与 pct 模式主轴单位 v/base 兼容）
 *   - arith 模式：返回 (NAV_A/base_A) − (NAV_B/base_B)
 *     0 附近差值，单位是"累计收益百分点的小数表示"
 *
 * 基准日选择：从 allDates 里找 ≥ baselineDate 的最早日；若该日 A/B 任一为空，
 * 向后推到两边都非空的第一日。两边整段都空 → 返回全 null。
 *
 * @param {string[]} allDates              YYYYMMDD 升序
 * @param {Array<number|null>} alignedA    与 allDates 等长（前向填充后的 NAV）
 * @param {Array<number|null>} alignedB    同上
 * @param {string|null} baselineDate       'YYYY-MM-DD' 或 null
 * @param {'geom'|'arith'} mode
 * @returns {Array<number|null>}           与 allDates 等长
 */
export function computeExcessSeries(allDates, alignedA, alignedB, baselineDate, mode) {
  const n = allDates.length;
  const out = new Array(n).fill(null);
  if (!baselineDate || !alignedA || !alignedB) return out;
  if (alignedA.length !== n || alignedB.length !== n) return out;

  const target = String(baselineDate).replace(/-/g, '');
  let baseIdx = allDates.findIndex(d => d >= target);
  if (baseIdx === -1) return out;
  while (baseIdx < n && (alignedA[baseIdx] == null || alignedB[baseIdx] == null)) baseIdx++;
  if (baseIdx >= n) return out;

  const baseA = alignedA[baseIdx];
  const baseB = alignedB[baseIdx];
  if (!baseA || !baseB) return out;

  for (let i = baseIdx; i < n; i++) {
    const a = alignedA[i], b = alignedB[i];
    if (a == null || b == null) continue;
    const rA = a / baseA;
    const rB = b / baseB;
    out[i] = mode === 'geom' ? rA / rB : rA - rB;
  }
  return out;
}

/**
 * 按 valueMode 选择超额算法。
 * pct 模式 → geom（几何超额，与 v/base 主轴单位匹配）
 * nav 模式 → arith（算术差）
 */
export function excessModeForValueMode(valueMode) {
  return valueMode === 'pct' ? 'geom' : 'arith';
}

/**
 * 派生指标条目字段约定：
 *   id / label / defaultEnabled
 *   persist: { enabledKey, ...其它参数键 }    —— state 里的字段名
 *   panel:   'main' | <subplot_id>          —— 同 INDICATORS 语义
 *
 *   build(ctx): 返回 ECharts series 数组（可空数组 = 这次不画）
 *     ctx 形状：
 *       {
 *         state,           // 完整 state 引用（读 ref 参数 + valueMode + selected）
 *         series,          // state.data.series（含基准）
 *         alignedByCode,   // Map<code, Array<number|null>>
 *         allDates,        // YYYYMMDD 升序
 *         baseline,        // effectiveBaseline (ISO) 或 null
 *         theme,           // 主题色
 *         xAxisIndex, yAxisIndex,  // panel 对应轴索引
 *       }
 */
export const DERIVED_INDICATORS = {
  EXCESS: {
    id: 'EXCESS',
    label: '超额收益',
    defaultEnabled: true,
    persist: {
      enabledKey: 'excessOn',
      numRefKey: 'excessNumRef',     // 'FIRST_FUND' | <code>
      denRefKey: 'excessDenRef',     // 'BENCHMARK'  | <code>
    },
    defaults: {
      excessNumRef: REF_FIRST_FUND,
      excessDenRef: REF_BENCHMARK,
    },
    ui: {
      checkboxId: 'nav-ind-excess',
      numSelectId: 'nav-ind-excess-num',
      denSelectId: 'nav-ind-excess-den',
    },
    panel: 'main',
    build(ctx) {
      const { state, series, alignedByCode, allDates, baseline, xAxisIndex, yAxisIndex } = ctx;
      const numCode = resolveRef(state.excessNumRef, state.selected);
      const denCode = resolveRef(state.excessDenRef, state.selected);
      if (!numCode || !denCode || numCode === denCode) return [];

      const numAligned = alignedByCode.get(numCode);
      const denAligned = alignedByCode.get(denCode);
      if (!numAligned || !denAligned) return [];

      const mode = excessModeForValueMode(state.valueMode);
      const data = computeExcessSeries(allDates, numAligned, denAligned, baseline, mode);
      if (data.every(v => v == null)) return [];

      const numName = series.find(s => s.code === numCode)?.name || numCode;
      const denName = series.find(s => s.code === denCode)?.name || denCode;
      const label = mode === 'geom' ? '几何超额' : '算术超额';

      return [{
        name: `${label} ${numName}/${denName}`,
        type: 'line',
        data,
        showSymbol: false,
        lineStyle: { width: 1.2, color: ctx.theme.accent, type: 'dashed' },
        itemStyle: { color: ctx.theme.accent },
        xAxisIndex, yAxisIndex,
        connectNulls: true,
        z: 5,
      }];
    },
  },
};

/** 有序数组形式 —— 用在遍历场景（persist、setupEvents、renderChart 循环） */
export const DERIVED_INDICATORS_LIST = Object.values(DERIVED_INDICATORS);

/** 派生指标在 state 里是否开启。 */
export function isDerivedEnabled(state, ind) {
  return !!state[ind.persist.enabledKey];
}
