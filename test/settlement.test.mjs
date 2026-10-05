import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeSettlement, isUnsettled } from '../settlement.js';

const ex = (memberId, amount, extra = {}) => ({ memberId, amount, ...extra });

test('SPEC 4.4 example: 2 members (kt 450, usui 300)', () => {
  const r = computeSettlement([ex('kt', 150), ex('usui', 300), ex('kt', 300)], ['kt', 'usui']);
  assert.equal(r.total, 750);
  assert.equal(r.share, 375);
  assert.deepEqual(r.members, { kt: { paid: 450, balance: 75 }, usui: { paid: 300, balance: -75 } });
  assert.deepEqual(r.transfers, [{ from: 'usui', to: 'kt', amount: 75 }]);
});

test('SPEC 4.4 example: 3 members (A 1,000, B 200, C 0)', () => {
  const r = computeSettlement([ex('A', 1000), ex('B', 200)], ['A', 'B', 'C']);
  assert.equal(r.total, 1200);
  assert.equal(r.share, 400);
  assert.deepEqual(r.members, {
    A: { paid: 1000, balance: 600 },
    B: { paid: 200, balance: -200 },
    C: { paid: 0, balance: -400 },
  });
  assert.deepEqual(r.transfers, [
    { from: 'C', to: 'A', amount: 400 },
    { from: 'B', to: 'A', amount: 200 },
  ]);
});

test('SPEC 4.4 example: rounding (A 1,000, B 0, C 0), leftover 1 is dropped', () => {
  const r = computeSettlement([ex('A', 1000)], ['A', 'B', 'C']);
  assert.equal(r.total, 1000);
  assert.equal(r.share, 333);
  assert.deepEqual(r.members, {
    A: { paid: 1000, balance: 667 },
    B: { paid: 0, balance: -333 },
    C: { paid: 0, balance: -333 },
  });
  assert.deepEqual(r.transfers, [
    { from: 'B', to: 'A', amount: 333 },
    { from: 'C', to: 'A', amount: 333 },
  ]);
});

test('SPEC 4.4 example: own portion (usui pays 1,200, kt own 280)', () => {
  const r = computeSettlement([ex('usui', 1200, { own: { kt: 280 } })], ['kt', 'usui', 'M']);
  assert.equal(r.total, 1200);
  assert.equal(r.ownTotal, 280);
  assert.equal(r.share, 307);
  assert.deepEqual(r.members, {
    kt: { paid: 0, own: 280, balance: -587 },
    usui: { paid: 1200, balance: 893 },
    M: { paid: 0, balance: -307 },
  });
  assert.deepEqual(r.transfers, [
    { from: 'kt', to: 'usui', amount: 587 },
    { from: 'M', to: 'usui', amount: 306 },
  ]);
});

test('own portion equal to the whole expense: plain advance for one member', () => {
  const r = computeSettlement([ex('usui', 280, { own: { kt: 280 } })], ['kt', 'usui']);
  assert.equal(r.share, 0);
  assert.deepEqual(r.transfers, [{ from: 'kt', to: 'usui', amount: 280 }]);
});

test('own portions are ignored when invalid or larger than the expense', () => {
  const r1 = computeSettlement([ex('A', 100, { own: { B: 60, C: 50 } })], ['A', 'B', 'C']);
  assert.equal(r1.ownTotal, 0);
  assert.equal(r1.share, 33);
  const r2 = computeSettlement([ex('A', 100, { own: { X: 50, B: 0, C: 1.5 } })], ['A', 'B', 'C']);
  assert.equal(r2.ownTotal, 0);
  const r3 = computeSettlement([ex('A', 100, { own: { B: 40, X: 50 } })], ['A', 'B']);
  assert.equal(r3.ownTotal, 40);
  assert.equal(r3.share, 30);
  assert.deepEqual(r3.members.B, { paid: 0, own: 40, balance: -70 });
});

test('deleted and already settled expenses are excluded', () => {
  const r = computeSettlement(
    [
      ex('A', 100, { id: 'e1' }),
      ex('B', 999, { id: 'e2', deletedAt: 1 }),
      ex('B', 500, { id: 'e3', settlementId: 's1' }),
      ex('B', 100, { id: 'e4', deletedAt: null, settlementId: null }),
    ],
    ['A', 'B']
  );
  assert.equal(r.count, 2);
  assert.equal(r.total, 200);
  assert.deepEqual(r.expenseIds, ['e1', 'e4']);
  assert.deepEqual(r.transfers, []);
});

test('no expenses: nothing to transfer', () => {
  const r = computeSettlement([], ['A', 'B']);
  assert.equal(r.count, 0);
  assert.equal(r.total, 0);
  assert.deepEqual(r.transfers, []);
});

test('isUnsettled treats missing fields as null', () => {
  assert.equal(isUnsettled({ amount: 1 }), true);
  assert.equal(isUnsettled({ amount: 1, deletedAt: 5 }), false);
  assert.equal(isUnsettled({ amount: 1, settlementId: 'x' }), false);
});
