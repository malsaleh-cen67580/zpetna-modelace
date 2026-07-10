const fs = require('fs');
const text = fs.readFileSync('/home/runner/work/zpetna-modelace/zpetna-modelace/index.html','utf8');
const vm = require('vm');
function evalChunk(startMarker, endMarker, names){
  const start = text.indexOf(startMarker);
  const end = text.indexOf(endMarker, start);
  let chunk = text.slice(start, end);
  chunk += '\nthis.__out = {' + names.join(',') + '};';
  const ctx = { console, Date, Math, Number, String, Object, Array, JSON, Set, Map };
  vm.createContext(ctx);
  vm.runInContext(chunk, ctx, { timeout: 20000 });
  return ctx.__out;
}
const core = evalChunk('const DAILY_DATES = [', 'const InvestmentContext = createContext(null);', [
  'DAILY_DATES','WEEKLY_DATES','FUND_CATALOG_BY_CURRENCY','FUND_DAILY_RETURNS','FUND_WEEKLY_RETURNS_BY_ISIN','FUND_WEEKLY_RETURNS_BY_NORMALIZED_NAME','FUND_PERF_DATA','FUND_INCEPTION','PRESET_PORTFOLIOS','MMA_PORTFOLIOS','WEEKLY_HISTORICAL_RETURNS','CHART_MAX_TS','PERF_REFERENCE_DATE'
]);
const cls = evalChunk('const FUND_CLASSIFICATION_BY_ISIN = {', 'function getFundCategoryInfo', ['FUND_CLASSIFICATION_BY_ISIN']);
const data = { ...core, ...cls };
function compact(s){ return String(s||'').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]/g,''); }

const result = {};
result.catalogFunds = Object.fromEntries(Object.entries(data.FUND_CATALOG_BY_CURRENCY).map(([cur,funds]) => [cur, funds.map(f=>({name:f.name, isin:f.isin, sleeve:f.sleeve, missingFields:['name','isin','currency','class','subclass'].filter(k=>!(k in f))}))]));
result.catalogCoverage = {};
for (const [cur,funds] of Object.entries(data.FUND_CATALOG_BY_CURRENCY)) {
  result.catalogCoverage[cur] = funds.map(f=>({
    name:f.name, isin:f.isin,
    hasWeeklyIsin: !!data.FUND_WEEKLY_RETURNS_BY_ISIN[f.isin],
    hasDailyByName: Object.prototype.hasOwnProperty.call(data.FUND_DAILY_RETURNS, f.name),
    hasPerfExact: Object.prototype.hasOwnProperty.call(data.FUND_PERF_DATA[cur]||{}, f.name),
    hasClassification: Object.prototype.hasOwnProperty.call(data.FUND_CLASSIFICATION_BY_ISIN, f.isin),
    hasInception: Object.prototype.hasOwnProperty.call(data.FUND_INCEPTION, `${f.name}:${cur}`),
  }));
}
result.catalogMissingByCurrency = {};
for (const [cur,rows] of Object.entries(result.catalogCoverage)) {
  result.catalogMissingByCurrency[cur] = {
    missingWeeklyIsin: rows.filter(r=>!r.hasWeeklyIsin).map(r=>r.name),
    missingPerfExact: rows.filter(r=>!r.hasPerfExact).map(r=>r.name),
    missingClassification: rows.filter(r=>!r.hasClassification).map(r=>r.name),
    withDailyByName: rows.filter(r=>r.hasDailyByName).map(r=>r.name),
    withInception: rows.filter(r=>r.hasInception).map(r=>r.name),
  };
}
result.perfNotInCatalog = {};
for (const [cur, perf] of Object.entries(data.FUND_PERF_DATA)) {
  const names = new Set((data.FUND_CATALOG_BY_CURRENCY[cur]||[]).map(f=>f.name));
  result.perfNotInCatalog[cur] = Object.keys(perf).filter(name=>!names.has(name));
}
function exactNameMismatches(arr, fundsByCurrency){
  const out = [];
  for (const p of arr) {
    for (const [cur, fundList] of Object.entries({CZK: p.funds || [], EUR: p.fundsByCurrency?.EUR || [], USD: p.fundsByCurrency?.USD || []})) {
      const names = new Set((data.FUND_CATALOG_BY_CURRENCY[cur]||[]).map(f=>f.name));
      for (const fund of fundList) if (!names.has(fund.name)) out.push({portfolio:p.name, currency:cur, fund:fund.name});
    }
  }
  return out;
}
result.presetMismatches = {
  preset: exactNameMismatches(data.PRESET_PORTFOLIOS),
  mma: exactNameMismatches(Object.values(data.MMA_PORTFOLIOS))
};
result.lengths = {
  dailyDates: data.DAILY_DATES.length,
  weeklyDates: data.WEEKLY_DATES.length,
  fundDailyUniqueLengths: [...new Set(Object.values(data.FUND_DAILY_RETURNS).map(v=>v.length))].sort((a,b)=>a-b),
  weeklyHistUniqueLengths: [...new Set(Object.values(data.WEEKLY_HISTORICAL_RETURNS).map(v=>v.length))].sort((a,b)=>a-b),
  weeklyIsinUniqueLengths: [...new Set(Object.values(data.FUND_WEEKLY_RETURNS_BY_ISIN).map(v=>v.length))].sort((a,b)=>a-b),
  weeklyNameUniqueLengths: [...new Set(Object.values(data.FUND_WEEKLY_RETURNS_BY_NORMALIZED_NAME).map(v=>v.length))].sort((a,b)=>a-b)
};
result.lengthOutliers = {
  fundDaily: Object.entries(data.FUND_DAILY_RETURNS).filter(([,v])=>v.length!==data.DAILY_DATES.length-1).map(([k,v])=>({name:k,length:v.length})),
  weeklyHist: Object.entries(data.WEEKLY_HISTORICAL_RETURNS).filter(([,v])=>v.length!==data.WEEKLY_DATES.length-1).map(([k,v])=>({name:k,length:v.length})),
  weeklyIsin: Object.entries(data.FUND_WEEKLY_RETURNS_BY_ISIN).filter(([,v])=>v.length!==data.WEEKLY_DATES.length-1).map(([k,v])=>({isin:k,length:v.length})).slice(0,20),
  weeklyName: Object.entries(data.FUND_WEEKLY_RETURNS_BY_NORMALIZED_NAME).filter(([,v])=>v.length!==data.WEEKLY_DATES.length-1).map(([k,v])=>({name:k,length:v.length})).slice(0,20),
};
result.dailyAnomalies = [];
for (const [name, arr] of Object.entries(data.FUND_DAILY_RETURNS)) {
  arr.forEach((v,i)=>{ if (Math.abs(v) >= 50) result.dailyAnomalies.push({name, index:i, date:data.DAILY_DATES[i+1], value:v}); });
}
result.trailingZeroSeries = [];
for (const [isin, arr] of Object.entries(data.FUND_WEEKLY_RETURNS_BY_ISIN)) {
  let tz = 0; for (let i=arr.length-1;i>=0 && Math.abs(Number(arr[i])||0) <= 1e-12;i--) tz++;
  if (tz>0) result.trailingZeroSeries.push({isin, trailingZeros:tz});
}
const normMap = new Set(Object.keys(data.FUND_WEEKLY_RETURNS_BY_NORMALIZED_NAME));
result.catalogNoSeriesAtAll = Object.fromEntries(Object.entries(data.FUND_CATALOG_BY_CURRENCY).map(([cur,funds])=>[cur, funds.filter(f=>!data.FUND_WEEKLY_RETURNS_BY_ISIN[f.isin] && !normMap.has(compact(f.name)) && !data.FUND_DAILY_RETURNS[f.name]).map(f=>f.name)]));
const allCatalogIsins = new Set(Object.values(data.FUND_CATALOG_BY_CURRENCY).flat().map(f=>f.isin));
result.classificationExtra = Object.keys(data.FUND_CLASSIFICATION_BY_ISIN).filter(isin=>!allCatalogIsins.has(isin));
result.catalogIsinsMissingClassification = [...allCatalogIsins].filter(isin=>!Object.prototype.hasOwnProperty.call(data.FUND_CLASSIFICATION_BY_ISIN, isin));
fs.writeFileSync('audit_data.json', JSON.stringify(result,null,2));
console.log('wrote audit_data.json');
