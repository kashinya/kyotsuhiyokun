// Settlement calculation (SPEC.md 4.4). Pure functions: no DOM, no Firebase.
// Used by the UI preview and inside the Firebase transaction, so both always agree.

// An expense belongs to the current period while it is neither deleted nor settled.
// Firebase drops null fields, so a missing field counts as null.
export function isUnsettled(e) {
  return !!e && e.deletedAt == null && e.settlementId == null;
}

// expenses: array of { id?, memberId, amount, deletedAt?, settlementId? }
// members:  array of member ids in join order (order decides ties)
// Returns { total, share, memberCount, count, expenseIds, members: { id: { paid, balance } }, transfers: [{ from, to, amount }] }
// expenseIds lists the ids of the expenses that were counted (only for expenses that carry an id).
export function computeSettlement(expenses, members) {
  const ids = members.slice();
  const paid = new Map(ids.map((id) => [id, 0]));
  const expenseIds = [];
  let total = 0;
  let count = 0;
  for (const e of expenses) {
    if (!isUnsettled(e) || !paid.has(e.memberId)) continue;
    const amount = Number(e.amount);
    if (!Number.isInteger(amount) || amount <= 0) continue;
    paid.set(e.memberId, paid.get(e.memberId) + amount);
    total += amount;
    count += 1;
    if (e.id != null) expenseIds.push(e.id);
  }
  const n = ids.length;
  const share = n ? Math.round(total / n) : 0;
  const result = { total, share, memberCount: n, count, expenseIds, members: {}, transfers: [] };
  const bal = ids.map((id) => ({ id, v: paid.get(id) - share }));
  for (const b of bal) result.members[b.id] = { paid: paid.get(b.id), balance: b.v };

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
