-- Conservative precharged application budget; no refunds or bill reconstruction.
CREATE TABLE IF NOT EXISTS ai_cost_periods (
  kind TEXT NOT NULL CHECK(kind IN ('day','month')),
  period_start TEXT NOT NULL,
  reserved_micro_cny BIGINT NOT NULL CHECK(reserved_micro_cny>=0),
  last_request_id TEXT NOT NULL,
  PRIMARY KEY(kind,period_start)
);
CREATE TABLE IF NOT EXISTS ai_cost_reservations (
  request_id TEXT PRIMARY KEY,
  reserved_micro_cny BIGINT NOT NULL CHECK(reserved_micro_cny>0),
  model TEXT NOT NULL,
  base_url TEXT NOT NULL,
  input_bound INTEGER NOT NULL,
  max_output_tokens INTEGER NOT NULL,
  price_input_micro BIGINT NOT NULL,
  price_output_micro BIGINT NOT NULL,
  created_at TEXT NOT NULL
);
