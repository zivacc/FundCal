#!/usr/bin/env node
/** Rebuild only the public index search catalogue, without touching fund shards. */
import Database from 'better-sqlite3';
import { writeFileSync, renameSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildIndexSearch } from './nav/index-search.js';

const db=new Database(fileURLToPath(new URL('../data/fundcal.db',import.meta.url)),{readonly:true,fileMustExist:true});
try {
  const rows=buildIndexSearch(db);
  const output=fileURLToPath(new URL('../data/allfund/index-search-index.json',import.meta.url));
  writeFileSync(`${output}.tmp`,JSON.stringify(rows));renameSync(`${output}.tmp`,output);
  console.log(`index-search-index.json: ${rows.length} indices`);
}finally{db.close();}
