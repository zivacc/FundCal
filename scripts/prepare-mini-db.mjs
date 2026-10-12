/** Produce a checked SQLite snapshot and resumable compressed transfer file. */
import fs from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createGzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import Database from 'better-sqlite3';

export async function sha256(file) {
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(file)) hash.update(bytes);
  return hash.digest('hex');
}
export function inspectSnapshot(file) {
  const db = new Database(file, { readonly: true, fileMustExist: true });
  try {
    db.exec('BEGIN');
    const checks = db.pragma('quick_check').map(row => Object.values(row)[0]);
    if (checks.length !== 1 || checks[0] !== 'ok') throw new Error('snapshot quick_check failed');
    const counts = {};
    for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()) {
      counts[name] = db.prepare(`SELECT count(*) AS n FROM "${name.replaceAll('"', '""')}"`).get().n;
    }
    const latestNav = counts.fund_nav !== undefined ? db.prepare('SELECT max(end_date) AS d FROM fund_nav').get().d : null;
    const schema = db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all();
    return { quickCheck: 'ok', counts, latestNav, schemaSha256: createHash('sha256').update(JSON.stringify(schema)).digest('hex') };
  } finally { db.close(); }
}
export async function prepare({ source, out, reuse = false, gzip = true }) {
  const sourcePath = await fs.realpath(source);
  const output = path.resolve(out);
  if (sourcePath === path.join(output, 'fundcal.db')) throw new Error('output cannot replace source');
  await fs.mkdir(output, { recursive: true, mode: 0o700 });
  if (await fs.realpath(output) !== output) throw new Error('output cannot contain symlinks');
  await fs.chmod(output, 0o700);
  const snapshot = path.join(output, 'fundcal.db');
  if (!reuse) {
    if (await fs.stat(snapshot).then(() => true, () => false)) throw new Error('snapshot already exists; use a fresh output directory');
    const db = new Database(sourcePath, { readonly: true, fileMustExist: true });
    try { await db.backup(snapshot); } finally { db.close(); }
  }
  const stat = await fs.lstat(snapshot);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('snapshot must be an ordinary file');
  await fs.chmod(snapshot, 0o600);
  const checked = inspectSnapshot(snapshot);
  const hash = await sha256(snapshot);
  const compressed = path.join(output, 'fundcal.db.gz');
  if (gzip) {
    const partial = `${compressed}.partial`;
    await pipeline(createReadStream(snapshot), createGzip({ level: 1 }), createWriteStream(partial, { flags: 'wx', mode: 0o600 }));
    await fs.rename(partial, compressed);
  }
  const manifest = { version: 1, createdAt: new Date().toISOString(), sourcePath, snapshot: { file: 'fundcal.db', bytes: stat.size, sha256: hash, ...checked }, transfer: gzip ? { file: 'fundcal.db.gz', bytes: (await fs.stat(compressed)).size, sha256: await sha256(compressed) } : { file: 'fundcal.db', bytes: stat.size, sha256: hash } };
  await fs.writeFile(path.join(output, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  return manifest;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const options = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--reuse') options.reuse = true;
    else if (arg === '--no-gzip') options.gzip = false;
    else if (arg === '--source' || arg === '--out') options[arg.slice(2)] = args[++i];
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!options.source || !options.out) throw new Error('--source and --out are required');
  console.log(JSON.stringify(await prepare(options), null, 2));
}
