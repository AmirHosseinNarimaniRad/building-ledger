-- Balances are never stored; they are views over the ledger.
-- Rule: always sum EVERY row. A reversal cancels its target, and a revision adds the new
-- value. Never filter by version chain here; that filter is for the list view only.

-- Signed effect of each row:
--   kind              fund balance   unit debt
--   expense           -              .
--   income            +              .
--   payment           +              -
--   charge_issued     .              +
--   reversal          -(target)      -(target)
--   document_attached .              .
CREATE VIEW ledger_effects AS
SELECT
  e.id,
  e.building_id,
  COALESCE(e.unit_id, t.unit_id) AS unit_id,
  (CASE e.kind
    WHEN 'expense' THEN -e.amount_rial
    WHEN 'income'  THEN  e.amount_rial
    WHEN 'payment' THEN  e.amount_rial
    WHEN 'reversal' THEN CASE t.kind
      WHEN 'expense' THEN  t.amount_rial
      WHEN 'income'  THEN -t.amount_rial
      WHEN 'payment' THEN -t.amount_rial
      ELSE 0 END
    ELSE 0 END)::BIGINT AS cash_rial,
  (CASE e.kind
    WHEN 'charge_issued' THEN  e.amount_rial
    WHEN 'payment'       THEN -e.amount_rial
    WHEN 'reversal' THEN CASE t.kind
      WHEN 'charge_issued' THEN -t.amount_rial
      WHEN 'payment'       THEN  t.amount_rial
      ELSE 0 END
    ELSE 0 END)::BIGINT AS debt_rial
FROM ledger_entries e
LEFT JOIN ledger_entries t ON t.id = e.target_id;

CREATE VIEW building_balances AS
SELECT b.id AS building_id, COALESCE(SUM(x.cash_rial), 0)::BIGINT AS balance_rial
FROM buildings b
LEFT JOIN ledger_effects x ON x.building_id = b.id
GROUP BY b.id;

-- Positive = the unit owes; negative = credit.
CREATE VIEW unit_debts AS
SELECT u.id AS unit_id, u.building_id, COALESCE(SUM(x.debt_rial), 0)::BIGINT AS debt_rial
FROM units u
LEFT JOIN ledger_effects x ON x.unit_id = u.id
GROUP BY u.id, u.building_id;

GRANT SELECT ON ledger_effects, building_balances, unit_debts TO app_user;
