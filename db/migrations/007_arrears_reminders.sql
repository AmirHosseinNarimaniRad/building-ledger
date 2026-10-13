-- Arrears reminder SMS: kept so a unit is not texted more than once a day.
CREATE TABLE arrears_reminders (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id      UUID NOT NULL REFERENCES units(id),
  amount_rial  BIGINT NOT NULL,
  sent_by      UUID NOT NULL REFERENCES users(id),
  sent_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON arrears_reminders (unit_id, sent_at DESC);
