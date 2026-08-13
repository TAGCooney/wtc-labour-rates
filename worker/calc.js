// Rate build-up: award rate (blended from entered hours x official penalty-category
// rates) -> on-costs (super/payroll tax/WorkCover, floored at 22.7%) -> margin.

export const ONCOST_FLOOR_PCT = 22.7;
export const DEFAULT_MARGIN_PCT = 15;

// roster: [{ penaltyDescription, hours }], rateRows: penalty_rates rows for the
// chosen classification + casual/permanent split (from GET .../categories),
// each with { penalty_description, calculated_value }. Any casual loading is
// already baked into calculated_value by that endpoint -- this function never
// applies a loading itself, so it can't be double-applied.
export function blendAwardRate(roster, rateRows) {
  const rateByCategory = new Map(rateRows.map((r) => [r.penalty_description, r.calculated_value]));
  let totalPay = 0;
  let totalHours = 0;
  const lines = [];
  for (const line of roster) {
    const hours = Number(line.hours) || 0;
    if (hours <= 0) continue;
    const rate = rateByCategory.get(line.penaltyDescription);
    if (rate == null) {
      throw new Error(`No rate found for category "${line.penaltyDescription}" on this classification`);
    }
    totalPay += rate * hours;
    totalHours += hours;
    lines.push({ penaltyDescription: line.penaltyDescription, hours, loadedRate: rate, lineTotal: rate * hours });
  }
  if (totalHours <= 0) throw new Error("Roster has no hours entered");
  return { lines, totalHours, totalPay, blendedAwardRate: totalPay / totalHours };
}

export function applyOncostAndMargin(blendedAwardRate, oncostPct, marginPct) {
  if (oncostPct < ONCOST_FLOOR_PCT) {
    throw new Error(`On-cost % cannot be below the ${ONCOST_FLOOR_PCT}% floor (super + payroll tax + WorkCover)`);
  }
  const costRate = blendedAwardRate * (1 + oncostPct / 100);
  const chargeRate = costRate * (1 + (Number(marginPct) || 0) / 100);
  return { costRate, chargeRate };
}
