/**
 * Unit tests for nav-api ETag helpers (P1.C).
 *
 * 跑：npm test
 *
 * 覆盖：
 *   - computeETag 决定性、稳定、对正常字符串敏感
 *   - ifNoneMatchHits 处理多值 / 通配 / weak/strong 等价
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeETag, ifNoneMatchHits } from './nav-api.js';

/* ============== computeETag ============== */

test('computeETag: deterministic for identical input', () => {
  const a = computeETag('{"a":1,"b":2}');
  const b = computeETag('{"a":1,"b":2}');
  assert.equal(a, b);
});

test('computeETag: differs for different input', () => {
  const a = computeETag('{"a":1}');
  const b = computeETag('{"a":2}');
  assert.notEqual(a, b);
});

test('computeETag: format is W/"<8-hex>"', () => {
  const e = computeETag('hello world');
  assert.match(e, /^W\/"[0-9a-f]{8}"$/);
});

test('computeETag: handles empty string', () => {
  const e = computeETag('');
  // FNV offset basis = 0x811c9dc5
  assert.equal(e, 'W/"811c9dc5"');
});

test('computeETag: known reference vector', () => {
  // FNV-1a 32-bit("a") = 0xe40c292c
  assert.equal(computeETag('a'), 'W/"e40c292c"');
  // FNV-1a 32-bit("foobar") = 0xbf9cf968
  assert.equal(computeETag('foobar'), 'W/"bf9cf968"');
});

test('computeETag: stable across small unicode (no high-byte loss)', () => {
  // charCodeAt 直接取 UTF-16 单元；只要 hash 决定性即可。
  const a = computeETag('中文测试');
  const b = computeETag('中文测试');
  assert.equal(a, b);
  assert.match(a, /^W\/"[0-9a-f]{8}"$/);
});

/* ============== ifNoneMatchHits ============== */

test('ifNoneMatchHits: undefined / empty header returns false', () => {
  assert.equal(ifNoneMatchHits(undefined, 'W/"abc"'), false);
  assert.equal(ifNoneMatchHits('', 'W/"abc"'), false);
});

test('ifNoneMatchHits: exact match', () => {
  assert.equal(ifNoneMatchHits('W/"abc"', 'W/"abc"'), true);
});

test('ifNoneMatchHits: wildcard *', () => {
  assert.equal(ifNoneMatchHits('*', 'W/"abc"'), true);
});

test('ifNoneMatchHits: weak vs strong equivalence', () => {
  // 客户端发回 strong，我们存的是 weak
  assert.equal(ifNoneMatchHits('"abc"', 'W/"abc"'), true);
  // 反过来
  assert.equal(ifNoneMatchHits('W/"abc"', '"abc"'), true);
});

test('ifNoneMatchHits: multi-value list, one match', () => {
  assert.equal(ifNoneMatchHits('W/"old", W/"new", W/"abc"', 'W/"abc"'), true);
});

test('ifNoneMatchHits: multi-value list, no match', () => {
  assert.equal(ifNoneMatchHits('W/"old", W/"new"', 'W/"abc"'), false);
});

test('ifNoneMatchHits: tolerates whitespace', () => {
  assert.equal(ifNoneMatchHits('  W/"abc"  ', 'W/"abc"'), true);
});

test('ifNoneMatchHits: empty etag arg returns false', () => {
  assert.equal(ifNoneMatchHits('W/"abc"', ''), false);
  assert.equal(ifNoneMatchHits('W/"abc"', undefined), false);
});
