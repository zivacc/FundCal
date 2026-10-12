import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { once } from 'node:events';
import http from 'node:http';
import Database from 'better-sqlite3';
import { prepare, sha256 } from './prepare-mini-db.mjs';
import { fingerprint } from './sqlite-content-fingerprint.mjs';
import { createTransferServer } from './mini-db-transfer-server.mjs';

async function fixture(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'fundcal-db-sync-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}
test('snapshot includes committed WAL data and carries verified transfer hashes', async t => {
  const root = await fixture(t), source = path.join(root, 'live.db'), out = path.join(root, 'out');
  const writer = new Database(source);
  writer.pragma('journal_mode=WAL'); writer.pragma('wal_autocheckpoint=0');
  writer.exec('CREATE TABLE items (id INTEGER PRIMARY KEY, value TEXT); INSERT INTO items VALUES (1, \'from WAL\');');
  t.after(() => writer.close());
  assert.ok((await fs.stat(`${source}-wal`)).size > 0);
  const manifest = await prepare({ source, out });
  assert.equal(manifest.snapshot.counts.items, 1);
  assert.equal(manifest.snapshot.sha256, await sha256(path.join(out, 'fundcal.db')));
  const decompressed = path.join(root, 'restored.db');
  await fs.writeFile(decompressed, gunzipSync(await fs.readFile(path.join(out, 'fundcal.db.gz'))));
  assert.equal(await sha256(decompressed), manifest.snapshot.sha256);
  assert.deepEqual(fingerprint(source), fingerprint(decompressed));
  const plainOut = path.join(root, 'plain');
  const plain = await prepare({ source, out: plainOut, gzip: false });
  assert.equal(plain.transfer.file, 'fundcal.db');
  assert.equal(plain.transfer.sha256, plain.snapshot.sha256);
  await assert.rejects(fs.stat(path.join(plainOut, 'fundcal.db.gz')), { code: 'ENOENT' });
  await assert.rejects(prepare({ source, out }), /snapshot already exists/);
  writer.exec("UPDATE items SET value='changed on receiver' WHERE id=1");
  assert.notDeepEqual(fingerprint(source), fingerprint(decompressed), 'same row count cannot hide receiver changes');
});
test('transfer requires authentication, rejects private paths and symlinks, resumes exact byte ranges', async t => {
  const root = await fixture(t), token = 'ab'.repeat(32);
  await fs.writeFile(path.join(root, 'fundcal.db.gz'), '0123456789');
  await fs.writeFile(path.join(root, '.env'), 'secret');
  await fs.symlink(path.join(root, '.env'), path.join(root, 'manifest.json'));
  const server = createTransferServer({ root, token });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const request = (url, headers = {}, method = 'GET') => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: server.address().port, path: url, headers, method, agent: false }, res => {
      let body = ''; res.on('data', d => body += d); res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
    }); req.on('error', reject); req.end();
  });
  const auth = { Authorization: `Bearer ${token}` };
  assert.equal((await request('/fundcal.db.gz')).status, 401);
  assert.equal((await request('/fundcal.db.gz', { Authorization: 'Bearer invalid' })).status, 401);
  for (const url of ['/.env', '/../.env', '/%2e%2e/.env', '/fundcal.db', '/manifest.json', '/fundcal.db.gz?token=x']) assert.equal((await request(url, auth)).status, 404);
  assert.equal((await request('/fundcal.db.gz', auth, 'POST')).status, 405);
  const partial = await request('/fundcal.db.gz', { ...auth, Range: 'bytes=4-' });
  assert.equal(partial.status, 206); assert.equal(partial.body, '456789'); assert.equal(partial.headers['content-range'], 'bytes 4-9/10');
  for (const range of ['bytes=10-', 'bytes=5-3', 'bytes=0-99', 'bytes=0-1,3-4']) assert.equal((await request('/fundcal.db.gz', { ...auth, Range: range })).status, 416);
  const head = await request('/fundcal.db.gz', auth, 'HEAD'); assert.equal(head.status, 200); assert.equal(head.body, '');
});
