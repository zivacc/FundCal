import { pinyin } from 'pinyin-pro';
import { indexReturnType } from '../../js/domain/index-return.js';

/** Shared DTO for live API and the static fallback. Uses a supplied DB connection. */
export function buildIndexSearch(db) {
  const links = new Map();
  if(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='index_return_links'").get()) {
    for(const row of db.prepare(`SELECT index_ts_code,return_ts_code FROM index_return_links l
      WHERE EXISTS(SELECT 1 FROM index_daily d WHERE d.ts_code=l.return_ts_code)
      ORDER BY index_ts_code,return_ts_code`).all()) {
      if(!links.has(row.index_ts_code)) links.set(row.index_ts_code,[]);
      links.get(row.index_ts_code).push(row.return_ts_code);
    }
  }
  return db.prepare(`SELECT b.ts_code,b.name,b.fullname,b.index_type FROM index_basic b
    WHERE EXISTS(SELECT 1 FROM index_daily d WHERE d.ts_code=b.ts_code) ORDER BY b.ts_code`).all().map(row=>{
    const returnType=indexReturnType(row);
    return {code:row.ts_code,name:row.name||row.ts_code,fullname:row.fullname||'',
      initials:pinyin(row.name||'',{pattern:'first',toneType:'none',type:'array'}).join('').toLowerCase(),
      kind:'index',isPrice:returnType==='price',returnType,totalReturnCodes:links.get(row.ts_code)||[]};
  });
}
