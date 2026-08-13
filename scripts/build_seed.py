"""
Converts the Fair Work Modern Awards Pay (MAP) database export spreadsheets into
SQL seed files for the wtc-labour-rates D1 database.

Source files (not committed to this repo — kept in the Downloads folder the
snapshot was delivered to):
  map-award-export-2026.xlsx
  map-classification-export-2026.xlsx
  map-penalty-export-2026.xlsx
  map-wage-allowance-export-2026.xlsx
  map-expense-allowance-export-2026.xlsx
  award-index.csv

Run: python3 scripts/build_seed.py
Writes: seed/01_awards.sql .. seed/05_expense_allowances.sql
"""
import csv
import datetime
import openpyxl
from pathlib import Path

SRC = Path(r"C:\Users\Tom Cooney\Downloads")
OUT = Path(__file__).resolve().parent.parent / "seed"
OUT.mkdir(exist_ok=True)

# Only rows currently in force. The exports are a 2026 snapshot, but a handful of
# rows carry an operative_to (superseded mid-year), so filter those out explicitly.
def is_current(row_operative_to):
    return row_operative_to is None


def sql_str(v):
    if v is None:
        return "NULL"
    s = str(v).replace("'", "''")
    return f"'{s}'"


def sql_num(v):
    if v is None or v == "":
        return "NULL"
    return str(v)


def sql_date(v):
    if v is None:
        return "NULL"
    if isinstance(v, (datetime.datetime, datetime.date)):
        return f"'{v.date().isoformat()}'"
    return sql_str(v)


def load_rows(fname, sheet):
    wb = openpyxl.load_workbook(SRC / fname, read_only=True)
    ws = wb[sheet]
    rows = list(ws.iter_rows(values_only=True))
    headers = rows[0]
    idx = {h: i for i, h in enumerate(headers)}
    data = [dict(zip(headers, r)) for r in rows[1:]]
    wb.close()
    return idx, data


def chunked(seq, n):
    for i in range(0, len(seq), n):
        yield seq[i : i + n]


def write_inserts(path, table, columns, value_rows, batch=400):
    with open(path, "w", encoding="utf-8") as f:
        f.write(f"DELETE FROM {table};\n")
        for batch_rows in chunked(value_rows, batch):
            f.write(f"INSERT INTO {table} ({', '.join(columns)}) VALUES\n")
            f.write(",\n".join(batch_rows))
            f.write(";\n")


# --- award index (for source_url / consolidated_to, display-only reference) ---
award_meta = {}
with open(SRC / "award-index.csv", encoding="utf-8") as f:
    for r in csv.DictReader(f):
        award_meta[r["award_code"]] = {
            "source_url": r["source_url"],
            "consolidated_to": r["consolidated_to"],
        }

# --- 1. awards ---
_, awards = load_rows("map-award-export-2026.xlsx", "Award Export 2026")
rows = []
for a in awards:
    code = a["awardCode"]
    if not code:
        continue
    meta = award_meta.get(code, {})
    name = (a["name"] or "").strip()
    rows.append(
        "("
        + ", ".join(
            [
                sql_str(code),
                sql_str(name),
                sql_date(a["awardOperativeFrom"]),
                sql_str(meta.get("source_url")),
                sql_str(meta.get("consolidated_to")),
            ]
        )
        + ")"
    )
write_inserts(
    OUT / "01_awards.sql",
    "awards",
    ["award_code", "name", "operative_from", "source_url", "consolidated_to"],
    rows,
)
print(f"awards: {len(rows)}")

# --- 2. classifications ---
_, classifications = load_rows("map-classification-export-2026.xlsx", "Classification Export 2026")
rows = []
seen_bpr = set()
for c in classifications:
    if not c["awardCode"] or not is_current(c["operativeTo"]):
        continue
    if c["type"] == "Group" or c["classificationLevel"] is None or not c["basePayRateID"]:
        continue  # header/grouping rows, not payable classifications
    if c["basePayRateID"] in seen_bpr:
        continue  # the export contains a handful of exact-duplicate rows
    seen_bpr.add(c["basePayRateID"])
    rows.append(
        "("
        + ", ".join(
            [
                sql_str(c["basePayRateID"]),
                sql_str(c["awardCode"]),
                sql_str(c["employeeRateTypeCode"]),
                sql_str(c["parentClassificationName"]),
                sql_str(c["classification"]),
                sql_num(c["classificationLevel"]),
                sql_num(c["baseRate"]),
                sql_str(c["baseRateType"]),
                sql_num(c["calculatedRate"]),
                sql_str(c["calculatedRateType"]),
                sql_num(c["displayOrder"]),
            ]
        )
        + ")"
    )
write_inserts(
    OUT / "02_classifications.sql",
    "classifications",
    [
        "base_pay_rate_id",
        "award_code",
        "employee_rate_type_code",
        "parent_classification_name",
        "classification",
        "classification_level",
        "base_rate",
        "base_rate_type",
        "calculated_rate",
        "calculated_rate_type",
        "display_order",
    ],
    rows,
)
print(f"classifications: {len(rows)}")

# --- 3. penalty rates ---
_, penalties = load_rows("map-penalty-export-2026.xlsx", "Penalty Export 2026")
rows = []
for p in penalties:
    if not p["awardCode"] or not is_current(p["operativeTo"]):
        continue
    if p["isHeading"]:
        continue
    rows.append(
        "("
        + ", ".join(
            [
                sql_str(p["awardCode"]),
                sql_str(p["basePayRateID"]),
                sql_str(p["classification"]),
                sql_num(p["classificationLevel"]),
                sql_str(p["employeeRateTypeCode"]),
                sql_str(p["penaltyDescription"]),
                sql_str(p["clauseDescription"]),
                sql_str(p["clauses"]),
                sql_num(p["rate"]),
                sql_num(p["penaltyCalculatedValue"]),
                sql_num(p["penaltyColumnDisplayOrder"]),
                sql_num(p["classificationDisplayOrder"]),
            ]
        )
        + ")"
    )
write_inserts(
    OUT / "03_penalty_rates.sql",
    "penalty_rates",
    [
        "award_code",
        "base_pay_rate_id",
        "classification",
        "classification_level",
        "employee_rate_type_code",
        "penalty_description",
        "clause_description",
        "clauses",
        "rate_percent",
        "calculated_value",
        "column_display_order",
        "classification_display_order",
    ],
    rows,
    batch=150,
)
print(f"penalty_rates: {len(rows)}")

# --- 4. wage allowances (tied to a classification via basePayRateID) ---
_, wage_allow = load_rows("map-wage-allowance-export-2026.xlsx", "Wage Allowance Export 2026")
rows = []
for w in wage_allow:
    if not w["awardCode"] or not is_current(w["operativeTo"]):
        continue
    if w["isHeading"]:
        continue
    rows.append(
        "("
        + ", ".join(
            [
                sql_str(w["awardCode"]),
                sql_str(w["basePayRateID"]),
                sql_str(w["allowance"]),
                sql_num(1 if w["isAllPurpose"] else 0),
                sql_num(w["rate"]),
                sql_num(w["allowanceAmount"]),
                sql_str(w["rateUnit"]),
                sql_str(w["paymentFrequency"]),
                sql_num(w["displayOrder"]),
            ]
        )
        + ")"
    )
write_inserts(
    OUT / "04_wage_allowances.sql",
    "wage_allowances",
    [
        "award_code",
        "base_pay_rate_id",
        "allowance",
        "is_all_purpose",
        "rate_percent",
        "allowance_amount",
        "rate_unit",
        "payment_frequency",
        "display_order",
    ],
    rows,
)
print(f"wage_allowances: {len(rows)}")

# --- 5. expense allowances (flat per-award, not classification-tied) ---
_, exp_allow = load_rows("map-expense-allowance-export-2026.xlsx", "Expense Allowance Export 2026")
rows = []
for e in exp_allow:
    if not e["awardCode"] or not is_current(e["operativeTo"]):
        continue
    if e["isHeading"]:
        continue
    rows.append(
        "("
        + ", ".join(
            [
                sql_str(e["awardCode"]),
                sql_str(e["allowance"]),
                sql_num(e["allowanceAmount"]),
                sql_str(e["paymentFrequency"]),
                sql_num(e["displayOrder"]),
            ]
        )
        + ")"
    )
write_inserts(
    OUT / "05_expense_allowances.sql",
    "expense_allowances",
    ["award_code", "allowance", "allowance_amount", "payment_frequency", "display_order"],
    rows,
)
print(f"expense_allowances: {len(rows)}")
