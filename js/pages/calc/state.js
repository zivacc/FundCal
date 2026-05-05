/**
 * 计算器页 - 状态持久化（纯 IO + 纯函数，零 DOM 依赖）
 *
 * 暴露的 helper 都接收/返回 plain state 对象，由 index.js 负责
 * 将其与 DOM 之间的读写桥接（getStateFromDOM / restoreState 等）。
 */

const STORAGE_KEY = 'fundCalState';
const SESSION_COMPARE_FROM_CACHE_KEY = 'fundCalCompareFromCache';

/** 从 .ziva 快照对象中提取 state；容错支持直接传入 state 本身 */
export function extractStateFromSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return null;
  if (snapshot.type === 'FundCalSnapshot' && snapshot.state && typeof snapshot.state === 'object') {
    return snapshot.state;
  }
  // 兼容老格式：直接就是 state
  if (snapshot.funds || snapshot.calcDaysMin != null || snapshot.calcDaysMax != null) {
    return snapshot;
  }
  return null;
}

/** 用页面 state 构造完整 .ziva 导出快照对象 */
export function createExportSnapshot(state) {
  return {
    type: 'FundCalSnapshot',
    version: 1,
    createdAt: new Date().toISOString(),
    state,
  };
}

/** 保存 state 到 localStorage（容错） */
export function saveStateToStorage(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch { /* ignore */ }
}

/** 从 localStorage 读取 state，无效或不存在返回 null */
export function loadStateFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** 清除 localStorage 中暂存的 state */
export function clearStorageState() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch { /* ignore */ }
}

/**
 * 消费 sessionStorage 中"从基金列表页传来的去比较"基金列表（一次性）。
 * 读取后立即移除 session 项。
 * @returns {Array<{code?:string, name?:string}> | null}
 */
export function consumeCompareFromCacheSession() {
  try {
    const raw = sessionStorage.getItem(SESSION_COMPARE_FROM_CACHE_KEY);
    if (!raw) return null;
    // 不论解析成功与否都清除 session 项
    try { sessionStorage.removeItem(SESSION_COMPARE_FROM_CACHE_KEY); } catch { /* ignore */ }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
    const list = parsed && (parsed.funds || parsed);
    if (!Array.isArray(list) || list.length === 0) return null;
    return list;
  } catch {
    return null;
  }
}
