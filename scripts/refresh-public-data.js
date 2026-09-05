#!/usr/bin/env node
/** One-shot public-data refresh. Does not require Tushare or change source arbitration. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';
import Database from 'better-sqlite3';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const statusPath = path.join(root, 'data/public-refresh-status.json');
const reportPath = path.join(root, 'data/public-refresh-coverage.json');
const lockPath = path.join(root, 'data/public-refresh.lock');
const args = process.argv.slice(2);
const waitArg = args.find(a => a.startsWith('--after-pids='));
const waitPids = waitArg ? waitArg.split('=')[1].split(',').map(Number) : [];
if (waitPids.some(p => !Number.isInteger(p) || p < 1)) throw new Error('Invalid --after-pids');
const state = { pid: process.pid, startedAt: new Date().toISOString(), phase: 'starting', stages: [] };
const save = () => fs.writeFileSync(statusPath, JSON.stringify({ ...state, updatedAt: new Date().toISOString() }, null, 2));

function commandFor(pid) {
  try { return execFileSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8', stdio: ['ignore','pipe','ignore'] }).trim(); }
  catch { return ''; }
}

async function run(name, script, scriptArgs = []) {
  const stage = { name, startedAt: new Date().toISOString(), status: 'running' };
  state.stages.push(stage); save();
  console.log(`\n[refresh] ${name}`);
  const exitCode = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...scriptArgs], { cwd: root, stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
  Object.assign(stage, { exitCode, status: exitCode ? 'partial_or_failed' : 'done', finishedAt: new Date().toISOString() });
  save();
  return exitCode;
}

function coverage() {
  const db = new Database(path.join(root, 'data/fundcal.db'), { readonly: true });
  try {
    const cutoff = new Date(Date.now() - 7 * 86400000).toISOString().slice(0,10).replaceAll('-', '');
    const funds = db.prepare(`SELECT b.ts_code,b.name,b.status,b.fund_type,
      (SELECT MAX(end_date) FROM fund_nav n WHERE n.ts_code=b.ts_code) latest
      FROM fund_basic b WHERE b.ts_code LIKE '%.OF' AND COALESCE(b.status,'')!='D'
      AND COALESCE(b.fund_type,'') NOT LIKE '%货币%'`).all();
    const indices = db.prepare(`SELECT b.ts_code,b.name,
      (SELECT MAX(end_date) FROM index_daily d WHERE d.ts_code=b.ts_code) latest
      FROM index_basic b WHERE EXISTS(SELECT 1 FROM index_fund_tracker t WHERE t.index_ts_code=b.ts_code)
      OR EXISTS(SELECT 1 FROM index_daily d WHERE d.ts_code=b.ts_code)`).all();
    const report = {
      generatedAt: new Date().toISOString(), staleBefore: cutoff,
      note: 'Missing/stale are availability flags, not proof of provider errors. Includes unknown-status funds; excludes money-market NAV (different units). No data is fabricated.',
      funds: { total: funds.length, missing: funds.filter(r => !r.latest), stale: funds.filter(r => r.latest && r.latest < cutoff) },
      indices: { total: indices.length, missing: indices.filter(r => !r.latest), stale: indices.filter(r => r.latest && r.latest < cutoff) },
      latestErrors: db.prepare(`SELECT ts_code,api_name,error_message,finished_at FROM sync_log s
        WHERE s.id IN (SELECT MAX(id) FROM sync_log GROUP BY ts_code,api_name)
        AND status='error' AND finished_at>=?`).all(state.startedAt.slice(0,10)),
    };
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    return { funds: { total: report.funds.total, missing: report.funds.missing.length, stale: report.funds.stale.length },
      indices: { total: report.indices.total, missing: report.indices.missing.length, stale: report.indices.stale.length }, latestErrors: report.latestErrors.length };
  } finally { db.close(); }
}

async function main() {
  if (args.includes('--coverage-only')) {
    console.log(JSON.stringify(coverage(), null, 2));
    return;
  }
  // Refuse duplicate full refreshes; only reclaim a lock whose recorded process has exited.
  if (fs.existsSync(lockPath)) {
    const pid = Number(fs.readFileSync(lockPath, 'utf8'));
    if (commandFor(pid)) throw new Error(`Refresh already running: PID ${pid}`);
    fs.unlinkSync(lockPath);
  }
  fs.writeFileSync(lockPath, String(process.pid), { flag: 'wx' });
  try {
    if (waitPids.length) {
      const adopted = waitPids.map(pid => ({ pid, command: commandFor(pid) }));
      if (adopted.some(p => p.command && !/node .*scripts\/(nav\/crawl-eastmoney-nav|crawl-all-fund-fee)\.js\b/.test(p.command))) {
        throw new Error('--after-pids only accepts existing FundCal fee/NAV crawlers');
      }
      state.phase = 'waiting_for_existing_crawlers'; state.waitingFor = adopted; save();
      while (adopted.some(p => p.command && commandFor(p.pid) === p.command)) {
        await new Promise(r => setTimeout(r, 30000));
        save();
      }
      delete state.waitingFor;
    }
    state.phase = 'refreshing'; save();
    // Resume skips today's successful requests; failed funds get a bounded retry pass.
    const results = await Promise.all([
      run('fees', 'scripts/crawl-all-fund-fee.js', ['--force', '--resume', '--concurrency=10', '--delay=100', '--retry=2']),
      run('indices', 'scripts/nav/crawl-em-index.js', ['--tracked', '--resume']),
    ]);
    const merged = await run('field-arbitration', 'scripts/nav/apply-merge-rules.js');
    if (merged) throw new Error('Field arbitration failed; refusing to publish inconsistent fields');
    results.push(await run('share-classes', 'scripts/nav/parse-share-class.js'));
    results.push(await run('fund-nav', 'scripts/nav/crawl-eastmoney-nav.js', ['--all', '--resume', '--concurrency', '5']));
    state.phase = 'building'; save();
    for (const [name, script] of [
      ['allfund','scripts/build-allfund-from-db.js'], ['feeder-index','scripts/build-feeder-index.js'],
      ['fund-stats','scripts/build-fund-stats.js'], ['trade-calendar','scripts/build-trade-calendar.js'],
    ]) {
      if (await run(name, script)) throw new Error(`Build failed: ${name}`);
    }
    state.coverage = coverage(); save();
    results.push(await run('health-check', 'scripts/nav/health-check.js', ['--out', 'data/public-refresh-health.md']));
    const gaps = Object.values(state.coverage).some(c => typeof c === 'object' && (c.missing || c.stale));
    state.phase = results.some(Boolean) || gaps ? 'finished_with_gaps' : 'complete';
    state.finishedAt = new Date().toISOString(); save();
    if (state.phase !== 'complete') process.exitCode = 1;
  } finally { fs.unlinkSync(lockPath); }
}

main().catch(error => {
  // Do not overwrite another active refresh's status when lock acquisition fails.
  if (state.stages.length || state.phase !== 'starting') {
    state.phase = 'failed'; state.error = error.message; save();
  }
  console.error(error); process.exitCode = 1;
});
