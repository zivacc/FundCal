/**
 * 批量拉取全部基金费率与基础信息：
 * 先从天天基金 fundcode_search.js 获取基金代码列表，再并发抓取并写入 data/funds/
 * 单只数据结构与 crawl-fund-fee.js 保持一致（含跟踪标的 / 基金管理人 / 业绩比较基准等扩展字段）。
 * 使用：node scripts/crawl-all-fund-fee.js [--force] [--concurrency=N] [--delay=N] [--retry=N] [--limit=N]
 *   --force         不跳过已缓存的基金，全部重新抓取
 *   --concurrency=N 并发数，默认 10（建议 5–20，过大可能被限流）
 *   --delay=N       同一批内每启动一个请求的间隔毫秒，默认 0；并发时可用 50–100 略微限速
 *   --retry=N       失败后重试次数，默认 2（即最多共尝试 3 次）
 *   --limit=N       仅抓取前 N 只（用于测试）
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { fetchFundFee, saveFund, DATA_DIR } from './crawl-fund-fee.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INDEX_PATH = path.join(DATA_DIR, 'index.json');
const ALLFUND_DIR = path.join(__dirname, '..', 'data', 'allfund');
const ALLFUND_PATH = path.join(ALLFUND_DIR, 'allfund.json');
const OVERSEAS_CODES_PATH = path.join(ALLFUND_DIR, 'overseas-codes.json');
const FUND_LIST_URL = 'http://fund.eastmoney.com/js/fundcode_search.js';
const HK_FUND_LIST_URL = 'https://overseas.1234567.com.cn/FundList';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function parseArgs() {
  const args = process.argv.slice(2);
  let force = false;
  let concurrency = 100;
  let delayMs = 50;
  let retry = 10;
  let limit = 0;
  for (const a of args) {
    if (a === '--force') force = true;
    else if (a.startsWith('--concurrency=')) concurrency = Math.max(1, Math.min(50, parseInt(a.slice(14), 10) || 10));
    else if (a.startsWith('--delay=')) delayMs = Math.max(0, parseInt(a.slice(8), 10) || 0);
    else if (a.startsWith('--retry=')) retry = Math.max(0, Math.min(10, parseInt(a.slice(7), 10) || 2));
    else if (a.startsWith('--limit=')) limit = Math.max(0, parseInt(a.slice(8), 10) || 0);
  }
  return { force, concurrency, delayMs, retry, limit };
}

/**
 * 从 fundcode_search.js 获取全部境内公募基金代码（去重、6 位）
 */
async function fetchDomesticFundCodes() {
  const res = await fetch(FUND_LIST_URL, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`获取基金列表失败: ${res.status}`);
  const text = await res.text();
  const codeSet = new Set();
  const re = /"(\d{6})"/g;
  let m;
  while ((m = re.exec(text)) !== null) codeSet.add(m[1]);
  return [...codeSet].sort();
}

/**
 * 从海外基金列表抓取中港互认基金代码（968 开头），遍历 FundList 的分页链接
 */
async function fetchOverseasFundCodes() {
  // 1) 优先尝试从本地配置文件读取（推荐方式）
  if (fs.existsSync(OVERSEAS_CODES_PATH)) {
    try {
      const raw = fs.readFileSync(OVERSEAS_CODES_PATH, 'utf8');
      const data = JSON.parse(raw);
      const list = Array.isArray(data)
        ? data
        : Array.isArray(data.codes)
          ? data.codes
          : [];
      const codes = list
        .map(c => String(c).trim())
        .filter(c => /^968\d{3}$/.test(c));
      if (codes.length > 0) {
        console.log(`从本地 ${OVERSEAS_CODES_PATH} \n读取到 ${codes.length} 只 968 开头海外基金代码`);
        return [...new Set(codes)].sort();
      }
    } catch (e) {
      console.warn(`读取或解析 ${OVERSEAS_CODES_PATH} 失败，将尝试从线上 FundList 解析：`, e.message || e);
    }
  }

  // 2) 远程 FundList 页面抓取（注意：该页面大量内容由前端 JS 渲染，可能抓不到完整列表）
  const base = 'https://overseas.1234567.com.cn';
  const visited = new Set();
  const queue = [HK_FUND_LIST_URL];
  const codeSet = new Set();
  const maxPages = 32;

  while (queue.length && visited.size < maxPages) {
    const url = queue.shift();
    if (visited.has(url)) continue;
    visited.add(url);
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA } });
      if (!res.ok) continue;
      const html = await res.text();
      // 提取 968 开头的 6 位基金代码
      const codeRe = /\b(968\d{3})\b/g;
      let m;
      while ((m = codeRe.exec(html)) !== null) {
        codeSet.add(m[1]);
      }
      // 继续遍历其它 FundList 分页链接
      const linkRe = /href="([^"]*FundList[^"]*)"/g;
      let lm;
      while ((lm = linkRe.exec(html)) !== null) {
        let href = lm[1];
        if (!href) continue;
        let nextUrl;
        if (href.startsWith('http')) {
          nextUrl = href;
        } else if (href.startsWith('/')) {
          nextUrl = base + href;
        } else {
          nextUrl = base + '/' + href;
        }
        if (!visited.has(nextUrl) && !queue.includes(nextUrl)) {
          queue.push(nextUrl);
        }
      }
    } catch {
      // 忽略单页错误，继续其它页面
    }
  }
  return [...codeSet].sort();
}

function loadExistingCodes() {
  if (!fs.existsSync(INDEX_PATH)) return [];
  try {
    const index = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8'));
    return index.codes || [];
  } catch (_) {
    return [];
  }
}

/** 单只基金抓取，失败时重试最多 retry 次，每次间隔 retryDelayMs */
async function fetchWithRetry(code, retryCount, retryDelayMs) {
  let lastErr;
  for (let attempt = 0; attempt <= retryCount; attempt++) {
    try {
      const data = await fetchFundFee(code);
      if (data) return data;
    } catch (e) {
      lastErr = e;
    }
    if (attempt < retryCount && retryDelayMs > 0) {
      await new Promise(r => setTimeout(r, retryDelayMs));
    }
  }
  return null;
}

async function main() {
  const { force, concurrency, delayMs, retry, limit } = parseArgs();
  console.log('正在获取基金代码列表…');
  const domesticCodes = await fetchDomesticFundCodes();
  console.log(`境内公募基金 ${domesticCodes.length} 只`);
  let overseasCodes = [];
  try {
    overseasCodes = await fetchOverseasFundCodes();
    if (overseasCodes.length) {
      console.log(`中港互认基金（968 开头）${overseasCodes.length} 只`);
    } else {
      console.log('未从海外基金列表解析到任何 968 开头的基金代码');
    }
  } catch (e) {
    console.warn('获取海外中港互认基金代码失败，将仅抓取境内公募基金：', e.message || e);
  }

  const allCodes = [...new Set([...domesticCodes, ...overseasCodes])].sort();
  console.log(`合计 ${allCodes.length} 只基金（含境内公募与中港互认基金）`);

  const existing = loadExistingCodes();
  let toCrawl = force ? allCodes : allCodes.filter(c => !existing.includes(c));
  if (limit > 0) {
    toCrawl = toCrawl.slice(0, limit);
    console.log(`--limit=${limit}，实际抓取 ${toCrawl.length} 只`);
  }
  if (!force && existing.length > 0 && limit <= 0) {
    console.log(`已缓存 ${existing.length} 只，本次待抓取 ${toCrawl.length} 只`);
  }

  if (toCrawl.length === 0) {
    console.log('没有需要抓取的基金（使用 --force 可强制全量重抓）');
    process.exit(0);
  }

  const total = toCrawl.length;
  const workers = Math.min(concurrency, total);
  const retryDelayMs = 1000;
  console.log(`并发数 ${workers}${delayMs > 0 ? `，启动间隔 ${delayMs}ms` : ''}，失败重试 ${retry} 次`);

  let nextIndex = 0;
  let ok = 0;
  let fail = 0;
  let done = 0;
  /** @type {string[]} */
  const failedCodes = [];
  const start = Date.now();
  const logInterval = total > 500 ? 500 : total > 100 ? 100 : 20;
  let lastLogTime = start;

  function progressBar() {
    const pct = total > 0 ? (done / total * 100) : 0;
    const barLen = 30;
    const filled = Math.round(barLen * done / total);
    const bar = '█'.repeat(filled) + '░'.repeat(barLen - filled);
    const elapsedSec = ((Date.now() - start) / 1000).toFixed(0);
    const speed = done > 0 ? (done / ((Date.now() - start) / 1000)).toFixed(1) : '0';
    const eta = done > 0 ? Math.round((total - done) / (done / ((Date.now() - start) / 1000))) : '?';
    return `${bar} ${pct.toFixed(1)}%  ${done}/${total}  ✓${ok} ✗${fail}  ${speed}/s  ETA ${eta}s  [${elapsedSec}s]`;
  }

  console.log(`\n${'─'.repeat(60)}`);

  async function runWorker() {
    while (true) {
      const i = nextIndex++;
      if (i >= total) return;
      const code = toCrawl[i];
      if (delayMs > 0) await new Promise(r => setTimeout(r, delayMs));
      const data = await fetchWithRetry(code, retry, retryDelayMs);
      if (data) {
        saveFund(data);
        ok++;
      } else {
        fail++;
        failedCodes.push(code);
      }
      done++;
      const now = Date.now();
      if (done % logInterval === 0 || done === total || now - lastLogTime > 5000) {
        process.stdout.write(`\r${progressBar()}`);
        lastLogTime = now;
      }
    }
  }

  await Promise.all(Array.from({ length: workers }, () => runWorker()));

  process.stdout.write(`\r${progressBar()}\n`);

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`${'─'.repeat(60)}`);
  console.log(`完成：成功 ${ok}，失败 ${fail}，耗时 ${elapsed}s`);
  if (failedCodes.length) {
    const show = failedCodes.length > 20 ? failedCodes.slice(0, 20).join('  ') + `  …共${failedCodes.length}只` : failedCodes.join('  ');
    console.log(`⚠ 失败代码：${show}`);
  }

  // 抓取完成后，基于 data/funds 下的单只文件聚合生成 data/allfund/allfund.json
  try {
    fs.mkdirSync(ALLFUND_DIR, { recursive: true });
    if (!fs.existsSync(INDEX_PATH)) {
      console.warn('索引 index.json 不存在，跳过 allfund.json 生成');
    } else {
      const index = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8'));
      const codes = index.codes || [];
      const funds = {};
      for (const code of codes) {
        const filePath = path.join(DATA_DIR, `${code}.json`);
        if (!fs.existsSync(filePath)) continue;
        try {
          const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
          // 规范化基金类型：
          // - 对于来源页面标记为「中港互认基金」的，统一归类为「中港互认」
          // - 对于 968 开头的中港互认基金，如缺少类型，也统一标记为「中港互认」
          if (typeof data.fundType === 'string') {
            const t = data.fundType.trim();
            if (t === '中港互认基金') {
              data.fundType = '中港互认';
            }
          }
          if ((!data.fundType || String(data.fundType).trim() === '') && /^968\d{3}$/.test(code)) {
            data.fundType = '中港互认';
          }
          funds[code] = data;
        } catch {
          // 跳过损坏文件
        }
      }
      fs.writeFileSync(ALLFUND_PATH, JSON.stringify({ codes, funds }, null, 2), 'utf8');
      console.log(`已生成聚合文件 ${ALLFUND_PATH}（${codes.length} 只基金）`);
    }
  } catch (e) {
    console.error('生成 allfund.json 失败：', e);
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
