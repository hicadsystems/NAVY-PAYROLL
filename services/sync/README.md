# Payslip Sync — website side (Dev B)

Receives the encrypted, signed `.npsync` package from the offline payroll network, checks it, loads it, and publishes the month to staff payslips. Contract: `docs/03-reference/website-contract.md`. File format and crypto: `navy-payslip-sync` (Dev A).

## Set up (staging, then production)

1. `npm install` (pulls `navy-payslip-sync#v0.1.2`; the deploying server needs read access to that private repo). Until access is granted: `npm install ./navy-payslip-sync-0.1.2.tgz` (same code), then switch back to the git tag.
2. `npm run migrate:up all` — index fixes (`20261021_173000_payroll_index_fixes.sql`, stops a database if `py_ipis_payhistory` has duplicate keys) and the control tables (`20261022_090000_sync_control_tables.sql`). Each migration starts with `-- @scope: master` (hicaddata only: users, login, emolument, sync) or `-- @scope: all` (every payroll database: py_* tables); the migrator skips master files on the class databases.
3. Restricted MySQL user: `node scripts/sync-grants.js > sync-grants.sql`, set a password, run it as an admin (after step 2). Put `SYNC_DB_USER` / `SYNC_DB_PASSWORD` in `.env`.
4. Website key: `website-private.pem` from Dev A's `scripts/keygen.js`. Keep it outside the repo and set `SYNC_PRIVATE_KEY` to its path (the PEM text also works). The public half is built into the exporter.
5. Check a real package before uploading it: `node scripts/sync-check-package.js NAVY_FULL_202609_seq0002.npsync --fingerprint 58B7-367B-A715 --key-id D395-4E84-3E15-0137 --db` (signature, decryption, every table against the manifest, columns against this MySQL; writes nothing).
6. Access: who can open Payslip Sync is set by the app's existing roles and permissions; the API only requires a logged-in user.
7. `node scripts/sync-wire-up.js` — mounts `/api/sync`, adds Utilities → Payslip Sync to the dashboard menus, adds the dependency and the `.env.example` settings. Safe to re-run.
8. `node scripts/sync-preflight.js --probe-rename` — `max_allowed_packet`, server layout, `hicaddata.hr_employees` coverage, a real Go-live `RENAME TABLE` as the sync user.

## How a package flows

| Step | Code | Staff see a change? |
|---|---|---|
| Upload (8 MB chunks, resumable) | `upload.service.js`, `routes/sync/packages.routes.js` | No |
| Verify signature, payload hash, sequence; new exporter → super admin approves the key id | `package.service.js` | No |
| Load into `<table>__stage` (multi-row INSERT, secondary indexes added after) | `staging.service.js`, `loader.service.js` | No |
| Validate rows / batches / checksums against the manifest, per entry (database + table + scope; a month crossing a year end has one `py_payhistory` entry per `his_year`) | `validate.service.js` | No |
| Prepare: lookups swapped, `hr_employees` + `py_payhistory` merged, IPPIS period replaced — each with an `__undo` snapshot | `merge.service.js`, `run.service.js` | No (new period not read until `py_stdrate` moves) |
| Go live: one `RENAME TABLE` for `py_masterpayded`, `py_mastercum`, `py_stdrate` in every database | `golive.service.js` | Yes |
| Withdraw / roll back (latest run only, `__prev` swap + undo restore) | `golive.service.js` | Yes |

Any failure before Go live changes nothing staff can see; a failure part-way through Prepare is undone automatically. `userpayslip.js` asks `publication.service.isPeriodVisible()` first: months before the first synced publication stay visible.

Every run flags `hr_employees` rows on the website that are not in the package (renumbered, left, or created on the website): shown in the run detail, never deleted.

Safety rails: only tables in the shared manifest can be written; website-owned tables (`ef_*`, `sync_*`, `py_webpayslip`, users, roles) are refused; `hr_employees` accepts only `HR_EMPLOYEES_PAYROLL_COLUMNS` plus the key, so login data never changes.

## Tests

`SYNC_E2E=1 npm run test:sync` — 15 end-to-end checks against a local MySQL, using throwaway `t_hicaddata*` schemas and the real `navy-payslip-sync` (packages built with its own writer in `test/sync/package-helpers.js`: real encryption, signatures and checksums). Covers test-day items 1, 3, 6–12. Also passes as the restricted `sync_writer` user.

## Open items

- `py_generate_combined_payslip` year check: run `node scripts/sync-dump-payslip-procedure.js` to save the procedure into `config/sql/procedures/`, then make the fix as a migration.
- `migratedata.js` (hard-coded `sa` password) is not in this repo; fix it where it lives.
- `hr_employees` is master-only (navy-payslip-sync v0.1.2): it arrives in the officers part with all staff and is merged into hicaddata; class databases have no copy. `py_ipis_payhistory` is optional per database in a package, but the table exists in every database (migration `20261022_184500_py_ipis_payhistory_everywhere.sql`) because the payslip procedure reads it.
- Website screens that write payroll-owned data (payroll class change, reg-number change, profile edit, bulk personnel upload, IPPIS import): recommendation to the client is in open question 2. Test day: leave them, don't use them on test staff.
- Reconciliation and Settings tabs, auto Go live: after the test day.
