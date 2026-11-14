-- Synthetic SQLite migration reference v1 -> v2, NOT production storage.
-- A future Rust/SQLCipher migrator MUST check user_version=1, enable FK checks,
-- run the entire migration under BEGIN IMMEDIATE, and commit only after checks.
-- This ledger stores no payload, token, birthplace or personal record.
CREATE TABLE local_ack_ledger (
  profile_id TEXT NOT NULL,
  mutation_id TEXT NOT NULL CHECK (length(mutation_id) BETWEEN 1 AND 128),
  server_revision TEXT NOT NULL CHECK (length(server_revision) BETWEEN 1 AND 128),
  PRIMARY KEY (profile_id, mutation_id),
  FOREIGN KEY (profile_id) REFERENCES local_profiles(profile_id) ON DELETE RESTRICT
) STRICT;

-- Acknowledged IDs remain reserved, even after the original outbox row is gone.
-- Scope by profile: the same remote-generated ID in another profile is distinct.
CREATE TRIGGER local_outbox_reject_ack_id_reuse
BEFORE INSERT ON local_outbox
WHEN EXISTS (
  SELECT 1 FROM local_ack_ledger
  WHERE profile_id = NEW.profile_id AND mutation_id = NEW.mutation_id
)
BEGIN
  SELECT RAISE(ABORT, 'Previously acknowledged mutation ID');
END;

-- A caller may not bypass the reservation by changing a pending row's ID.
CREATE TRIGGER local_outbox_reject_ack_id_update
BEFORE UPDATE OF profile_id, mutation_id ON local_outbox
WHEN EXISTS (
  SELECT 1 FROM local_ack_ledger
  WHERE profile_id = NEW.profile_id AND mutation_id = NEW.mutation_id
)
BEGIN
  SELECT RAISE(ABORT, 'Previously acknowledged mutation ID');
END;

PRAGMA user_version = 2;
