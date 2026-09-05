import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { once } from 'node:events';
import { createStaticServer } from './serve-static.js';

test('static server exposes only application assets, for GET and HEAD', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'fundcal-static-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const file of ['index.html', 'js/core/router.js', 'js/private.test.js', 'css/main.css', 'data/allfund/search-index.json',
    'data/allfund/funds/000001.json', 'data/fundcal.db', 'data/fundcal.db-wal', '.git/config', '.env', 'scripts/nav/db.js',
    'docs/audit.md', 'data/morningstar_full_fund_fee/raw.xlsx']) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), 'fixture');
  }
  await symlink(path.join(root, 'data/fundcal.db'), path.join(root, 'js/secret.js'));
  const server = createStaticServer({ root });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const request = (url, method = 'GET', headers = {}) => new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: server.address().port, path: url, method, headers, agent: false }, res => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject); req.end();
  });
  for (const url of ['/', '/index.html', '/js/core/router.js', '/css/main.css', '/data/allfund/search-index.json', '/data/allfund/funds/000001.json']) {
    assert.equal((await request(url)).status, 200, url);
    const head = await request(url, 'HEAD');
    assert.equal(head.status, 200, url);
    assert.equal(head.body, '');
    assert.equal((await request(url, 'GET', { 'If-None-Match': head.headers.etag })).status, 304);
  }
  for (const url of ['/data/fundcal.db', '/data/fundcal.db-wal', '/.git/config', '/.env', '/scripts/nav/db.js', '/docs/audit.md',
    '/data/morningstar_full_fund_fee/raw.xlsx', '/data/', '/js/', '/js/private.test.js', '/js/secret.js', '/js/../scripts/nav/db.js',
    '/js/%2e%2e/scripts/nav/db.js', '/js/%5c..%5csecret.js']) {
    for (const method of ['GET', 'HEAD']) assert.equal((await request(url, method)).status, 404, `${method} ${url}`);
  }
  assert.equal((await request('/%')).status, 400);
  assert.equal((await request('/', 'POST')).status, 405);
});
