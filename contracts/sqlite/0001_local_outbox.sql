-- VirgoStars Desktop: synthetic-only plaintext SQLite schema contract.
-- This is a migration reference for the eventual Rust + SQLCipher adapter,
-- NOT a production migration. Never create a real personal-data store with it.
-- Enable foreign keys separately on EVERY connection before using this schema.
CREATE TABLE IF NOT EXISTS local_profiles (
  profile_id TEXT PRIMARY KEY NOT NULL CHECK (length(profile_id) BETWEEN 1 AND 128)
) STRICT;

CREATE TABLE IF NOT EXISTS local_entities (
  profile_id TEXT NOT NULL,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('subject','chart','note','preference')),
  entity_id TEXT NOT NULL CHECK (length(entity_id) BETWEEN 1 AND 128),
  payload_json TEXT CHECK (payload_json IS NULL OR json_valid(payload_json)),
  locally_deleted INTEGER NOT NULL DEFAULT 0 CHECK (locally_deleted IN (0,1)),
  server_revision TEXT,
  local_revision INTEGER NOT NULL DEFAULT 0 CHECK (local_revision >= 0),
  PRIMARY KEY (profile_id,entity_type,entity_id),
  FOREIGN KEY(profile_id) REFERENCES local_profiles(profile_id) ON DELETE RESTRICT
) STRICT;

CREATE TABLE IF NOT EXISTS local_outbox (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id TEXT NOT NULL,
  mutation_id TEXT NOT NULL CHECK (length(mutation_id) BETWEEN 1 AND 128),
  entity_type TEXT NOT NULL CHECK (entity_type IN ('subject','chart','note','preference')),
  entity_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('upsert','delete')),
  payload_json TEXT,
  base_server_revision TEXT,
  created_at_utc TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','conflict')),
  conflict_server_revision TEXT,
  UNIQUE(profile_id, mutation_id),
  CHECK ((operation='delete' AND payload_json IS NULL) OR
         (operation='upsert' AND payload_json IS NOT NULL AND json_valid(payload_json))),
  CHECK ((state='pending' AND conflict_server_revision IS NULL) OR state='conflict'),
  FOREIGN KEY (profile_id,entity_type,entity_id)
    REFERENCES local_entities(profile_id,entity_type,entity_id) ON DELETE RESTRICT
) STRICT;

CREATE INDEX IF NOT EXISTS local_outbox_profile_fifo
  ON local_outbox(profile_id, sequence);
CREATE INDEX IF NOT EXISTS local_outbox_entity_fifo
  ON local_outbox(profile_id, entity_type, entity_id, sequence);

CREATE TABLE IF NOT EXISTS local_sync_cursors (
  profile_id TEXT PRIMARY KEY NOT NULL,
  cursor_token TEXT,
  FOREIGN KEY(profile_id) REFERENCES local_profiles(profile_id) ON DELETE RESTRICT
) STRICT;
PRAGMA user_version = 1;
