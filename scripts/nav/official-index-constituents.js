import * as XLSX from 'xlsx';
import { setTimeout as delay } from 'node:timers/promises';
import { validDate } from './index-constituents.js';

const CSI_HEADERS = ['日期Date','指数代码 Index Code','指数名称 Index Name','指数英文名称Index Name(Eng)','成份券代码Constituent Code','成份券名称Constituent Name','成份券英文名称Constituent Name(Eng)','交易所Exchange','交易所英文名称Exchange(Eng)','权重(%)weight'];
const CNI_HEADERS = ['日期','样本代码','样本简称','所属行业','总市值(亿元)','权重（%）'];
const compact = value => String(value ?? '').replace(/\s/g,'');

export function officialTarget(index) {
  const code = index.ts_code.split('.')[0].toUpperCase();
  if (!/^[A-Z0-9]{6}$/.test(code)) return null;
  if (['中证指数有限公司','上海证券交易所'].includes(index.publisher)) {
    return { source:'csindex', code, url:`https://oss-ch.csindex.com.cn/static/html/csindex/public/uploads/file/autofile/closeweight/${code}closeweight.xls` };
  }
  if (['深圳证券交易所','深圳证券信息有限公司','巨潮公司'].includes(index.publisher)) {
    return { source:'cnindex', code, url:`https://www.cnindex.com.cn/sample-detail/download-history?indexcode=${code}` };
  }
  return null;
}

function weight(value) {
  if ((typeof value !== 'number' && typeof value !== 'string') || String(value).trim()==='' || !Number.isFinite(Number(value)) || Number(value)<0 || Number(value)>100) throw new Error('Missing or invalid percentage weight');
  return Number(value);
}

function date(value) {
  const str=String(value).trim();
  const d=/^\d{8}$/.test(str) ? `${str.slice(0,4)}-${str.slice(4,6)}-${str.slice(6)}` : str;
  if (!validDate(d)) throw new Error('Invalid weight date');
  return d;
}

function security(value,exchange,source) {
  let code=String(value??'').trim();
  const match=code.match(/^(\d{1,6})(?:\.(SH|SZ|BJ|HK))?$/);
  if (!match) throw new Error(`Unsupported constituent code ${code}`);
  code=match[1];
  if (source==='csindex') {
    const exchanges = new Map([
      ['上海证券交易所','SH'],['深圳证券交易所','SZ'],['北京证券交易所','BJ'],
      ['香港交易所','HK'],['香港联合交易所','HK'],['香港证券交易所','HK'],
      ['上海','SH'],['深圳','SZ'],['北京','BJ'],['香港','HK'],
    ]);
    const suffix=exchanges.get(String(exchange).trim());
    if (!suffix) throw new Error(`Unsupported exchange ${exchange}`);
    if(match[2] && match[2]!==suffix)throw new Error('Security suffix and exchange disagree');
    return `${code.padStart(suffix==='HK'?5:6,'0')}.${suffix}`;
  }
  if(match[2])throw new Error('Unexpected CNI security suffix');
  // CNI stock files omit exchange. Accept only unambiguous stock code ranges.
  // Bond/fund files and unknown markets require a separate adapter.
  if (code.length===5) return `${code}.HK`;
  code=code.padStart(6,'0');
  if (/^(000|001|002|003|300|301|302)\d{3}$/.test(code)) return `${code}.SZ`;
  if (/^(600|601|603|605|688|689)\d{3}$/.test(code)) return `${code}.SH`;
  // Legacy 4/8 prefixes also identify NEEQ shares: do not infer a BJ listing from them.
  if (/^920\d{3}$/.test(code)) return `${code}.BJ`;
  throw new Error(`Unsupported CNI security ${code}`);
}

/** Parse only official complete-weight downloads, never a web page or TOP-N list. */
export function parseOfficialWeights(buffer,{indexCode,source,code,end,contentDisposition=''}) {
  if (!validDate(end) || indexCode.split('.')[0].toUpperCase()!==code || !['csindex','cnindex'].includes(source)) throw new Error('Invalid source/index/date');
  if (source==='cnindex' && !contentDisposition.includes(`filename=${code}_cons.xlsx`)) throw new Error('CNI file index identity mismatch');
  if (!Buffer.isBuffer(buffer) || buffer.length>20*1024*1024 || !(buffer.subarray(0,8).equals(Buffer.from('d0cf11e0a1b11ae1','hex')) || buffer.subarray(0,4).equals(Buffer.from('504b0304','hex')))) throw new Error('Not an XLS/XLSX weight file');
  const book=XLSX.read(buffer,{type:'buffer',cellFormula:false,cellHTML:false});
  if (book.SheetNames.length!==1) throw new Error('Unexpected weight workbook sheets');
  const table=XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]],{header:1,raw:true,defval:null,blankrows:false});
  const headers=source==='csindex'?CSI_HEADERS:CNI_HEADERS;
  if (JSON.stringify(table[0]?.map(compact))!==JSON.stringify(headers.map(compact))) throw new Error('Unexpected weight file columns');
  const rows=[],dates=new Set(),seen=new Set();
  for (const row of table.slice(1)) {
    if (source==='csindex' && String(row[1]).toUpperCase().padStart(6,'0')!==code) throw new Error('File index identity mismatch');
    const d=date(row[0]);
    if (d>end) throw new Error('Future weight date');
    dates.add(d);
    const c=security(row[source==='csindex'?4:1],row[7],source);
    const name=row[source==='csindex'?5:2];
    if (typeof name!=='string' || !name.trim() || seen.has(c)) throw new Error('Missing name or duplicate constituent');
    seen.add(c);
    rows.push({code:c,name:name.trim(),weight_pct:weight(row[source==='csindex'?9:5])});
  }
  if (!rows.length || dates.size!==1) throw new Error('Empty file or mixed weight dates');
  const sum=rows.reduce((s,r)=>s+r.weight_pct,0);
  if (Math.abs(sum-100)>0.1) throw new Error(`Incomplete weight sum ${sum}`);
  // A complete official download is the population, without a separate declared count/sum.
  // The legacy declared_weight_sum_pct stores the observed total for this validation basis.
  return {indexCode,asOfDate:[...dates][0],expectedCount:rows.length,declaredSum:sum,weightSum:sum,validationBasis:'official_full_file',rows:rows.sort((a,b)=>a.code.localeCompare(b.code))};
}

export async function downloadOfficialWeights(url,{fetchImpl=fetch,retryDelayMs=1000}={}) {
  for(let attempt=0;;attempt++) {
    try{return await downloadOnce(url,fetchImpl);}
    catch(error) {
      const transient=['TimeoutError','AbortError'].includes(error.name) || error.message==='fetch failed' || [502,503,504].includes(error.status);
      if(!transient || attempt>=2)throw error;
      await delay(retryDelayMs*(attempt+1));
    }
  }
}

async function downloadOnce(url,fetchImpl) {
  const response=await fetchImpl(url,{signal:AbortSignal.timeout(20000)});
  if (!response.ok) {
    await response.body?.cancel();
    const error=new Error(`HTTP ${response.status}`);error.status=response.status;throw error;
  }
  const chunks=[];let size=0;
  for await (const chunk of response.body) {
    size+=chunk.length;if(size>20*1024*1024)throw new Error('Weight download exceeds 20 MiB');chunks.push(chunk);
  }
  return {buffer:Buffer.concat(chunks),contentDisposition:response.headers.get('content-disposition')||'',fetchedAt:new Date().toISOString(),url};
}
