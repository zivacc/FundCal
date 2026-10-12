/**
 * Poll origin/main and activate a validated release on the Mac mini.
 * Private data/configuration are never copied into staging, cleaned, or reset.
 * The CLI serializes both scheduled and manual runs with macOS lockf.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import { fstatSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(import.meta.url);
const SHA = /^[a-f0-9]{40,64}$/;
const REQUIRED_FILES = ['package.json', 'package-lock.json', 'scripts/deploy-mini.mjs', 'scripts/serve-static.js', 'scripts/serve-fund-api.js'];

export function protectedRuntimePath(value) {
  const p = value.normalize('NFC').toLowerCase();
  const parts = p.split('/');
  if (parts.some(s => ['.git', 'node_modules', 'output', 'outputs', '.workbuddy', '.wrangler', '.kv-upload-tmp', '.vscode', '.idea'].includes(s))) return true;
  if (parts.some(s => /^\.env(?:\.|$)/.test(s) || /\.(?:db|sqlite|sqlite3)(?:-|$)/.test(s) || /\.(?:log|token)$/.test(s) || s === '.ds_store')) return true;
  return /^\.agents\/config\.json$/.test(p)
    || /^\.agents\/skills\/wind-[^/]+\/(?:config\.json|scripts\/(?:request-[^/]+\.json|update-state\.json|update\.lock))$/.test(p)
    || /^\.claude\/settings\.local\.json$/.test(p)
    || /^data\/(?:wind|funds|allfund\/funds|morningstar_full_fund_fee|repair-[^/]+)(?:\/|$)/.test(p)
    || /^data\/public-refresh[^/]*(?:\/|$)/.test(p)
    || /^data\/allfund\/(?:allfund\.json|list-index\.json|fund-stats-detail\.json|crawl-failures\.json)$/.test(p);
}

export function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd, env: options.env, shell: false, detached: true,
      stdio: [...(options.inherit ? ['ignore', 'inherit', 'inherit'] : ['pipe', 'pipe', 'pipe']), ...(options.lockFd === undefined ? [] : [options.lockFd])],
    });
    let stdout = '', stderr = '', size = 0, expired = false, outputExceeded = false;
    let forceTimer;
    const terminate = () => {
      try { process.kill(-child.pid, 'SIGTERM'); } catch { /* already exited */ }
      forceTimer = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already exited */ } }, 2000);
      forceTimer.unref();
    };
    const receive = (where, data) => {
      size += data.length;
      if (size > 16 * 1024 * 1024) { outputExceeded = true; terminate(); return; }
      if (where === 'stdout') stdout += data.toString(); else stderr += data.toString();
    };
    child.stdout?.on('data', d => receive('stdout', d));
    child.stderr?.on('data', d => receive('stderr', d));
    const timer = setTimeout(() => { expired = true; terminate(); }, options.timeoutMs ?? 120000);
    timer.unref();
    const onAbort = () => terminate();
    options.signal?.addEventListener('abort', onAbort, { once: true });
    if (options.signal?.aborted) terminate();
    child.on('error', () => {
      clearTimeout(timer); clearTimeout(forceTimer);
      options.signal?.removeEventListener('abort', onAbort);
      reject(new Error(`cannot start ${path.basename(command)}`));
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer); clearTimeout(forceTimer);
      options.signal?.removeEventListener('abort', onAbort);
      const result = { code: code ?? 1, stdout, stderr, signal };
      if (expired || outputExceeded || options.signal?.aborted || (!options.acceptFailure && result.code !== 0)) {
        const reason = expired ? 'timed out' : outputExceeded ? 'output limit exceeded' : options.signal?.aborted ? 'interrupted' : `exit ${result.code}`;
        // Git errors can contain authenticated remote URLs; do not log raw stderr.
        const error = new Error(`${path.basename(command)} ${reason}`);
        error.result = result;
        reject(error);
      } else resolve(result);
    });
    if (!options.inherit) child.stdin?.end(options.input);
  });
}

async function lstatOrNull(file) {
  try { return await fs.lstat(file); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}

async function privateDirectory(dir) {
  const current = await lstatOrNull(dir);
  if (current && (!current.isDirectory() || current.isSymbolicLink())) throw new Error('state directory must be an ordinary directory');
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  if (await fs.realpath(dir) !== path.resolve(dir)) throw new Error('state directory cannot contain symlink ancestors');
  await fs.chmod(dir, 0o700);
}

export async function runWithLock(lockFile, command, args, options = {}) {
  const stat = await lstatOrNull(lockFile);
  if (stat?.isSymbolicLink() || (stat && !stat.isFile())) throw new Error('lock file must be an ordinary file');
  const fd = await fs.open(lockFile, 'a+', 0o600);
  await fs.chmod(lockFile, 0o600);
  try {
    // Numeric-fd mode locks the shared open file description. The descriptor is
    // then inherited by the deployment and its mutating children, so even a
    // killed supervisor cannot unlock while an orphan git/npm command remains.
    // The inode is kept permanently; stale PID files and unlink races do not apply.
    const acquire = await (options.run ?? runCommand)('/usr/bin/lockf', ['-s', '-t', '0', '3'], {
      lockFd: fd.fd, acceptFailure: true, timeoutMs: 10000,
    });
    if (acquire.code === 75) return { ...acquire, busy: true };
    if (acquire.code !== 0) return acquire;
    return await (options.run ?? runCommand)(command, args, {
      ...options, lockFd: fd.fd, acceptFailure: true, timeoutMs: 40 * 60 * 1000,
    });
  } finally { await fd.close(); }
}

function settings(options) {
  const repo = path.resolve(options.repo ?? path.join(path.dirname(SCRIPT), '..'));
  const stateDir = path.resolve(options.stateDir ?? path.join(os.homedir(), '.local/state/FundCal/deploy'));
  if (stateDir === repo || stateDir.startsWith(`${repo}${path.sep}`)) throw new Error('deployment state must be outside the project');
  return {
    repo, stateDir, staticPort: options.staticPort ?? 3456, apiPort: options.apiPort ?? 3457,
    agentsDir: options.agentsDir ?? path.join(os.homedir(), 'Library/LaunchAgents'),
    domain: options.domain ?? `gui/${process.getuid()}`,
    initialize: options.initialize ?? false, retryNow: options.retryNow ?? false,
    node: process.execPath, npm: path.join(path.dirname(process.execPath), 'npm'),
    ...options, repo, stateDir,
  };
}

function safeError(error) {
  return String(error?.message ?? error).replace(/https?:\/\/[^\s]+/g, '[URL]').slice(0, 1000);
}

async function writeState(config, value) {
  const file = path.join(config.stateDir, 'state.json');
  if ((await lstatOrNull(file))?.isSymbolicLink()) throw new Error('state file cannot be a symlink');
  const temp = path.join(config.stateDir, `.state-${randomUUID()}.tmp`);
  const fd = await fs.open(temp, 'wx', 0o600);
  try { await fd.writeFile(`${JSON.stringify(value, null, 2)}\n`); await fd.sync(); } finally { await fd.close(); }
  await fs.rename(temp, file);
}

async function readState(config) {
  const file = path.join(config.stateDir, 'state.json');
  const stat = await lstatOrNull(file);
  if (!stat) return { version: 1, lastSuccessful: null, pending: null, failed: null };
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('state file must be an ordinary file');
  const state = JSON.parse(await fs.readFile(file, 'utf8'));
  if (state.version !== 1 || (state.lastSuccessful && !SHA.test(state.lastSuccessful))) throw new Error('invalid deployment state');
  if (state.pending) {
    const p = state.pending;
    if (!SHA.test(p.oldHead) || !SHA.test(p.target) || path.dirname(p.stageDir) !== config.stateDir || !path.basename(p.stageDir).startsWith('candidate-')) throw new Error('invalid pending deployment state');
    if (p.unloading !== undefined && (!Array.isArray(p.unloading) || p.unloading.some(label => !['me.z-c.fundcal.static', 'me.z-c.fundcal.api'].includes(label)))) throw new Error('invalid pending unload state');
  }
  return state;
}

async function directoryOrAbsent(file) {
  const stat = await lstatOrNull(file);
  if (stat && (!stat.isDirectory() || stat.isSymbolicLink())) throw new Error('dependency directory cannot be a symlink or file');
  return Boolean(stat);
}

function treeRecords(output) {
  return output.split('\0').filter(Boolean).map(record => {
    const tab = record.indexOf('\t');
    const [mode, type, object] = record.slice(0, tab).split(' ');
    return { mode, type, object, name: record.slice(tab + 1) };
  });
}

async function inspectTree(config, git, oldHead, target) {
  const [before, after] = await Promise.all([
    git(['ls-tree', '-r', '-z', '--full-tree', oldHead]), git(['ls-tree', '-r', '-z', '--full-tree', target]),
  ]);
  const oldFiles = new Set(treeRecords(before.stdout).map(row => row.name));
  if ([...oldFiles].some(protectedRuntimePath)) throw new Error('local tracked tree contains a protected runtime path');
  const rows = treeRecords(after.stdout);
  const names = new Map();
  const prefixes = new Map();
  for (const row of rows) {
    const folded = row.name.normalize('NFC').toLowerCase();
    if (names.has(folded)) throw new Error('candidate contains case-colliding paths');
    names.set(folded, row);
    if (row.type !== 'blob' || protectedRuntimePath(row.name)) throw new Error('candidate tracks a protected runtime path or submodule');
    const segments = row.name.split('/');
    if (segments.some(s => !s || s === '..' || s === '.') || path.isAbsolute(row.name)) throw new Error('unsafe candidate path');
    for (let count = 1; count <= segments.length; count++) {
      const prefix = segments.slice(0, count).join('/');
      const key = prefix.normalize('NFC').toLowerCase();
      if (prefixes.has(key) && prefixes.get(key) !== prefix) throw new Error('candidate contains case-colliding path prefixes');
      prefixes.set(key, prefix);
    }
    let ancestor = config.repo;
    for (const segment of segments.slice(0, -1)) {
      ancestor = path.join(ancestor, segment);
      const stat = await lstatOrNull(ancestor);
      if (stat && (!stat.isDirectory() || stat.isSymbolicLink())) throw new Error('candidate path has a symlink or non-directory ancestor');
    }
    // merge --ff-only may overwrite ignored files. Reject new destination paths
    // even when Git would accept them; this also protects directory descendants.
    if (!oldFiles.has(row.name) && await lstatOrNull(path.join(config.repo, row.name))) throw new Error('candidate would replace local untracked content');
    if (row.mode === '120000') {
      const link = (await git(['cat-file', 'blob', row.object])).stdout;
      const relative = path.posix.normalize(path.posix.join(path.posix.dirname(row.name), link));
      if (path.posix.isAbsolute(link) || relative === '..' || relative.startsWith('../') || protectedRuntimePath(relative)) throw new Error('candidate symlink points outside code or into runtime data');
    }
  }
  for (const file of REQUIRED_FILES) {
    const row = names.get(file);
    if (!row || row.name !== file || !['100644', '100755'].includes(row.mode)) throw new Error('candidate is missing a required deployment entrypoint');
  }
  const added = rows.filter(row => !oldFiles.has(row.name)).map(row => row.name);
  if (added.length) {
    const ignored = await git(['check-ignore', '--no-index', '-z', '--stdin'], { input: `${added.join('\0')}\0`, acceptFailure: true });
    if (ignored.code > 1) throw new Error('cannot check candidate against local ignore rules');
    if (ignored.stdout) throw new Error('candidate introduces a locally ignored file');
  }
  await directoryOrAbsent(path.join(config.repo, 'node_modules'));
}

async function portOpen(port) {
  return new Promise(resolve => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    const finish = value => { socket.destroy(); resolve(value); };
    socket.once('connect', () => finish(true)); socket.once('error', () => finish(false));
    socket.setTimeout(1000, () => finish(true));
  });
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function waitForPortsClosed(config) {
  const end = Date.now() + 15000;
  do {
    if (!(await portOpen(config.staticPort)) && !(await portOpen(config.apiPort))) return;
    await sleep(250);
  } while (Date.now() < end);
  throw new Error('service ports did not close');
}

export async function checkLocalHealth(config) {
  const read = async (port, url, method = 'GET') => fetch(`http://127.0.0.1:${port}${url}`, { method, signal: AbortSignal.timeout(5000), redirect: 'error' });
  const root = await read(config.staticPort, '/');
  if (root.status !== 200 || !root.headers.get('content-type')?.includes('text/html')) throw new Error('static health failed');
  await root.body?.cancel();
  const list = await read(config.apiPort, '/api/fund/list?page=1&size=1');
  if (list.status !== 200) throw new Error('API health failed');
  const body = await list.json();
  if (!Number.isInteger(body.total) || body.total < 1 || !Array.isArray(body.rows) || body.rows.length !== 1) throw new Error('API data health failed');
  for (const url of ['/data/fundcal.db', '/.env', '/.git/config', '/scripts/serve-fund-api.js']) {
    for (const method of ['GET', 'HEAD']) {
      const response = await read(config.staticPort, url, method);
      await response.body?.cancel();
      if (response.status !== 404) throw new Error('private resource access health failed');
    }
  }
}

/** runDeployment assumes its caller holds the kernel lock; exported for tests. */
export async function runDeployment(options = {}, io = {}) {
  const config = settings(options);
  if (Number(process.versions.node.split('.')[0]) !== 24) throw new Error('automatic deployment requires Node.js 24');
  await privateDirectory(config.stateDir);
  const commandRunner = io.run ?? runCommand;
  const run = (command, args, extra = {}) => commandRunner(command, args, { lockFd: config.lockFd, ...extra });
  const log = io.log ?? (message => console.log(`${new Date().toISOString()} ${message}`));
  const now = io.now ?? Date.now;
  const env = { ...process.env, PATH: `${path.dirname(config.node)}${path.delimiter}${process.env.PATH ?? ''}`, GIT_TERMINAL_PROMPT: '0', npm_config_cache: path.join(config.stateDir, 'npm-cache') };
  delete env.NODE_ENV;
  const git = (args, extra = {}) => run('/usr/bin/git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd: config.repo, env, timeoutMs: 120000, ...extra });
  const head = async () => (await git(['rev-parse', 'HEAD'])).stdout.trim();
  const assertClean = async () => {
    if ((await git(['symbolic-ref', '--short', 'HEAD'])).stdout.trim() !== 'main') throw new Error('deployment requires the main branch');
    if ((await git(['status', '--porcelain=v1', '-z', '--untracked-files=no'])).stdout) throw new Error('tracked working tree or index is dirty');
  };
  if (await fs.realpath(config.repo) !== config.repo || (await git(['rev-parse', '--show-toplevel'])).stdout.trim() !== config.repo) throw new Error('repository path must be its ordinary Git root');
  let state = await readState(config);
  const labels = ['me.z-c.fundcal.static', 'me.z-c.fundcal.api'];
  const unloading = new Set(state.pending?.unloading ?? []);
  const loaded = async label => (await run('/bin/launchctl', ['print', `${config.domain}/${label}`], { acceptFailure: true, timeoutMs: 10000 })).code === 0;
  const waitUnloaded = async selected => {
    const deadline = now() + (io.stopTimeoutMs ?? 30000);
    do {
      const statuses = await Promise.all(selected.map(async label => ({ label, loaded: await loaded(label) })));
      let changed = false;
      for (const status of statuses) if (!status.loaded && unloading.delete(status.label)) changed = true;
      if (changed && state.pending) { state.pending.unloading = [...unloading]; await writeState(config, state); }
      if (statuses.every(status => !status.loaded)) return;
      await (io.sleep ?? sleep)(250);
    } while (now() < deadline);
    throw new Error('LaunchAgent did not stop before the deadline');
  };
  const stop = async () => {
    for (const label of labels) {
      const wasUnloading = unloading.has(label);
      unloading.add(label);
      if (state.pending) { state.pending.unloading = [...unloading]; await writeState(config, state); }
      const result = await run('/bin/launchctl', ['bootout', `${config.domain}/${label}`], { acceptFailure: true, timeoutMs: 15000 });
      // bootout acknowledgement precedes job removal. Remember accepted requests
      // so rollback never mistakes a still-unloading old job for a restored one.
      if (result.code !== 0 && !wasUnloading) {
        unloading.delete(label);
        if (state.pending) { state.pending.unloading = [...unloading]; await writeState(config, state); }
      }
    }
    await waitUnloaded(labels);
    await (io.portsClosed ?? waitForPortsClosed)(config);
  };
  const start = async (allowLoaded = false) => {
    for (const label of labels) {
      if (unloading.has(label)) {
        // A persisted intent may precede the actual bootout when the supervisor
        // was killed. Reissue it before waiting, then load a fresh old-code job.
        await run('/bin/launchctl', ['bootout', `${config.domain}/${label}`], { acceptFailure: true, timeoutMs: 15000 });
        await waitUnloaded([label]);
      }
      if (await loaded(label)) {
        if (!allowLoaded) throw new Error('LaunchAgent was unexpectedly still loaded');
        continue;
      }
      await run('/bin/launchctl', ['bootstrap', config.domain, path.join(config.agentsDir, `${label}.plist`)], { timeoutMs: 15000 });
    }
  };
  const healthy = async () => {
    const deadline = now() + (io.healthTimeoutMs ?? 60000);
    let error;
    do {
      try {
        for (const label of labels) if (!(await loaded(label))) throw new Error('LaunchAgent is not loaded');
        await (io.health ?? checkLocalHealth)(config);
        return;
      } catch (e) { error = e; }
      await (io.sleep ?? sleep)(1000);
    } while (now() < deadline);
    throw error;
  };
  const fail = async (target, error) => {
    const attempts = state.failed?.target === target ? state.failed.attempts + 1 : 1;
    state.failed = { target, attempts, at: new Date(now()).toISOString(), retryAt: now() + Math.min(1800000, 300000 * 2 ** Math.min(attempts - 1, 8)), error: safeError(error) };
    await writeState(config, state);
  };
  const cleanStage = async dir => {
    if (path.dirname(dir) !== config.stateDir || !path.basename(dir).startsWith('candidate-')) throw new Error('unsafe staging cleanup path');
    const stat = await lstatOrNull(dir);
    if (stat && (!stat.isDirectory() || stat.isSymbolicLink())) throw new Error('staging directory must be ordinary');
    await fs.rm(dir, { recursive: true, force: true });
  };
  const rollback = async pending => {
    if (!(await directoryOrAbsent(pending.stageDir)) || !(await directoryOrAbsent(path.join(pending.stageDir, 'release')))) throw new Error('pending staging directories are missing or unsafe');
    const current = await head();
    await assertClean();
    if (current !== pending.oldHead && current !== pending.target) throw new Error('local HEAD changed during deployment; automatic rollback refused');
    const modules = path.join(config.repo, 'node_modules');
    const backup = path.join(pending.stageDir, 'previous-node_modules');
    const candidate = path.join(pending.stageDir, 'release/node_modules');
    const backupExists = await directoryOrAbsent(backup);
    const candidateExists = await directoryOrAbsent(candidate);
    const changed = current === pending.target || backupExists || (!pending.hadModules && !candidateExists);
    state.pending.phase = 'rolling-back'; await writeState(config, state);
    if (changed) {
      await stop();
      await assertClean();
      if (await head() !== current) throw new Error('local HEAD changed before rollback');
      if (current === pending.target) await git(['reset', '--keep', pending.oldHead]);
      if (backupExists) {
        if (await directoryOrAbsent(modules)) {
          if (candidateExists) throw new Error('ambiguous dependency recovery; backup preserved');
          await fs.rename(modules, candidate);
        }
        await fs.rename(backup, modules);
      } else if (!pending.hadModules && !candidateExists && await directoryOrAbsent(modules)) await fs.rename(modules, candidate);
    }
    await start(true);
    await healthy();
    state.lastSuccessful = pending.oldHead; state.pending = null;
    await writeState(config, state);
    await cleanStage(pending.stageDir);
    log(`rolled back code and dependencies to ${pending.oldHead.slice(0, 12)}; database/config unchanged`);
  };

  if (state.pending) {
    const pending = state.pending;
    log(`recovering interrupted deployment ${pending.target.slice(0, 12)}`);
    try {
      await rollback(pending);
      await fail(pending.target, new Error('previous deployment was interrupted'));
    } catch (error) {
      await fail(pending.target, error);
      throw new Error(`deployment recovery requires attention: ${safeError(error)}`);
    }
  }
  await assertClean();
  log('checking origin/main');
  await git(['fetch', '--quiet', '--no-tags', 'origin', '+refs/heads/main:refs/remotes/origin/main'], { timeoutMs: 90000 });
  const current = await head();
  const target = (await git(['rev-parse', 'refs/remotes/origin/main'])).stdout.trim();
  if (!SHA.test(target)) throw new Error('invalid origin/main commit');
  if (config.initialize && current !== target) throw new Error('initialize requires HEAD to match origin/main');
  if (current === target && state.lastSuccessful === target) return { status: 'unchanged', target };
  if (current === target && !state.lastSuccessful) {
    await healthy();
    state.lastSuccessful = target; state.failed = null; await writeState(config, state);
    log(`initialized healthy baseline ${target.slice(0, 12)}`);
    return { status: 'initialized', target };
  }
  if (state.failed?.target === target && !config.retryNow && now() < state.failed.retryAt) return { status: 'backoff', target, retryAt: state.failed.retryAt };
  if ((await git(['merge-base', '--is-ancestor', current, target], { acceptFailure: true })).code !== 0) throw new Error('origin/main is not a fast-forward of local main');
  let stageDir;
  try {
    await inspectTree(config, git, current, target);
    stageDir = await fs.mkdtemp(path.join(config.stateDir, 'candidate-'));
    await fs.chmod(stageDir, 0o700);
    const release = path.join(stageDir, 'release'); await fs.mkdir(release, { mode: 0o700 });
    const archive = path.join(stageDir, 'release.tar');
    await git(['archive', '--format=tar', `--output=${archive}`, target]);
    await run('/usr/bin/tar', ['-xf', archive, '-C', release], { timeoutMs: 120000 });
    await fs.unlink(archive);
    const validationFile = path.join(config.stateDir, 'validation.log');
    const validationStat = await lstatOrNull(validationFile);
    if (validationStat && (!validationStat.isFile() || validationStat.isSymbolicLink())) throw new Error('validation log must be an ordinary file');
    await fs.writeFile(validationFile, `${new Date(now()).toISOString()} candidate ${target}\n`, { mode: 0o600 });
    await fs.chmod(validationFile, 0o600);
    const npm = async args => {
      try {
        const result = await run(config.npm, args, { cwd: release, env, timeoutMs: 15 * 60 * 1000 });
        await fs.appendFile(validationFile, result.stdout + result.stderr);
      } catch (error) {
        if (error.result) await fs.appendFile(validationFile, error.result.stdout + error.result.stderr);
        throw error;
      }
    };
    log(`validating candidate ${target.slice(0, 12)} (npm ci and tests)`);
    await npm(['ci', '--include=dev', '--no-audit', '--no-fund']);
    await npm(['test']);
    await assertClean();
    if (await head() !== current) throw new Error('local HEAD changed while candidate was validated');
    // Recheck collisions and symlink ancestors immediately before activation.
    await inspectTree(config, git, current, target);
    const pending = { oldHead: current, target, stageDir, hadModules: await directoryOrAbsent(path.join(config.repo, 'node_modules')), phase: 'prepared' };
    state.pending = pending; await writeState(config, state);
    log(`activating ${target.slice(0, 12)}`);
    await stop();
    await assertClean();
    if (await head() !== current) throw new Error('local HEAD changed before activation');
    await git(['merge', '--ff-only', '--no-edit', target]);
    state.pending.phase = 'code-updated'; await writeState(config, state);
    if (pending.hadModules) await fs.rename(path.join(config.repo, 'node_modules'), path.join(stageDir, 'previous-node_modules'));
    await fs.rename(path.join(release, 'node_modules'), path.join(config.repo, 'node_modules'));
    state.pending.phase = 'dependencies-updated'; await writeState(config, state);
    await start();
    state.pending.phase = 'checking-health'; await writeState(config, state);
    await healthy();
    state.lastSuccessful = target; state.pending = null; state.failed = null;
    state.deployedAt = new Date(now()).toISOString(); await writeState(config, state);
    await cleanStage(stageDir);
    log(`deployed ${target.slice(0, 12)}; local health passed`);
    return { status: 'deployed', target };
  } catch (error) {
    const pending = state.pending;
    if (pending) {
      try { await rollback(pending); }
      catch (rollbackError) {
        await fail(target, new Error(`${safeError(error)}; rollback failed: ${safeError(rollbackError)}`));
        throw new Error(`deployment failed and needs recovery: ${safeError(rollbackError)}`);
      }
    } else if (stageDir) await cleanStage(stageDir);
    await fail(target, error);
    throw error;
  }
}

export function parseArguments(args) {
  const options = {};
  const strings = new Map([['--repo', 'repo'], ['--state-dir', 'stateDir'], ['--launch-agents-dir', 'agentsDir']]);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (strings.has(arg)) {
      if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`missing value for ${arg}`);
      options[strings.get(arg)] = args[++i];
    } else if (arg === '--static-port' || arg === '--api-port') {
      const number = Number(args[++i]);
      if (!Number.isInteger(number) || number < 1 || number > 65535) throw new Error('invalid service port');
      options[arg === '--static-port' ? 'staticPort' : 'apiPort'] = number;
    } else if (arg === '--initialize') options.initialize = true;
    else if (arg === '--retry-now') options.retryNow = true;
    else if (arg === '--locked') options.locked = true;
    else throw new Error(`unknown option ${arg}`);
  }
  return options;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const config = settings(options);
  if (process.platform !== 'darwin') throw new Error('this deployment CLI requires macOS');
  await privateDirectory(config.stateDir);
  if (!options.locked) {
    const result = await runWithLock(path.join(config.stateDir, 'deploy.lock'), process.execPath, [SCRIPT, ...process.argv.slice(2), '--locked'], { inherit: true });
    if (result.busy) console.log(`${new Date().toISOString()} skipped: another deployment holds the lock`);
    process.exitCode = result.busy ? 0 : result.code;
    return;
  }
  const inherited = fstatSync(3);
  const lock = await fs.lstat(path.join(config.stateDir, 'deploy.lock'));
  if (!inherited.isFile() || !lock.isFile() || inherited.ino !== lock.ino || inherited.dev !== lock.dev) throw new Error('internal locked entry requires the inherited deployment lock descriptor');
  const owner = path.join(config.stateDir, 'owner.json');
  const ownerStat = await lstatOrNull(owner);
  if (ownerStat && (!ownerStat.isFile() || ownerStat.isSymbolicLink())) throw new Error('owner file must be ordinary');
  await fs.writeFile(owner, `${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`, { mode: 0o600 });
  await fs.chmod(owner, 0o600);
  try { await runDeployment({ ...config, lockFd: 3 }); } finally { await fs.unlink(owner).catch(() => {}); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT) {
  main().catch(error => { console.error(`${new Date().toISOString()} deployment error: ${safeError(error)}`); process.exitCode = 1; });
}
