-- VirgoStars Desktop experimental v2 migration REFERENCE, synthetic-only.
-- NEVER apply to an actual user profile or the current Rust SQLCipher v1 store.
-- Caller MUST verify existing user_version=1 and run this inside an exclusive
-- or BEGIN IMMEDIATE transaction with checked foreign_keys=ON, then commit.
CREATE TABLE local_ack_ledger (
  profile_id TEXT NOT NULL,
  mutation_id TEXT NOT NULL CHECK (length(mutation_id) BETWEEN 1 AND 128),
  entity_type TEXT NOT NULL CHECK (entity_type IN ('subject','chart','note','preference')),
  entity_id TEXT NOT NULL CHECK (length(entity_id) BETWEEN 1 AND 128),
  request_fingerprint TEXT NOT NULL CHECK (
    length(request_fingerprint)=64 AND request_fingerprint NOT GLOB '*[^0-9a-f]*'),
  result TEXT NOT NULL CHECK (result IN ('accepted','already_applied')),
  server_revision TEXT NOT NULL CHECK (length(server_revision) BETWEEN 1 AND 128),
  acknowledged_at_utc TEXT NOT NULL,
  PRIMARY KEY (profile_id, mutation_id),
  FOREIGN KEY (profile_id) REFERENCES local_profiles(profile_id) ON DELETE RESTRICT
) STRICT;
CREATE INDEX local_ack_ledger_profile_time
  ON local_ack_ledger(profile_id, acknowledged_at_utc);
PRAGMA user_version=2;
