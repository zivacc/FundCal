import test from 'node:test';
import assert from 'node:assert/strict';
import { createCrawlRunner } from './crawl-jobs.js';

test('crawl deduplicates same code, limits concurrent jobs and releases slots', async () => {
  const jobs = new Map();
  const crawl = createCrawlRunner(code => new Promise(resolve => jobs.set(code, resolve)));
  const first = crawl('000001');
  assert.equal(crawl('000001'), first);
  const second = crawl('000002');
  await assert.rejects(crawl('000003'), error => error.statusCode === 429);
  assert.equal(jobs.size, 2);
  jobs.get('000001')({ exitCode: 0 });
  assert.deepEqual(await first, { exitCode: 0 });
  const third = crawl('000003');
  await Promise.resolve();
  jobs.get('000002')({ exitCode: 0 });
  jobs.get('000003')({ exitCode: 0 });
  await Promise.all([second, third]);
});

test('failed crawl releases its slot and can be retried', async () => {
  let fail = true;
  const crawl = createCrawlRunner(() => { if (fail) { fail = false; throw new Error('failed'); } return 'ok'; }, { maxActive: 1 });
  await assert.rejects(crawl('000001'), /failed/);
  assert.equal(await crawl('000001'), 'ok');
});
