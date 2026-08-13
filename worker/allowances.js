// Splits an award's allowances into "common" (priced per hour/shift/day/occasion --
// scales with an actual roster, so likely relevant to a labour-hire booking) vs
// "other" (weekly/fixed items, deductions, apprentice-only entries -- rarer for a
// generic placement). This is a heuristic over payment_frequency/allowance text,
// not a manually curated per-award list, so it generalises across all 155 awards
// without per-award research. Rows with no usable dollar amount are dropped --
// they can't be entered as a quantity x $ line anyway.

const RELEVANT_FREQUENCY = /hour|shift|day|occasion|engagement/i;
const EXCLUDE_TEXT = /deduction|apprentice|trainee/i;

export async function getAllowanceRows(env, awardCode) {
  const wage = await env.DB.prepare(
    `SELECT allowance, allowance_amount, payment_frequency FROM wage_allowances WHERE award_code = ? ORDER BY display_order`
  )
    .bind(awardCode)
    .all();
  const expense = await env.DB.prepare(
    `SELECT allowance, allowance_amount, payment_frequency FROM expense_allowances WHERE award_code = ? ORDER BY display_order`
  )
    .bind(awardCode)
    .all();
  return [...wage.results, ...expense.results];
}

export function splitAllowances(rows) {
  const usable = rows.filter((r) => r.allowance_amount != null);
  const common = [];
  const other = [];
  for (const r of usable) {
    const isCommon = RELEVANT_FREQUENCY.test(r.payment_frequency || "") && !EXCLUDE_TEXT.test(r.allowance || "");
    (isCommon ? common : other).push(r);
  }
  return { common, other };
}
