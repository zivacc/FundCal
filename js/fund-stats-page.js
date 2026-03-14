function getFeeApiBase() {
  if (typeof window !== 'undefined' && window.FUND_FEE_API_BASE) {
    return window.FUND_FEE_API_BASE;
  }
  if (typeof window !== 'undefined') {
    const h = window.location.hostname;
    if (h === 'localhost' || h === '127.0.0.1') {
      return 'http://localhost:3457/api/fund';
    }
    if (h.endsWith('.github.io')) return null;
    return '/api/fund';
  }
  return 'http://localhost:3457/api/fund';
}

const STATS_PAGE_SIZE = 100;
let statsViews = null;
let currentStatsKey = 'tracking';
let statsLoadedCounts = {};
let statsObserver = null;
let fundDetailCache = {};
let statsDetail = null;

// 静态模式下的 allfund.json 缓存，供明细回退使用（避免每次点击都重新加载大文件）
let allfundStoreCache = null;
let allfundStoreLoading = null;

// 静态模式下的「代码 -> 基金名称」映射，体积较小，优先用于补全名称
let codeNameMapCache = null;
let codeNameMapLoading = null;

async function ensureAllfundStore() {
  if (allfundStoreCache) return allfundStoreCache;
  if (allfundStoreLoading) return allfundStoreLoading;
  allfundStoreLoading = (async () => {
    try {
      const res = await fetch('data/allfund/allfund.json').catch(() => null);
      if (!res || !res.ok) return {};
      const data = await res.json();
      const store = data.funds || data || {};
      /** @type {Record<string, any>} */
      const byCode = {};
      for (const code of Object.keys(store)) {
        byCode[code] = store[code];
      }
      allfundStoreCache = byCode;
      return byCode;
    } catch {
      allfundStoreCache = {};
      return {};
    } finally {
      allfundStoreLoading = null;
    }
  })();
  return allfundStoreLoading;
}

async function ensureCodeNameMap() {
  if (codeNameMapCache) return codeNameMapCache;
  if (codeNameMapLoading) return codeNameMapLoading;
  codeNameMapLoading = (async () => {
    try {
      const res = await fetch('data/allfund/code-name-map.json').catch(() => null);
      if (!res || !res.ok) {
        codeNameMapCache = {};
        return {};
      }
      const data = await res.json();
      if (!data || typeof data !== 'object') {
        codeNameMapCache = {};
        return {};
      }
      codeNameMapCache = data;
      return data;
    } catch {
      codeNameMapCache = {};
      return {};
    } finally {
      codeNameMapLoading = null;
    }
  })();
  return codeNameMapLoading;
}

// 跟踪指数搜索时复用 name 的拼音首字母索引：code -> initials
let searchIndexInitialsMap = null;

function getFeeApiBaseSafe() {
  return getFeeApiBase();
}

function setStatus(msg, isError = false) {
  const el = document.getElementById('fund-stats-status');
  if (!el) return;
  el.textContent = msg;
  el.classList.toggle('error', !!isError);
}

function setProgress(pct) {
  const bar = document.getElementById('fund-stats-progress-bar');
  if (!bar) return;
  const v = Math.max(0, Math.min(100, pct));
  bar.style.width = `${v.toFixed(1)}%`;
}

function renderSummary(total) {
  const el = document.getElementById('fund-stats-summary');
  if (!el) return;
  if (!total) {
    el.innerHTML = '<p class="fund-stats-summary-text">当前没有缓存的基金数据。</p>';
    return;
  }
  el.innerHTML = `
    <div class="fund-stats-summary-card fund-stats-fade-in">
      <div class="fund-stats-summary-number">${total}</div>
      <div class="fund-stats-summary-label">已缓存基金总数<span class="fund-stats-summary-extra" id="fund-stats-summary-extra"></span></div>
      <div class="fund-stats-summary-sub">基于本地 allfund.json 聚合统计</div>
    </div>
  `;
}

function renderSection(containerId, items, total, titleForEmpty, metaSuffix, viewKey, offset = 0) {
  const el = document.getElementById(containerId);
  if (!el) return;
  if (!items || !items.length) {
    el.innerHTML = `<p class="fund-stats-empty">${titleForEmpty || '暂无数据'}</p>`;
    return;
  }
  // items 已经过滤为当前应显示的子集，这里不再额外限制数量
  const maxCount = items[0]?.count || 1;
  el.innerHTML = items.map((item, idx) => {
    const pct = total ? (item.count / total) * 100 : 0;
    const barWidth = maxCount ? (item.count / maxCount) * 100 : 0;
    const tail = metaSuffix || '的基金';
    const globalIndex = offset + idx;
    return `
      <div class="fund-stats-card fund-stats-fade-in"
           data-view-key="${viewKey || ''}"
           data-label="${item.label}"
           data-index="${globalIndex}"
           role="button"
           tabindex="0"
           aria-label="${item.label}，共 ${item.count} 只基金"
           style="animation-delay:${idx * 25}ms">
        <div class="fund-stats-card-header">
          <div class="fund-stats-card-title" title="${item.label}">${item.label}</div>
          <div class="fund-stats-card-count">${item.count}</div>
        </div>
        <div class="fund-stats-card-bar-wrap">
          <div class="fund-stats-card-bar" style="width:${barWidth.toFixed(1)}%"></div>
        </div>
        <div class="fund-stats-card-meta">${pct.toFixed(2)}% ${tail}</div>
      </div>
    `;
  }).join('');
}

/**
 * 在「按跟踪标的统计」视图中，根据名称 / 拼音首字母过滤统计项。
 * 仅对 tracking 维度生效，其他维度不参与搜索。
 * @param {string} q
 * @returns {Array<{label:string,count:number,codes:string[]}>}
 */
async function ensureSearchIndexInitialsMap() {
  if (searchIndexInitialsMap) return searchIndexInitialsMap;
  searchIndexInitialsMap = new Map();
  let list = null;
  const base = getFeeApiBaseSafe();
  if (base) {
    try {
      const url = base.endsWith('/') ? `${base}search-index` : `${base}/search-index`;
      const res = await fetch(url);
      if (res.ok) list = await res.json();
    } catch { /* 尝试静态文件 */ }
  }
  if (!list) {
    try {
      const res = await fetch('data/allfund/search-index.json');
      if (res.ok) list = await res.json();
    } catch { /* 忽略 */ }
  }
  if (Array.isArray(list)) {
    for (const item of list) {
      const code = String(item.code || '').trim();
      if (!code) continue;
      const initials = String(item.initials || '').toLowerCase();
      if (!initials) continue;
      searchIndexInitialsMap.set(code, initials);
    }
  }
  return searchIndexInitialsMap;
}

async function filterTrackingItems(q) {
  if (!statsViews || !statsViews.tracking) return [];
  const list = statsViews.tracking.items || [];
  const s = String(q || '').trim().toLowerCase();
  if (!s) return list;
  // 支持纯数字直接按子串匹配（如「500」「300」）
  const numOnly = s.replace(/\D/g, '');
  const initialsMap = await ensureSearchIndexInitialsMap();

  const filtered = list.filter(item => {
    const label = String(item.label || '').trim();
    const lower = label.toLowerCase();
    if (!lower) return false;
    if (numOnly && (lower.includes(numOnly))) return true;
    if (lower.includes(s)) return true;
    // 1) 预留：如果后端为跟踪标的补充了拼音首字母，可直接利用
    if (item.initials && String(item.initials).toLowerCase().startsWith(s)) return true;
    // 2) 回退：如果本条 tracking 没有 initials，则看其成分基金名称的首字母
    if (Array.isArray(item.codes) && item.codes.length && initialsMap.size) {
      for (const code of item.codes) {
        const key = String(code || '').trim();
        if (!key) continue;
        const initials = initialsMap.get(key);
        if (initials && initials.startsWith(s)) return true;
      }
    }
    return false;
  });
  // 简单排序：名称前缀匹配优先，其次包含匹配，其余保持原顺序
  const score = (item) => {
    const lower = String(item.label || '').trim().toLowerCase();
    if (lower.startsWith(s)) return 0;
    if (numOnly && lower.includes(numOnly)) return 1;
    if (lower.includes(s)) return 2;
    return 3;
  };
  return filtered.slice().sort((a, b) => score(a) - score(b));
}

function ensureObserver() {
  if (statsObserver) return;
  statsObserver = new IntersectionObserver((entries) => {
    if (!entries.some(e => e.isIntersecting)) return;
    const v = statsViews && statsViews[currentStatsKey];
    if (!v) return;
    const totalItems = v.items.length;
    const loaded = statsLoadedCounts[currentStatsKey] ?? STATS_PAGE_SIZE /10;
    if (loaded >= totalItems) return;
    const nextLoaded = Math.min(loaded + STATS_PAGE_SIZE, totalItems);
    statsLoadedCounts[currentStatsKey] = nextLoaded;
    const gridEl = document.getElementById('fund-stats-grid');
    if (!gridEl) return;
    // 追加新的一批卡片，而不是整块重绘，避免在页面很靠下时长时间卡顿
    const newItems = v.items.slice(loaded, nextLoaded);
    const maxCount = v.items[0]?.count || 1;
    const tail = v.suffix || '的基金';
    const offset = loaded; // 用于渐入动画的延迟基数
    // 移除旧哨兵，稍后重新追加
    const oldSentinel = gridEl.querySelector('.fund-stats-grid-sentinel');
    if (oldSentinel) oldSentinel.remove();
    const html = newItems.map((item, idx) => {
      const pct = v.total ? (item.count / v.total) * 100 : 0;
      const barWidth = maxCount ? (item.count / maxCount) * 100 : 0;
      const delay = (offset + idx) * 2;
      const globalIndex = offset + idx;
      return `
        <div class="fund-stats-card fund-stats-fade-in"
             data-view-key="${v.key}"
             data-label="${item.label}"
             data-index="${globalIndex}"
             role="button"
             tabindex="0"
             aria-label="${item.label}，共 ${item.count} 只基金"
             style="animation-delay:${delay}ms">
          <div class="fund-stats-card-header">
            <div class="fund-stats-card-title" title="${item.label}">${item.label}</div>
            <div class="fund-stats-card-count">${item.count}</div>
          </div>
          <div class="fund-stats-card-bar-wrap">
            <div class="fund-stats-card-bar" style="width:${barWidth.toFixed(1)}%"></div>
          </div>
          <div class="fund-stats-card-meta">${pct.toFixed(2)}% ${tail}</div>
        </div>
      `;
    }).join('');
    if (html) {
      gridEl.insertAdjacentHTML('beforeend', html);
    }
    // 重新追加并监听新的哨兵
    const sentinel = document.createElement('div');
    sentinel.className = 'fund-stats-grid-sentinel';
    sentinel.setAttribute('aria-hidden', 'true');
    gridEl.appendChild(sentinel);
    statsObserver.observe(sentinel);
  }, {
    root: null,
    rootMargin: '0px 0px 120px 0px',
    threshold: 0.1,
  });
}

function getViewItemByLabel(viewKey, label) {
  if (!statsViews) return null;
  const v = statsViews[viewKey];
  if (!v || !v.items) return null;
  return v.items.find(item => item.label === label) || null;
}

async function fetchFundDetailByCode(code) {
  if (fundDetailCache[code]) return fundDetailCache[code];
  const base = getFeeApiBaseSafe();
  if (base) {
    try {
      const url = base.endsWith('/') ? `${base}${code}/fee` : `${base}/${code}/fee`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        fundDetailCache[code] = data;
        return data;
      }
    } catch { /* 尝试静态回退 */ }
  }
  
  // 优化：静态模式下优先按需从分片加载，避免频繁读取庞大的 allfund.json
  try {
    const res = await fetch(`data/allfund/funds/${code}.json`);
    if (res.ok) {
      const data = await res.json();
      fundDetailCache[code] = data;
      return data;
    }
  } catch (err) {
    console.error(`加载基金 ${code} 详情失败:`, err);
  }

  // 回退：如分片不存在，则从 allfund.json 中按代码查找一次
  try {
    const store = await ensureAllfundStore();
    const data = store && store[code];
    if (data) {
      fundDetailCache[code] = data;
      return data;
    }
  } catch (err) {
    console.error(`从 allfund.json 回退查找基金 ${code} 失败:`, err);
  }

  fundDetailCache[code] = null;
  return null;
}

async function loadFundsForCard(viewKey, label) {
  const item = getViewItemByLabel(viewKey, label);
  if (!item || !Array.isArray(item.codes) || !item.codes.length) {
    return { meta: item, funds: [] };
  }

  // 0. 纯静态部署（无 API）且存在预生成的统计详情文件时，优先直接使用静态详情，避免逐只请求
  const base = getFeeApiBaseSafe();
  if (!base && statsDetail && statsDetail[viewKey] && statsDetail[viewKey][label]) {
    const list = statsDetail[viewKey][label] || [];
    const funds = list.map(data => ({
      code: data.code,
      name: data.name || '',
      trackingTarget: (data.trackingTarget || '').trim(),
      fundManager: (data.fundManager || '').trim(),
      performanceBenchmark: (data.performanceBenchmark || '').trim(),
    }));
    return { meta: item, funds };
  }

  const codes = item.codes;

  // 1. 纯静态部署、无 API 时：优先使用预生成的「代码->名称」映射，避免逐只请求详情
  if (!base) {
    try {
      const codeNameMap = await ensureCodeNameMap();
      if (codeNameMap && typeof codeNameMap === 'object') {
        const funds = codes.map(code => {
          const c = String(code || '').trim();
          const name = codeNameMap[c] || '';
          return {
            code: c,
            name: name || '',
            trackingTarget: '',
            fundManager: '',
            performanceBenchmark: '',
          };
        });
        return { meta: item, funds };
      }
    } catch {
      // 如果映射加载失败，则继续走后面的逐只加载回退逻辑
    }
  }
  const tasks = codes.map(code => fetchFundDetailByCode(code));
  const results = await Promise.all(tasks);
  const funds = [];
  for (let i = 0; i < codes.length; i++) {
    const code = codes[i];
    const data = results[i];
    if (!data) {
      funds.push({
        code,
        name: '（加载失败）',
        trackingTarget: '',
        fundManager: '',
        performanceBenchmark: '',
      });
      continue;
    }
    funds.push({
      code: data.code || code,
      name: data.name || '',
      trackingTarget: (data.trackingTarget || '').trim(),
      fundManager: (data.fundManager || '').trim(),
      performanceBenchmark: (data.performanceBenchmark || '').trim(),
    });
  }
  return { meta: item, funds };
}

function renderFundDetailPlaceholder() {
  const el = document.getElementById('fund-stats-detail');
  if (!el) return;
  el.innerHTML = `
    <div class="fund-stats-detail-placeholder">
      <div class="fund-stats-detail-placeholder-title">点击上方任意统计卡片查看对应的基金列表</div>
      <div class="fund-stats-detail-placeholder-sub">支持按跟踪标的、基金公司、业绩基准维度展开明细。</div>
    </div>
  `;
}

function renderFundDetailLoading(label) {
  const el = document.getElementById('fund-stats-detail');
  if (!el) return;
  el.innerHTML = `
    <div class="fund-stats-detail-card fund-stats-detail-loading">
      <div class="fund-stats-detail-header">
        <div class="fund-stats-detail-header-main">
          <div class="fund-stats-detail-title" title="${label}">${label}</div>
          <div class="fund-stats-detail-meta">正在加载基金明细...</div>
        </div>
        <button type="button" class="fund-stats-detail-close-btn" aria-label="关闭基金列表">✕</button>
      </div>
      <div class="fund-stats-detail-list fund-stats-detail-list-skeleton">
        <div class="fund-stats-detail-row-skeleton"></div>
        <div class="fund-stats-detail-row-skeleton"></div>
        <div class="fund-stats-detail-row-skeleton"></div>
      </div>
    </div>
  `;
}

function renderFundDetail(viewKey, label, detail) {
  const el = document.getElementById('fund-stats-detail');
  if (!el) return;
  const meta = detail.meta;
  const funds = detail.funds || [];
  if (!meta || !funds.length) {
    el.innerHTML = `
      <div class="fund-stats-detail-card">
        <div class="fund-stats-detail-header">
          <div class="fund-stats-detail-header-main">
            <div class="fund-stats-detail-title" title="${label}">${label}</div>
            <div class="fund-stats-detail-meta">未找到对应的基金数据</div>
          </div>
          <button type="button" class="fund-stats-detail-close-btn" aria-label="关闭基金列表">✕</button>
        </div>
      </div>
    `;
    return;
  }
  const count = meta.count || funds.length;
  let typeLabel = '统计维度';
  if (viewKey === 'tracking') typeLabel = '跟踪标的';
  else if (viewKey === 'manager') typeLabel = '基金公司';
  else if (viewKey === 'benchmark') typeLabel = '业绩基准';
  else if (viewKey === 'fundType') typeLabel = '基金类型';
  const listHtml = funds.map((f, idx) => {
    const order = idx + 1;
    return `
      <div class="fund-stats-detail-row">
        <div class="fund-stats-detail-order">#${order}</div>
        <div class="fund-stats-detail-main">
          <div class="fund-stats-detail-name-line">
            <span class="fund-stats-detail-name" title="${f.name || f.code}">${f.name || f.code}</span>
            <span class="fund-stats-detail-code">${f.code}</span>
          </div>
          <div class="fund-stats-detail-extra">
            ${f.trackingTarget ? `<span class="fund-stats-detail-tag" title="跟踪标的">${f.trackingTarget}</span>` : ''}
            ${f.fundManager ? `<span class="fund-stats-detail-tag" title="基金公司">${f.fundManager}</span>` : ''}
          </div>
        </div>
      </div>
    `;
  }).join('');

  el.innerHTML = `
    <div class="fund-stats-detail-card fund-stats-fade-in">
      <div class="fund-stats-detail-header">
        <div class="fund-stats-detail-header-main">
          <div class="fund-stats-detail-title" title="${label}">${label}</div>
          <div class="fund-stats-detail-meta">
            ${typeLabel} · 共 ${count} 只基金
          </div>
        </div>
        <button type="button" class="fund-stats-detail-close-btn" aria-label="关闭基金列表">✕</button>
      </div>
      <div class="fund-stats-detail-list">
        ${listHtml}
      </div>
    </div>
  `;
}

function bindCardInteractions() {
  const gridEl = document.getElementById('fund-stats-grid');
  if (!gridEl) return;
  const mainEl = document.querySelector('.fund-stats-main');
  const detailWrapper = document.getElementById('fund-stats-detail-section');

  function openDetailPanel() {
    if (mainEl) {
      mainEl.classList.add('fund-stats-main-show-detail');
    }
  }

  function closeDetailPanel() {
    if (mainEl) {
      mainEl.classList.remove('fund-stats-main-show-detail');
    }
    renderFundDetailPlaceholder();
  }

  gridEl.addEventListener('click', async (evt) => {
    const card = evt.target.closest('.fund-stats-card');
    if (!card) return;
    const viewKey = card.getAttribute('data-view-key') || currentStatsKey;
    const label = card.getAttribute('data-label') || '';
    if (!label) return;
    openDetailPanel();
    renderFundDetailLoading(label);
    const detail = await loadFundsForCard(viewKey, label);
    renderFundDetail(viewKey, label, detail);
  });
  gridEl.addEventListener('keydown', async (evt) => {
    if (evt.key !== 'Enter' && evt.key !== ' ') return;
    const card = evt.target.closest('.fund-stats-card');
    if (!card) return;
    evt.preventDefault();
    const viewKey = card.getAttribute('data-view-key') || currentStatsKey;
    const label = card.getAttribute('data-label') || '';
    if (!label) return;
    openDetailPanel();
    renderFundDetailLoading(label);
    const detail = await loadFundsForCard(viewKey, label);
    renderFundDetail(viewKey, label, detail);
  });

  if (detailWrapper) {
    detailWrapper.addEventListener('click', (evt) => {
      const btn = evt.target.closest('.fund-stats-detail-close-btn');
      if (!btn) return;
      closeDetailPanel();
    });
  }
}

async function loadStats() {
  try {
    setStatus('正在加载统计数据...');
    setProgress(10);
    
    // 1. 加载统计聚合数据 (该文件由 build-fund-stats.js 生成，体积较小)
    const statsRes = await fetch('data/allfund/fund-stats.json');
    if (!statsRes.ok) {
      throw new Error('无法读取 fund-stats.json');
    }
    const statsData = await statsRes.json();

    // 2. 尝试加载预生成的统计详情数据（静态部署下用于直接展示基金名称等信息）
    try {
      const detailRes = await fetch('data/allfund/fund-stats-detail.json');
      if (detailRes.ok) {
        statsDetail = await detailRes.json();
      }
    } catch { /* ignore */ }

    setProgress(50);

    // 3. 加载首字母索引 (用于搜索)
    try {
      const idxRes = await fetch('data/allfund/search-index.json');
      if (idxRes.ok) {
        const idx = await idxRes.json();
        searchIndexInitialsMap = new Map();
        idx.forEach(item => {
          if (item.code) searchIndexInitialsMap.set(String(item.code), (item.initials || '').toLowerCase());
        });
      }
    } catch { /* ignore */ }
    
    const { total = 0, trackingFundCount = 0, tracking = [], manager = [], benchmark = [], fundType, fundtype, fundtpye } = statsData;
    renderSummary(total);
    const summaryExtraEl = document.getElementById('fund-stats-summary-extra');
    if (summaryExtraEl && trackingFundCount) {
      summaryExtraEl.textContent = `（其中 ${trackingFundCount} 个指数跟踪型基金）`;
    }

    // 预先构建各维度的数据视图
    statsViews = {
      tracking: {
        key: 'tracking',
        title: '按跟踪标的统计',
        subtitle: '跟踪指数的基金数量占比',
        items: tracking,
        total: trackingFundCount || total,
        suffix: '的指数基金',
      },
      manager: {
        key: 'manager',
        title: '按基金公司统计',
        subtitle: '基金公司旗下基金数量占比',
        items: manager,
        total,
        suffix: '的基金',
      },
      benchmark: {
        key: 'benchmark',
        title: '按业绩基准统计',
        subtitle: '业绩基准对应的基金数量占比',
        items: benchmark,
        total,
        suffix: '的基金',
      },
      fundType: {
        key: 'fundType',
        title: '按基金类型统计',
        subtitle: '不同基金类型对应的基金数量占比',
        items: fundType || fundtype || fundtpye || [],
        total,
        suffix: '的基金',
      },
    };

    const gridId = 'fund-stats-grid';
    const subtitleEl = document.getElementById('fund-stats-toggle-subtitle');

    function applyView(key, opts = {}) {
      currentStatsKey = key;
      const v = statsViews[key];
      if (!v) return;
      if (subtitleEl) subtitleEl.textContent = v.subtitle || '';
      const sourceItems = v.items || [];
      const totalItems = sourceItems.length;
      const loaded = statsLoadedCounts[key] ?? STATS_PAGE_SIZE;
      const sliceEnd = Math.min(loaded, totalItems);
      statsLoadedCounts[key] = sliceEnd;
      let itemsToShow = sourceItems.slice(0, sliceEnd);
      // 仅在 tracking 视图下，根据搜索关键字进行过滤
      if (key === 'tracking' && typeof opts.searchQuery === 'string') {
        // filterTrackingItems 是异步的，这里通过同步包装器延迟更新 DOM
        filterTrackingItems(opts.searchQuery).then(filtered => {
          const gridEl2 = document.getElementById(gridId);
          if (!gridEl2) return;
          renderSection(gridId, filtered, v.total, '暂无统计数据', v.suffix, key, 0);
        });
      }
      const gridEl = document.getElementById(gridId);
      if (!gridEl) return;
      renderSection(gridId, itemsToShow, v.total, '暂无统计数据', v.suffix, key, 0);
      // 追加哨兵并绑定观察者
      const sentinel = document.createElement('div');
      sentinel.className = 'fund-stats-grid-sentinel';
      sentinel.setAttribute('aria-hidden', 'true');
      gridEl.appendChild(sentinel);
      ensureObserver();
      if (statsObserver) {
        statsObserver.disconnect();
        statsObserver.observe(sentinel);
      }
    }

    // 默认显示按跟踪标的
    applyView('tracking');

    // 绑定滑块切换
    const buttons = document.querySelectorAll('.fund-stats-toggle-btn');
    const slider = document.querySelector('.fund-stats-toggle-slider');
    buttons.forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.getAttribute('data-key');
        const idx = parseInt(btn.getAttribute('data-index') || '0', 10);
        buttons.forEach(b => {
          b.classList.toggle('fund-stats-toggle-btn-active', b === btn);
          b.setAttribute('aria-selected', b === btn ? 'true' : 'false');
        });
        if (slider && !Number.isNaN(idx)) {
          slider.style.transform = `translateX(${idx * 100}%)`;
        }
        applyView(key);
      });
    });

    // 跟踪指数搜索：仅作用于 tracking 视图
    const searchInput = document.getElementById('fund-stats-search-input');
    if (searchInput) {
      let timer;
      const handleSearch = () => {
        const q = searchInput.value || '';
        // 只在 tracking 维度下应用搜索；如果当前不是 tracking，则切回 tracking
        if (currentStatsKey !== 'tracking') {
          const trackingBtn = document.querySelector('.fund-stats-toggle-btn[data-key="tracking"]');
          if (trackingBtn) {
            trackingBtn.click();
          } else {
            currentStatsKey = 'tracking';
          }
        }
        applyView('tracking', { searchQuery: q });
      };
      searchInput.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(handleSearch, 120);
      });
    }

    setStatus(`已加载统计信息：共 ${total} 只基金。`);
    setProgress(100);
  } catch (e) {
    setStatus('加载统计信息时发生错误，请检查网络或本地 API 服务。', true);
    setProgress(0);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  loadStats();
  renderFundDetailPlaceholder();
  bindCardInteractions();
});

