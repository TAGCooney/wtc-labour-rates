// Rate build-up: award rate (blended from entered hours x official penalty-category
// rates) -> on-costs (super/payroll tax/WorkCover, floored at a configurable %) -> margin.
// The floor and default margin are owner-editable business settings stored in
// app_settings (see worker/settings.js), not constants -- these are just the
// values used if no settings row exists yet (should never happen post-migration).
export const FALLBACK_ONCOST_FLOOR_PCT = 22.7;
export const FALLBACK_DEFAULT_MARGIN_PCT = 15;

const isOvertimeClause = (clauseDescription) => /overtime/i.test(clauseDescription || "");

// roster: [{ penaltyDescription, hours }], rateRows: penalty_rates rows for the
// chosen classification + casual/permanent split (from GET .../categories),
// each with { penalty_description, clause_description, calculated_value }. Any
// casual loading is already baked into calculated_value by that endpoint --
// this function never applies a loading itself, so it can't be double-applied.
export function blendAwardRate(roster, rateRows) {
  const rowByCategory = new Map(rateRows.map((r) => [r.penalty_description, r]));
  let totalPay = 0;
  let totalHours = 0;
  const lines = [];
  for (const line of roster) {
    const hours = Number(line.hours) || 0;
    if (hours <= 0) continue;
    const row = rowByCategory.get(line.penaltyDescription);
    if (row == null) {
      throw new Error(`No rate found for category "${line.penaltyDescription}" on this classification`);
    }
    const rate = row.calculated_value;
    totalPay += rate * hours;
    totalHours += hours;
    lines.push({
      penaltyDescription: line.penaltyDescription,
      hours,
      loadedRate: rate,
      lineTotal: rate * hours,
      isOvertime: isOvertimeClause(row.clause_description),
    });
  }
  if (totalHours <= 0) throw new Error("Roster has no hours entered");
  return { lines, totalHours, totalPay, blendedAwardRate: totalPay / totalHours };
}

// selections: [{ allowance, quantity }], allowanceRows: this award's full
// allowance list (from getAllowanceRows) -- matched by exact allowance name so
// the dollar amount always comes from our data, never trusted from the client.
// The extra dollars are folded into totalPay (and so into blendedAwardRate)
// WITHOUT adding to totalHours, since these aren't extra hours worked -- this
// spreads the flat allowance evenly across the rostered hours, which is the
// right way to fold a flat $ amount into a $/hr charge rate.
export function applyAllowances(selections, allowanceRows, totalPay, totalHours) {
  const rowByName = new Map(allowanceRows.map((r) => [r.allowance, r]));
  const lines = [];
  let allowanceTotal = 0;
  for (const sel of selections || []) {
    const qty = Number(sel.quantity) || 0;
    if (qty <= 0) continue;
    const row = rowByName.get(sel.allowance);
    if (row == null) throw new Error(`Unknown allowance "${sel.allowance}" for this award`);
    const lineTotal = row.allowance_amount * qty;
    allowanceTotal += lineTotal;
    lines.push({ allowance: sel.allowance, quantity: qty, amount: row.allowance_amount, unit: row.payment_frequency, lineTotal });
  }
  const newTotalPay = totalPay + allowanceTotal;
  return { lines, allowanceTotal, totalPay: newTotalPay, blendedAwardRate: totalHours > 0 ? newTotalPay / totalHours : 0 };
}

export function applyOncostAndMargin(blendedAwardRate, oncostPct, marginPct, oncostFloorPct) {
  if (oncostPct < oncostFloorPct) {
    throw new Error(`On-cost % cannot be below the ${oncostFloorPct}% floor (super + payroll tax + WorkCover)`);
  }
  const costRate = blendedAwardRate * (1 + oncostPct / 100);
  const chargeRate = costRate * (1 + (Number(marginPct) || 0) / 100);
  return { costRate, chargeRate };
}
