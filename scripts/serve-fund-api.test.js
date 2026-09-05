import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createApiServer } from './serve-fund-api.js';

async function startServer(t, routers = {}) {
  const server = createApiServer(routers);
  t.after(() => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return path => new Promise((resolve, reject) => {
    http.get({ hostname: '127.0.0.1', port: server.address().port, path, agent: false }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(body) }));
      res.on('error', reject);
    }).on('error', reject);
  });
}

function success(req, res) {
  res.end(JSON.stringify({ query: req.query }));
  return true;
}

test('malformed queries return 400 before any router or database work; server stays usable', async t => {
  let routed = 0;
  const route = (req, res) => { routed++; return success(req, res); };
  const request = await startServer(t, { fundRouter: route, navRouter: route });
  for (const path of ['/api/fund/list?q=%', '/api/nav/compare?codes=%E4%B8']) {
    const response = await request(path);
    assert.equal(response.status, 400);
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.deepEqual(response.body, { error: 'Invalid query encoding' });
  }
  assert.equal(routed, 0);
  const response = await request('/api/fund/list?q=%E6%B2%AA%E6%B7%B1+300&tag=a=b');
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.query, { q: '沪深 300', tag: 'a=b' });
  assert.equal(routed, 1);
});

for (const kind of ['fund', 'nav']) {
  test(`${kind} router async failure returns 500 and the next request succeeds`, async t => {
    const errors = [];
    let fail = true;
    const request = await startServer(t, {
      [`${kind}Router`]: async (req, res) => {
        await Promise.resolve();
        if (fail) { fail = false; throw new Error('private database path'); }
        return success(req, res);
      },
      onError: error => errors.push(error),
    });
    const response = await request(`/api/${kind}/test`);
    assert.equal(response.status, 500);
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.deepEqual(response.body, { error: 'Internal Server Error' });
    assert.equal(errors.length, 1);
    assert.equal(errors[0].message, 'private database path');
    assert.equal((await request(`/api/${kind}/test`)).status, 200);
  });
}

test('lookalike prefixes do not enter fund or NAV routers', async t => {
  let routed = 0;
  const route = () => { routed++; };
  const request = await startServer(t, { fundRouter: route, navRouter: route });
  for (const path of ['/api/fundamental', '/api/navigation', '/unknown']) {
    assert.equal((await request(path)).status, 404);
  }
  assert.equal(routed, 0);
});
