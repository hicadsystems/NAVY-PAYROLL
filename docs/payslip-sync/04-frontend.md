# 04 — Screens

There are only three screens. No Electron and no separate web app.

| # | Screen | Where it runs | Who uses it | When | Built by |
|---|---|---|---|---|---|
| 1 | Exporter | Command-line window on the offline payroll machine | Payroll officer | Once a month (plus a full export at go-live) | Dev A, `navy-payslip-sync` repo |
| 2 | Sync Console | New page in the existing NAVY-PAYROLL admin dashboard (Utilities) | Sync officer | Once a month | Dev B, NAVY-PAYROLL repo |
| 3 | Staff payslip page | Existing website page | All staff | Any time | Unchanged |

## 1. Exporter (inside the offline network)

`navy-sync-exporter.exe` opens a plain command-line window: keyboard only, no browser, no web server, no open ports. It walks through three steps in order. Built with Node `readline`, no extra packages.

```
NAVY Payslip Exporter  v0.1.0

STEP 1 of 3 — Connect
  Server ............ HICAD-THREEONE\SQL2022
  Read-only user .... sync_reader
  Password .......... ********
  Testing databases...
    officers        ok   2,104 staff   period 2026-10
    ratings         ok  12,412 staff   period 2026-10
    ...             (one line per database)

STEP 2 of 3 — Export
  Kind ........... [1] Month  [2] Full     > 1
  Period ......... 2026-10                 (Enter to accept)
  Save to ........ E:\                     (USB drive)
  Exporting...
    officers        ██████████ done   38 s
    ratings         ██████░░░░ py_masterpayded  61%

STEP 3 of 3 — Done
  File ........... E:\NAVY_202610_seq0042.npsync
  Size ........... 74 MB
  Sequence ....... 42  (follows 41)
  Fingerprint .... 9F3A-71C2-0B8E   <- write this in the media log
  Time ........... 3 min 12 s
```

(Figures above are examples only.)

**Setup** (first run, or `--setup`): server; then "Read-only login: [1] already created, sign in [2] create it now". Option 2 asks a DBA for an admin login once (never saved), then creates the read-only login with access to exactly the chosen databases. Setup then lists the payroll databases it finds on the server (staff count, current period, which one has `py_payrollclass`), suggests which is which class from `py_payrollclass`, and the officer confirms by number. No database names are typed.

| Step | Asks for | Shows |
|---|---|---|
| 1. Connect | Server, read-only user, password (typed each time in this delivery) | Per database: reachable, staff count, current period (BT05). Stops with a clear message if any database fails |
| 2. Export | Kind (month / full), period (default: current), output folder (default: removable drive) | Live progress per database and table, elapsed time |
| 3. Done | — | File name, size, sequence (and the one it follows), fingerprint in a form easy to copy by hand, total time |

Extra commands: `navy-sync-exporter.exe --dry-run` (reads and packs everything, prints rows, raw MB, packed MB and seconds per table, writes a test package), `--ledger` (list of exported packages), `--show-key` (prints the exporter public key for registration on the website).

**Phase 2 (after cutover):** the same three steps become an **Export for web** page inside NAVY-PAYROLL on the payroll server, since that app already runs there.

## 2. Sync Console (website)

`public/sections/payslip-sync.html`, built like the existing sections (inline script), loaded by the dashboard shell, listed under **Utilities** next to IPPIS Payments and Consolidated Payslip.

Layout, top to bottom:

1. **Title row:** "Payslip sync", with **Upload package** and **Go live** buttons on the right (Go live is the one filled button).
2. **Status chips:** last package (seq, period), live period, any period prepared but not live (warning colour), last publish machine time (green under 15 min, red over).
3. **Tabs:** Overview · Upload · Runs · Publications.
4. **Tab content** (below).

| Tab | Shows | Actions |
|---|---|---|
| Overview | One card per database (officers, wofficers, ratings, ratingsA, ratingsB, juniorTrainee): live period, prepared period, staff count, total net | Go live |
| Upload | File picker. On choosing the file, a preview read from its header: file name, kind and period, exporter, fingerprint (to compare with the media log), signature and sequence check. Then an upload bar that resumes after a dropped connection, then loading and checking. Ends with one card per database: staff count and "checks passed" (or the failure) | Upload, Resume, Cancel |
| Runs | Every upload: date, seq, kind, period, status, rows, MB, machine time (red over 15 min), uploaded by. Opening a run shows a timing bar (export, upload, verify, load, apply, validate, go live) and per-table row counts and checks | Open detail |
| Publications | Database × month grid: prepared / live / withdrawn, staff count, total net, who and when | Go live, Withdraw, Roll back |

While a month is prepared but not live, staff still see the previous month.

Dialogs: **Approve new exporter** (super admin; shown when an upload comes from an exporter not yet approved: exporter name and key id to compare with the exporter's screen), **Go live** (lists each database's prepared month and totals; one confirm), **Withdraw / Roll back** (asks for a reason).

Behaviour: progress through the existing Socket.IO service (fallback: refresh every 5 s); Upload, Go live, Withdraw and Roll back only for the sync role; Lagos time.

After the test day: Reconciliation tab, Settings tab (exporter registration; until then a script does it), Changes for payroll tab (Phase 2).

## 3. Staff payslip page

No visual change. If the chosen month is not published for the staff member's database, the existing message shows: "Sorry, payslip for selected month and year is not ready yet. Please check again later."
