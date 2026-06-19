// ============================================================
// MoneyIn — Settlement logic
// Mirrors DivAid's core/utils/group_settlement.dart
// ============================================================

/**
 * Computes each member's balance in a group: sum(paid) - sum(share).
 * Positive = they are owed money. Negative = they owe money.
 * @param {Array} expenses - list of expense docs ({paidBy, splitBetween})
 * @param {Array} memberIds - all member uids in the group
 * @returns {Object} map uid -> balance (number)
 */
export function computeBalances(expenses, memberIds) {
  const balances = {};
  memberIds.forEach(id => { balances[id] = 0; });

  for (const exp of expenses) {
    const paidBy = exp.paidBy || {};
    const splitBetween = exp.splitBetween || {};

    for (const [uid, amount] of Object.entries(paidBy)) {
      balances[uid] = (balances[uid] || 0) + amount;
    }
    for (const [uid, amount] of Object.entries(splitBetween)) {
      balances[uid] = (balances[uid] || 0) - amount;
    }
  }

  // Round to avoid floating point dust
  for (const uid of Object.keys(balances)) {
    balances[uid] = Math.round(balances[uid] * 100) / 100;
  }
  return balances;
}

/**
 * Greedy debt-simplification: repeatedly match the largest debtor
 * with the largest creditor until all balances are ~0.
 * @param {Object} balances - map uid -> balance
 * @returns {Array} list of {from, to, amount}
 */
export function suggestSettlements(balances) {
  const creditors = [];
  const debtors = [];

  for (const [uid, balance] of Object.entries(balances)) {
    if (balance > 0.005) creditors.push({ uid, amount: balance });
    else if (balance < -0.005) debtors.push({ uid, amount: -balance });
  }

  creditors.sort((a, b) => b.amount - a.amount);
  debtors.sort((a, b) => b.amount - a.amount);

  const payments = [];
  let ci = 0, di = 0;

  while (ci < creditors.length && di < debtors.length) {
    const creditor = creditors[ci];
    const debtor = debtors[di];
    const amount = Math.min(creditor.amount, debtor.amount);

    if (amount > 0.005) {
      payments.push({
        from: debtor.uid,
        to: creditor.uid,
        amount: Math.round(amount * 100) / 100
      });
    }

    creditor.amount -= amount;
    debtor.amount -= amount;

    if (creditor.amount <= 0.005) ci++;
    if (debtor.amount <= 0.005) di++;
  }

  return payments;
}
