/**
 * Lightweight .env loader — no external dependencies.
 * Reads KEY=VALUE pairs from the project root .env file into process.env.
 * Skips blank lines and comments (#). Does NOT override existing env vars.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = path.join(__dirname, '..', '..', '.env');

let loaded = false;

export function loadEnv() {
  if (loaded) return;
  loaded = true;

  if (!fs.existsSync(ENV_PATH)) return;

  const lines = fs.readFileSync(ENV_PATH, 'utf8').split('\n');
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let val = line.slice(idx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = val;
    }
  }
}

export function requireEnv(key) {
  loadEnv();
  const val = process.env[key];
  if (!val) {
    console.error(`\u274c 缺少环境变量 ${key}，请检查 .env 文件`);
    process.exit(1);
  }
  return val;
}
