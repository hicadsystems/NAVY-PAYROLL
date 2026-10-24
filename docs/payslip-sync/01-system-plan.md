# 01 — System Plan

## 1. Purpose

The sync service keeps the website supplied with the data its payslip page needs, while payroll is calculated on the office server. Staff keep printing payslips from the web exactly as today; only the source of the data changes.

Why it is needed:

- Payroll processing runs on the physical office server, on a network kept **offline as a security measure**. The website (nncpo.ng) stays online for 30k+ users.
- Today the office runs the legacy MSSQL system. Later it runs the new MySQL payroll. The website must work in both phases with no change.
- The two sides must never fight over the same data, and a month must never show half-loaded.

## 2. Goals

1. **Payslips first.** After a payroll month is published, every staff member can view and print it on the web.
2. **15 minutes or less of machine time.** Export, upload, load and Go live for all six databases take ≤ 15 min together (carrying the media out is not counted); switching on a prepared month takes ≤ 60 s.
3. **One way only.** Payroll data leaves the offline network as an encrypted, signed file. Nothing comes back in; website changes reach payroll as a printed list keyed in by payroll staff (Phase 2).
4. **All or nothing.** A month is loaded fully, checked, then switched on in one step, and can be withdrawn or rolled back.
5. **Same tables both sides.** No translation layer: the website keeps the same tables and the same stored procedure it uses today.
6. **Keeps the air gap.** No machine is on both networks; uploads resume after dropped connections.
7. **Full resync on demand.** An admin can rebuild a whole database on the website from the office copy.

Done looks like: a published month on the website matches the office figures for staff count and total net pay, per payroll database, with a log entry and stage timings proving it.

## 3. Current state (what the code does today)

The payslip page builds payslips from raw payroll tables on demand, so the website needs those tables, not finished payslips.

How a staff payslip is produced (`routes/user-dashboard/payslips/userpayslip.js`):

1. Look up the staff member's `payrollclass` in `hr_employees` (master database `hicaddata`).
2. Map the class to its payroll database: officers, wofficers, ratings, ratingsA, ratingsB or juniorTrainee.
3. Read the current period from `py_stdrate` (row `type = 'BT05'`).
4. For the current period, require IPPIS rows in `py_ipis_payhistory`; otherwise answer "not ready yet".
5. Call `py_generate_combined_payslip`, which writes lines into `py_webpayslip` for that user.
6. Read `py_webpayslip`, map the rows, render the PDF from `templates/user-payslip.html`.

What the stored procedure reads:

| Table | Used for |
|---|---|
| `hr_employees` | Name, title, grade, bank, PFA, NSITF, factory, location, date left |
| `ac_months` | Month name |
| `py_stdrate` | Current month (BT05) |
| `ac_businessline`, `ac_costcentre`, `py_bank`, `py_pfa` | Lookup names |
| `py_ipis_payhistory` | IPPIS lines for the period |
| `py_masterpayded`, `py_mastercum`, `py_elementtype` | Current month's own (NAVY) lines |
| `py_payhistory` | Past months' own lines (one row per staff + pay type per year, 12 month columns) |

Other facts that shape the design:

- The app runs on MySQL or MSSQL through `config/db-config.js` and `config/adapters/`. Table names are the same on both (see `migratedata.js`).
- `py_webpayslip` is scratch space, rebuilt on every view. It is never synced.
- `hr_employees` also holds login data (passwords, reset tokens) from the unified login work. That data belongs to the website.
- Admin bulk payslips (`adminpayslip.js`) and consolidated payslips (`controllers/utilities/consolidatedPayslip.js`) use the same procedure and tables.

## 4. Decisions needed before M1

- [ ] Security sign-off on the export procedure: approved media, who may export, who may upload, where the exporter runs.
- [ ] Which `hr_employees` columns does the website change (email, phone, bank)? Those leave the exporter's column list.
- [x] Who clicks Go live: the sync role, manually, in this delivery. Automatic Go live later, off by default. (Still open: is approval needed before upload?)
- [ ] Where does the legacy MSSQL live during transition (`HICAD-THREEONE\SQL2022`?), which machine inside runs the exporter, and can it get a read-only login?
- [ ] Do the legacy MSSQL database names map one to one to the six website payroll databases?
- [ ] How many years of payslip history must be reprintable on the website? (Default: everything in the source; the Day 2 full dry run gives size and time to decide on.)
- [ ] Which website changes must flow back to the office in Phase 2 (bank details only, or more)?
- [ ] Which PC and connection will the sync officer use to upload? (Speed measured in M1, see 06.)

## 5. Known issues found in the code

| Issue | Where | Effect | Fix |
|---|---|---|---|
| "Current period" compares month only, not year | `py_generate_combined_payslip` | Asking for Oct 2025 while Oct 2026 is current shows this month's figures labelled 2025 | Also compare the year with `py_stdrate.ord` |
| `sa` login and password written in the file | `migratedata.js` | Credentials sit in the git repo | Move to `.env` and change the password |
| BT05 read and procedure call use `pool.query` after `USE` ran on `conn` | `userpayslip.js` | They may run against a different database than intended | Confirm `pool.query` routes to the target DB, or run both on `conn` |
| Unpublished months are visible if data is present | `userpayslip.js` | Partly loaded or unapproved months could show | Check `sync_publications` before calling the procedure |
| No index at all on `py_ipis_payhistory` and `py_webpayslip` | Website DB | Every staff payslip view scans both tables in full; worse as they grow | Add indexes (06-performance.md §5a) before M1 |
| Duplicate indexes on `py_masterpayded` and `py_mastercum` | Website DB | Slower writes and loads | Drop the duplicates (06-performance.md §5a) |
| IPPIS import selects `id` and sets `updated_at`, but `py_ipis_payhistory` has neither column | `routes/utilities/ippis-payment.js` (lines ~483, ~490) | On this schema every record of an IPPIS upload fails with "Unknown column" | Use `SELECT 1 … LIMIT 1` and drop `updated_at` (or add the columns); with the new primary key, a single `INSERT … ON DUPLICATE KEY UPDATE` replaces both queries |

## 6. Milestones

Each milestone has a gate that must pass before the next starts. Dates to be set by the team.

1. **M0 — Decisions settled.** Section 4 answered, including security sign-off. Index fixes (06 §5a) applied.
2. **M1 — Foundations + measurement.** Control tables, manifest, package format, exporter dry run (reads, packs and times everything; test package uploaded to staging). *Gate:* counts match legacy for one database; projected machine time ≤ 10 min.
3. **M2 — Reference packages on staging.** Export, upload and apply a reference-only package to staging.hicad.ng; Upload tab. *Gate:* login data untouched; signature, sequence and duplicate checks refuse bad files.
4. **M3 — Publish one month on staging.** Month package → prepared → Go live for one database; Overview, Runs, Publications tabs. *Gate:* 20 sampled payslips match legacy line for line; Go live ≤ 60 s.
5. **M4 — Full package + full-size test.** Full package with agreed history years for all six databases; Reconciliation tab; month publish at full size on staging. *Gate:* totals match; machine time ≤ 15 min.
6. **M5 — Production, parallel run.** All six databases on nncpo.ng for one payroll cycle alongside the current process, following the real media procedure. *Gate:* zero mismatches; machine time ≤ 15 min.
7. **M6 — Cutover.** Office moves to the new MySQL payroll; export moves into the payroll app's Export for web section. *Gate:* first month after cutover reconciles clean within 15 min.
8. **M7 — Phase 2.** Changes for payroll list, printable sheet, auto-close from packages.
