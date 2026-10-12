import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { protectedRuntimePath, runCommand, runDeployment, runWithLock, parseArguments } from './deploy-mini.mjs';

const labels = ['me.z-c.fundcal.static', 'me.z-c.fundcal.api'];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function fixture(t) {
  const base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'fundcal-deploy-test-')));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const repo = path.join(base, 'live');
  const source = path.join(base, 'source');
  const remote = path.join(base, 'remote.git');
  const stateDir = path.join(base, 'state');
  const gitAt = (cwd, args, options) => runCommand('/usr/bin/git', args, { cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }, ...options });
  await gitAt(base, ['init', '--bare', remote]);
  await gitAt(base, ['init', '-b', 'main', source]);
  await gitAt(source, ['config', 'user.name', 'Deploy Test']);
  await gitAt(source, ['config', 'user.email', 'deploy-test@example.invalid']);
  await fs.mkdir(path.join(source, 'scripts'));
  await fs.writeFile(path.join(source, 'package.json'), '{"type":"module","scripts":{"test":"node --test"}}\n');
  await fs.writeFile(path.join(source, 'package-lock.json'), '{"lockfileVersion":3}\n');
  for (const name of ['deploy-mini.mjs', 'serve-static.js', 'serve-fund-api.js']) await fs.writeFile(path.join(source, 'scripts', name), '// fixture\n');
  await fs.writeFile(path.join(source, '.gitignore'), 'node_modules/\n.env*\ndata/*.db*\nlocal-cache/\n');
  await fs.writeFile(path.join(source, 'version.txt'), 'baseline\n');
  await gitAt(source, ['add', '.']); await gitAt(source, ['commit', '-m', 'baseline']);
  await gitAt(source, ['remote', 'add', 'origin', remote]); await gitAt(source, ['push', 'origin', 'main']);
  await gitAt(base, ['clone', '--branch', 'main', remote, repo]);
  await gitAt(repo, ['config', 'user.name', 'Deploy Test']); await gitAt(repo, ['config', 'user.email', 'deploy-test@example.invalid']);
  await fs.mkdir(path.join(repo, 'data'));
  await fs.writeFile(path.join(repo, 'data/fundcal.db'), 'PRIVATE DATABASE');
  await fs.writeFile(path.join(repo, '.env.local'), 'PRIVATE CONFIG');
  await fs.mkdir(path.join(repo, 'node_modules')); await fs.writeFile(path.join(repo, 'node_modules/version.txt'), 'baseline dependencies');
  const baseline = (await gitAt(repo, ['rev-parse', 'HEAD'])).stdout.trim();
  const controls = { loaded: new Set(labels), npmFailure: null, failHealthFor: null, stoppedError: false, acceptedButStuck: false, unloadDelay: 0, unloading: new Map(), clock: Date.now(), commands: [], npmCalls: [], healthCalls: 0, portsClosedCalls: 0 };
  const options = { repo, stateDir, domain: 'gui/501', healthTimeoutMs: 0 };
  const io = {
    log: () => {}, now: () => controls.clock, sleep: async ms => { controls.clock += ms; }, healthTimeoutMs: 0, stopTimeoutMs: 1000,
    run: async (command, args, runOptions = {}) => {
      controls.commands.push({ command, args, cwd: runOptions.cwd });
      if (path.basename(command) === 'npm') {
        controls.npmCalls.push(args[0]);
        assert.ok(runOptions.env.PATH.startsWith(path.dirname(process.execPath)));
        assert.equal(runOptions.env.NODE_ENV, undefined);
        assert.equal(runOptions.env.npm_config_cache, path.join(stateDir, 'npm-cache'));
        if (controls.npmFailure === args[0]) throw new Error(`npm ${args[0]} failed`);
        if (args[0] === 'ci') {
          assert.ok(args.includes('--include=dev'));
          await fs.mkdir(path.join(runOptions.cwd, 'node_modules'));
          await fs.writeFile(path.join(runOptions.cwd, 'node_modules/version.txt'), await fs.readFile(path.join(runOptions.cwd, 'version.txt')));
        }
        return { code: 0, stdout: 'validation passed\n', stderr: '' };
      }
      if (path.basename(command) === 'launchctl') {
        const label = args.at(-1).split('/').at(-1).replace(/\.plist$/, '');
        if (args[0] === 'print') {
          if (controls.unloading.has(label)) {
            const left = controls.unloading.get(label);
            if (left > 0) controls.unloading.set(label, left - 1);
            else { controls.loaded.delete(label); controls.unloading.delete(label); }
          }
          return { code: controls.loaded.has(label) ? 0 : 113, stdout: '', stderr: '' };
        }
        if (args[0] === 'bootout') {
          if (controls.stoppedError && label === labels[1]) return { code: controls.acceptedButStuck ? 0 : 1, stdout: '', stderr: '' };
          if (controls.unloadDelay && !controls.unloading.has(label)) controls.unloading.set(label, controls.unloadDelay);
          else if (controls.unloadDelay) { /* a repeated request does not restart an in-flight unload */ }
          else controls.loaded.delete(label);
          return { code: 0, stdout: '', stderr: '' };
        }
        if (args[0] === 'bootstrap') controls.loaded.add(label);
        return { code: 0, stdout: '', stderr: '' };
      }
      return runCommand(command, args, runOptions);
    },
    portsClosed: async () => { controls.portsClosedCalls++; assert.equal(controls.loaded.size, 0); },
    health: async () => {
      controls.healthCalls++;
      assert.deepEqual([...controls.loaded].sort(), [...labels].sort());
      await assertPrivate();
      const liveHead = (await gitAt(repo, ['rev-parse', 'HEAD'])).stdout.trim();
      if (liveHead === controls.failHealthFor) throw new Error('new release unhealthy');
    },
  };
  const assertPrivate = async () => {
    assert.equal(await fs.readFile(path.join(repo, 'data/fundcal.db'), 'utf8'), 'PRIVATE DATABASE');
    assert.equal(await fs.readFile(path.join(repo, '.env.local'), 'utf8'), 'PRIVATE CONFIG');
  };
  const publish = async (changes = { 'version.txt': 'next release\n' }) => {
    for (const [name, value] of Object.entries(changes)) {
      const full = path.join(source, name);
      if (value === null) await fs.rm(full, { recursive: true, force: true });
      else { await fs.mkdir(path.dirname(full), { recursive: true }); await fs.writeFile(full, value); }
    }
    await gitAt(source, ['add', '--all']); await gitAt(source, ['commit', '-m', 'new release']); await gitAt(source, ['push', 'origin', 'main']);
    return (await gitAt(source, ['rev-parse', 'HEAD'])).stdout.trim();
  };
  const state = async () => JSON.parse(await fs.readFile(path.join(stateDir, 'state.json'), 'utf8'));
  const liveHead = async () => (await gitAt(repo, ['rev-parse', 'HEAD'])).stdout.trim();
  const initialize = () => runDeployment({ ...options, initialize: true }, io);
  return { base, repo, source, remote, stateDir, baseline, controls, options, io, gitAt, publish, state, liveHead, assertPrivate, initialize };
}

test('protected runtime names include case variants, credentials, databases and generated data', () => {
  for (const name of ['Data/FundCal.DB-WAL', '.ENV.production', 'output/report.html', 'nested/node_modules/a.js', '.agents/config.json', '.agents/skills/wind-mcp-skill/config.json', '.agents/skills/wind-mcp-skill/scripts/request-x.json', 'data/wind/result.json', 'data/repair-20261012/log.txt', 'data/morningstar_full_fund_fee/x.xlsx', 'data/allfund/funds/000001.json', 'data/public-refresh.lock', 'log/server.log', 'fundcal-tunnel.token']) assert.equal(protectedRuntimePath(name), true, name);
  for (const name of ['scripts/nav/db.js', 'package-lock.json', '.agents/skills/wind-mcp-skill/SKILL.md', 'data/allfund/search-index.json', 'docs/output-description.md']) assert.equal(protectedRuntimePath(name), false, name);
});

test('initialize and unchanged polls preserve private files and do not install or restart', async t => {
  const f = await fixture(t);
  assert.equal((await f.initialize()).status, 'initialized');
  const healthCalls = f.controls.healthCalls;
  assert.equal((await runDeployment(f.options, f.io)).status, 'unchanged');
  assert.equal(f.controls.healthCalls, healthCalls);
  assert.deepEqual(f.controls.npmCalls, []);
  assert.equal(f.controls.commands.some(c => c.args[0] === 'bootout'), false);
  assert.equal((await f.state()).lastSuccessful, f.baseline);
  assert.equal((await fs.stat(path.join(f.stateDir, 'state.json'))).mode & 0o777, 0o600);
  await f.assertPrivate();
});

test('healthy release validates in isolation, fast-forwards and swaps dependencies after stopping', async t => {
  const f = await fixture(t); await f.initialize();
  const target = await f.publish();
  const ordinary = path.join(f.repo, 'my-local-note.txt'); await fs.writeFile(ordinary, 'KEEP');
  assert.equal((await runDeployment(f.options, f.io)).status, 'deployed');
  assert.equal(await f.liveHead(), target);
  assert.equal(await fs.readFile(path.join(f.repo, 'node_modules/version.txt'), 'utf8'), 'next release\n');
  assert.equal(await fs.readFile(ordinary, 'utf8'), 'KEEP');
  const state = await f.state(); assert.equal(state.lastSuccessful, target); assert.equal(state.pending, null); assert.equal(state.failed, null);
  assert.deepEqual(f.controls.npmCalls, ['ci', 'test']);
  const validation = f.controls.commands.findIndex(c => path.basename(c.command) === 'npm' && c.args[0] === 'test');
  const stop = f.controls.commands.findIndex(c => c.args[0] === 'bootout');
  const merge = f.controls.commands.findIndex(c => c.args[0] === '-c' && c.args.includes('merge'));
  assert.ok(validation < stop && stop < merge);
  assert.equal(f.controls.portsClosedCalls, 1);
  assert.equal((await fs.readdir(f.stateDir)).some(name => name.startsWith('candidate-')), false);
  await f.assertPrivate();
});

for (const command of ['ci', 'test']) test(`${command} failure leaves live code, dependencies and services unchanged; retry backs off`, async t => {
  const f = await fixture(t); await f.initialize(); const target = await f.publish();
  f.controls.npmFailure = command;
  await assert.rejects(runDeployment(f.options, f.io), new RegExp(`npm ${command} failed`));
  assert.equal(await f.liveHead(), f.baseline);
  assert.equal(await fs.readFile(path.join(f.repo, 'node_modules/version.txt'), 'utf8'), 'baseline dependencies');
  assert.equal(f.controls.commands.some(c => c.args[0] === 'bootout'), false);
  const state = await f.state(); assert.equal(state.lastSuccessful, f.baseline); assert.equal(state.failed.target, target); assert.equal(state.pending, null);
  const calls = f.controls.npmCalls.length;
  assert.equal((await runDeployment(f.options, f.io)).status, 'backoff'); assert.equal(f.controls.npmCalls.length, calls);
  f.controls.npmFailure = null;
  assert.equal((await runDeployment({ ...f.options, retryNow: true }, f.io)).status, 'deployed');
  await f.assertPrivate();
});

test('health failure rolls back tracked code and dependencies and records failure, never false success', async t => {
  const f = await fixture(t); await f.initialize(); const target = await f.publish();
  f.controls.failHealthFor = target;
  await assert.rejects(runDeployment(f.options, f.io), /new release unhealthy/);
  assert.equal(await f.liveHead(), f.baseline);
  assert.equal(await fs.readFile(path.join(f.repo, 'node_modules/version.txt'), 'utf8'), 'baseline dependencies');
  const state = await f.state(); assert.equal(state.lastSuccessful, f.baseline); assert.equal(state.failed.target, target); assert.equal(state.pending, null);
  assert.deepEqual([...f.controls.loaded].sort(), [...labels].sort());
  assert.equal(f.controls.commands.some(c => c.args.includes('--hard') || c.args.includes('clean')), false);
  await f.assertPrivate();
});

test('partial bootout failure restores the already stopped agent without changing live code', async t => {
  const f = await fixture(t); await f.initialize(); await f.publish(); f.controls.stoppedError = true;
  await assert.rejects(runDeployment(f.options, f.io), /LaunchAgent did not stop/);
  assert.equal(await f.liveHead(), f.baseline);
  assert.deepEqual([...f.controls.loaded].sort(), [...labels].sort());
  assert.equal((await f.state()).pending, null);
  await f.assertPrivate();
});

test('acknowledged bootout waits for delayed job removal before activating code', async t => {
  const f = await fixture(t); await f.initialize(); const target = await f.publish(); f.controls.unloadDelay = 3;
  assert.equal((await runDeployment(f.options, f.io)).status, 'deployed');
  assert.equal(await f.liveHead(), target);
  assert.equal(f.controls.portsClosedCalls, 1);
  assert.deepEqual([...f.controls.loaded].sort(), [...labels].sort());
  const commands = f.controls.commands;
  const stop = commands.findIndex(c => c.args[0] === 'bootout');
  const otherStop = commands.findIndex((c, i) => i > stop && c.args[0] === 'bootout');
  const nextPrint = commands.findIndex((c, i) => i > stop && c.args[0] === 'print');
  assert.ok(otherStop > stop && nextPrint > otherStop, 'request both unloads before polling');
  assert.equal((await f.state()).pending, null); await f.assertPrivate();
});

test('accepted bootout that never removes its job cannot be mistaken for successful rollback', async t => {
  const f = await fixture(t); await f.initialize(); await f.publish();
  f.controls.stoppedError = true; f.controls.acceptedButStuck = true;
  await assert.rejects(runDeployment(f.options, f.io), /needs recovery/);
  assert.equal(await f.liveHead(), f.baseline);
  const state = await f.state(); assert.ok(state.pending); assert.ok(state.pending.unloading.includes(labels[1]));
  assert.deepEqual([...f.controls.loaded].sort(), [...labels].sort());
  assert.equal(f.controls.commands.some(c => c.args.includes('merge')), false);
  assert.equal(f.controls.portsClosedCalls, 0); await f.assertPrivate();
});

test('a late accepted unload finishes during rollback before healthy old jobs are recorded', async t => {
  const f = await fixture(t); await f.initialize(); await f.publish(); f.controls.unloadDelay = 5;
  await assert.rejects(runDeployment(f.options, f.io), /did not stop before the deadline/);
  assert.equal(await f.liveHead(), f.baseline);
  assert.equal(await fs.readFile(path.join(f.repo, 'node_modules/version.txt'), 'utf8'), 'baseline dependencies');
  const state = await f.state(); assert.equal(state.pending, null); assert.equal(state.lastSuccessful, f.baseline);
  assert.equal(f.controls.commands.filter(c => c.args[0] === 'bootstrap').length, 2);
  assert.deepEqual([...f.controls.loaded].sort(), [...labels].sort()); await f.assertPrivate();
});

test('dirty tracked/index state and non-fast-forward origin are rejected before validation', async t => {
  const f = await fixture(t); await f.initialize(); await f.publish();
  await fs.writeFile(path.join(f.repo, 'version.txt'), 'LOCAL CHANGE');
  await assert.rejects(runDeployment(f.options, f.io), /dirty/);
  await f.gitAt(f.repo, ['restore', 'version.txt']);
  await fs.writeFile(path.join(f.repo, 'local-commit.txt'), 'local commit'); await f.gitAt(f.repo, ['add', 'local-commit.txt']); await f.gitAt(f.repo, ['commit', '-m', 'local commit']);
  const localHead = await f.liveHead();
  await assert.rejects(runDeployment(f.options, f.io), /not a fast-forward/);
  assert.equal(await f.liveHead(), localHead); assert.deepEqual(f.controls.npmCalls, []); await f.assertPrivate();
});

test('an incoming tracked database or private config is rejected even when force-added to Git', async t => {
  const f = await fixture(t); await f.initialize();
  await fs.mkdir(path.join(f.source, '.agents')); await fs.writeFile(path.join(f.source, '.agents/config.json'), 'SHOULD NOT DEPLOY');
  await f.gitAt(f.source, ['add', '-f', '.agents/config.json']); await f.gitAt(f.source, ['commit', '-m', 'private file']); await f.gitAt(f.source, ['push', 'origin', 'main']);
  await assert.rejects(runDeployment(f.options, f.io), /protected runtime path/);
  assert.equal(await f.liveHead(), f.baseline); assert.deepEqual(f.controls.npmCalls, []); await f.assertPrivate();
});

test('new incoming path colliding with an ignored local file is not overwritten', async t => {
  const f = await fixture(t); await f.initialize();
  await fs.mkdir(path.join(f.repo, 'local-cache')); await fs.writeFile(path.join(f.repo, 'local-cache/keep.json'), 'PRIVATE UNTRACKED');
  await fs.mkdir(path.join(f.source, 'local-cache')); await fs.writeFile(path.join(f.source, 'local-cache/keep.json'), 'REMOTE');
  await f.gitAt(f.source, ['add', '-f', 'local-cache/keep.json']); await f.gitAt(f.source, ['commit', '-m', 'collision']); await f.gitAt(f.source, ['push', 'origin', 'main']);
  await assert.rejects(runDeployment(f.options, f.io), /replace local untracked content/);
  assert.equal(await fs.readFile(path.join(f.repo, 'local-cache/keep.json'), 'utf8'), 'PRIVATE UNTRACKED');
  assert.equal(await f.liveHead(), f.baseline); await f.assertPrivate();
});

test('new incoming file cannot replace a directory containing ignored descendants', async t => {
  const f = await fixture(t); await f.initialize();
  await fs.mkdir(path.join(f.repo, 'notes')); await fs.writeFile(path.join(f.repo, 'notes/private.txt'), 'KEEP');
  await f.publish({ notes: 'REMOTE FILE' });
  await assert.rejects(runDeployment(f.options, f.io), /replace local untracked content/);
  assert.equal(await fs.readFile(path.join(f.repo, 'notes/private.txt'), 'utf8'), 'KEEP'); await f.assertPrivate();
});

test('incoming paths cannot traverse an existing untracked symlink ancestor', async t => {
  const f = await fixture(t); await f.initialize();
  const external = path.join(f.base, 'external'); await fs.mkdir(external); await fs.writeFile(path.join(external, 'private.txt'), 'KEEP');
  await fs.symlink(external, path.join(f.repo, 'new-directory'));
  await f.publish({ 'new-directory/public.txt': 'REMOTE' });
  await assert.rejects(runDeployment(f.options, f.io), /symlink or non-directory ancestor/);
  assert.equal(await fs.readFile(path.join(external, 'private.txt'), 'utf8'), 'KEEP'); assert.deepEqual(await fs.readdir(external), ['private.txt']);
  await f.assertPrivate();
});

test('candidate symlinks into private data and deleting the polling entrypoint are rejected', async t => {
  const f = await fixture(t); await f.initialize();
  await fs.symlink('data/fundcal.db', path.join(f.source, 'db-link')); await f.gitAt(f.source, ['add', 'db-link']); await f.gitAt(f.source, ['commit', '-m', 'unsafe symlink']); await f.gitAt(f.source, ['push', 'origin', 'main']);
  await assert.rejects(runDeployment(f.options, f.io), /symlink points/);
  await fs.unlink(path.join(f.source, 'db-link'));
  await f.publish({ 'scripts/deploy-mini.mjs': null });
  await assert.rejects(runDeployment(f.options, f.io), /required deployment entrypoint/); await f.assertPrivate();
});

test('case-colliding directory prefixes are rejected on case-insensitive deployment filesystems', async t => {
  const f = await fixture(t); await f.initialize();
  const blob = (await f.gitAt(f.source, ['hash-object', '-w', '--stdin'], { input: 'new code\n' })).stdout.trim();
  // Index entries allow constructing the conflict even on a case-insensitive Mac.
  for (const name of ['js/a.js', 'JS/b.js']) await f.gitAt(f.source, ['update-index', '--add', '--cacheinfo', `100644,${blob},${name}`]);
  await f.gitAt(f.source, ['commit', '-m', 'case collision']); await f.gitAt(f.source, ['push', 'origin', 'main']);
  await assert.rejects(runDeployment(f.options, f.io), /case-colliding path prefixes/);
  assert.equal(await f.liveHead(), f.baseline); assert.deepEqual(f.controls.npmCalls, []); await f.assertPrivate();
});

test('new ignored paths are blocked even before any local file exists', async t => {
  const f = await fixture(t); await f.initialize();
  await fs.mkdir(path.join(f.source, 'local-cache')); await fs.writeFile(path.join(f.source, 'local-cache/new.json'), 'REMOTE');
  await f.gitAt(f.source, ['add', '-f', 'local-cache/new.json']); await f.gitAt(f.source, ['commit', '-m', 'force ignored path']); await f.gitAt(f.source, ['push', 'origin', 'main']);
  await assert.rejects(runDeployment(f.options, f.io), /locally ignored file/);
  assert.equal(await f.liveHead(), f.baseline); await f.assertPrivate();
});

test('interrupted activation with HEAD already updated recovers old code/deps before retry', async t => {
  const f = await fixture(t); await f.initialize(); const target = await f.publish();
  await f.gitAt(f.repo, ['fetch', 'origin']); await f.gitAt(f.repo, ['merge', '--ff-only', target]);
  const stageDir = await fs.mkdtemp(path.join(f.stateDir, 'candidate-')); await fs.mkdir(path.join(stageDir, 'release'));
  await fs.rename(path.join(f.repo, 'node_modules'), path.join(stageDir, 'previous-node_modules'));
  await fs.mkdir(path.join(f.repo, 'node_modules')); await fs.writeFile(path.join(f.repo, 'node_modules/version.txt'), 'candidate dependencies');
  const state = await f.state(); state.pending = { oldHead: f.baseline, target, stageDir, hadModules: true, phase: 'checking-health' };
  await fs.writeFile(path.join(f.stateDir, 'state.json'), JSON.stringify(state)); f.controls.loaded.clear();
  assert.equal((await runDeployment(f.options, f.io)).status, 'backoff');
  assert.equal(await f.liveHead(), f.baseline); assert.equal(await fs.readFile(path.join(f.repo, 'node_modules/version.txt'), 'utf8'), 'baseline dependencies');
  const recovered = await f.state(); assert.equal(recovered.lastSuccessful, f.baseline); assert.equal(recovered.pending, null); assert.equal(recovered.failed.target, target);
  assert.deepEqual(f.controls.npmCalls, []); await f.assertPrivate();
});

test('interrupted dependency swap after backup rename restores original modules while HEAD is updated', async t => {
  const f = await fixture(t); await f.initialize(); const target = await f.publish();
  await f.gitAt(f.repo, ['fetch', 'origin']); await f.gitAt(f.repo, ['merge', '--ff-only', target]);
  const stageDir = await fs.mkdtemp(path.join(f.stateDir, 'candidate-'));
  await fs.mkdir(path.join(stageDir, 'release/node_modules'), { recursive: true });
  await fs.writeFile(path.join(stageDir, 'release/node_modules/version.txt'), 'candidate dependencies');
  await fs.rename(path.join(f.repo, 'node_modules'), path.join(stageDir, 'previous-node_modules'));
  const state = await f.state(); state.pending = { oldHead: f.baseline, target, stageDir, hadModules: true, phase: 'code-updated' };
  await fs.writeFile(path.join(f.stateDir, 'state.json'), JSON.stringify(state)); f.controls.loaded.clear();
  assert.equal((await runDeployment(f.options, f.io)).status, 'backoff');
  assert.equal(await f.liveHead(), f.baseline);
  assert.equal(await fs.readFile(path.join(f.repo, 'node_modules/version.txt'), 'utf8'), 'baseline dependencies');
  assert.equal((await f.state()).pending, null); await f.assertPrivate();
});

test('pending staging symlinks are rejected before tracked rollback or dependency writes', async t => {
  const f = await fixture(t); await f.initialize(); const target = await f.publish();
  await f.gitAt(f.repo, ['fetch', 'origin']); await f.gitAt(f.repo, ['merge', '--ff-only', target]);
  const external = path.join(f.base, 'external-stage'); await fs.mkdir(path.join(external, 'release'), { recursive: true });
  await fs.writeFile(path.join(external, 'private.txt'), 'KEEP');
  const stageDir = path.join(f.stateDir, 'candidate-symlink'); await fs.symlink(external, stageDir);
  const state = await f.state(); state.pending = { oldHead: f.baseline, target, stageDir, hadModules: true, phase: 'code-updated' };
  await fs.writeFile(path.join(f.stateDir, 'state.json'), JSON.stringify(state));
  await assert.rejects(runDeployment(f.options, f.io), /recovery requires attention/);
  assert.equal(await f.liveHead(), target); assert.equal(await fs.readFile(path.join(external, 'private.txt'), 'utf8'), 'KEEP');
  assert.equal(await fs.readFile(path.join(f.repo, 'node_modules/version.txt'), 'utf8'), 'baseline dependencies'); await f.assertPrivate();
});

test('fresh-process recovery honors persisted unload intent before restoring old service jobs', async t => {
  const f = await fixture(t); await f.initialize(); const target = await f.publish();
  const stageDir = await fs.mkdtemp(path.join(f.stateDir, 'candidate-'));
  await fs.mkdir(path.join(stageDir, 'release/node_modules'), { recursive: true });
  const state = await f.state();
  state.pending = { oldHead: f.baseline, target, stageDir, hadModules: true, phase: 'prepared', unloading: [labels[0]] };
  await fs.writeFile(path.join(f.stateDir, 'state.json'), JSON.stringify(state));
  f.controls.unloadDelay = 2;
  assert.equal((await runDeployment(f.options, f.io)).status, 'backoff');
  assert.equal(await f.liveHead(), f.baseline);
  const stopped = f.controls.commands.findIndex(c => c.args[0] === 'bootout');
  const restored = f.controls.commands.findIndex(c => c.args[0] === 'bootstrap');
  assert.ok(stopped >= 0 && restored > stopped);
  assert.deepEqual([...f.controls.loaded].sort(), [...labels].sort());
  assert.equal((await f.state()).pending, null); await f.assertPrivate();
});

test('pending state outside the private staging directory is rejected without deleting anything', async t => {
  const f = await fixture(t); await f.initialize();
  const state = await f.state(); state.pending = { oldHead: f.baseline, target: f.baseline, stageDir: f.repo, hadModules: true };
  await fs.writeFile(path.join(f.stateDir, 'state.json'), JSON.stringify(state));
  await assert.rejects(runDeployment(f.options, f.io), /invalid pending deployment state/);
  assert.equal(await f.liveHead(), f.baseline); await f.assertPrivate();
});

test('state and node_modules symlinks are refused', async t => {
  const f = await fixture(t); await f.initialize(); await f.publish();
  await fs.rename(path.join(f.repo, 'node_modules'), path.join(f.base, 'external-modules')); await fs.symlink(path.join(f.base, 'external-modules'), path.join(f.repo, 'node_modules'));
  await assert.rejects(runDeployment(f.options, f.io), /dependency directory cannot be a symlink/);
  assert.equal(await fs.readFile(path.join(f.base, 'external-modules/version.txt'), 'utf8'), 'baseline dependencies');
  await assert.rejects(runDeployment({ ...f.options, stateDir: f.repo }, f.io), /state must be outside/); await f.assertPrivate();
});

test('CLI options reject ambiguous arguments and invalid ports', () => {
  assert.deepEqual(parseArguments(['--repo', '/tmp/a b', '--state-dir', '/tmp/state', '--initialize', '--retry-now', '--api-port', '3457']), { repo: '/tmp/a b', stateDir: '/tmp/state', initialize: true, retryNow: true, apiPort: 3457 });
  for (const args of [['--unknown'], ['--repo'], ['--api-port', '0'], ['--static-port', '65536']]) assert.throws(() => parseArguments(args));
});

test('macOS kernel lock prevents overlap and is reusable after owner termination', { skip: process.platform !== 'darwin' }, async t => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'fundcal-lock-test-')); t.after(() => fs.rm(base, { recursive: true, force: true }));
  const lock = path.join(base, 'deploy.lock'); const ready = path.join(base, 'ready.json');
  await fs.writeFile(lock, '', { mode: 0o600 });
  const owner = spawn('/usr/bin/lockf', ['-k', '-s', '-t', '0', lock, process.execPath, '-e', 'require("fs").writeFileSync(process.argv[1], JSON.stringify({pid:process.pid}));setTimeout(()=>{},30000)', ready], { stdio: 'ignore' });
  t.after(() => owner.kill('SIGTERM'));
  for (let i = 0; i < 100; i++) { try { await fs.access(ready); break; } catch { await pause(10); } }
  const pid = JSON.parse(await fs.readFile(ready, 'utf8')).pid;
  t.after(() => { try { process.kill(pid, 'SIGTERM'); } catch { /* already exited */ } });
  const blocked = await runWithLock(lock, process.execPath, ['-e', 'process.exit(0)']); assert.equal(blocked.busy, true);
  const exited = new Promise(resolve => owner.once('close', resolve)); process.kill(pid, 'SIGKILL'); await exited;
  assert.equal((await runWithLock(lock, process.execPath, ['-e', 'process.exit(0)'])).code, 0);
  assert.equal((await fs.stat(lock)).mode & 0o777, 0o600);
});

test('inherited kernel lock remains exclusive while an orphan mutating child survives its supervisor', { skip: process.platform !== 'darwin' }, async t => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'fundcal-orphan-lock-test-')); t.after(() => fs.rm(base, { recursive: true, force: true }));
  const lock = path.join(base, 'deploy.lock'); const ready = path.join(base, 'ready.json');
  const childCode = 'require("fs").writeFileSync(process.argv[1],JSON.stringify({pid:process.pid}));setTimeout(()=>{},30000)';
  const supervisorCode = 'const c=require("child_process").spawn(process.execPath,["-e",process.argv[1],process.argv[2]],{detached:true,stdio:["ignore","ignore","ignore",3]});c.unref();';
  assert.equal((await runWithLock(lock, process.execPath, ['-e', supervisorCode, childCode, ready])).code, 0);
  for (let i = 0; i < 100; i++) { try { await fs.access(ready); break; } catch { await pause(10); } }
  const pid = JSON.parse(await fs.readFile(ready, 'utf8')).pid;
  t.after(() => { try { process.kill(pid, 'SIGKILL'); } catch { /* already exited */ } });
  assert.equal((await runWithLock(lock, process.execPath, ['-e', 'process.exit(0)'])).busy, true);
  process.kill(pid, 'SIGKILL');
  let result;
  for (let i = 0; i < 100; i++) { result = await runWithLock(lock, process.execPath, ['-e', 'process.exit(0)']); if (!result.busy) break; await pause(10); }
  assert.equal(result.code, 0);
});
