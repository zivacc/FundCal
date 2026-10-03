import {validDate} from './index-constituents.js';

function dataRows(receipt) {
  if (receipt?.httpStatus!==200 || receipt.response?.code!==0 || receipt.request?.api_name!=='index_weight') throw new Error('Failed or wrong Tushare receipt');
  const {fields,items}=receipt.response.data||{};
  if (!Array.isArray(fields) || !Array.isArray(items) || new Set(fields).size!==fields.length) throw new Error('Invalid Tushare table');
  if (items.length && !['index_code','con_code','trade_date','weight'].every(f=>fields.includes(f))) throw new Error('Missing weight fields');
  return items.map(item=>{
    if (!Array.isArray(item)||item.length!==fields.length) throw new Error('Tushare row/column mismatch');
    return Object.fromEntries(fields.map((field,i)=>[field,item[i]]));
  });
}

/** A complete index_weight API result, separately labelled from provider totals
 * and official files. Never synthesize a count/sum claimed to come from Wind. */
export function normalizeTushareConstituents(receipt,{indexCode,date,names,terminalReceipt,knownConstituentCodes=null}) {
  if (!validDate(date)) throw new Error('Invalid requested weight date');
  const sourceCode=indexCode.toUpperCase(),compactDate=date.replaceAll('-','');
  if (receipt.request?.params?.index_code!==sourceCode) throw new Error('Wrong requested index');
  const records=dataRows(receipt),seen=new Set();
  if (!records.length) throw new Error('Empty constituent result');
  const rows=records.map(r=>{
    if (r.index_code!==sourceCode || r.trade_date!==compactDate) throw new Error('Wrong index or weight date');
    if (typeof r.con_code!=='string'||!/^\d{5,6}\.(SH|SZ|BJ|HK)$/.test(r.con_code)||seen.has(r.con_code)) throw new Error('Invalid or duplicate constituent identity');
    seen.add(r.con_code);
    const name=names.get(r.con_code);
    if (typeof name!=='string'||!name.trim()) throw new Error(`Missing constituent name: ${r.con_code}`);
    if (typeof r.weight!=='number'||!Number.isFinite(r.weight)||r.weight<0||r.weight>100) throw new Error('Missing or invalid constituent weight');
    return {code:r.con_code,name:name.trim(),weight_pct:r.weight};
  }).sort((a,b)=>a.code.localeCompare(b.code));
  const p=terminalReceipt?.request?.params;
  if (p?.index_code!==sourceCode||p.trade_date!==compactDate||p.offset!==rows.length||p.limit!==1||dataRows(terminalReceipt).length!==0) throw new Error('Missing or nonempty terminal page');
  if (knownConstituentCodes) {
    const expected=new Set(knownConstituentCodes);
    if (expected.size!==seen.size || [...expected].some(code=>!seen.has(code))) throw new Error('Known constituent list mismatch');
  }
  const sum=rows.reduce((n,r)=>n+r.weight_pct,0);
  if (Math.abs(sum-100)>0.1) throw new Error('Incomplete weight sum');
  return {indexCode,asOfDate:date,expectedCount:rows.length,declaredSum:sum,weightSum:sum,validationBasis:'api_full_result',rows,
    completeness:{method:'index_weight_pagination',expectedCount:rows.length,terminalOffset:p.offset,terminalLimit:p.limit,terminalRows:0}};
}
