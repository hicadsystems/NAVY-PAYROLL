# 05 — Contracts

## 1. Package file (`.npsync`)

Implemented in `navy-payslip-sync/shared/` (`package-format.js`, `package-writer.js`, `package-reader.js`, `batch-format.js`, `crypto.js`). The website uses `verifyPackage()` and `readRecords()` from there and does not parse the file itself.

One file per export, covering the chosen databases (normally all six) for one period.

Name: `NAVY_<period>_seq<0042>.npsync`; full: `NAVY_FULL_<period>_seq<0042>.npsync`; dry run: `NAVY_DRYRUN_<period>_<timestamp>.npsync`.

Layout:

```
offset 0        8 bytes   magic "NPSYNC01"
offset 8        4 bytes   header length L (uint32 big-endian; currently 16384)
offset 12       L bytes   header JSON, padded with spaces (readable without decrypting)
offset 12+L     ...       encrypted payload, exactly header.payloadBytes long
```

The header is written last, into the reserved space, because it carries the payload hash, the GCM tag and the signature. The browser reads the first 16,396 bytes to preview the header before uploading.

Header:

```json
{
  "format": 1,
  "kind": "month",
  "exporterId": "navy-payroll-office-01",
  "exporterKeyId": "3f9c…",
  "exporterPublicKey": "-----BEGIN PUBLIC KEY-----\n…",
  "seq": 42,
  "baseSeq": 41,
  "period": "202610",
  "databases": ["officers", "wofficers", "ratings", "ratingsA", "ratingsB", "juniorTrainee"],
  "createdAt": "2026-10-28T09:14:03.512Z",
  "operator": "name as typed",
  "manifestVersion": 1,
  "exporterVersion": "0.1.0",
  "payloadBytes": 77123456,
  "payloadSha256": "…64 hex…",
  "encryption": {
    "alg": "AES-256-GCM",
    "kdf": "X25519-HKDF-SHA256",
    "ephemeralPublicKey": "…base64 SPKI…",
    "websiteKeyId": "…",
    "iv": "…",
    "authTag": "…"
  },
  "signature": "ed25519:…"
}
```

- **Encryption:** each package gets a fresh X25519 key pair. Its private half and the website public key give a shared secret; HKDF-SHA256 turns that into the AES-256-GCM key. Only the website private key can recover it. `websiteKeyId` lets the website say "encrypted for a different website key".
- **Signature:** the exporter's Ed25519 signature over the header without `signature`, as canonical JSON (keys sorted). It covers `payloadSha256`, so it covers every byte.
- **Exporter key in the header:** every package carries the exporter's public key (covered by the signature). The website uses it only to offer approval of a new exporter (§7). Trust comes from a person approving the key id, never from the file alone.
- **Fingerprint** shown to people: first 12 hex characters of `payloadSha256`, as `9F3A-71C2-0B8E`.

Decrypted payload: a sequence of records `[uint8 type][uint32 nameLength][name][uint32 dataLength][data]`:

| type | name | data |
|---|---|---|
| 1 batch | `batches/<db>/<table>[/<scope>]/<00001>.json.gz` | gzipped batch JSON |
| 2 manifest | `manifest.json` | package manifest JSON |
| 255 end | `end` | empty |

Order: all batches (databases interleaved, batches of one table in order), then the manifest, then the end record. **The manifest comes last** because row counts are only known after reading. The website loads batches into stage tables as they arrive and checks them against the manifest at the end.

Batch:

```json
{
  "v": 1,
  "database": "ratings",
  "table": "py_ipis_payhistory",
  "mode": "replace-scope",
  "scope": { "period": "202610" },
  "batchNo": 3,
  "columns": ["numb", "period", "bpc", "bpa", "bp", "bpm", "createdby", "datecreated", "Type"],
  "types":   ["string", "string", "string", "string", "string", "decimal", "string", "datetime", "string"],
  "rows": [["NN1234", "202610", "BP", "TAXABLE PAYMENT", "BASIC SALARY", "250000.0000", null, "2026-10-02 10:11:12", "BP001"]],
  "checksum": "sha256:…"
}
```

- `types`: `string`, `int`, `bigint` (string), `decimal` (string, exact), `float`, `bit` (0/1), `date` ("YYYY-MM-DD"), `datetime` ("YYYY-MM-DD HH:MM:SS"), `time`, `binary` (base64). Column names keep the source spelling; match them to MySQL columns case-insensitively.
- Up to 5,000 rows per batch. The batch count per table is in the manifest.
- `merge-columns` batches carry the key plus only the columns to write (for `py_payhistory`: key + the month column groups being sent).

Package manifest (the `manifest.json` record):

```json
{
  "manifestVersion": 1,
  "kind": "month",
  "dryrunOf": null,
  "period": "202610", "seq": 42, "baseSeq": 41,
  "payhistoryMonths": [{ "year": 2026, "months": [9, 10] }],
  "exporterVersion": "0.1.0",
  "timings": { "exportMs": 191000 },
  "databases": {
    "ratings": {
      "sourceDatabase": "HicadRatings",
      "totals": { "staffCount": 12412, "totalNet": "1234567890.1200" },
      "ms": 160000,
      "tables": [
        { "table": "py_ipis_payhistory", "mode": "replace-scope", "applyAt": "prepare", "rollback": "undo-snapshot",
          "key": ["period", "numb", "Type"], "scope": { "period": "202610" },
          "columns": ["…"], "types": ["…"], "rows": 402113, "batches": 81,
          "checksum": "sha256:…", "rawBytes": 61234567, "packedBytes": 6123456, "ms": 24000 }
      ]
    }
  }
}
```

The table `checksum` is sha256 over that table's batch checksums in order. Totals come from `py_mastercum` for the period's month.

## 2. Website API (`/api/sync`, logged in, sync role)

Upload (resumable, 8 MB chunks):

| Method | Path | Body / query | Returns |
|---|---|---|---|
| POST | `/packages` | header JSON (read by the browser from the file's first bytes), total bytes | `fingerprint`, chunks already held (for resume), or a refusal (unknown exporter, bad signature, seq gap, duplicate) |
| PUT | `/packages/:fingerprint/chunks/:n` | raw bytes | ok |
| POST | `/packages/:fingerprint/complete` | — | `received` → processing starts; returns run id |

Console:

| Method | Path | Purpose |
|---|---|---|
| GET | `/status` | Last package per exporter, last applied seq, per database: published and prepared period |
| GET | `/runs`, `/runs/:runId` | Run list and detail: per table counts, checks, stage timings |
| POST | `/golive` | `{period}`: one atomic switch for every prepared database |
| GET | `/publications` | Prepared / published / withdrawn periods |
| POST | `/publications/:db/:period/withdraw` | Hide a period |
| POST | `/publications/:db/:period/rollback` | Put back `__prev` tables |
| GET | `/reconciliation?db=&period=` | Package totals vs website totals |
| GET | `/exporters` | Approved exporters (id, key id, approved by, when) |
| POST | `/exporters/approve` | `{fingerprint}` of an uploaded package from an unknown exporter: stores its key after a super admin confirms the key id (§7) |
| GET | `/changes` | Phase 2: changes awaiting payroll, printable |

## 3. Sequence rules

- Accept when `baseSeq` = last applied `seq`, or `kind` = `full`.
- Refuse `seq` ≤ last applied (old or replayed file).
- Same fingerprint twice → "already received".

## 4. Run statuses and timings

`received` → `verifying` → `loading` → `validating` → `prepared` → `live`; `failed` from any step.

`sync_runs.summary` timing keys (ms): exporter side `export`, website side `upload`, `verify`, `load`, `apply`, `validate`, `golive`.

## 5. Apply, Go live and roll back (website)

Agreed at the contract freeze. `navy-payslip-sync` `shared/manifest.js` gives each table's `mode`, `applyAt` and `rollback`; `goliveTables(kind)` lists what Go live swaps.

**Every table goes through a stage table.** `DROP TABLE IF EXISTS <db>.<t>__stage; CREATE TABLE <db>.<t>__stage LIKE <db>.<t>;` then batches are loaded into it. Stage tables keep only the primary key while loading.

**Prepare, merge-columns** (`hr_employees`, `py_payhistory` in month packages), per database, in this order:

1. `DROP TABLE IF EXISTS <t>__undo, <t>__undo_new;`
2. Undo snapshot of rows about to change, sent columns only: `CREATE TABLE <t>__undo AS SELECT <key + sent columns> FROM <t> JOIN <t>__stage USING (<key>);`
3. Keys that are new: `CREATE TABLE <t>__undo_new AS SELECT <key> FROM <t>__stage LEFT JOIN <t> USING (<key>) WHERE <t>.<first key> IS NULL;`
4. Apply in chunks of 10,000 keys: `INSERT INTO <t> (<key + sent>) SELECT … FROM <t>__stage … ON DUPLICATE KEY UPDATE <col> = VALUES(<col>), …;`

**Prepare, replace-scope** (`py_ipis_payhistory` in month packages):

1. `DROP TABLE IF EXISTS <t>__undo; CREATE TABLE <t>__undo AS SELECT * FROM <t> WHERE period = ?;`
2. In one transaction: `DELETE FROM <t> WHERE period = ?; INSERT INTO <t> SELECT * FROM <t>__stage;`

**Prepare, swap at prepare** (lookups in month packages): same as Go live below, run during Prepare.

**Go live** (swap tables with `applyAt: golive`):

```sql
SET SESSION lock_wait_timeout = 30;
DROP TABLE IF EXISTS db.py_masterpayded__prev, db.py_mastercum__prev, db.py_stdrate__prev;   -- every database
RENAME TABLE
  db.py_masterpayded        TO db.py_masterpayded__prev,
  db.py_masterpayded__stage TO db.py_masterpayded,
  db.py_mastercum           TO db.py_mastercum__prev,
  db.py_mastercum__stage    TO db.py_mastercum,
  db.py_stdrate             TO db.py_stdrate__prev,
  db.py_stdrate__stage      TO db.py_stdrate;                                                   -- one statement
```

- What must be atomic is **each database on its own**: its three tables move together, so its staff never see the old month with new numbers. Each staff member only reads their own database, so the six databases do not have to switch in the same instant.
- If all six databases are on one MySQL server (to confirm on staging and production), put all of them in the one `RENAME TABLE`. If not, run one statement per server.
- `RENAME TABLE` fails if a target exists, hence the `DROP … __prev` first. It waits for running payslip queries on those tables (metadata lock); `lock_wait_timeout = 30` stops it hanging. On timeout, retry.
- Then write `sync_publications` rows (`published`).

**Roll back** (only the latest live run):

```sql
DROP TABLE IF EXISTS db.py_masterpayded__rb, db.py_mastercum__rb, db.py_stdrate__rb;
RENAME TABLE
  db.py_masterpayded TO db.py_masterpayded__rb, db.py_masterpayded__prev TO db.py_masterpayded, db.py_masterpayded__rb TO db.py_masterpayded__prev,
  db.py_mastercum    TO db.py_mastercum__rb,    db.py_mastercum__prev    TO db.py_mastercum,    db.py_mastercum__rb    TO db.py_mastercum__prev,
  db.py_stdrate      TO db.py_stdrate__rb,      db.py_stdrate__prev      TO db.py_stdrate,      db.py_stdrate__rb      TO db.py_stdrate__prev;
```

then, per database, in one transaction per table:

- merge-columns: `UPDATE <t> JOIN <t>__undo USING (<key>) SET <t>.<col> = <t>__undo.<col>, …;` and `DELETE <t> FROM <t> JOIN <t>__undo_new USING (<key>);`
- replace-scope: `DELETE FROM <t> WHERE period = ?; INSERT INTO <t> SELECT * FROM <t>__undo;`

The rename swaps rather than drops, so a rollback can itself be reversed. `__undo` tables live until the next Prepare. Rollback covers `hr_employees` too: changed names and bank details go back.

**After a rollback the sequence steps back.** The last applied seq returns to the package before. Inside the offline network the officer must run `navy-sync-exporter --discard-last` before the next export, so the next package builds on the right seq (otherwise the website refuses it with a sequence gap, and that is the safe outcome). The Console shows this instruction after a rollback.

## 6. Which database each table is written to

- Every table in a package is written to **the same website database it came from**: the batch's `database` field (`officers`, `wofficers`, `ratings`, `ratingsA`, `ratingsB`, `juniorTrainee`).
- `officers` is the master database (`hicaddata`). It holds `py_payrollclass` and the `hr_employees` the login and payslip lookup use (step 1 of 01 §3). Each class database also has its own `hr_employees`, which the payslip procedure reads after `USE <class db>`. Both are merged from their own source database.
- To confirm on staging: `hicaddata.hr_employees` has every staff member (the login lookup depends on it).

## 7. Approving a new exporter

No key files are carried by hand. The exporter's public key travels inside every package.

1. The sync officer uploads a package. `readHeader()` shows an `exporterId` that is not in `sync_exporters`.
2. The website calls `inspectNewExporter(file)` (shared/package-reader.js). It checks the file against the key it carries and returns `exporterId`, `keyIdFormatted` (e.g. `3F9C-1A2B-7D0E-55AA`) and `publicKeyPem`.
3. The Console shows "New exporter navy-payroll-office-01, key id 3F9C-1A2B-7D0E-55AA. Approve?" to a super admin only.
4. The super admin checks the key id against the one the exporter shows on screen (start-up line and Done step), read out by the payroll officer or written in the media log. Then approves.
5. The key is stored in `sync_exporters`. Processing continues with `verifyPackage(file, { exporterPublicKeyPem })`.

After approval, a package whose embedded key differs from the approved one is refused with `exporter-key-changed`. Replacing an exporter's key (new machine) is a deliberate super-admin action: deactivate the old one, approve the new one.

`scripts/sync-register-exporter.js` stays as a fallback (paste a key printed by `--show-key`).

