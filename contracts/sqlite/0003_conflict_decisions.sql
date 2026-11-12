-- PROTOTYPE ONLY: explicit v2->v3 conflict-decision history with synthetic records.
-- Caller MUST validate exact v2 schema, FK integrity and synthetic IDs and
-- apply within BEGIN IMMEDIATE. Never run against real profiles or production.
CREATE TABLE local_conflict_decisions (
  profile_id TEXT NOT NULL,
  original_mutation_id TEXT NOT NULL CHECK(length(original_mutation_id) BETWEEN 1 AND 128),
  original_fingerprint TEXT NOT NULL CHECK(length(original_fingerprint)=64 AND original_fingerprint NOT GLOB '*[^0-9a-f]*'),
  entity_type TEXT NOT NULL CHECK(entity_type='subject'),
  entity_id TEXT NOT NULL,
  original_operation TEXT NOT NULL CHECK(original_operation IN ('upsert','delete')),
  original_payload_json TEXT,
  original_base_server_revision TEXT,
  original_created_at_utc TEXT NOT NULL,
  replacement_mutation_id TEXT NOT NULL CHECK(length(replacement_mutation_id) BETWEEN 1 AND 128),
  remote_revision TEXT NOT NULL CHECK(length(remote_revision) BETWEEN 1 AND 128),
  choice TEXT NOT NULL CHECK(choice='keep_local'),
  decided_at_utc TEXT NOT NULL,
  PRIMARY KEY(profile_id,original_mutation_id),
  UNIQUE(profile_id,replacement_mutation_id),
  CHECK(original_mutation_id <> replacement_mutation_id),
  CHECK((original_operation='delete' AND original_payload_json IS NULL) OR
        (original_operation='upsert' AND original_payload_json IS NOT NULL AND json_valid(original_payload_json))),
  FOREIGN KEY(profile_id,entity_type,entity_id)
    REFERENCES local_entities(profile_id,entity_type,entity_id) ON DELETE RESTRICT
) STRICT;
CREATE INDEX local_conflict_decisions_entity
  ON local_conflict_decisions(profile_id,entity_type,entity_id,decided_at_utc);
-- DDL-level safety net for future staging implementations: no raw INSERT may
-- resurrect acknowledged or retired mutation IDs even after restart.
CREATE TRIGGER local_outbox_v3_reject_used_mutation_id
BEFORE INSERT ON local_outbox
WHEN EXISTS(SELECT 1 FROM local_ack_ledger a
            WHERE a.profile_id=NEW.profile_id AND a.mutation_id=NEW.mutation_id)
  OR EXISTS(SELECT 1 FROM local_conflict_decisions d
            WHERE d.profile_id=NEW.profile_id
              AND (d.original_mutation_id=NEW.mutation_id
                   OR d.replacement_mutation_id=NEW.mutation_id))
  -- BEFORE INSERT fires even for INSERT OR REPLACE; reject a collision
  -- with a queued ID or an explicit INTEGER PRIMARY KEY / rowid position.
  -- Otherwise REPLACE deletes the old row and bypasses UPDATE triggers.
  OR EXISTS(SELECT 1 FROM local_outbox q
            WHERE (q.profile_id=NEW.profile_id AND q.mutation_id=NEW.mutation_id)
               OR q.sequence=NEW.sequence)
BEGIN
  SELECT RAISE(ABORT,'already used mutation id');
END;
-- Explicit rowids can recycle an already deleted AUTOINCREMENT sequence,
-- making keyset pages miss a newly queued intent. At AFTER INSERT time
-- sqlite_sequence still stores the prior high-water mark; reject nonpositive
-- or non-increasing numbers. The insertion is atomically rolled back.
CREATE TRIGGER local_outbox_v3_fifo_must_advance
AFTER INSERT ON local_outbox
WHEN NEW.sequence <= 0 OR NEW.sequence <= COALESCE(
  (SELECT seq FROM sqlite_sequence WHERE name='local_outbox'), 0)
BEGIN
  SELECT RAISE(ABORT,'queued FIFO sequence must advance');
END;
-- Queued request identity is immutable. The existing INSERT trigger does not
-- intercept UPDATE mutations, so without this guard a caller could rename an
-- existing queued ID to an ACKed/retired ID or move it between entities.
-- State and remote conflict-revision updates remain legal; the v3 writer
-- retires an old request with DELETE and creates a replacement with INSERT.
CREATE TRIGGER local_outbox_v3_identity_immutable
BEFORE UPDATE ON local_outbox
WHEN NEW.sequence IS NOT OLD.sequence
  OR NEW.profile_id <> OLD.profile_id
  OR NEW.mutation_id <> OLD.mutation_id
  OR NEW.entity_type <> OLD.entity_type
  OR NEW.entity_id <> OLD.entity_id
BEGIN
  SELECT RAISE(ABORT,'queued mutation identity is immutable');
END;
-- A queued request is an immutable intent, even if a caller uses raw SQL.
-- Use SQLite's NULL-safe IS NOT so that initial NULL base revisions and
-- deletion payloads cannot be silently rewritten after staging.
-- Only state / conflict_server_revision may transition in place; an edit
-- must stage a NEW mutation and a keep-local decision must DELETE + INSERT.
CREATE TRIGGER local_outbox_v3_request_snapshot_immutable
BEFORE UPDATE OF operation,payload_json,base_server_revision,created_at_utc ON local_outbox
WHEN NEW.operation IS NOT OLD.operation
  OR NEW.payload_json IS NOT OLD.payload_json
  OR NEW.base_server_revision IS NOT OLD.base_server_revision
  OR NEW.created_at_utc IS NOT OLD.created_at_utc
BEGIN
  SELECT RAISE(ABORT,'queued mutation request is immutable');
END;
-- A user's recorded decision is audit history, not a mutable queue row.
CREATE TRIGGER local_conflict_decisions_no_update
BEFORE UPDATE ON local_conflict_decisions
BEGIN SELECT RAISE(ABORT,'conflict decision history is immutable'); END;
CREATE TRIGGER local_conflict_decisions_no_delete
BEFORE DELETE ON local_conflict_decisions
BEGIN SELECT RAISE(ABORT,'conflict decision history is immutable'); END;
PRAGMA user_version=3;
