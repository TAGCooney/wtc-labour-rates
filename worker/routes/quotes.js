import { match } from "../router.js";
import { json, error } from "../http.js";
import { requireSession } from "./staff.js";
import { blendAwardRate, applyOncostAndMargin } from "../calc.js";
import { getRateCategories } from "../rates.js";
import { getSettings } from "../settings.js";

function quoteRow(row) {
  return { ...row, roster: JSON.parse(row.roster_json), isCasual: !!row.is_casual };
}

export async function handleQuotes(request, env, url) {
  const { pathname } = url;
  const method = request.method;

  const staff = await requireSession(request, env);
  if (!staff) return error("Not authenticated", 401);

  // Preview a calculation without saving it — used as the user edits the roster.
  if (match("/api/staff/quotes/preview", pathname) && method === "POST") {
    const computed = await computeQuote(request, env);
    if (computed instanceof Response) return computed;
    return json(computed.result);
  }

  if (match("/api/staff/quotes", pathname) && method === "POST") {
    const computed = await computeQuote(request, env);
    if (computed instanceof Response) return computed;
    const { body, result } = computed;
    const row = await env.DB.prepare(
      `INSERT INTO quotes (
         staff_id, client_name, role_title, award_code, award_name, base_pay_rate_id, classification_name,
         employee_rate_type_code, is_casual, casual_loading_pct, casual_rate_source, oncost_pct, margin_pct, roster_json,
         blended_award_rate, cost_rate, charge_rate, notes
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`
    )
      .bind(
        staff.id,
        body.clientName,
        body.roleTitle || null,
        body.awardCode,
        body.awardName,
        body.basePayRateId,
        body.classificationName,
        body.employeeRateTypeCode,
        body.isCasual ? 1 : 0,
        result.usedFallbackLoading ? body.casualLoadingPct : null,
        result.casualRateSource,
        body.oncostPct,
        body.marginPct,
        JSON.stringify(result.lines),
        result.blendedAwardRate,
        result.costRate,
        result.chargeRate,
        body.notes || null
      )
      .first();
    return json(quoteRow(row), 201);
  }

  if (match("/api/staff/quotes", pathname) && method === "GET") {
    const rows = await env.DB.prepare(
      `SELECT q.*, s.name AS staff_name FROM quotes q
       JOIN staff_users s ON s.id = q.staff_id ORDER BY q.created_at DESC LIMIT 200`
    ).all();
    return json(rows.results.map(quoteRow));
  }

  let m = match("/api/staff/quotes/:id", pathname);
  if (m && method === "GET") {
    const row = await env.DB.prepare(
      `SELECT q.*, s.name AS staff_name FROM quotes q
       JOIN staff_users s ON s.id = q.staff_id WHERE q.id = ?`
    )
      .bind(m.id)
      .first();
    if (!row) return error("Not found", 404);
    return json(quoteRow(row));
  }

  return error("Not found", 404);
}

async function computeQuote(request, env) {
  const body = await request.json().catch(() => ({}));
  if (!body.basePayRateId || !body.awardCode) return error("basePayRateId and awardCode required");
  if (!Array.isArray(body.roster) || !body.roster.length) return error("roster required");

  const settings = await getSettings(env);
  const oncostPct = body.oncostPct != null ? Number(body.oncostPct) : settings.oncostFloorPct;
  const marginPct = body.marginPct != null ? Number(body.marginPct) : settings.defaultMarginPct;

  const { rows: rateRows, hasCasualTable, usedFallbackLoading } = await getRateCategories(env, body.basePayRateId, {
    wantCasual: !!body.isCasual,
    fallbackPct: body.casualLoadingPct,
  });
  if (!rateRows.length) return error("No rate categories found for this classification", 404);

  let blended;
  try {
    blended = blendAwardRate(body.roster, rateRows);
  } catch (e) {
    return error(e.message, 400);
  }

  let costAndCharge;
  try {
    costAndCharge = applyOncostAndMargin(blended.blendedAwardRate, oncostPct, marginPct, settings.oncostFloorPct);
  } catch (e) {
    return error(e.message, 400);
  }

  const casualRateSource = !body.isCasual ? "not_casual" : hasCasualTable ? "award_table" : "loading_fallback";

  const result = {
    lines: blended.lines,
    totalHours: blended.totalHours,
    totalPay: blended.totalPay,
    blendedAwardRate: blended.blendedAwardRate,
    oncostPct,
    marginPct,
    costRate: costAndCharge.costRate,
    chargeRate: costAndCharge.chargeRate,
    oncostFloorPct: settings.oncostFloorPct,
    hasCasualTable,
    usedFallbackLoading,
    casualRateSource,
  };

  return { body, result };
}
