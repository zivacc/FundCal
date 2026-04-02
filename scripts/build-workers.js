/**
 * 构建 Workers 静态资源：将前端文件复制到 dist/ 目录
 * 使用：node scripts/build-workers.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

const COPY_FILES = [
  'index.html',
  'index-picker.html',
  'cached-funds.html',
  'cached-fund-stats.html',
];

const COPY_DIRS = [
  'js',
  'css',
  'pics',
];

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function copyDir(src, dest) {
  ensureDir(dest);
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function clean() {
  if (fs.existsSync(DIST)) {
    fs.rmSync(DIST, { recursive: true, force: true });
  }
}

function build() {
  console.log('清理 dist/ ...');
  clean();
  ensureDir(DIST);

  for (const file of COPY_FILES) {
    const src = path.join(ROOT, file);
    if (!fs.existsSync(src)) {
      console.warn(`  跳过不存在的文件: ${file}`);
      continue;
    }
    fs.copyFileSync(src, path.join(DIST, file));
    console.log(`  复制 ${file}`);
  }

  for (const dir of COPY_DIRS) {
    const src = path.join(ROOT, dir);
    if (!fs.existsSync(src)) {
      console.warn(`  跳过不存在的目录: ${dir}/`);
      continue;
    }
    copyDir(src, path.join(DIST, dir));
    console.log(`  复制 ${dir}/`);
  }

  // 排排网映射：找到 data/smpp/ 下最新的映射文件，复制为稳定文件名
  const smppSrc = path.join(ROOT, 'data', 'smpp');
  const smppDest = path.join(DIST, 'data', 'smpp');
  if (fs.existsSync(smppSrc)) {
    const mappingFiles = fs.readdirSync(smppSrc)
      .filter(f => f.startsWith('simuwang-code-mapping-') && f.endsWith('.json'))
      .sort();
    if (mappingFiles.length > 0) {
      const latest = mappingFiles[mappingFiles.length - 1];
      ensureDir(smppDest);
      fs.copyFileSync(
        path.join(smppSrc, latest),
        path.join(smppDest, 'simuwang-code-mapping.json')
      );
      console.log(`  复制 ${latest} → data/smpp/simuwang-code-mapping.json`);
    } else {
      console.warn('  跳过：data/smpp/ 中无排排网映射文件');
    }
  }

  console.log(`构建完成 → ${DIST}`);
}

build();
