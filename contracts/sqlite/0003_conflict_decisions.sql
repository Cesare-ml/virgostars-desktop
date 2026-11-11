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
BEGIN
  SELECT RAISE(ABORT,'already used mutation id');
END;
PRAGMA user_version=3;
