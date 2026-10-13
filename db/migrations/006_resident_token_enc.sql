-- The link must stay the same across every monthly SMS, so the server has to be able to rebuild
-- it. The raw token is still never stored: lookups use token_hash, and token_enc holds the token
-- encrypted with RESIDENT_TOKEN_KEY (AES-256-GCM), which lives outside the database.
ALTER TABLE resident_tokens ADD COLUMN token_enc BYTEA NOT NULL;
CREATE INDEX ON resident_tokens (unit_id) WHERE revoked_at IS NULL;
