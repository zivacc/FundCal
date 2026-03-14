/**
 * 将基金数据批量上传到 Cloudflare KV
 *
 * 使用前提：
 *   1. 已安装 wrangler 并登录 (npx wrangler login)
 *   2. 已在 wrangler.toml 中配置 KV namespace id
 *
 * 使用：
 *   node scripts/upload-kv.js                  # 上传全部数据（基金 + 索引）
 *   node scripts/upload-kv.js --meta-only      # 仅上传索引/元数据文件
 *   node scripts/upload-kv.js --funds-only     # 仅上传基金数据
 *   node scripts/upload-kv.js --preview        # 上传到 preview KV namespace
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const ALLFUND_DIR = path.join(ROOT, 'data', 'allfund');
const ALLFUND_PATH = path.join(ALLFUND_DIR, 'allfund.json');
const TEMP_DIR = path.join(ROOT, '.kv-upload-tmp');

const BATCH_SIZE = 10000;

const args = process.argv.slice(2);
const metaOnly = args.includes('--meta-only');
const fundsOnly = args.includes('--funds-only');
const isPreview = args.includes('--preview');

const META_FILES = [
  { file: 'search-index.json', key: 'meta:search-index' },
  { file: 'feeder-index.json', key: 'meta:feeder-index' },
  { file: 'fund-stats.json', key: 'meta:fund-stats' },
  { file: 'fund-stats-detail.json', key: 'meta:fund-stats-detail' },
  { file: 'list-index.json', key: 'meta:list-index' },
  { file: 'code-name-map.json', key: 'meta:code-name-map' },
  { file: 'overseas-codes.json', key: 'meta:overseas-codes' },
  { file: 'feeder-master-overrides.json', key: 'meta:feeder-master-overrides' },
];

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function cleanTemp() {
  if (fs.existsSync(TEMP_DIR)) fs.rmSync(TEMP_DIR, { recursive: true, force: true });
}

function wranglerBulkPut(jsonFilePath) {
  const previewFlag = isPreview ? ' --preview' : '';
  const cmd = `npx wrangler kv:bulk put "${jsonFilePath}" --binding FUND_DATA${previewFlag}`;
  console.log(`  执行: ${cmd}`);
  execSync(cmd, { cwd: ROOT, stdio: 'inherit' });
}

function uploadMetaFiles() {
  console.log('\n=== 上传索引/元数据文件 ===');
  const entries = [];

  for (const { file, key } of META_FILES) {
    const filePath = path.join(ALLFUND_DIR, file);
    if (!fs.existsSync(filePath)) {
      console.log(`  跳过（不存在）: ${file}`);
      continue;
    }
    const content = fs.readFileSync(filePath, 'utf8');
    entries.push({ key, value: content });
    console.log(`  准备: ${key} ← ${file} (${(Buffer.byteLength(content) / 1024).toFixed(1)} KB)`);
  }

  if (!entries.length) {
    console.log('  无索引文件可上传');
    return;
  }

  ensureDir(TEMP_DIR);
  const tmpFile = path.join(TEMP_DIR, 'meta-bulk.json');
  fs.writeFileSync(tmpFile, JSON.stringify(entries), 'utf8');
  wranglerBulkPut(tmpFile);
  console.log(`  已上传 ${entries.length} 个索引文件`);
}

function uploadFundData() {
  console.log('\n=== 上传基金数据 ===');

  if (!fs.existsSync(ALLFUND_PATH)) {
    console.error(`  错误: 未找到 ${ALLFUND_PATH}`);
    console.error('  请先运行 node scripts/build-allfund.js 生成 allfund.json');
    process.exit(1);
  }

  console.log(`  读取 allfund.json ...`);
  const raw = JSON.parse(fs.readFileSync(ALLFUND_PATH, 'utf8'));
  const funds = raw.funds || raw;
  const codes = raw.codes || Object.keys(funds);

  console.log(`  共 ${codes.length} 只基金`);

  // 上传 codes 列表
  ensureDir(TEMP_DIR);
  const codesFile = path.join(TEMP_DIR, 'codes-bulk.json');
  fs.writeFileSync(codesFile, JSON.stringify([{ key: 'meta:codes', value: JSON.stringify(codes) }]), 'utf8');
  wranglerBulkPut(codesFile);
  console.log(`  已上传 meta:codes (${codes.length} 个代码)`);

  // 分批上传基金数据
  const fundCodes = codes.filter(c => funds[c]);
  const totalBatches = Math.ceil(fundCodes.length / BATCH_SIZE);

  for (let i = 0; i < totalBatches; i++) {
    const batch = fundCodes.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE);
    const entries = batch.map(code => ({
      key: `fund:${code}`,
      value: JSON.stringify(funds[code]),
    }));

    const batchFile = path.join(TEMP_DIR, `funds-batch-${i}.json`);
    fs.writeFileSync(batchFile, JSON.stringify(entries), 'utf8');
    console.log(`  批次 ${i + 1}/${totalBatches}: ${batch.length} 条 ...`);
    wranglerBulkPut(batchFile);
  }

  console.log(`  已上传 ${fundCodes.length} 只基金数据`);
}

function main() {
  console.log('Cloudflare KV 数据上传工具');
  console.log(`  模式: ${metaOnly ? '仅索引' : fundsOnly ? '仅基金' : '全部'}`);
  console.log(`  目标: ${isPreview ? 'preview' : 'production'} KV namespace`);

  try {
    if (!fundsOnly) uploadMetaFiles();
    if (!metaOnly) uploadFundData();

    console.log('\n=== 上传完成 ===');
  } finally {
    cleanTemp();
  }
}

main();
