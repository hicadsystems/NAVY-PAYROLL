# 02 — Architecture

## 1. The constraint: the payroll network is offline on purpose

The office payroll server has no internet connection, as a security measure. Sync must keep it that way. So data leaves the payroll network **one way, as an encrypted file**, and nothing comes back in.

- No machine is connected to the payroll network and the internet at the same time.
- No inbound files or connections to the payroll network (Phase 2 included, see §4.4).
- The only thing ever brought in is the exporter software, once, through the approved media process.

## 2. Components

```
 OFFLINE PAYROLL NETWORK                 │  INTERNET
                                         │
┌─────────────────────────────┐          │          ┌──────────────────────────────┐
│ Office payroll DB           │          │          │ Website (nncpo.ng)           │
│ legacy MSSQL now,           │          │          │                              │
│ new MySQL after cutover     │          │          │  Sync Console                │
└──────────────┬──────────────┘          │          │  upload, check, go live      │
               │ read-only               │          │            │                 │
┌──────────────▼──────────────┐          │          │  Sync Import (/api/sync)     │
│ Sync Exporter               │  package │  upload  │  verify, decrypt, stage,     │
│ reads manifest tables,      │──▶ file ─┼─────────▶│  validate, swap              │
│ writes one encrypted,       │ (approved│ (any     │            │                 │
│ signed .npsync file         │  media)  │  online  │  Website MySQL               │
└─────────────────────────────┘          │  PC)     │  same tables + sync_*        │
                                         │          └──────────────────────────────┘
          data only moves left to right ─┼─▶
```

| Part | Runs on | Job |
|---|---|---|
| Office payroll DB | Payroll server (offline) | Where payroll is calculated |
| Sync Exporter | Payroll server or a payroll-network PC (offline) | Reads manifest tables with a read-only login, writes one package file per export |
| Package file (`.npsync`) | Approved removable media | Encrypted so only the website can open it; signed so the website knows which exporter made it |
| Sync Console | Website admin section, any online PC | Upload the package (resumable), see checks, Go live, withdraw, roll back |
| Sync Import | Website, `/api/sync` | Verifies signature and sequence, decrypts, loads stage tables, validates, swaps |
| Website MySQL | Website | Same payroll databases and tables as today, plus `sync_*` control tables |

Exporter form by phase:

- **Phase 1 (legacy MSSQL):** a standalone Windows command-line program, `navy-sync-exporter.exe` (Node single executable, no install of Node needed), with three screens: Connect, Export, Done. Built from the separate `navy-payslip-sync` repo and brought in once per version through the approved media process.
- **Phase 2 (new MySQL payroll):** the same exporter code as an **Export for web** section inside NAVY-PAYROLL on the payroll server. Nothing extra to install.

## 3. Data ownership and table rules

Every synced table has one owner, and only the owner writes it. This list becomes `shared/manifest.js` in the `navy-payslip-sync` repo.

Modes:

- **swap** — a full copy is loaded into `<table>__stage`, then exchanged with live by `RENAME TABLE` (instant, atomic). The old copy becomes `<table>__prev`.
- **replace-scope** — only the rows of one period are replaced.
- **merge-columns** — rows matched by key; only the listed columns written; new keys inserted; nothing deleted.
- **never** — not synced.

What one month's package holds, per payroll database:

| Table | Mode | Key / scope | In the package | Applied at |
|---|---|---|---|---|
| `ac_months`, `py_elementtype`, `py_bank`, `py_pfa`, `ac_businessline`, `ac_costcentre` | swap | whole table | Full table (small) | Prepare, skipped if unchanged |
| `hr_employees` (payroll columns only) | merge-columns | `EMPL_ID` | Payroll columns for all staff (narrow; compresses well) | Prepare |
| `py_ipis_payhistory` | replace-scope | `period` | Rows of the period | Prepare |
| `py_payhistory` | merge-columns | `his_empno, his_year, his_type` | Month column groups closed since the previous package (normally one) | Prepare |
| `py_masterpayded`, `py_mastercum` | swap | whole table | Full table | Loaded in Prepare, switched at Go live |
| `py_stdrate` | swap | whole table | Full table | Switched at Go live |
| `py_payrollclass` | swap | whole table, master DB | Full table | Prepare |

`hr_employees` payroll columns: `Surname`, `othername`, `Title`, `gradelevel`, `bankcode`, `BankACNumber`, `pfacode`, `nsitfcode`, `factory`, `location`, `payrollclass`, `dateleft`. Final list per decision in 01 §4.

Each table is written to the website database it came from (`officers` = master `hicaddata`; each class database has its own `hr_employees`). See 05-contracts.md §6.

Website-owned, never in a package: login and security columns of `hr_employees`, emolument tables (`ef_*`), notifications, audit, roles, `py_webpayslip`.

**Full copy.** A **full package** holds every manifest table, every period and year, for the chosen databases. Used for the first load, after a restore, or when a package was lost. A full copy website → payroll network is not offered (it would mean bringing data in).

## 4. Flows

### 4.1 Publish a month: Export → Upload → Go live

**Export (inside, payroll officer):**

1. Open the exporter. Step 1, **Connect:** pick the saved read-only connection (or enter it), test it.
2. Step 2, **Export:** pick period and databases (default: current period, all six). The exporter reads all six databases in parallel and writes one file, e.g. `NAVY_202610_seq0042.npsync`, to the chosen drive.
3. It shows the file's sequence number, size and a short fingerprint (first 12 characters of its hash). The officer records these in the media log.

**Upload (outside, sync officer):**

4. In the Sync Console, **Upload package**. Upload is chunked and resumes after a dropped connection.
5. The website checks the signature (a registered exporter), the fingerprint, and that the sequence number follows the last one applied. Then it decrypts and loads: scoped and merge data in short chunked transactions; swap tables into `__stage`.
6. It validates row counts, checksums and totals per database. Pass → `prepared`, with a summary on screen (staff count, total net per database). Fail → `failed`, nothing visible changed.

**Go live (outside, ≤ 60 s):**

7. Click **Go live** (manual in this delivery; automatic Go live comes later as a setting). Old `__prev` copies are dropped, then one `RENAME TABLE` swaps `py_masterpayded`, `py_mastercum` and `py_stdrate`. Each database switches atomically; all six go in one statement when they share a MySQL server. The period is marked `published`.

Why applying scoped data at Prepare is safe: the new period's IPPIS rows and `py_payhistory` month columns are not read for any visible period until `py_stdrate` moves at Go live.

### 4.2 Sequence numbers and lost packages

- Every package carries `seq` (its number) and `baseSeq` (the package it builds on).
- The website accepts a package only if `baseSeq` equals the last applied `seq` (or the package is full).
- A package that was never uploaded leaves a gap. The next package is refused with a clear message; the officer exports a **full** package (or re-uploads the missing one).
- Duplicate uploads (same fingerprint) are ignored.

### 4.3 Between monthly publishes

There is no nightly refresh: the payroll network cannot call out. New staff, promotions and bank changes reach the website with the next package. If a mid-month update is needed, the officer exports a **reference-only** package (lookups + `hr_employees`), which goes through the same upload and needs no Go live.

### 4.4 Website → payroll changes (Phase 2), without bringing files in

1. Staff changes approved on the website (for example a new bank account) are listed in the Console as **Changes awaiting payroll**, printable as a signed-off sheet.
2. Payroll staff apply them through the normal payroll screens, under normal payroll controls.
3. When the next package shows the new value, the website marks the change `done` automatically. Values that differ are flagged for follow-up.

A data import file into the payroll network is not part of the design. If ever wanted, it needs security sign-off first.

### 4.5 Withdraw and roll back

- **Withdraw:** hides the period ("not ready yet") until published again.
- **Roll back** (latest live run only): one `RENAME TABLE` swaps the `__prev` copies back, and the undo snapshots taken at Prepare restore `hr_employees`, `py_payhistory` and the period's IPPIS rows. Afterwards the officer inside runs `--discard-last` before the next export. Exact statements: 05-contracts.md §5.
