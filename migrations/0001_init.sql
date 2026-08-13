-- wtc-labour-rates: award data (from the Fair Work MAP database export) + app tables

CREATE TABLE awards (
  award_code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  operative_from TEXT,
  source_url TEXT,
  consolidated_to TEXT
);

CREATE TABLE classifications (
  base_pay_rate_id TEXT PRIMARY KEY,
  award_code TEXT NOT NULL REFERENCES awards(award_code),
  employee_rate_type_code TEXT NOT NULL,
  parent_classification_name TEXT,
  classification TEXT NOT NULL,
  classification_level INTEGER,
  base_rate REAL,
  base_rate_type TEXT,
  calculated_rate REAL,
  calculated_rate_type TEXT,
  display_order INTEGER
);
CREATE INDEX idx_classifications_award ON classifications(award_code);

CREATE TABLE penalty_rates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  award_code TEXT NOT NULL,
  base_pay_rate_id TEXT,
  classification TEXT,
  classification_level INTEGER,
  employee_rate_type_code TEXT,
  penalty_description TEXT,
  clause_description TEXT,
  clauses TEXT,
  rate_percent REAL,
  calculated_value REAL,
  column_display_order INTEGER,
  classification_display_order INTEGER
);
CREATE INDEX idx_penalty_bpr ON penalty_rates(base_pay_rate_id);
CREATE INDEX idx_penalty_award ON penalty_rates(award_code);

CREATE TABLE wage_allowances (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  award_code TEXT NOT NULL,
  base_pay_rate_id TEXT,
  allowance TEXT,
  is_all_purpose INTEGER,
  rate_percent REAL,
  allowance_amount REAL,
  rate_unit TEXT,
  payment_frequency TEXT,
  display_order INTEGER
);
CREATE INDEX idx_wage_allowances_award ON wage_allowances(award_code);
CREATE INDEX idx_wage_allowances_bpr ON wage_allowances(base_pay_rate_id);

CREATE TABLE expense_allowances (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  award_code TEXT NOT NULL,
  allowance TEXT,
  allowance_amount REAL,
  payment_frequency TEXT,
  display_order INTEGER
);
CREATE INDEX idx_expense_allowances_award ON expense_allowances(award_code);

-- app tables

CREATE TABLE staff_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','staff')),
  pw_salt TEXT NOT NULL,
  pw_hash TEXT NOT NULL,
  pw_iter INTEGER NOT NULL DEFAULT 100000,
  must_change INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE quotes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  staff_id INTEGER NOT NULL REFERENCES staff_users(id),
  client_name TEXT NOT NULL,
  role_title TEXT,
  award_code TEXT NOT NULL,
  award_name TEXT NOT NULL,
  base_pay_rate_id TEXT NOT NULL,
  classification_name TEXT NOT NULL,
  employee_rate_type_code TEXT NOT NULL,
  is_casual INTEGER NOT NULL DEFAULT 1,
  casual_loading_pct REAL,
  oncost_pct REAL NOT NULL,
  margin_pct REAL NOT NULL,
  roster_json TEXT NOT NULL,
  blended_award_rate REAL NOT NULL,
  cost_rate REAL NOT NULL,
  charge_rate REAL NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_quotes_staff ON quotes(staff_id);
CREATE INDEX idx_quotes_created ON quotes(created_at);
