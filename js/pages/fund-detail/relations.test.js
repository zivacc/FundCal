import test from 'node:test';
import assert from 'node:assert/strict';
import { createFundRelations } from './relations.js';

const empty = { shareClasses: [], feederFunds: [], isFof: false };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const container = () => ({ hidden: false, innerHTML: '', addEventListener() {}, querySelector() { return null; } });

test('late relationship responses cannot replace the next selected fund or the empty state', async () => {
  const first = deferred();
  const second = deferred();
  const element = container();
  const view = createFundRelations(element, { fetchRelations: code => code === '000001' ? first.promise : second.promise });
  const loadA = view.load('000001');
  const loadB = view.load('000002');
  second.resolve(empty);
  await loadB;
  const rendered = element.innerHTML;
  first.resolve({ ...empty, isFof: true });
  await loadA;
  assert.equal(element.innerHTML, rendered);
  assert.equal(element.innerHTML.includes('FOF'), false);
  const pending = deferred();
  const next = createFundRelations(element, { fetchRelations: () => pending.promise });
  const loading = next.load('000003');
  await next.load('');
  pending.resolve(empty);
  await loading;
  assert.equal(element.innerHTML, '');
  assert.equal(element.hidden, true);
});

test('a failed related request leaves a retry control without hiding fund details', async () => {
  const element = container();
  const view = createFundRelations(element, { fetchRelations: async () => { throw new Error('offline'); } });
  await view.load('000001');
  assert.match(element.innerHTML, /data-retry-relations/);
  assert.equal(element.hidden, false);
});
