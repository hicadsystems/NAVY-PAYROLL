# 07 — Deployment, Security and Operations

## 1. Keeping the air gap

- The payroll network stays offline. No machine is on the payroll network and the internet at the same time.
- Data leaves only as a package file, on approved removable media, under the existing media-handling procedure (log, scan, encrypted drive where policy requires).
- Nothing is brought into the payroll network except the exporter program itself, once per version, through the approved process. No data files come in, Phase 2 included.
- The exporter has no internet code paths, no auto-update, and no web server or open ports: it is a command-line program.
- Security sign-off on this procedure is milestone M0.

## 2. Keys

| Key | Made where | Kept where | Used for |
|---|---|---|---|
| Website key pair (X25519) | Website, once | Private key in website `.env` / secret store; public key built into the exporter | Only the website can open a package |
| Exporter key pair (Ed25519) | Exporter, on first run inside | Private key on the payroll machine; public key travels inside every package and is approved once in the Console by a super admin who compares the key id with the exporter's screen | Website knows which exporter made a package |

A lost USB stick or laptop exposes nothing readable. A package not signed by a registered exporter is refused.

## 3. Logins

- Exporter → payroll DB: read-only login (`db_datareader` on MSSQL), never `sa`. Password in Windows Credential Manager or typed each time.
- Website writes: MySQL user `sync_writer` with rights only on manifest tables, their `__stage` / `__prev` copies and `sync_*` tables.
- Console: existing login; Upload / Go live / Withdraw / Roll back limited to a sync role; exporter registration to super admin.

## 4. Installing

- **Phase 1:** `navy-sync-exporter.exe` (one file, Node single executable) plus `README.txt`, copied in through the approved process. First run: makes the exporter key, shows its public key for registration, asks for the read-only connection.
- **Phase 2:** no separate program; the **Export for web** section of NAVY-PAYROLL on the payroll server (`APP_ROLE=payroll-office`).

Settings (`.env` on the website; exporter settings screen inside):

| Setting | Where | Meaning |
|---|---|---|
| `SYNC_PRIVATE_KEY` | Website | Opens packages |
| `SYNC_UPLOAD_DIR` | Website | Temporary chunk store |
| `SYNC_AUTO_GOLIVE` | Website | Go live automatically after a clean prepare |
| `SYNC_BATCH_ROWS` | Exporter | Rows per batch (default 5000) |
| `SYNC_DB_CONCURRENCY` | Exporter | Databases read in parallel (default 6) |
| `SYNC_DB_MAP` | Exporter | Payroll DB name → website DB name per class |
| Output folder | Exporter | Default: the inserted removable drive |

## 5. Procedure each month

1. Payroll closes the month's calculation.
2. Payroll officer runs the exporter: Connect → Export. Notes seq, size and fingerprint in the media log.
3. Media moves out under the media procedure.
4. Sync officer uploads in the Console, checks the fingerprint matches the log, reviews the totals screen.
5. Go live. Delete the package from the media after the Console shows `published`.

## 6. Monitoring

- Console shows the last package received and its age; warns when the current month has no package after the expected date.
- Failed runs and machine time over 15 min raise an admin notification.
- The exporter ledger (inside) and `sync_packages` (outside) together give a full audit trail: who exported, who uploaded, when, which fingerprint.

## 7. Recovery

- A failed run leaves live tables untouched; fix and upload again.
- A bad publish: **Roll back** (from `__prev`) or upload a corrected package.
- Lost package / sequence gap: export a full package.
- Website DB lost: restore from backup, then upload a full package.
