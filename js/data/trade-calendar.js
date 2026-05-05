/**
 * A 股交易日历（SSE）加载器。
 *
 * 数据来源: scripts/build-trade-calendar.js 生成 data/allfund/trade-calendar.json
 * 格式: { version, exchange, from, to, openDays: string[] }  (YYYYMMDD 紧凑格式)
 *
 * 全局只 fetch 一次，结果用 Set 存 open 天，命中 O(1)。
 * 日期若落在日历覆盖范围之外（例如 1990-12-19 之前），降级为"认为是开盘日"
 * —— 避免把上古时代的基金数据误杀。
 */

let _openSet = null;
let _fromYmd = '';
let _toYmd = '';
let _loadingPromise = null;

/**
 * 异步加载交易日历。重复调用复用同一个 Promise，不会发多次请求。
 * fetch 失败时不抛异常，返回 null；isTradingDay 会降级放行所有日期。
 */
export function loadTradeCalendar() {
  if (_openSet) return Promise.resolve(_openSet);
  if (_loadingPromise) return _loadingPromise;
  _loadingPromise = (async () => {
    try {
      const res = await fetch('data/allfund/trade-calendar.json');
      if (!res.ok) return null;
      const cal = await res.json();
      if (!cal || !Array.isArray(cal.openDays)) return null;
      _openSet = new Set(cal.openDays);
      _fromYmd = String(cal.from || '');
      _toYmd = String(cal.to || '');
      return _openSet;
    } catch (_) {
      return null;
    } finally {
      _loadingPromise = null;
    }
  })();
  return _loadingPromise;
}

/**
 * 判断某日（YYYYMMDD）是否为交易日。
 * - 日历尚未加载：保守返回 true（不过滤）
 * - 日期在日历覆盖范围外：保守返回 true（不误杀历史数据）
 */
export function isTradingDay(ymd) {
  if (!_openSet) return true;
  if (!ymd) return false;
  if ((_fromYmd && ymd < _fromYmd) || (_toYmd && ymd > _toYmd)) return true;
  return _openSet.has(ymd);
}

/**
 * 仅测试用：重置模块状态，让 loadTradeCalendar 可以被再次触发。
 */
export function __resetForTest() {
  _openSet = null;
  _fromYmd = '';
  _toYmd = '';
  _loadingPromise = null;
}
