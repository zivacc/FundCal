/**
 * 基金费率爬虫：从天天基金/东方财富 fundf10 费率页抓取并写入本地
 * 数据存于 data/funds/[code].json，便于后续前端或接口调用
 * 使用：node scripts/crawl-fund-fee.js [基金代码1] [基金代码2] ...
 * 示例：node scripts/crawl-fund-fee.js 000001 110011
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data', 'funds');
const INDEX_PATH = path.join(DATA_DIR, 'index.json');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/**
 * 解析有上限区间的天数上限（该段适用区间的右端点）
 * "小于7天" -> 7；"大于等于7天，小于365天" -> 365；"大于等于365天，小于730天" -> 730；"大于等于1年，小于2年" -> 730
 */
function parseDaysUpperBound(text) {
  if (!text || typeof text !== 'string') return 730;
  const t = text.trim();
  const lessThanDay = t.match(/小于\s*(\d+)\s*天/);
  if (lessThanDay) return parseInt(lessThanDay[1], 10);
  const lessThanYear = t.match(/小于\s*(\d+)\s*年/);
  if (lessThanYear) return parseInt(lessThanYear[1], 10) * 365;
  const lessThanMonth = t.match(/小于\s*(\d+)\s*[个]?月/);
  if (lessThanMonth) return Math.round(parseInt(lessThanMonth[1], 10) * 30.44);
  const dayMatch = t.match(/(\d+)\s*天/);
  if (dayMatch) return parseInt(dayMatch[1], 10);
  const yearMatch = t.match(/(\d+)\s*年/);
  if (yearMatch) return parseInt(yearMatch[1], 10) * 365;
  return 730;
}

/**
 * 判断适用期限是否为「大于等于某期限」无上限（表格中通常为最后一行）
 * 如 "大于等于7天"、"大于等于8年" 为 true；"大于等于1年，小于2年" 为 false
 */
function isUnboundedPeriod(text) {
  if (!text || typeof text !== 'string') return false;
  const t = text.trim();
  return (/大于等于|不少于|不低于/.test(t) && !/小于/.test(t));
}

/**
 * (已弃用) 旧 schema 中无上限段需要起算天数；新 schema 用 to=null，无需此函数。
 * 暂保留实现以备旧调用回退。
 */
function _parseDaysStartUnbounded_legacy(text) {
  if (!text || typeof text !== 'string') return 0;
  const t = text.trim();
  const dayMatch = t.match(/(\d+)\s*天/);
  const yearMatch = t.match(/(\d+)\s*年/);
  if (dayMatch) return parseInt(dayMatch[1], 10);
  if (yearMatch) return parseInt(yearMatch[1], 10) * 365;
  const monthMatch = t.match(/(\d+)\s*[个]?月/);
  if (monthMatch) return Math.round(parseInt(monthMatch[1], 10) * 30.44);
  return 0;
}

/** 解析费率百分比字符串为小数 */
function parseRatePercent(str) {
  if (str === undefined || str === null || str === '' || str === '---') return 0;
  const m = String(str).match(/([\d.]+)/);
  return m ? parseFloat(m[1]) / 100 : 0;
}

/** 从表格 HTML 中提取行，每行为单元格文本数组 */
function parseTableRows(tableHtml) {
  const rows = (tableHtml || '').match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];
  const result = [];
  for (const row of rows) {
    const cells = row.match(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi);
    if (!cells || cells.length === 0) continue;
    const getText = (cell) => cell.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
    result.push(cells.map(getText));
  }
  return result;
}

/**
 * 从 jbgk 表格「净资产规模」单元格解析结构化数据
 * 例：29.37亿元（截止至：2025年12月31日）
 */
function parseNetAssetScale(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const text = raw.replace(/\s+/g, ' ').trim();
  if (!text) return null;
  let amountText;
  const amt = text.match(/([\d.]+)\s*亿\s*元/);
  if (amt) amountText = `${amt[1]}亿元`;
  let asOfDate;
  const d = text.match(/截止至[：:]\s*(\d{4})[年/.-](\d{1,2})[月/.-](\d{1,2})\s*日?/);
  if (d) {
    asOfDate = `${d[1]}-${String(d[2]).padStart(2, '0')}-${String(d[3]).padStart(2, '0')}`;
  }
  return {
    text,
    ...(amountText ? { amountText } : {}),
    ...(asOfDate ? { asOfDate } : {}),
  };
}

/** 从 FundArchivesDatas.aspx 返回的脚本中提取 content HTML 字符串 */
function extractApidataContent(jsText) {
  const key = 'content:"';
  const i = (jsText || '').indexOf(key);
  if (i === -1) return null;
  const start = i + key.length;
  let end = start;
  while (end < jsText.length) {
    if (jsText[end] === '"' && jsText[end - 1] !== '\\') break;
    end++;
  }
  return jsText.slice(start, end);
}

/**
 * 解析阶段涨幅明细 HTML（与页面 Ajax 返回的 apidata.content 一致）
 * 取「涨幅」列（本基金），即每个 <ul> 中第二个 <li>。
 */
function normalizeStageReturnPeriod(rawPeriod) {
  const text = String(rawPeriod || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  const known = text.match(/(今年来|近1周|近1月|近3月|近6月|近1年|近2年|近3年|近5年|成立来)/);
  if (known) return known[1];
  return text;
}

function parseJdzfStageReturnsHtml(fragment) {
  if (!fragment || typeof fragment !== 'string') return [];
  const rows = [];
  const uls = fragment.match(/<ul[^>]*>[\s\S]*?<\/ul>/gi) || [];
  for (const ul of uls) {
    if (/class=['"]fcol['"]/.test(ul)) continue;
    const titleMatch = ul.match(/<li[^>]*class=['"]title['"][^>]*>([\s\S]*?)<\/li>/i);
    if (!titleMatch) continue;
    const periodRaw = titleMatch[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
    const period = normalizeStageReturnPeriod(periodRaw);
    if (!period) continue;
    const lis = ul.match(/<li[^>]*>[\s\S]*?<\/li>/gi) || [];
    if (lis.length < 2) continue;
    const returnText = lis[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
    let returnPct = null;
    if (returnText && returnText !== '---') {
      const m = returnText.match(/(-?[\d.]+)\s*%/);
      returnPct = m ? parseFloat(m[1]) : null;
    }
    rows.push({ period, returnPct, returnText });
  }
  return rows;
}

/**
 * 从搜狐基金费率页抓取运作费用（基金管理费 / 托管费）
 * 示例页面：
 *   https://q.fund.sohu.com/c/gt.php?code=180401
 */
async function fetchSohuOperationFees(code) {
  const url = `https://q.fund.sohu.com/c/gt.php?code=${code}`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, 'Referer': 'https://q.fund.sohu.com/' } });
    if (!res.ok) return null;
    const html = await res.text();

    const rows = parseTableRows(html);
    if (!rows.length) return null;

    const extractSectionRate = (sectionKeyword) => {
      let inSection = false;
      for (const row of rows) {
        const joined = row.join('');
        if (!inSection) {
          if (joined.includes(sectionKeyword)) {
            inSection = true;
          }
          continue;
        }
        const cellWithPercent = row.find(c => /([\d.]+)\s*%/.test(c));
        if (cellWithPercent) {
          const m = cellWithPercent.match(/([\d.]+)\s*%/);
          return m ? parseFloat(m[1]) / 100 : 0;
        }
        if (/基金.+费/.test(joined)) break;
      }
      return 0;
    };

    const managementFee = extractSectionRate('基金管理费');
    const custodyFee = extractSectionRate('基金托管费');
    const salesServiceFee = 0;
    if (!managementFee && !custodyFee && !salesServiceFee) return null;
    const total = managementFee + custodyFee + salesServiceFee;
    return { managementFee, custodyFee, salesServiceFee, total };
  } catch (e) {
    console.error(`[${code}] 搜狐费率页请求失败:`, e.message);
    return null;
  }
}

/**
 * 从「基本概况」页面抓取基础信息：
 * - 跟踪标的
 * - 基金管理人
 * - 业绩比较基准
 * - 基金类型（例如：货币型-普通货币、混合型-偏股 等）
 * - 成立日期（格式统一为 YYYY-MM-DD）
 * URL 形如：https://fundf10.eastmoney.com/jbgk_<code>.html
 */
async function fetchFundBasicInfo(code) {
  const url = `https://fundf10.eastmoney.com/jbgk_${code}.html`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) {
      return {
        trackingTarget: '',
        fundManager: '',
        performanceBenchmark: '',
        fundType: '',
        netAssetScale: null,
        establishmentDate: ''
      };
    }
    const html = await res.text();
    // 直接解析页面中的所有表格行，查找目标字段所在的单元格
    const rows = parseTableRows(html);
    let trackingTarget = '';
    let fundManager = '';
    let performanceBenchmark = '';
    let fundType = '';
    let netAssetScale = null;
    let establishmentDate = '';
    for (const row of rows) {
      for (let i = 0; i < row.length; i++) {
        const label = row[i];
        if (!label) continue;
        if (!fundManager && /基金管理人/.test(label) && i + 1 < row.length) {
          fundManager = row[i + 1].trim();
        }
        if (!performanceBenchmark && /业绩比较基准/.test(label) && i + 1 < row.length) {
          performanceBenchmark = row[i + 1].trim();
        }
        if (!trackingTarget && /跟踪标的/.test(label) && i + 1 < row.length) {
          trackingTarget = row[i + 1].trim();
        }
        // 基金类型：通常在「基金类型」字段对应的下一格，比如 “货币型-普通货币”
        if (!fundType && /基金类型/.test(label) && i + 1 < row.length) {
          fundType = row[i + 1].trim();
        }
        // 净资产规模：含规模与截止日期，如「21.22亿元（截止至：2025年12月31日）」
        // 部分页面同一单元格后紧跟「份额规模」文案，需截断
        if (!netAssetScale && /净资产规模/.test(label) && i + 1 < row.length) {
          let raw = row[i + 1].replace(/<[^>]+>/g, '').trim();
          const idxShare = raw.indexOf('份额规模');
          if (idxShare !== -1) raw = raw.slice(0, idxShare).trim();
          netAssetScale = parseNetAssetScale(raw);
        }
        // 成立日期：天天基金「基本概况」通常是「成立日期/规模」标签，值形如
        // "2012-04-26 / 15.84亿份" 或 "2012年04月26日 / ..."；只取日期部分并标准化为 YYYY-MM-DD
        if (!establishmentDate && /成立日期/.test(label) && i + 1 < row.length) {
          const raw = row[i + 1].replace(/<[^>]+>/g, '').trim();
          const m1 = raw.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
          const m2 = raw.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
          const m = m1 || m2;
          if (m) {
            const mm = String(m[2]).padStart(2, '0');
            const dd = String(m[3]).padStart(2, '0');
            establishmentDate = `${m[1]}-${mm}-${dd}`;
          }
        }
      }
    }
    return { trackingTarget, fundManager, performanceBenchmark, fundType, netAssetScale, establishmentDate };
  } catch {
    return {
      trackingTarget: '',
      fundManager: '',
      performanceBenchmark: '',
      fundType: '',
      netAssetScale: null,
      establishmentDate: ''
    };
  }
}

/**
 * 阶段涨幅明细（本基金「涨幅」列）+ jdzf 页脚「数据截止至」日期。
 * 与页面内 LoadJdzf 同源：GET FundArchivesDatas.aspx?type=jdzf（返回 var apidata={ content:"..." };）
 */
async function fetchFundStageReturnsInfo(code) {
  const empty = { stageReturns: null, stageReturnsAsOf: '' };
  if (/^968\d{3}$/.test(code)) return empty;
  const apiUrl = `https://fundf10.eastmoney.com/FundArchivesDatas.aspx?type=jdzf&code=${encodeURIComponent(code)}&rt=${Math.random()}`;
  const pageUrl = `https://fundf10.eastmoney.com/jdzf_${encodeURIComponent(code)}.html`;
  try {
    const [apiRes, pageRes] = await Promise.all([
      fetch(apiUrl, { headers: { 'User-Agent': UA, Referer: pageUrl } }),
      fetch(pageUrl, { headers: { 'User-Agent': UA } })
    ]);
    let stageReturnsAsOf = '';
    if (pageRes.ok) {
      const pageHtml = await pageRes.text();
      const dateM = pageHtml.match(/数据截止至[：:]\s*(\d{4}-\d{2}-\d{2})/);
      if (dateM) stageReturnsAsOf = dateM[1];
    }
    if (!apiRes.ok) return { ...empty, stageReturnsAsOf };
    const jsText = await apiRes.text();
    const content = extractApidataContent(jsText);
    if (!content) return { ...empty, stageReturnsAsOf };
    const list = parseJdzfStageReturnsHtml(content);
    const stageReturns = list.length ? list : null;
    return { stageReturns, stageReturnsAsOf };
  } catch {
    return empty;
  }
}

/**
 * 从海外基金基本资料页抓取基金名称等基础信息
 * URL 形如：https://overseas.1234567.com.cn/f10/FundBaseInfo/<code>
 */
async function fetchOverseasFundBaseInfo(code) {
  const url = `https://overseas.1234567.com.cn/f10/FundBaseInfo/${code}`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) return { name: '' };
    const html = await res.text();
    const rows = parseTableRows(html);
    let name = '';
    for (const row of rows) {
      for (let i = 0; i < row.length; i++) {
        const label = row[i];
        if (!label) continue;
        if (!name && /基金名称/.test(label) && i + 1 < row.length) {
          name = row[i + 1].trim();
        }
      }
    }
    return { name };
  } catch {
    return { name: '' };
  }
}

/**
 * 抓取海外/中港互认基金费率页（overseas.1234567.com.cn/f10/FundSaleInfo/<code>）
 * 返回与境内基金相同结构的对象，便于前端统一处理。
 */
async function fetchOverseasFundFee(code) {
  const url = `https://overseas.1234567.com.cn/f10/FundSaleInfo/${code}`;
  let html;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) return null;
    html = await res.text();
  } catch (e) {
    console.error(`[${code}] 海外费率页请求失败:`, e.message);
    return null;
  }

  // 基金名称：优先从海外基金基本资料页获取，其次从费率页标题中提取
  let name = `基金${code}`;
  try {
    const baseInfo = await fetchOverseasFundBaseInfo(code);
    if (baseInfo?.name && baseInfo.name.trim().length >= 2) {
      name = baseInfo.name.trim();
    }
  } catch {
    // 忽略基础信息抓取错误，退回到费率页解析
  }
  if (!name || name === `基金${code}`) {
    const nameMatch = html.match(/>\s*([^<（(]{2,})[（(]\s*${code}\s*[）)]/);
    if (nameMatch) {
      name = nameMatch[1].trim();
    }
  }

  // 运作费用：管理费 / 托管费
  let managementFee = 0;
  let custodyFee = 0;
  const opsBlock = html.match(/运作费用[\s\S]*?<table[^>]*>([\s\S]*?)<\/table>/);
  if (opsBlock) {
    const block = opsBlock[1];
    const mgmtMatch = block.match(/管理费[^%]*?([\d.]+)%/);
    if (mgmtMatch) managementFee = parseFloat(mgmtMatch[1]) / 100;
    const custMatch = block.match(/托管费[^%]*?([\d.]+)%/);
    if (custMatch) custodyFee = parseFloat(custMatch[1]) / 100;
  }
  const salesServiceFee = 0;
  const totalOperationFee = managementFee + custodyFee + salesServiceFee;
  let operationFees = {
    managementFee,
    custodyFee,
    salesServiceFee,
    total: totalOperationFee
  };

  // 申购费用：直接取金额最小区间（首条）的费率作为 buyFee
  const subscribeFrontSegments = [];
  const purchaseFrontSegments = [];
  const purchaseBackSegments = [];
  let buyFee = 0;
  const buyBlock = html.match(/申购费用[\s\S]*?<table[^>]*>([\s\S]*?)<\/table>/);
  if (buyBlock) {
    const rows = parseTableRows(buyBlock[1]);
    for (const row of rows) {
      const rowText = row.join(' ');
      if (!/[\d.]+%/.test(rowText)) continue;
      const rateMatch = rowText.match(/([\d.]+)%/);
      if (!rateMatch) continue;
      const rate = parseFloat(rateMatch[1]) / 100;
      const amountCondition = row[0] || '---';
      const periodCondition = row[1] || '---';
      purchaseFrontSegments.push({
        amountCondition,
        periodCondition,
        rate
      });
      if (buyFee === 0) {
        buyFee = rate;
      }
    }
  }

  // 赎回费用：转换为 sellFeeSegments
  const redeemSegments = [];
  const redeemBlock = html.match(/赎回费用[\s\S]*?<table[^>]*>([\s\S]*?)<\/table>/);
  if (redeemBlock) {
    const rows = parseTableRows(redeemBlock[1]);
    for (const row of rows) {
      const rowText = row.join(' ');
      if (!/[\d.]+%/.test(rowText)) continue;
      const rateMatch = rowText.match(/([\d.]+)%/);
      if (!rateMatch) continue;
      const rate = parseFloat(rateMatch[1]) / 100;
      const periodRaw = row[1] || row[0] || '---';
      const periodText = periodRaw.trim();
      const unbounded = isUnboundedPeriod(periodText);
      const to = unbounded ? null : parseDaysUpperBound(periodText);
      redeemSegments.push({
        periodCondition: periodText,
        to,
        rate,
      });
    }
    redeemSegments.sort((a, b) => (a.to ?? Infinity) - (b.to ?? Infinity));
  }

  const sellFeeSegments = redeemSegments.length > 0
    ? redeemSegments.map(s => ({ to: s.to, rate: s.rate }))
    : [{ to: null, rate: 0 }];

  return {
    code,
    name,
    source: 'eastmoney-overseas',
    updatedAt: new Date().toISOString(),
    tradingStatus: null,
    operationFees,
    subscribeFrontSegments,
    purchaseFrontSegments,
    purchaseBackSegments,
    redeemSegments,
    buyFee,
    sellFeeSegments,
    annualFee: totalOperationFee,
    isFloatingAnnualFee: false
  };
}

/**
 * 抓取单只基金费率页 HTML，解析为计算器所需结构
 * @param {string} code - 6位基金代码
 * @returns {Promise<Object|null>} { name, buyFee, sellFeeSegments, annualFee, code, updatedAt } 或 null
 */
async function fetchFundFee(code) {
  // 968 开头为中港互认/海外基金，使用海外费率页解析逻辑
  if (/^968\d{3}$/.test(code)) {
    return fetchOverseasFundFee(code);
  }
  const url = `https://fundf10.eastmoney.com/jjfl_${code}.html`;
  let html;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) return null;
    html = await res.text();
  } catch (e) {
    console.error(`[${code}] 请求失败:`, e.message);
    return null;
  }

  const nameMatch = html.match(/<title>([^<(]+)(?:\([\d]+\))?[^<]*<\/title>/);
  const name = nameMatch ? nameMatch[1].trim() : `基金${code}`;

  // ---------- 0. 基本信息（jbgk）+ 阶段涨幅明细（FundArchivesDatas type=jdzf + jdzf 页截止日期） ----------
  const [basicInfo, stageInfo] = await Promise.all([
    fetchFundBasicInfo(code),
    fetchFundStageReturnsInfo(code)
  ]);
  const { trackingTarget, fundManager, performanceBenchmark, fundType, netAssetScale, establishmentDate } = basicInfo;
  const { stageReturns, stageReturnsAsOf } = stageInfo;

  // ---------- 1. 交易状态：申购状态、赎回状态 ----------
  let subscribeStatus = '';
  let redeemStatus = '';
  const tradingBlock = html.match(/交易状态[\s\S]*?<table[^>]*>([\s\S]*?)<\/table>/);
  if (tradingBlock) {
    const rows = parseTableRows(tradingBlock[1]);
    for (const row of rows) {
      const full = row.join(' ');
      const subIdx = row.findIndex(c => /申购状态/.test(c));
      const redIdx = row.findIndex(c => /赎回状态/.test(c));
      if (subIdx >= 0 && subIdx + 1 < row.length) subscribeStatus = row[subIdx + 1] || subscribeStatus;
      if (redIdx >= 0 && redIdx + 1 < row.length) redeemStatus = row[redIdx + 1] || redeemStatus;
    }
  }
  const tradingStatus = { subscribe: subscribeStatus, redeem: redeemStatus };

  // ---------- 2. 运作费用：管理、托管、销售服务、总运作费率 ----------
  let managementFee = 0;
  let custodyFee = 0;
  let salesServiceFee = 0;
  let hasTextualOperationRate = false; // 标记“费率数值一栏包含文字说明”的情形

  const opsBlock = html.match(/运作费用[\s\S]*?<table[^>]*>([\s\S]*?)<\/table>/);
  if (opsBlock) {
    const block = opsBlock[1];

    // 先按原有方式用正则提取，保证普通基金行为不变
    const mgmtMatch = block.match(/管理费率[\s\S]*?([\d.]+)%/);
    if (mgmtMatch) managementFee = parseFloat(mgmtMatch[1]) / 100;
    const custMatch = block.match(/托管费率[\s\S]*?([\d.]+)%/);
    if (custMatch) custodyFee = parseFloat(custMatch[1]) / 100;
    const salesMatch = block.match(/销售服务费率[\s\S]*?([\d.]+)%/);
    if (salesMatch && !/---|\-\-\-/.test(salesMatch[0])) salesServiceFee = parseFloat(salesMatch[1]) / 100;

    // 再基于表格逐行检查“费率数值一栏是否含有文字”（例如附加管理费说明等）
    const opRows = parseTableRows(block);
    let mgmtHasText = false;
    let custHasText = false;
    let salesHasText = false;
    for (const row of opRows) {
      const rowText = row.join('');
      const hasMgmtLabel = /基金管理费率|管理费率/.test(rowText);
      const hasCustLabel = /基金托管费率|托管费率/.test(rowText);
      const hasSalesLabel = /销售服务费率|销售服务费/.test(rowText);
      if (!hasMgmtLabel && !hasCustLabel && !hasSalesLabel) continue;

      // 认为“数值一栏”是行中第一个包含 % 的单元格；若不存在 %，则整行视为文字说明
      const rateCell = row.find(c => /%/.test(c)) || '';
      const stripped = rateCell.replace(/[\d.\s%（）()，,\-\u2014—]/g, '');
      const cjkCount = (stripped.match(/[\u4e00-\u9fa5]/g) || []).length;
      const isTextual = !rateCell || cjkCount > 5;
      if (isTextual) {
        if (hasMgmtLabel) mgmtHasText = true;
        if (hasCustLabel) custHasText = true;
        if (hasSalesLabel) salesHasText = true;
      }
    }

    if (mgmtHasText) {
      managementFee = 0;
      hasTextualOperationRate = true;
    }
    if (custHasText) {
      custodyFee = 0;
      hasTextualOperationRate = true;
    }
    if (salesHasText) {
      salesServiceFee = 0;
      hasTextualOperationRate = true;
    }
  }
  const totalOperationFee = managementFee + custodyFee + salesServiceFee;
  let operationFees = {
    managementFee,
    custodyFee,
    salesServiceFee,
    total: totalOperationFee
  };

  // ---------- 3. 申赎费率：认购（前端）、申购（前端）、申购（后端）、赎回 ----------
  const subscribeFrontSegments = [];
  const subFrontSection = html.match(/认购费率（前端）[\s\S]*?<table[^>]*>([\s\S]*?)<\/table>/);
  if (subFrontSection) {
    const rows = parseTableRows(subFrontSection[1]);
    for (const row of rows) {
      if (/适用金额|适用期限/.test(row.join(' ')) && !/[\d.]+%/.test(row.join(' '))) continue;
      const rateStr = row.find(c => /[\d.]+%/.test(c));
      if (!rateStr) continue;
      const amountCondition = row[0] || '---';
      const periodCondition = row[1] || '---';
      subscribeFrontSegments.push({
        amountCondition,
        periodCondition,
        rate: parseRatePercent(rateStr)
      });
    }
  }

  const purchaseFrontSegments = [];
  const buySection = html.match(/申购费率（前端）[\s\S]*?<table[^>]*>([\s\S]*?)<\/table>/);
  let buyFeeFront = null;
  if (buySection) {
    const rows = parseTableRows(buySection[1]);
    for (const row of rows) {
      const rowText = row.join(' ');
      if (/适用金额|适用期限/.test(row[0] + (row[1] || '')) && !/[\d.]+%/.test(rowText)) continue;
      const rateStrs = [...rowText.matchAll(/([\d.]+)%/g)].map(m => m[1] + '%');
      if (rateStrs.length === 0) continue;
      const amountCondition = row[0] || '---';
      const periodCondition = row[1] || '---';
      const rates = rateStrs.map(s => parseRatePercent(s));
      const rate = rates[0];
      const discountCandidates = rates.filter(r => r > 0.0001 && r < 0.005);
      const rateDiscount = discountCandidates.length ? Math.min(...discountCandidates) : (rate < 0.005 ? rate : 0);
      // buyFeeFront：使用金额最小区间（通常为首行）的「优惠前」费率
      if (buyFeeFront === null) {
        buyFeeFront = rate;
      }
      purchaseFrontSegments.push({
        amountCondition,
        periodCondition,
        rate,
        rateDiscount: rateDiscount !== rate && rateDiscount > 0 ? rateDiscount : undefined
      });
    }
  }

  const purchaseBackSegments = [];
  const buyBackSection = html.match(/申购费率（后端）[\s\S]*?<table[^>]*>([\s\S]*?)<\/table>/);
  if (buyBackSection) {
    const rows = parseTableRows(buyBackSection[1]);
    for (const row of rows) {
      if (/适用期限|申购费率/.test(row.join(' ')) && !/[\d.]+%/.test(row.join(' '))) continue;
      const rateStr = row.find(c => /[\d.]+%/.test(c));
      if (!rateStr) continue;
      const periodCondition = row.find(c => /[天年月]|小于|大于/.test(c)) || row[0] || '---';
      const periodText = /\d+\s*[天年月]/.test(periodCondition) ? periodCondition : (row[0] || row[1] || '---');
      const unbounded = isUnboundedPeriod(periodText);
      const to = unbounded ? null : parseDaysUpperBound(periodText);
      purchaseBackSegments.push({
        periodCondition: periodText,
        to,
        rate: parseRatePercent(rateStr),
      });
    }
    purchaseBackSegments.sort((a, b) => (a.to ?? Infinity) - (b.to ?? Infinity));
  }

  const redeemSegments = [];
  const redeemSection = html.match(/赎回费率[\s\S]*?<table[^>]*>([\s\S]*?)<\/table>/);
  if (redeemSection) {
    const rows = parseTableRows(redeemSection[1]);
    for (const row of rows) {
      if (/适用期限|赎回费率|适用金额/.test(row.join(' ')) && !/[\d.]+%/.test(row.join(' '))) continue;
      const rateStr = row.find(c => /[\d.]+%/.test(c));
      if (!rateStr) continue;
      const periodText = /\d+\s*[天年月]/.test(row[1]) ? row[1] : (/\d+\s*[天年月]/.test(row[0]) ? row[0] : row[0] || row[1]);
      const unbounded = isUnboundedPeriod(periodText);
      const to = unbounded ? null : parseDaysUpperBound(periodText);
      redeemSegments.push({
        periodCondition: periodText,
        to,
        rate: parseRatePercent(rateStr),
      });
    }
    redeemSegments.sort((a, b) => (a.to ?? Infinity) - (b.to ?? Infinity));
  }
  const sellFeeSegments = redeemSegments.length > 0
    ? redeemSegments.map(s => ({ to: s.to, rate: s.rate }))
    : [{ to: null, rate: 0 }];

  // 买入费率：优先使用前端申购费率表中金额最小区间（首条记录）的原始费率；
  // 如无前端申购费率，则退回到后端申购费率表的首条记录。
  let buyFee = 0;
  if (buyFeeFront != null) {
    buyFee = buyFeeFront;
  } else if (purchaseBackSegments.length > 0) {
    buyFee = purchaseBackSegments[0].rate ?? 0;
  }

  // ---------- 4. 对 REITs / 绝对收益等浮动管理费基金做标记 ----------
  // 规则：
  // - 若“运作费用”表中费率数值一栏包含文字（hasTextualOperationRate），视为浮动费率基金
  // - 或 基金类型中含 REIT / 不动产 / 绝对收益 关键字
  // - 或 费率页正文中出现“附加管理费 / 激励管理费 / 超额收益 / 运营服务费”等描述
  let isFloatingAnnualFee = hasTextualOperationRate;
  let floatingFeeNote = '';

  const fundTypeStr = (fundType || '').trim();
  if (/REIT/i.test(fundTypeStr) || /不动产/.test(fundTypeStr) || /绝对收益/.test(fundTypeStr)) {
    isFloatingAnnualFee = true;
  }

  // 在原始 HTML 文本中查找典型关键字，以捕捉“附加管理费 / 激励管理费 / 超额收益提成 / 运营服务费”等描述
  const floatingKeywords = ['附加管理费', '激励管理费', '超额收益', '运营服务费'];
  const plainText = html.replace(/<[^>]+>/g, ''); // 粗略去掉标签，便于截取中文段落
  for (const kw of floatingKeywords) {
    const idx = plainText.indexOf(kw);
    if (idx !== -1) {
      isFloatingAnnualFee = true;
      const start = Math.max(0, idx - 80);
      const end = Math.min(plainText.length, idx + 260);
      floatingFeeNote = plainText.slice(start, end).replace(/\s+/g, ' ').trim();
      break;
    }
  }

  // ---------- 5. 如为浮动管理费基金，尝试用搜狐费率源覆盖运作费用 ----------
  if (isFloatingAnnualFee) {
    try {
      const override = await fetchSohuOperationFees(code);
      if (override && (override.managementFee || override.custodyFee || override.salesServiceFee)) {
        operationFees = {
          managementFee: override.managementFee ?? operationFees.managementFee,
          custodyFee: override.custodyFee ?? operationFees.custodyFee,
          salesServiceFee: override.salesServiceFee ?? operationFees.salesServiceFee,
          total: override.total ?? ((override.managementFee || 0) + (override.custodyFee || 0) + (override.salesServiceFee || 0))
        };
      }
    } catch (e) {
      console.error(`[${code}] 覆盖浮动管理费时调用第三方费率源失败:`, e.message);
    }
  }

  return {
    code,
    name,
    source: 'eastmoney',
    updatedAt: new Date().toISOString(),
    trackingTarget,
    fundManager,
    performanceBenchmark,
    fundType,
    ...(establishmentDate ? { establishmentDate } : {}),
    ...(netAssetScale ? { netAssetScale } : {}),
    ...(stageReturns?.length ? { stageReturns } : {}),
    ...(stageReturnsAsOf ? { stageReturnsAsOf } : {}),
    tradingStatus,
    operationFees,
    subscribeFrontSegments,
    purchaseFrontSegments,
    purchaseBackSegments,
    redeemSegments,
    buyFee,
    sellFeeSegments,
    annualFee: operationFees.total ?? totalOperationFee,
    // 必须每次写入布尔值，否则 saveFund 合并旧 JSON 时会一直保留曾经的 true
    isFloatingAnnualFee: !!isFloatingAnnualFee,
    ...(floatingFeeNote ? { floatingFeeNote } : {})
  };
}

/** 写入单只基金 JSON 并更新索引 */
function saveFund(data) {
  if (!data || !data.code) return;
  const filePath = path.join(DATA_DIR, `${data.code}.json`);
  fs.mkdirSync(DATA_DIR, { recursive: true });

  // 如果已有历史数据，优先保留那些这次爬虫缺失的关键信息，避免“越爬越少”
  let merged = data;
  if (fs.existsSync(filePath)) {
    try {
      const old = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      merged = { ...old, ...data };

      // 浮动费率：新结果已带 isFloatingAnnualFee 时，同步清理过期的 floatingFeeNote
      if (Object.prototype.hasOwnProperty.call(data, 'isFloatingAnnualFee')) {
        if (!data.isFloatingAnnualFee) {
          delete merged.floatingFeeNote;
        } else if (!data.floatingFeeNote) {
          delete merged.floatingFeeNote;
        }
      }

      // 1) 基金名称：新抓到的不是“基金xxxx”这种默认占位时，才覆盖旧值
      const oldName = (old.name || '').trim();
      const newName = (data.name || '').trim();
      const isDefaultNewName = /^基金\d{6}$/.test(newName);
      if (newName && !isDefaultNewName) {
        merged.name = newName;
      } else if (oldName) {
        merged.name = oldName;
      }

      // 2) 关键信息字段：本次为空/缺失时，保留旧值，防止被覆盖成空
      const keyFields = ['trackingTarget', 'fundManager', 'performanceBenchmark', 'fundType', 'establishmentDate'];
      for (const key of keyFields) {
        const oldVal = (old[key] || '').trim?.() ?? old[key];
        const newVal = (data[key] || '').trim?.() ?? data[key];
        if (!newVal && oldVal) {
          merged[key] = oldVal;
        }
      }
      const hasNetAsset = (v) => {
        if (v == null) return false;
        if (typeof v === 'string') return v.trim().length > 0;
        if (typeof v === 'object' && v.text != null) return String(v.text).trim().length > 0;
        return false;
      };
      if (!hasNetAsset(data.netAssetScale) && hasNetAsset(old.netAssetScale)) {
        merged.netAssetScale = old.netAssetScale;
      }
      // 阶段涨幅：本次无数据时保留旧数据；截止日期同理
      const newSr = data.stageReturns;
      const oldSr = old.stageReturns;
      if ((!newSr || !newSr.length) && Array.isArray(oldSr) && oldSr.length > 0) {
        merged.stageReturns = oldSr;
      }
      const newAsOf = (data.stageReturnsAsOf || '').trim();
      const oldAsOf = (old.stageReturnsAsOf || '').trim();
      if (!newAsOf && oldAsOf) {
        merged.stageReturnsAsOf = oldAsOf;
      }

      // 3) 交易状态：按字段粒度合并
      if (old.tradingStatus || data.tradingStatus) {
        merged.tradingStatus = {
          subscribe: data.tradingStatus?.subscribe || old.tradingStatus?.subscribe || '',
          redeem: data.tradingStatus?.redeem || old.tradingStatus?.redeem || '',
        };
      }

      // 4) 运作费用：如果新抓到的 total 为 0，但旧值非 0，则保留旧 total
      if (old.operationFees || data.operationFees) {
        const oldOps = old.operationFees || {};
        const newOps = data.operationFees || {};
        const mergedOps = {
          ...oldOps,
          ...newOps,
        };
        const oldTotal = typeof oldOps.total === 'number' ? oldOps.total : 0;
        const newTotal = typeof newOps.total === 'number' ? newOps.total : 0;
        if (!newTotal && oldTotal) {
          mergedOps.total = oldTotal;
        }
        merged.operationFees = mergedOps;
        // annualFee 与运作费用总费率保持同步；如新 annualFee 为 0，则保留旧值
        const oldAnnual = typeof old.annualFee === 'number' ? old.annualFee : oldTotal;
        const newAnnual = typeof data.annualFee === 'number' ? data.annualFee : newTotal;
        merged.annualFee = newAnnual || oldAnnual || mergedOps.total || 0;
      }
    } catch {
      // 如果旧文件解析失败，则退回直接覆盖写入
      merged = data;
    }
  }

  fs.writeFileSync(filePath, JSON.stringify(merged, null, 2), 'utf8');
  const indexPath = path.join(DATA_DIR, 'index.json');
  let index = { description: '本地基金费率缓存索引，由 scripts/crawl-fund-fee.js 更新', codes: [], lastUpdated: {} };
  if (fs.existsSync(indexPath)) {
    try {
      index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    } catch (_) {}
  }
  if (!index.codes.includes(data.code)) index.codes.push(data.code);
  index.codes.sort();
  index.lastUpdated[data.code] = data.updatedAt;
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2), 'utf8');
}

/** 主流程：按参数基金代码依次抓取并落盘 */
async function main() {
  const codes = process.argv.slice(2).filter(c => /^\d{6}$/.test(c));
  if (codes.length === 0) {
    console.log('用法: node scripts/crawl-fund-fee.js <基金代码1> [代码2] ...');
    console.log('示例: node scripts/crawl-fund-fee.js 000001 110011');
    process.exit(1);
  }
  const total = codes.length;
  let okCount = 0;
  let failCount = 0;
  /** @type {{code:string,name:string}[]} */
  const missingFundType = [];
  /** @type {string[]} */
  const failedCodes = [];
  /** @type {{code:string,name:string}[]} */
  const floatingList = [];
  const startTime = Date.now();

  console.log(`\n共 ${total} 只基金待抓取\n${'─'.repeat(60)}`);

  for (let i = 0; i < codes.length; i++) {
    const code = codes[i];
    const prefix = `[${i + 1}/${total}] ${code}`;
    process.stdout.write(`${prefix}  `);
    const data = await fetchFundFee(code);
    if (data) {
      okCount++;
      saveFund(data);

      const op = data.operationFees || {};
      const buyPct = (data.buyFee * 100).toFixed(2);
      const annualPct = ((op.total ?? data.annualFee) * 100).toFixed(2);
      const floatTag = data.isFloatingAnnualFee ? ' [浮动]' : '';
      const sub = data.tradingStatus?.subscribe || '-';
      const red = data.tradingStatus?.redeem || '-';
      const ft = (data.fundType || '').trim();
      const typeTag = ft ? ` (${ft})` : '';

      console.log(`✓ ${data.name}${typeTag}  买${buyPct}%  运作${annualPct}%${floatTag}  申购:${sub}  赎回:${red}`);

      const isOverseas = /^968\d{3}$/.test(code);
      if (!isOverseas && !ft) {
        missingFundType.push({ code, name: data.name || `基金${code}` });
      }
      if (data.isFloatingAnnualFee) {
        floatingList.push({ code, name: data.name || `基金${code}` });
      }
    } else {
      failCount++;
      failedCodes.push(code);
      console.log('✗ 抓取失败');
    }
    await new Promise(r => setTimeout(r, 800));
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`${'─'.repeat(60)}`);
  console.log(`完成：成功 ${okCount}，失败 ${failCount}，耗时 ${elapsed}s\n`);

  if (failedCodes.length) {
    console.log(`⚠ 失败代码（${failedCodes.length} 只）：${failedCodes.join('  ')}\n`);
  }
  if (floatingList.length) {
    console.log(`ℹ 浮动费率基金（${floatingList.length} 只）：`);
    for (const item of floatingList) console.log(`  ${item.code} ${item.name}`);
    console.log('');
  }
  if (missingFundType.length) {
    console.log(`⚠ 缺失基金类型（${missingFundType.length} 只，中港互认已排除）：`);
    for (const item of missingFundType) console.log(`  ${item.code} ${item.name}`);
    console.log('');
  }
}

export { fetchFundFee, saveFund, DATA_DIR, fetchFundBasicInfo, fetchFundStageReturnsInfo };

// 仅在被直接运行（带基金代码参数）时执行，被 import 时不执行
if (process.argv[2] && /^\d{6}$/.test(String(process.argv[2]))) {
  main().catch(e => { console.error(e); process.exit(1); });
}
