/** Stable logical fingerprints used to detect changes in the receiving database. */
import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const quote = value => `"${value.replaceAll('"', '""')}"`;
export function fingerprint(file) {
  const db = new Database(file, { readonly: true, fileMustExist: true });
  try {
    db.exec('BEGIN');
    const tables = {};
    for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()) {
      const columns = db.pragma(`table_info(${quote(name)})`);
      const pk = columns.filter(c => c.pk).sort((a,b) => a.pk-b.pk).map(c=>quote(c.name));
      const order = pk.length ? pk.join(',') : columns.map(c=>quote(c.name)).join(',');
      const hash = createHash('sha256'); let count = 0;
      for (const row of db.prepare(`SELECT * FROM ${quote(name)} ORDER BY ${order}`).iterate()) {
        hash.update(`${JSON.stringify(row)}\n`); count++;
      }
      tables[name] = { count, sha256: hash.digest('hex') };
    }
    return { version: 1, tables };
  } finally { db.close(); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) throw new Error('usage: node sqlite-content-fingerprint.mjs database.db');
  console.log(JSON.stringify(fingerprint(process.argv[2]), null, 2));
}
