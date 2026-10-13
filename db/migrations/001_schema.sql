-- Users = managers only. Residents have no account.
CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone         TEXT NOT NULL UNIQUE,          -- E.164, e.g. +989121234567
  display_name  TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE buildings (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  address       TEXT,
  manager_id    UUID NOT NULL REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE units (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  building_id   UUID NOT NULL REFERENCES buildings(id),
  label         TEXT NOT NULL,                 -- '۱۲' or 'واحد ۳ طبقه ۲'
  sort_key      INT  NOT NULL,                 -- deterministic ordering for the charge split
  area_m2       NUMERIC(8,2) CHECK (area_m2 > 0),
  occupants     INT  NOT NULL DEFAULT 1 CHECK (occupants >= 0),  -- 0 = empty unit
  resident_name TEXT,
  phone         TEXT,                          -- E.164
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (building_id, label),
  UNIQUE (building_id, sort_key)
);

CREATE TABLE charge_periods (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  building_id     UUID NOT NULL REFERENCES buildings(id),
  jalali_year     INT NOT NULL,
  jalali_month    INT NOT NULL CHECK (jalali_month BETWEEN 1 AND 12),
  total_rial      BIGINT NOT NULL CHECK (total_rial > 0 AND total_rial % 10 = 0),
  formula         JSONB NOT NULL,              -- snapshot at issue time
  issued_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  voided_at       TIMESTAMPTZ                  -- NULL = active; set when the month is reissued
);

-- One active charge per month; a voided month can be issued again.
CREATE UNIQUE INDEX one_active_period_per_month
  ON charge_periods (building_id, jalali_year, jalali_month) WHERE voided_at IS NULL;

-- The ledger: append-only once locked (see 002).
CREATE TYPE entry_kind AS ENUM (
  'expense', 'income', 'charge_issued', 'payment', 'reversal', 'document_attached'
);
CREATE TYPE doc_status AS ENUM ('documented', 'pending_doc', 'undocumented');

CREATE TABLE ledger_entries (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  building_id       UUID NOT NULL REFERENCES buildings(id),
  kind              entry_kind NOT NULL,
  amount_rial       BIGINT,                    -- NULL only for document_attached; else > 0, kind decides the sign
  occurred_on       DATE NOT NULL,             -- Gregorian in DB, Jalali in UI
  title             TEXT NOT NULL,             -- 'تعمیر آسانسور'
  category          TEXT,
  unit_id           UUID REFERENCES units(id), -- set for payment / charge_issued
  period_id         UUID REFERENCES charge_periods(id),
  doc_state         doc_status,                -- required for expense and document_attached (the new state)
  undocumented_note TEXT,                      -- required when doc_state = 'undocumented'
  target_id         UUID REFERENCES ledger_entries(id),  -- the entry a reversal / document_attached is about
  supersedes_id     UUID REFERENCES ledger_entries(id),  -- the entry this revision replaces
  edit_reason       TEXT,                      -- required on revisions and reversals
  locked_at         TIMESTAMPTZ,               -- NULL = maybe still a draft (see ledger_is_locked)
  created_by        UUID NOT NULL REFERENCES users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT amount_shape CHECK (
    (kind = 'document_attached' AND amount_rial IS NULL)
    OR (kind <> 'document_attached' AND amount_rial > 0)
  ),
  -- Input is in toman, so every amount is a whole toman.
  CONSTRAINT amount_whole_toman CHECK (amount_rial % 10 = 0),
  CONSTRAINT edit_needs_reason CHECK (
    supersedes_id IS NULL
    OR (edit_reason IS NOT NULL AND length(btrim(edit_reason)) >= 3)
  ),
  CONSTRAINT reversal_needs_reason CHECK (
    kind <> 'reversal'
    OR (edit_reason IS NOT NULL AND length(btrim(edit_reason)) >= 3)
  ),
  CONSTRAINT expense_has_doc_state CHECK (
    kind NOT IN ('expense', 'document_attached') OR doc_state IS NOT NULL
  ),
  CONSTRAINT undocumented_needs_note CHECK (
    doc_state IS DISTINCT FROM 'undocumented'
    OR (undocumented_note IS NOT NULL AND length(btrim(undocumented_note)) >= 3)
  ),
  CONSTRAINT target_when_needed CHECK (
    (kind IN ('reversal', 'document_attached')) = (target_id IS NOT NULL)
  ),
  CONSTRAINT unit_for_unit_kinds CHECK (
    kind NOT IN ('payment', 'charge_issued') OR unit_id IS NOT NULL
  ),
  CONSTRAINT period_for_charges CHECK (
    kind <> 'charge_issued' OR period_id IS NOT NULL
  )
);

CREATE TABLE documents (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id      UUID NOT NULL REFERENCES ledger_entries(id),
  storage_key   TEXT NOT NULL,
  mime_type     TEXT NOT NULL,
  byte_size     INT  NOT NULL,
  extracted     JSONB,                         -- raw output of ReceiptExtractor
  uploaded_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE resident_tokens (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id       UUID NOT NULL REFERENCES units(id),
  token_hash    BYTEA NOT NULL UNIQUE,         -- sha256 of the raw token
  expires_at    TIMESTAMPTZ NOT NULL,
  revoked_at    TIMESTAMPTZ,
  last_seen_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ON ledger_entries (building_id, occurred_on DESC);
CREATE INDEX ON ledger_entries (unit_id) WHERE unit_id IS NOT NULL;
CREATE INDEX ON ledger_entries (target_id) WHERE target_id IS NOT NULL;
CREATE INDEX ON documents (entry_id);
