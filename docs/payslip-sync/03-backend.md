# 03 — Backend Structure

Two repos:

- **`navy-payslip-sync` (new, Dev A owns):** the exporter and the shared code both sides need (table list, package format, encryption). Kept separate because it is the only code that goes into the offline network: a small repo is easier for security to review and approve, it gets its own versioned releases (each `.exe` is reviewed and carried in), and no website code or settings sit next to it.
- **`NAVY-PAYROLL` (existing, Dev B):** the website side. It installs `navy-payslip-sync` as a dependency pinned to a tag and uses only its `shared/` part.

No Electron and no separate web app: the exporter is a command-line `.exe`; the Sync Console is one more section of the existing NAVY-PAYROLL website.

## 1. New files

### 1.1 `navy-payslip-sync` (new repo)

```
navy-payslip-sync/
├─ package.json                  "main": "shared/index.js"; dependency: mssql (tedious, pure JS); dev: esbuild, postject
├─ README.md
├─ keys/README.md                key files are git-ignored
├─ shared/                       used by exporter AND website; no database drivers
│  ├─ index.js                   require("navy-payslip-sync") → { manifest, format, batch, crypto, types, reader, writer, timings }
│  ├─ manifest.js                tables, mode, key, scope, columns, applyAt, rollback; tablesFor(), goliveTables()
│  ├─ package-format.js          file layout, header checks, checkSequence(), fingerprint(), file names, PackageError codes
│  ├─ batch-format.js            batch JSON + gzip + checksum; decodeBatch() verifies
│  ├─ crypto.js                  AES-256-GCM, X25519 + HKDF key agreement, Ed25519 header signature
│  ├─ package-writer.js          streams records into an encrypted package (exporter)
│  ├─ package-reader.js          readHeader(), verifyPackage(), readRecords() (website)
│  ├─ type-map.js                logical column types, wire values
│  ├─ canonical-json.js, timings.js
├─ exporter/                     offline side only
│  ├─ main.js                    entry: Connect → Export → Done; --dry-run --setup --show-key --ledger --discard-last
│  ├─ cli/                       prompt.js, setup.js, connect.js, export.js, done.js, format.js
│  ├─ paths.js, config.js        %ProgramData%\navy-payslip-sync: config.json (no password)
│  ├─ keys.js                    exporter signing key (made on first run); website public key (built into the .exe)
│  ├─ ledger.js                  seq / baseSeq, discard-last
│  ├─ checks.js                  Connect-step schema checks
│  ├─ export-job.js              databases in parallel into one package
│  ├─ sources/mssql-source.js    Phase 1: streaming reads, exact decimals and dates
│  └─ extract/                   extractor.js (manifest → batches), months.js (py_payhistory month groups)
├─ scripts/                      keygen.js, build-exe.js (esbuild → Node single executable → dist/navy-sync-exporter.exe)
└─ test/                         package round trip, tamper / wrong key / sequence, months
```

Rule: **pure JavaScript dependencies only** (no compiled native modules), so the single-`.exe` build works. `mssql` (tedious) and Node's built-in `crypto` qualify.

Tagging: Dev A tags `v0.1.0` on Day 1 by 11:00 (shared code with `crypto.js`); NAVY-PAYROLL pins that tag and moves to newer tags as they land.

### 1.2 `NAVY-PAYROLL` (existing repo)

```
package.json                     "navy-payslip-sync": "github:hicadsystems/navy-payslip-sync#v0.1.0"
routes/sync/                     website, mounted at /api/sync
├─ packages.routes.js            resumable upload (verifyToken + sync role)
└─ admin.routes.js               console: runs, go live, publications, reconciliation, changes

services/sync/                   uses require('navy-payslip-sync') for manifest, format and crypto
├─ upload.service.js             chunk store, resume, assembly, fingerprint check
├─ package.service.js            verify signature + seq, decrypt, stream batches out of the payload
├─ run.service.js                run state machine and timings
├─ staging.service.js            <table>__stage with primary key only; secondary indexes added after load
├─ loader.service.js             bulk multi-row INSERT sized to max_allowed_packet
├─ merge.service.js              replace-scope and merge-columns in chunks of 10,000 keys
├─ validate.service.js           counts, checksums, totals
├─ golive.service.js             one RENAME TABLE across all databases; rollback from __prev
├─ publication.service.js        publish, withdraw, is-period-published check
├─ reconcile.service.js          package totals vs website totals
└─ changes.service.js            Phase 2: changes awaiting payroll, auto-close from packages

scripts/sync-register-exporter.js   inserts an exporter public key into sync_exporters
config/sql/migrations/<ts>_sync_control_tables.sql
config/sql/migrations/<ts>_payroll_index_fixes.sql        (06-performance.md §5a)
public/sections/payslip-sync.html                          Sync Console (04-frontend.md)
routes/payroll-export/, public/sections/export-for-web.html  Phase 2 only (after cutover)
```

Deploy note: if `navy-payslip-sync` is private, the servers that deploy NAVY-PAYROLL (Coolify, cPanel) need read access to it, for example a read-only deploy key. Fallback: a git submodule at `sync/shared`.

## 2. Existing files that change

| File | Change |
|---|---|
| `routes/index.js` | Mount `/api/sync` (website); mount `payroll-export` only when `APP_ROLE=payroll-office` |
| `routes/user-dashboard/payslips/userpayslip.js` | Refuse periods not published; reuse the "not ready yet" reply |
| `routes/utilities/ippis-payment.js` | Fix `id` / `updated_at` columns that do not exist; one `INSERT … ON DUPLICATE KEY UPDATE` |
| `py_generate_combined_payslip` (DB procedure) | Compare year as well as month for "current period" |
| `public/dashboard.html`, `menu-highlighting.js`, `sidebar-filter.js`, `quick-access.js` | Payslip Sync (website) and Export for web (payroll server) menu entries |
| `.env.example` | `SYNC_*` and `APP_ROLE` variables |
| `server.js` / config | Raise the upload body limit only on the chunk endpoint |
| `package.json` | Scripts `sync:build-exporter` |
| `migratedata.js` | Move hard-coded `sa` credentials to `.env` |

## 3. Control tables (website, master DB `hicaddata`)

| Table | One row per | Key columns |
|---|---|---|
| `sync_exporters` | Registered exporter | `exporter_id`, `name`, `public_key` (Ed25519), `registered_by`, `registered_at`, `active` |
| `sync_packages` | Uploaded package | `fingerprint` (unique), `exporter_id`, `seq`, `base_seq`, `kind` (month / reference / full), `period`, `databases`, `bytes`, `uploaded_by`, `upload_started_at`, `upload_finished_at`, `status` (uploading / received / rejected / applied), `reject_reason` |
| `sync_upload_chunks` | Received chunk (temporary) | `fingerprint`, `chunk_no`, `bytes`, `received_at` |
| `sync_runs` | Processing of one package | `run_uuid`, `package_id`, `status`, `started_at`, `finished_at`, `error`, `summary` JSON (counts + stage timings incl. the exporter's) |
| `sync_table_state` | Table + scope last applied | `database_name`, `table_name`, `scope`, `last_run_id`, `row_count`, `table_hash`, `applied_at` |
| `sync_publications` | Database + period | `database_name`, `period`, `status` (prepared / published / withdrawn), `staff_count`, `total_net`, `package_id`, `published_by`, `published_at`, `withdrawn_by`, `withdrawn_at` |
| `sync_changes` | Phase 2 change awaiting payroll | `change_uuid`, `database_name`, `empl_id`, `column_name`, `old_value`, `new_value`, `approved_by`, `status` (awaiting / done / differs), `closed_by_package` |

Run statuses: `received` → `verifying` → `loading` → `validating` → `prepared` → `live`, or `failed`.

## 4. Coding rules

- The exporter has **no network code** except the database connection. It never opens an internet connection and never auto-updates.
- The exporter is a command-line program: no web server, no open ports.
- The exporter only reads: read-only login, `SELECT` only. Its sole writes are the package file and its local ledger.
- Exporter and website use their own pools; never `config/db.js` session-context map. Website writes use `getConnection()` with explicit `USE <db>`.
- Stream everything: reading, packing, uploading, unpacking, loading. Never a whole table or whole package in memory.
- Keyset paging, never `OFFSET`. Scoped deletes only. Short transactions on live tables.
- The manifest is the only place table names live. Every stage records its duration.
