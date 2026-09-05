import { spawn } from 'node:child_process';

/** 同代码共享执行结果；不同代码最多同时运行两个任务，不建立无界队列。 */
export function createCrawlRunner(run, { maxActive = 2 } = {}) {
  const active = new Map();
  return function crawl(code) {
    if (active.has(code)) return active.get(code);
    if (active.size >= maxActive) {
      const error = new Error('抓取任务繁忙，请稍后重试');
      error.statusCode = 429;
      return Promise.reject(error);
    }
    const work = Promise.resolve().then(() => run(code)).finally(() => active.delete(code));
    active.set(code, work);
    return work;
  };
}

export function runCrawlerProcess(script, code, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, code], { cwd, env: process.env });
    let stderr = '', timedOut = false, killTimer;
    child.stdout.resume();
    child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-2000); });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      killTimer = setTimeout(() => child.kill('SIGKILL'), 2000);
    }, 60_000);
    const cleanup = () => { clearTimeout(timer); clearTimeout(killTimer); };
    child.on('error', error => { cleanup(); reject(error); });
    child.on('close', exitCode => { cleanup(); resolve({ exitCode, stderr: timedOut ? '抓取超时' : stderr }); });
  });
}
