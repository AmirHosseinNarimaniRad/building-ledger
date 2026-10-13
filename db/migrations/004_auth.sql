-- Manager login by SMS code. Only hashes are stored, never the code itself.
CREATE TABLE otp_codes (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone        TEXT NOT NULL,
  code_hash    BYTEA NOT NULL,
  ip           TEXT,
  attempts     INT NOT NULL DEFAULT 0,
  expires_at   TIMESTAMPTZ NOT NULL,
  consumed_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON otp_codes (phone, created_at DESC);
CREATE INDEX ON otp_codes (ip, created_at DESC);

-- Server-side sessions; the cookie holds a random token, the table holds its sha256.
CREATE TABLE sessions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id),
  token_hash   BYTEA NOT NULL UNIQUE,
  expires_at   TIMESTAMPTZ NOT NULL,
  revoked_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
