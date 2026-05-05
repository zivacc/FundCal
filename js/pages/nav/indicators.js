/**
 * 指标 & 副图注册表（前端渲染层）
 * ========================
 *
 * 这个文件把原本散落在 index.js 里的指标相关硬编码（MA20 / MA60 / 回撤副图）
 * 集中到两张表：
 *
 *   INDICATORS  —— 每只基金可叠加的衍生数据层（MA、未来的 EMA / Bollinger / …）
 *   SUBPLOTS    —— 独立的副图（drawdown，未来的 RSI / MACD / Volume 等）
 *
 * 每个指标声明自己需要什么（stateKey、UI 控件 id、panel 归属、计算方式、
 * 如何产出 ECharts series、怎么出现在区间统计 panel 里）。renderChart、
 * persist、applyStateToUI、setupEvents、showPersistentRangeStats 全部用
 * 循环遍历注册表来跑，**加一个新指标 = 往表里加一项**，不再需要改 5 处分支。
 *
 * 本模块内所有函数都是纯函数（无 DOM、无 ECharts 实例引用），方便独立单测。
 *
 * 注意：项目里另有一张同名 INDICATORS 在 js/domain/nav-stats.js —— 那是
 * **后端 API 层**用的 compute+attach 预算注册表（给 /nav/compare?indicators=...
 * 接口在返回前把 ma20/drawdown 数组塞进 series）。两套表目标层不同：
 *   - 这里是 **怎么画 + UI 行为**
 *   - 那边是 **怎么算 + 返回哪些字段**
 * 目前前端还是在本地重算（不依赖后端预算的那份），所以两套表互不影响。
 */

import { computeMA, computeMASingle, computeDrawdown } from '../../domain/nav-statistics.js';

/* ========== SUBPLOTS（副图） ========== */

/**
 * 副图声明：独立 grid + 独立 yAxis。
 * order 决定多副图时的从上到下顺序。
 * grid.top / grid.height 采用百分比字符串（ECharts 接受），相对整个图表区。
 * buildYAxis(theme, gridIndex) —— 按索引生成 yAxis 配置。
 */
export const SUBPLOTS = {
  drawdown: {
    id: 'drawdown',
    order: 1,
    yAxisName: '回撤',
    grid: { left: 60, right: 30, top: '72%', height: '14%' },
    // 只返回 type + 数据相关配置；公共的 name/nameTextStyle 由 renderChart 统一套
    buildYAxis: (theme, gridIndex) => ({
      type: 'value',
      gridIndex,
      max: 0,
      axisLabel: { color: theme.text2, fontSize: 13, formatter: (v) => `${v.toFixed(0)}%` },
      axisLine: { lineStyle: { color: theme.rule } },
      splitLine: { lineStyle: { color: theme.rule, opacity: 0.5 } },
    }),
  },
  // 未来扩展示例：
  // rsi: { id: 'rsi', order: 2, grid: { left: 60, right: 30, top: '90%', height: '8%' }, buildYAxis: ... },
};

/* ========== INDICATORS（指标） ========== */

/**
 * 指标条目字段约定：
 *   id:           注册 id，也是区间统计 panel cell 的 key
 *   label:        UI 展示文本（区间统计 panel 里的列头 / 单基金 cell 标签）
 *   defaultEnabled: 首次访问的默认状态
 *   persist.key:  state 上的字段名（保持向后兼容，不换名以避免迁移）
 *   ui.checkboxId: 控件 id（HTML 里现有按钮）
 *   panel:        'main' | subplot id —— 决定该指标画到主图还是哪个副图
 *
 *   build(ctx):    产出 ECharts series entries 数组。主图指标返回 1 条线；
 *                  副图指标可返回带 markPoint 的 series。ctx 见下方类型说明。
 *
 *   rangeStats?:   可选。若存在，该指标会出现在"持久区间统计"面板里。
 *                  - label: 列头 / cell 标签
 *                  - single(aligned, lastIdx) → number | null  取单点值
 *
 * build 的 ctx 形状：
 *   {
 *     code, name, color,
 *     aligned:     raw NAV 对齐到 allDates 后的数组（含 null）
 *     transformed: 经 transformByMode 后的数组（主图画的值）
 *     winEIdx:     当前视图窗口结束索引
 *     extremaStartIdx: 极值搜索起点索引（>= viewStart 且 >= baseline）
 *     xAxisIndex:  指标所属 panel 的 xAxis 索引（0=main）
 *     yAxisIndex:  同上
 *   }
 */
export const INDICATORS = {
  MA20: {
    id: 'MA20',
    label: 'MA20',
    defaultEnabled: false,
    persist: { key: 'showMA20' },
    ui: { checkboxId: 'nav-ind-ma20' },
    panel: 'main',
    build(ctx) {
      return [{
        name: `${ctx.code} MA20`,
        type: 'line',
        data: computeMA(ctx.transformed, 20),
        showSymbol: false,
        lineStyle: { width: 1, color: ctx.color, type: 'dashed', opacity: 0.6 },
        xAxisIndex: ctx.xAxisIndex, yAxisIndex: ctx.yAxisIndex,
        connectNulls: true,
      }];
    },
    rangeStats: {
      label: 'MA20',
      single: (aligned, lastIdx) => computeMASingle(aligned, lastIdx, 20),
    },
  },

  MA60: {
    id: 'MA60',
    label: 'MA60',
    defaultEnabled: false,
    persist: { key: 'showMA60' },
    ui: { checkboxId: 'nav-ind-ma60' },
    panel: 'main',
    build(ctx) {
      return [{
        name: `${ctx.code} MA60`,
        type: 'line',
        data: computeMA(ctx.transformed, 60),
        showSymbol: false,
        lineStyle: { width: 1, color: ctx.color, type: 'dotted', opacity: 0.6 },
        xAxisIndex: ctx.xAxisIndex, yAxisIndex: ctx.yAxisIndex,
        connectNulls: true,
      }];
    },
    rangeStats: {
      label: 'MA60',
      single: (aligned, lastIdx) => computeMASingle(aligned, lastIdx, 60),
    },
  },

  DRAWDOWN: {
    id: 'DRAWDOWN',
    label: '回撤副图',
    defaultEnabled: true,
    persist: { key: 'showDD' },
    ui: { checkboxId: 'nav-ind-dd' },
    panel: 'drawdown',
    build(ctx) {
      const ddArr = computeDrawdown(ctx.aligned);
      // 视图窗口 × 基准后区间内的最大回撤（最小值）
      let minI = -1, minV = Infinity;
      for (let k = ctx.extremaStartIdx; k <= ctx.winEIdx; k++) {
        const v = ddArr[k];
        if (v == null || !Number.isFinite(v)) continue;
        if (v < minV) { minV = v; minI = k; }
      }
      const markData = minI >= 0
        ? [{ name: '最大回撤', coord: [minI, minV], value: minV, label: { position: 'bottom' } }]
        : [];
      return [{
        // 与主线同名 —— 即便自定义 legend 不依赖这一点，tooltip.formatter 里的
        // params[0] 仍按 xAxis 第一个 series 取值，保留命名一致性风险更小。
        name: `${ctx.code} ${ctx.name}`,
        type: 'line',
        data: ddArr,
        showSymbol: false,
        lineStyle: { width: 1, color: ctx.color },
        areaStyle: { color: ctx.color, opacity: 0.08 },
        xAxisIndex: ctx.xAxisIndex, yAxisIndex: ctx.yAxisIndex,
        sampling: 'lttb', connectNulls: true,
        markPoint: markData.length ? {
          symbol: 'circle', symbolSize: 1, silent: true,
          itemStyle: { color: 'rgba(0,0,0,0)', borderColor: 'rgba(0,0,0,0)' },
          label: {
            show: true,
            color: ctx.color, fontSize: 13, fontWeight: 600,
            formatter: (p) => {
              const v = Array.isArray(p.value) ? p.value[1] : p.value;
              return Number.isFinite(v) ? `${v.toFixed(1)}%` : '-';
            },
          },
          data: markData,
        } : undefined,
      }];
    },
    // 回撤目前不进区间统计 panel（"最大回撤"字段已由 computeRangeStats 提供）
  },
};

/** INDICATORS 的有序数组形式 —— 用在遍历场景（persist、setupEvents 等） */
export const INDICATORS_LIST = Object.values(INDICATORS);

/* ========== 辅助函数 ========== */

/** 指标在 state 里是否开启。 */
export function isIndicatorEnabled(state, ind) {
  return !!state[ind.persist.key];
}

/** 当前开启的指标列表。 */
export function getEnabledIndicators(state) {
  return INDICATORS_LIST.filter(ind => isIndicatorEnabled(state, ind));
}

/**
 * 当前开启的指标里用到的副图（去重 + 按 order 排序）。
 * 主图指标（panel === 'main'）不参与。
 */
export function getActiveSubplots(state) {
  const ids = new Set();
  for (const ind of getEnabledIndicators(state)) {
    if (ind.panel && ind.panel !== 'main' && SUBPLOTS[ind.panel]) {
      ids.add(ind.panel);
    }
  }
  return Object.values(SUBPLOTS)
    .filter(sp => ids.has(sp.id))
    .sort((a, b) => (a.order || 0) - (b.order || 0));
}

/**
 * 副图 id → xAxis/yAxis/grid 索引的映射。主图永远是 0；副图从 1 开始。
 * 返回 { main: 0, [subplotId]: 1, ... }
 */
export function getSubplotIndexMap(activeSubplots) {
  const map = { main: 0 };
  activeSubplots.forEach((sp, i) => { map[sp.id] = i + 1; });
  return map;
}

/** 指标应使用的 axis 索引（根据它 panel 所在的 grid）。 */
export function getIndicatorAxisIndex(ind, idxMap) {
  return idxMap[ind.panel] ?? 0;
}

/** 进入区间统计 panel 的指标（有 rangeStats 定义 + 当前 enabled）。 */
export function getEnabledRangeStatsIndicators(state) {
  return INDICATORS_LIST.filter(ind => ind.rangeStats && isIndicatorEnabled(state, ind));
}
