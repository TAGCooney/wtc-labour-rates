// Shared by the /rates/:id/categories route and the quote calculator so both use
// the exact same casual/permanent split logic -- never reimplemented twice.

const isCasualClause = (r) => /casual/i.test(r.clause_description || "");

export async function getRateCategories(env, basePayRateId, { wantCasual, fallbackPct }) {
  const all = await env.DB.prepare(
    `SELECT penalty_description, clause_description, clauses, rate_percent, calculated_value, column_display_order
     FROM penalty_rates WHERE base_pay_rate_id = ? ORDER BY column_display_order`
  )
    .bind(basePayRateId)
    .all();

  const casualRows = all.results.filter(isCasualClause);
  const permanentRows = all.results.filter((r) => !isCasualClause(r));
  const hasCasualTable = casualRows.length > 0 && permanentRows.length > 0;
  const baseRows = permanentRows.length ? permanentRows : all.results;

  let rows;
  let usedFallbackLoading = false;
  if (wantCasual) {
    if (hasCasualTable) {
      rows = casualRows;
    } else {
      usedFallbackLoading = true;
      rows = baseRows.map((r) => ({
        ...r,
        calculated_value: Math.round(r.calculated_value * (1 + (Number(fallbackPct) || 0) / 100) * 100) / 100,
      }));
    }
  } else {
    rows = baseRows;
  }

  return { rows, hasCasualTable, usedFallbackLoading };
}
