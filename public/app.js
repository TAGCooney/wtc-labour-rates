let ME = null;
let AWARDS = [];
let SELECTED_AWARD = null;
let CLASSIFICATIONS = [];
let SELECTED_CLASSIFICATION = null;
let RATE_CATEGORIES = [];
let RATE_INFO = { hasCasualTable: false, usedFallbackLoading: false };
let LAST_BREAKDOWN = null;
let SETTINGS = { oncostFloorPct: 22.7, defaultMarginPct: 15 };

const $ = (id) => document.getElementById(id);
const money = (n) => `$${Number(n).toFixed(2)}`;
const isOvertimeClause = (clauseDescription) => /overtime/i.test(clauseDescription || "");
const otBadge = (isOvertime) => (isOvertime ? '<span class="pill" style="color:var(--amber);border-color:var(--amber);margin-left:6px">OT</span>' : "");

async function api(path, opts) {
  const res = await fetch(path, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(opts && opts.headers) },
  });
  if (res.status === 401) {
    location.href = "/login.html";
    throw new Error("Not authenticated");
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || "Request failed");
  return body;
}

async function init() {
  try {
    ME = await api("/api/staff/me");
  } catch {
    return;
  }
  $("whoami").textContent = `${ME.name} (${ME.role})`;
  if (ME.mustChange) $("pwModalWrap").hidden = false;
  if (ME.role === "admin" || ME.role === "owner") {
    $("adminCard").hidden = false;
    if (ME.role === "owner") {
      $("newRole").innerHTML = `<option value="staff">Staff</option><option value="admin">Admin</option>`;
    }
    loadAccounts();
  }
  if (ME.role === "owner") {
    $("settingsCard").hidden = false;
  }

  SETTINGS = await api("/api/staff/settings");
  $("oncostPct").value = SETTINGS.oncostFloorPct;
  $("oncostPct").min = SETTINGS.oncostFloorPct;
  $("marginPct").value = SETTINGS.defaultMarginPct;
  $("settingOncostFloor").value = SETTINGS.oncostFloorPct;
  $("settingDefaultMargin").value = SETTINGS.defaultMarginPct;

  AWARDS = await api("/api/staff/awards");
  loadHistory();

  wireEvents();
}

function wireEvents() {
  $("logoutBtn").addEventListener("click", async () => {
    await api("/api/staff/logout", { method: "POST" });
    location.href = "/login.html";
  });

  $("changePwBtn").addEventListener("click", () => ($("pwModalWrap").hidden = false));
  $("pwSubmit").addEventListener("click", async () => {
    const password = $("newPw").value;
    try {
      await api("/api/staff/password", { method: "POST", body: JSON.stringify({ password }) });
      $("pwModalWrap").hidden = true;
    } catch (e) {
      $("pwErr").innerHTML = `<div class="notice error">${e.message}</div>`;
    }
  });

  $("awardSearch").addEventListener("input", onAwardSearch);
  $("awardSearch").addEventListener("focus", onAwardSearch);
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".autocomplete")) $("awardList").hidden = true;
  });

  $("rateTypeSelect").addEventListener("change", onRateTypeChange);
  $("classificationSelect").addEventListener("change", onClassificationChange);
  $("isCasual").addEventListener("change", loadRateCategories);
  $("casualLoadingPct").addEventListener("change", () => {
    if (RATE_INFO.usedFallbackLoading) loadRateCategories();
  });

  $("calcBtn").addEventListener("click", calculate);
  $("saveBtn").addEventListener("click", saveQuote);

  $("addAccountBtn").addEventListener("click", addAccount);
  $("saveSettingsBtn").addEventListener("click", saveSettings);
}

async function saveSettings() {
  try {
    SETTINGS = await api("/api/staff/settings", {
      method: "POST",
      body: JSON.stringify({
        oncostFloorPct: parseFloat($("settingOncostFloor").value),
        defaultMarginPct: parseFloat($("settingDefaultMargin").value),
      }),
    });
    $("oncostPct").min = SETTINGS.oncostFloorPct;
    $("settingsResult").innerHTML = `<div class="notice">Saved. New quotes will use these as the default.</div>`;
  } catch (e) {
    $("settingsResult").innerHTML = `<div class="notice error">${e.message}</div>`;
  }
}

// --- award search ---

function onAwardSearch() {
  const q = $("awardSearch").value.trim().toLowerCase();
  const list = $("awardList");
  if (!q) {
    list.hidden = true;
    return;
  }
  const matches = AWARDS.filter(
    (a) => a.award_code && ((a.name || "").toLowerCase().includes(q) || a.award_code.toLowerCase().includes(q))
  ).slice(0, 30);
  if (!matches.length) {
    list.hidden = true;
    return;
  }
  list.innerHTML = matches
    .map((a) => `<div data-code="${a.award_code}">${a.name} <span class="muted small">(${a.award_code})</span></div>`)
    .join("");
  list.hidden = false;
  list.querySelectorAll("div").forEach((el) => {
    el.addEventListener("click", () => selectAward(el.dataset.code));
  });
}

async function selectAward(code) {
  SELECTED_AWARD = AWARDS.find((a) => a.award_code === code);
  $("awardSearch").value = SELECTED_AWARD.name;
  $("awardList").hidden = true;
  renderAwardInfo();

  CLASSIFICATIONS = await api(`/api/staff/awards/${code}/classifications`);
  const RATE_TYPE_ORDER = ["AD", "JN", "CA", "TN", "AP", "AA"];
  const rateTypes = [...new Map(CLASSIFICATIONS.map((c) => [c.employee_rate_type_code, c.employee_rate_type_label])).entries()]
    .sort((a, b) => {
      const ai = RATE_TYPE_ORDER.indexOf(a[0]);
      const bi = RATE_TYPE_ORDER.indexOf(b[0]);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });
  $("rateTypeSelect").innerHTML = rateTypes.map(([code, label]) => `<option value="${code}">${label}</option>`).join("");
  onRateTypeChange();
  $("classificationSection").hidden = false;
  $("breakdown").innerHTML = "";
  $("saveBtn").disabled = true;
}

function renderAwardInfo() {
  const a = SELECTED_AWARD;
  const conf = a.casual_loading_confidence || "not_found";
  const pctText = a.casual_loading_pct != null ? `${a.casual_loading_pct}%` : "no single flat %";
  let noteHtml = `<div class="notice ${conf === "confirmed" ? "" : "warn"}">
    <span class="pill ${conf}">${conf.replace("_", " ")}</span>
    Fallback casual loading (only used if this classification has no official casual pay table below): <strong>${pctText}</strong>
    (${a.casual_loading_clause || "clause not identified"}). ${a.casual_loading_note ? `${a.casual_loading_note}.` : ""}
    Sourced from the award's own casual employment clause — confirm against the award before finalising if this placement involves heavy overtime/weekend work.
  </div>`;
  $("awardInfo").innerHTML = noteHtml;
  $("casualLoadingPct").value = a.casual_loading_pct != null ? a.casual_loading_pct : "";
}

function onRateTypeChange() {
  const rateType = $("rateTypeSelect").value;
  const opts = CLASSIFICATIONS.filter((c) => c.employee_rate_type_code === rateType);
  $("classificationSelect").innerHTML = opts
    .map(
      (c) =>
        `<option value="${c.base_pay_rate_id}">${c.parent_classification_name ? c.parent_classification_name + " — " : ""}${c.classification}${c.calculated_rate ? ` ($${c.calculated_rate.toFixed(2)}/hr)` : ""}</option>`
    )
    .join("");
  onClassificationChange();
}

async function onClassificationChange() {
  const bpr = $("classificationSelect").value;
  SELECTED_CLASSIFICATION = CLASSIFICATIONS.find((c) => c.base_pay_rate_id === bpr);
  await loadRateCategories();
}

async function loadRateCategories() {
  const priorHours = collectRosterHoursByCategory();
  const bpr = SELECTED_CLASSIFICATION && SELECTED_CLASSIFICATION.base_pay_rate_id;
  if (!bpr) {
    RATE_CATEGORIES = [];
    renderRoster();
    return;
  }
  const params = new URLSearchParams({
    casual: $("isCasual").checked ? "1" : "0",
    casualLoadingPct: $("casualLoadingPct").value || "0",
  });
  const res = await api(`/api/staff/rates/${bpr}/categories?${params}`);
  RATE_CATEGORIES = res.rows;
  RATE_INFO = { hasCasualTable: res.hasCasualTable, usedFallbackLoading: res.usedFallbackLoading };
  renderRoster(priorHours);
  $("breakdown").innerHTML = "";
  $("saveBtn").disabled = true;
}

function collectRosterHoursByCategory() {
  const map = {};
  document.querySelectorAll(".roster-hours").forEach((input) => {
    const cat = RATE_CATEGORIES[Number(input.dataset.idx)];
    if (cat && input.value) map[cat.penalty_description] = input.value;
  });
  return map;
}

function renderRoster(priorHours) {
  priorHours = priorHours || {};
  const section = $("rosterSection");
  $("casualLoadingPct").disabled = !($("isCasual").checked && RATE_INFO.usedFallbackLoading);

  let note = "";
  if ($("isCasual").checked) {
    note = RATE_INFO.hasCasualTable
      ? `<div class="notice">Using this award's own official casual pay table — rates below already include whatever casual arrangement the award defines.</div>`
      : `<div class="notice warn">This award/classification has no distinct casual pay table in the source data — applying the casual loading % above as a flat markup on the permanent rates instead. Confirm against the award if unsure.</div>`;
  }

  if (!RATE_CATEGORIES.length) {
    section.innerHTML = note;
    return;
  }
  section.innerHTML = `
    ${note}
    <label class="mt-8">Roster — enter hours worked in each applicable pay category. <span class="pill" style="color:var(--amber);border-color:var(--amber)">OT</span> marks overtime-rate categories.</label>
    <table>
      <thead><tr><th>Category</th><th>Clause</th><th class="num">Rate ($/hr)</th><th class="num" style="width:110px">Hours</th></tr></thead>
      <tbody>
        ${RATE_CATEGORIES.map(
          (r, i) => `<tr>
            <td>${r.penalty_description}${otBadge(isOvertimeClause(r.clause_description))}</td>
            <td class="muted small">${r.clauses || r.clause_description || ""}</td>
            <td class="num">${money(r.calculated_value)}</td>
            <td class="num"><input type="number" min="0" step="0.25" class="roster-hours" data-idx="${i}" value="${priorHours[r.penalty_description] || ""}" style="text-align:right"></td>
          </tr>`
        ).join("")}
      </tbody>
    </table>
  `;
}

function collectRoster() {
  const roster = [];
  document.querySelectorAll(".roster-hours").forEach((input) => {
    const hours = parseFloat(input.value);
    if (hours > 0) {
      const cat = RATE_CATEGORIES[Number(input.dataset.idx)];
      roster.push({ penaltyDescription: cat.penalty_description, hours });
    }
  });
  return roster;
}

async function calculate() {
  const roster = collectRoster();
  if (!roster.length) {
    $("breakdown").innerHTML = `<div class="notice error">Enter hours for at least one roster category.</div>`;
    return;
  }
  const payload = {
    awardCode: SELECTED_AWARD.award_code,
    basePayRateId: SELECTED_CLASSIFICATION.base_pay_rate_id,
    isCasual: $("isCasual").checked,
    casualLoadingPct: parseFloat($("casualLoadingPct").value) || 0,
    oncostPct: parseFloat($("oncostPct").value),
    marginPct: parseFloat($("marginPct").value),
    roster,
  };
  try {
    LAST_BREAKDOWN = await api("/api/staff/quotes/preview", { method: "POST", body: JSON.stringify(payload) });
    renderBreakdown(LAST_BREAKDOWN);
    $("saveBtn").disabled = false;
  } catch (e) {
    $("breakdown").innerHTML = `<div class="notice error">${e.message}</div>`;
    $("saveBtn").disabled = true;
  }
}

function renderBreakdown(b) {
  $("breakdown").innerHTML = `
    <h3 class="mt-8" style="margin-bottom:10px">Rate build-up</h3>
    <table>
      <thead><tr><th>Category</th><th class="num">Hours</th><th class="num">Rate ($/hr)</th><th class="num">Line total</th></tr></thead>
      <tbody>
        ${b.lines.map((l) => `<tr><td>${l.penaltyDescription}${otBadge(l.isOvertime)}</td><td class="num">${l.hours}</td><td class="num">${money(l.loadedRate)}</td><td class="num">${money(l.lineTotal)}</td></tr>`).join("")}
      </tbody>
    </table>
    <div class="row mt-8" style="gap:24px">
      <div class="breakdown-total"><span class="label">Blended award rate</span>${money(b.blendedAwardRate)}/hr</div>
      <div class="breakdown-total"><span class="label">Cost rate (+ ${b.oncostPct}% on-costs)</span>${money(b.costRate)}/hr</div>
      <div class="breakdown-total"><span class="label">Charge rate excl. GST (+ ${b.marginPct}% margin)</span>${money(b.chargeRate)}/hr</div>
    </div>
    <div class="small muted mt-8">Total rostered hours: ${b.totalHours} — total award pay: ${money(b.totalPay)}</div>
    <div class="small muted mt-8">Casual rate source: ${
      b.casualRateSource === "award_table"
        ? "award's own official casual pay table"
        : b.casualRateSource === "loading_fallback"
        ? "permanent rates + fallback casual loading %"
        : "not applicable (not a casual placement)"
    }</div>
  `;
}

async function saveQuote() {
  const clientName = $("clientName").value.trim();
  if (!clientName) {
    alert("Enter the employer / client name before saving.");
    return;
  }
  const roster = collectRoster();
  const payload = {
    clientName,
    roleTitle: $("roleTitle").value.trim(),
    awardCode: SELECTED_AWARD.award_code,
    awardName: SELECTED_AWARD.name,
    basePayRateId: SELECTED_CLASSIFICATION.base_pay_rate_id,
    classificationName: SELECTED_CLASSIFICATION.classification,
    employeeRateTypeCode: SELECTED_CLASSIFICATION.employee_rate_type_code,
    isCasual: $("isCasual").checked,
    casualLoadingPct: parseFloat($("casualLoadingPct").value) || 0,
    oncostPct: parseFloat($("oncostPct").value),
    marginPct: parseFloat($("marginPct").value),
    roster,
    notes: $("notes").value.trim(),
  };
  try {
    const quote = await api("/api/staff/quotes", { method: "POST", body: JSON.stringify(payload) });
    loadHistory();
    $("breakdown").innerHTML += `<div class="notice mt-8">Saved. <a href="/quote-print.html?id=${quote.id}" target="_blank">Open printable quote</a></div>`;
    $("saveBtn").disabled = true;
  } catch (e) {
    $("breakdown").innerHTML += `<div class="notice error mt-8">${e.message}</div>`;
  }
}

async function loadHistory() {
  const quotes = await api("/api/staff/quotes");
  $("history").innerHTML = quotes.length
    ? `<table>
        <thead><tr><th>Date</th><th>Client</th><th>Role</th><th>Award</th><th class="num">Charge rate (excl. GST)</th><th>By</th><th></th></tr></thead>
        <tbody>
          ${quotes.map(
            (q) => `<tr>
              <td>${new Date(q.created_at + "Z").toLocaleDateString()}</td>
              <td>${q.client_name}</td>
              <td>${q.role_title || ""}</td>
              <td>${q.award_name}</td>
              <td class="num">${money(q.charge_rate)}/hr</td>
              <td>${q.staff_name}</td>
              <td><a href="/quote-print.html?id=${q.id}" target="_blank">View</a></td>
            </tr>`
          ).join("")}
        </tbody>
      </table>`
    : `<p class="muted small">No quotes saved yet.</p>`;
}

async function loadAccounts() {
  const accounts = await api("/api/staff/accounts");
  const canToggle = (a) => a.role !== "owner" && a.id !== ME.id && (ME.role === "owner" || a.role === "staff");
  $("accountsList").innerHTML = `<table>
    <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th></th></tr></thead>
    <tbody>
      ${accounts.map(
        (a) => `<tr>
          <td>${a.name}</td>
          <td>${a.email}</td>
          <td>${a.role}</td>
          <td>
            ${!a.active ? '<span class="pill" style="color:var(--red);border-color:var(--red)">deactivated</span>' : ""}
            ${a.active && a.pendingInvite ? '<span class="pill uncertain">setup link pending</span>' : ""}
            ${a.active && !a.pendingInvite && a.mustChange ? '<span class="pill uncertain">pending first login</span>' : ""}
          </td>
          <td>${canToggle(a) ? `<button type="button" class="link toggle-active-btn" data-id="${a.id}" data-active="${a.active ? 1 : 0}">${a.active ? "Deactivate" : "Reactivate"}</button>` : ""}</td>
        </tr>`
      ).join("")}
    </tbody>
  </table>`;
  document.querySelectorAll(".toggle-active-btn").forEach((btn) => {
    btn.addEventListener("click", () => toggleAccountActive(btn.dataset.id, btn.dataset.active === "1"));
  });
}

async function toggleAccountActive(id, currentlyActive) {
  try {
    await api(`/api/staff/accounts/${id}`, { method: "PATCH", body: JSON.stringify({ active: !currentlyActive }) });
    loadAccounts();
  } catch (e) {
    $("newAccountResult").innerHTML = `<div class="notice error">${e.message}</div>`;
  }
}

async function addAccount() {
  const email = $("newEmail").value.trim();
  const name = $("newName").value.trim();
  const role = $("newRole").value;
  if (!email || !name) return;
  try {
    const account = await api("/api/staff/accounts", { method: "POST", body: JSON.stringify({ email, name, role }) });
    const subject = encodeURIComponent("Set up your WTC Labour Rates account");
    const body = encodeURIComponent(
      `Hi ${account.name},\n\nYou've been added to the WTC Labour Rates calculator. Click this link to set your password and sign in:\n\n${account.inviteLink}\n\nThis link expires in 7 days.`
    );
    const mailtoLink = `mailto:${account.email}?subject=${subject}&body=${body}`;
    $("newAccountResult").innerHTML = `
      <div class="notice">
        Created ${account.name}. Setup link (expires in 7 days, shown once):<br>
        <input type="text" readonly value="${account.inviteLink}" style="margin:6px 0" onclick="this.select()">
        <div class="row" style="gap:8px; margin-top:4px">
          <button type="button" id="copyInviteBtn">Copy link</button>
          <a href="${mailtoLink}"><button type="button">Email via your mail client</button></a>
        </div>
      </div>`;
    document.getElementById("copyInviteBtn").addEventListener("click", () => {
      navigator.clipboard.writeText(account.inviteLink);
    });
    $("newEmail").value = "";
    $("newName").value = "";
    loadAccounts();
  } catch (e) {
    $("newAccountResult").innerHTML = `<div class="notice error">${e.message}</div>`;
  }
}

init();
