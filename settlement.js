// Settlement calculation (SPEC.md 4.4). Pure functions: no DOM, no Firebase.
// Used by the UI preview and inside the Firebase transaction, so both always agree.

// An expense belongs to the current period while it is neither deleted nor settled.
// Firebase drops null fields, so a missing field counts as null.
export function isUnsettled(e) {
  return !!e && e.deletedAt == null && e.settlementId == null;
}

// Portions of an expense charged to one member only (SPEC.md 4.2): { memberId: amount }.
// Unknown members and non-positive or non-integer amounts are ignored; if the portions add up to
// more than the expense, they are all ignored and the whole expense is split equally.
export function ownPortions(e, memberIds) {
  const out = {};
  let sum = 0;
  for (const [id, v] of Object.entries(e?.own || {})) {
    const a = Number(v);
    if (!memberIds.has(id) || !Number.isInteger(a) || a <= 0) continue;
    out[id] = a;
    sum += a;
  }
  return sum <= Number(e?.amount) ? out : {};
}

// expenses: array of { id?, memberId, amount, own?, deletedAt?, settlementId? }
// members:  array of member ids in join order (order decides ties)
// Returns { total, ownTotal, share, memberCount, count, expenseIds,
//           members: { id: { paid, own?, balance } }, transfers: [{ from, to, amount }] }
// own is present only for members with own portions, so records without any stay as before.
// total includes the own portions; share is the equal split of total - ownTotal.
// expenseIds lists the ids of the expenses that were counted (only for expenses that carry an id).
export function computeSettlement(expenses, members) {
  const ids = members.slice();
  const idSet = new Set(ids);
  const paid = new Map(ids.map((id) => [id, 0]));
  const own = new Map(ids.map((id) => [id, 0]));
  const expenseIds = [];
  let total = 0;
  let ownTotal = 0;
  let count = 0;
  for (const e of expenses) {
    if (!isUnsettled(e) || !paid.has(e.memberId)) continue;
    const amount = Number(e.amount);
    if (!Number.isInteger(amount) || amount <= 0) continue;
    paid.set(e.memberId, paid.get(e.memberId) + amount);
    for (const [id, a] of Object.entries(ownPortions(e, idSet))) {
      own.set(id, own.get(id) + a);
      ownTotal += a;
    }
    total += amount;
    count += 1;
    if (e.id != null) expenseIds.push(e.id);
  }
  const n = ids.length;
  const share = n ? Math.round((total - ownTotal) / n) : 0;
  const result = { total, ownTotal, share, memberCount: n, count, expenseIds, members: {}, transfers: [] };
  const bal = ids.map((id) => ({ id, v: paid.get(id) - share - own.get(id) }));
  for (const b of bal) {
    const o = own.get(b.id);
    result.members[b.id] = o ? { paid: paid.get(b.id), own: o, balance: b.v } : { paid: paid.get(b.id), balance: b.v };
  }

  // Greedy: the most negative pays the most positive. Leftover rounding (< 1 per member) is dropped.
  for (;;) {
    let lo = null;
    let hi = null;
    for (const b of bal) {
      if (b.v <= -1 && (!lo || b.v < lo.v)) lo = b;
      if (b.v >= 1 && (!hi || b.v > hi.v)) hi = b;
    }
    if (!lo || !hi) break;
    const amount = Math.min(-lo.v, hi.v);
    result.transfers.push({ from: lo.id, to: hi.id, amount });
    lo.v += amount;
    hi.v -= amount;
  }
  return result;
}
