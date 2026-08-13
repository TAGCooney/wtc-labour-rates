import { match } from "../router.js";
import { json, error } from "../http.js";
import { requireSession } from "./staff.js";
import { getRateCategories } from "../rates.js";

const RATE_TYPE_LABELS = {
  AD: "Adult",
  JN: "Junior",
  AP: "Apprentice",
  AA: "Adult apprentice",
  TN: "Trainee",
  CA: "Casual (award-defined)",
};

export async function handleAwards(request, env, url) {
  const { pathname } = url;
  const method = request.method;

  const staff = await requireSession(request, env);
  if (!staff) return error("Not authenticated", 401);

  if (match("/api/staff/awards", pathname) && method === "GET") {
    const rows = await env.DB.prepare(
      `SELECT award_code, name, source_url, consolidated_to,
              casual_loading_pct, casual_loading_clause, casual_loading_confidence, casual_loading_note
       FROM awards ORDER BY name`
    ).all();
    return json(rows.results);
  }

  let m = match("/api/staff/awards/:code/classifications", pathname);
  if (m && method === "GET") {
    const rows = await env.DB.prepare(
      `SELECT base_pay_rate_id, employee_rate_type_code, parent_classification_name, classification,
              classification_level, base_rate, base_rate_type, calculated_rate, calculated_rate_type, display_order
       FROM classifications WHERE award_code = ? ORDER BY employee_rate_type_code, display_order`
    )
      .bind(m.code)
      .all();
    const withLabels = rows.results.map((r) => ({
      ...r,
      employee_rate_type_label: RATE_TYPE_LABELS[r.employee_rate_type_code] || r.employee_rate_type_code,
    }));
    return json(withLabels);
  }

  m = match("/api/staff/rates/:basePayRateId/categories", pathname);
  if (m && method === "GET") {
    const wantCasual = url.searchParams.get("casual") === "1";
    const fallbackPct = Number(url.searchParams.get("casualLoadingPct")) || 0;
    const result = await getRateCategories(env, m.basePayRateId, { wantCasual, fallbackPct });
    return json(result);
  }

  m = match("/api/staff/awards/:code/allowances", pathname);
  if (m && method === "GET") {
    const wage = await env.DB.prepare(
      `SELECT allowance, is_all_purpose, rate_percent, allowance_amount, rate_unit, payment_frequency
       FROM wage_allowances WHERE award_code = ? ORDER BY display_order`
    )
      .bind(m.code)
      .all();
    const expense = await env.DB.prepare(
      `SELECT allowance, allowance_amount, payment_frequency
       FROM expense_allowances WHERE award_code = ? ORDER BY display_order`
    )
      .bind(m.code)
      .all();
    return json({ wageAllowances: wage.results, expenseAllowances: expense.results });
  }

  return error("Not found", 404);
}
