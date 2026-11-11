# Purchased city catalog — observed schema and reproducible size check

**Product note 2026-11-11. Dataset owner reports that the previously purchased catalog can be used for the Desktop application. Formal license/notice provenance will still be recorded before publishing any data or binary. The owner has now measured the **PostgreSQL** size as ~284 MB table heap, ~310 MB indexes and ~595 MB total (displayed rounded). Converted SQLite and compressed installer bytes remain UNMEASURED.**

## Actual PostgreSQL storage measurement (owner-reported, 2026-11-11)

A read-only `pg_relation_size` / `pg_indexes_size` / `pg_total_relation_size` query in pgAdmin returned:

| Measure | Observed |
| --- | ---: |
| Table heap (~data~) | **284 MB** |
| PostgreSQL indexes | **310 MB** |
| Total relation footprint | **595 MB** |

The rounded values need not add exactly because PostgreSQL renders each separately. More than half the reported storage is in PostgreSQL indexes; **those indexes do not transfer as-is to SQLite**. SQLite will use a purpose-built set of indexes and possibly FTS5, whose byte cost must be measured. This report does **not** predict that converted SQLite will necessarily be 284 MB or below 595 MB.

**Recommendation now:** prioritize measuring the **full worldwide offline SQLite** rather than excluding it based on the earlier guessed 1 GB. If a slim full catalog with adequate indexes compresses to an acceptable shipped size, favor the full always-offline collection. Otherwise use a compact built-in pack plus one-time optional expanded offline download. Keep GeoNames as an alternative/comparator, not an automatic replacement for purchased data.

## Evidence from owner-supplied PostgreSQL table screenshot

Reported **1,951,599 rows**. The screenshot shows these columns:

| Field | Observed type | Desktop role |
| --- | --- | --- |
| `id` | integer PK | Legacy place ID; keep source-ID namespace |
| `nome` | varchar(255) | Primary locality name |
| `nome_it` | varchar(255) nullable | Optional Italian/localized label, not a reliable complete translation |
| `lat` / `lng` | numeric(10,6) | Geodetic coordinates; validate range |
| `pop` | integer nullable | Ranking hint for autocomplete, not proof of accuracy |
| `stato_id` | integer | Requires joining a separate state/country lookup; don't assume ISO code |
| `regione` | varchar(255) | Administrative disambiguation |
| `tz` | varchar(255) | Example `Asia/Kabul`, an IANA-style timezone identifier; validate against versioned tzdb |
| `tz_offs` | varchar | Example `+0430`, **current/reference offset only**: not suitable as historical birth-date UTC offset |

The sample rows show accented locality names and many NULLs in `nome_it` and `pop`; **the sample is not proof of global missing-value percentages**. The actual table/schema name, indexing scheme, uniqueness, original data size, copyright notice and data freshness were not provided. No purchased rows were copied into the repository.

## Local storage strategy to benchmark

Option A is a **full local read-only SQLite catalog of 1,951,599 places**, bundled with the app. Do not bundle PostgreSQL itself. Record actual storage separately for catalog rows, FTS search index, database file and compressed distribution.

Candidate lossless/logically equivalent transformations, subject to tests:
- Preserve primary key as `sourceId` with a dataset namespace. Use a local integer rowid for lookup. Separate country IDs and country metadata (requires the actual related state table).
- Normalize repeated timezone strings into a small timezone dictionary, refer to timezone ID by integer. Store valid IANA timezone name from the source and original zone ID, preserve exceptions/unknowns explicitly.
- Store geocoordinates as **signed integer microdegrees** where the source guarantees 6 decimals and range validation: round-trip integer degree × 1,000,000 fits within a 32-bit signed integer for ±180° longitude and ±90° latitude. Validate each coordinate; never truncate invalid/over-precise data. Longitude 0 is distinct from missing.
- Keep `nome`, optional `nome_it`, `regione`, `pop` and source IDs as needed. Avoid copying redundant timestamps, text collations, PostgreSQL TOAST/storage metadata or repeated `tz_offs` if reproducible historical timezone resolution uses the versioned IANA tzdb.
- Use SQLite `FTS5` **external-content/contentless index** (rather than duplicated stored text), plus prefix search after accent/case normalization and country/region disambiguation. Validate FTS consistency and query ranking.
- Keep the public reference catalog **outside the SQLCipher personal chart archive**. Reference data can be unencrypted read-only; guest natal records may require encrypted SQLite/SQLCipher.
- Distribute full SQLite as a package asset only if measured footprint is reasonable. Otherwise: compact core catalog on first install and an **optional, single-download, versioned and verified** full catalog, still searchable offline afterward. Online search can enrich, not replace, offline functionality.

**Do not assert 1GB required.** One million+ rows is common in disk-indexed SQLite, but page size and B-tree/FTS design determine bytes and latency. The compressed installer size differs from the **expanded** installed SQLite file size; report both. SQLite FTS5 external-content mode avoids duplicating all column text in the FTS virtual table (official source: https://www.sqlite.org/fts5.html).

## Read-only SQL size inspection (run in pgAdmin or psql on the owned database)

Change `public.NOME_TABELLA` to the **actual schema and PostgreSQL table name**. The following queries are SELECT-only; they do not export user records or change indexes/data. They operate on the table, so **do not run on a busy production database without assessing query load**.

1. Relation bytes and all indexes (fast metadata lookup; no full table scan):

```sql
SELECT
  pg_size_pretty(pg_relation_size('public.NOME_TABELLA'::regclass)) AS heap_size,
  pg_size_pretty(pg_indexes_size('public.NOME_TABELLA'::regclass)) AS indexes_size,
  pg_size_pretty(pg_total_relation_size('public.NOME_TABELLA'::regclass)) AS total_size,
  pg_relation_size('public.NOME_TABELLA'::regclass) AS heap_bytes,
  pg_indexes_size('public.NOME_TABELLA'::regclass) AS index_bytes,
  pg_total_relation_size('public.NOME_TABELLA'::regclass) AS total_bytes;
```

2. Inspect existing **individual index sizes** (read-only metadata, no table scan):

~~~sql
SELECT indexrelname AS index_name,
       pg_size_pretty(pg_relation_size(indexrelid)) AS index_size,
       pg_relation_size(indexrelid) AS index_bytes
FROM pg_stat_user_indexes
WHERE relid = 'public.NOME_TABELLA'::regclass
ORDER BY index_bytes DESC;
~~~

This helps explain where the existing **310 MB** of PostgreSQL index storage goes and informs a leaner SQLite index design. Do not mechanically reproduce every PostgreSQL index.

3. Inspect columns and types (reads only system catalog):

```sql
SELECT column_name, data_type, udt_name, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'NOME_TABELLA'
ORDER BY ordinal_position;
```

4. **Optional** sampled data density (uses `TABLESAMPLE`; estimates only and may scan pages depending on storage; actual table name required):

```sql
SELECT
  count(*) AS sampled_rows,
  round(avg(pg_column_size(t))::numeric, 1) AS mean_postgres_row_bytes,
  round(100 * avg((nome_it IS NULL)::int)::numeric,1) AS nome_it_null_pct,
  round(100 * avg((pop IS NULL)::int)::numeric,1) AS pop_null_pct,
  round(100 * avg((tz IS NULL)::int)::numeric,1) AS tz_null_pct
FROM public.NOME_TABELLA TABLESAMPLE SYSTEM (0.1) AS t;
```

The sampled mean PostgreSQL row size is **not** a direct SQLite byte forecast; results depend on table storage/layout and FTS indexes. Do not attempt extraction/benchmark against a production server unless the owner has approved load and provenance.

## Acceptance / selection gates

- [ ] Record exact source table and country/state relation name (no credentials), verified permission to bundle locally and current data revision.
- [ ] Capture heap/index/total bytes and sampled NULL rates. Check uniqueness and validity of IANA zone IDs and geographic coordinates.
- [ ] Create a **local privately generated benchmark copy** with only approved columns; convert to read-only SQLite with full 1,951,599 records and FTS5. Compare stored bytes, compressed download/install bytes, peak RSS, cold/warm p50/p95 search time, accent handling, namesakes and historical DST behavior.
- [ ] Test compact baseline (e.g., most populated cities plus globally diverse regions) and optional full-pack upgrade. Use coverage and latency, not row count alone, to choose default.
- [ ] Validate full/compact pack integrity and version migration; original saved charts retain place snapshots and UTC resolution. Do not bundle sample purchased place data in open-source git history without release rights.
- [ ] If source license is distributable and full footprint acceptable, prefer full offline catalog for maximum independence. If not, compact core + optional offline pack + opt-in online enrichment.

**Decision is not final until actual measurements; no city DB has been shipped or tested inside a Windows executable.**
