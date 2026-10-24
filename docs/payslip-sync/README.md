# Payslip Sync — Office ↔ Website Data Sync for NAVY-PAYROLL

> **The full, current documentation now lives in the `navy-payslip-sync` repo, in `docs/`.** These files were the planning drafts; where they differ, `navy-payslip-sync/docs` wins.

Payroll is calculated on the office server, on a network kept offline as a security measure. Staff view and print payslips on the website (nncpo.ng). Payslip Sync moves payroll data out **one way, as an encrypted, signed package file** carried on approved media, and loads it into the website. It works with the legacy MSSQL system now and the new MySQL payroll after cutover.

**Hard requirement:** exporting, uploading and publishing a month for all six payroll databases must take **15 minutes or less of machine time** (carrying the media out is not counted). See [06-performance.md](06-performance.md).

| # | Document | What it settles |
|---|---|---|
| 01 | [01-system-plan.md](01-system-plan.md) | Goals, current state of the code, decisions, known issues, milestones |
| 02 | [02-architecture.md](02-architecture.md) | Components, phases, data ownership, table rules, sync flows |
| 03 | [03-backend.md](03-backend.md) | Repo layout, files that change, control tables, coding rules |
| 04 | [04-frontend.md](04-frontend.md) | The three screens: exporter (command line), Sync Console, staff page |
| 05 | [05-contracts.md](05-contracts.md) | Package file format, upload and console API, sequence rules |
| 06 | [06-performance.md](06-performance.md) | The 15-minute budget and how each step meets it |
| 07 | [07-deployment.md](07-deployment.md) | Air gap rules, keys, installing, monthly procedure, recovery |
| 08 | [08-work-split.md](08-work-split.md) | Who builds what: 2 developers, 2 build days, 1 test day |

Names used throughout: **Sync Exporter** (inside the offline network; a standalone program in Phase 1, a payroll-app section in Phase 2), **package** (`.npsync` file), **Sync Import** (endpoints on the website), **Sync Console** (admin section on the website), **office DB**, **website DB**.

Code lives in two repos: the exporter and shared format in the new `navy-payslip-sync` repo; the website side in NAVY-PAYROLL. There are three screens: the exporter (command line, inside), the Sync Console (website admin), and the unchanged staff payslip page. See [04-frontend.md](04-frontend.md).

Status: plan approved for build. Delivery: 2 build days + 1 test day (see 08).
