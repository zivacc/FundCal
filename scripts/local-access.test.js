import test from 'node:test';
import assert from 'node:assert/strict';
import { isLocalManagementRequest } from './local-access.js';

test('management accepts local browser and CLI, rejects remote and proxied requests', () => {
  const request = (headers = {}, remoteAddress = '127.0.0.1') => ({ socket: { remoteAddress }, headers: { host: 'localhost:3457', ...headers } });
  assert.equal(isLocalManagementRequest(request()), true);
  assert.equal(isLocalManagementRequest(request({ origin: 'http://localhost:3456' })), true);
  assert.equal(isLocalManagementRequest(request({ host: '[::1]:3457', origin: 'http://[::1]:3456' }, '::1')), true);
  assert.equal(isLocalManagementRequest(request({}, '192.168.1.2')), false);
  for (const headers of [{ host: 'fc.example' }, { origin: 'https://evil.example' }, { origin: 'null' }, { host: 'localhost.evil.example' },
    { 'cf-connecting-ip': '1.2.3.4' }, { 'x-forwarded-for': '127.0.0.1' }, { 'forwarded': 'for=127.0.0.1' }, { 'sec-fetch-site': 'cross-site' }]) {
    assert.equal(isLocalManagementRequest(request(headers)), false, JSON.stringify(headers));
  }
});
