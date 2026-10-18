# Ops / Kaizen — Operations Inventory for the NAVY-PAYROLL Windows Server

Scope: everything that has to be run, watched, changed or recovered on the physical Windows server **after** `setup.bat` finishes. This includes operating it **from anywhere**: on the LAN or over the internet through **Cloudflare Tunnel**.
Source: `setup.bat`, `install-service.js`, `install-runner.js`, `proxy.js`, `mdns.js`, `watcher.js`, `server.js`, `.github/workflows/deploy.yml`, `routes/utilities/backup-db.js`, `restore-db.js`, emolument scheduler, `.env.*` keys, `docs/SECURITY_AUDIT_REPORT.md`.

Priority: **P0** = before go-live / before exposing to the internet · **P1** = first month · **P2** = later improvement

---

## Target topology (internet-facing via Cloudflare Tunnel)

```
                      Internet users (30k+)                 Ops team (anywhere)
                              │                                   │
                       ┌──────▼───────────────────────────────────▼──────┐
                       │                 Cloudflare edge                  │
                       │ DNS · TLS · WAF · rate limiting · bot/DDoS · cache│
                       │ Cloudflare Access (Zero Trust) for ops hostnames  │
                       └──────┬───────────────────────────────────┬──────┘
                              │      outbound-only tunnel (QUIC/HTTP2)
                       ┌──────▼───────────────────────────────────▼──────┐
  Windows server       │  cloudflared (Windows service, ≥2 replicas)       │
  NO inbound ports     │   payroll.<domain>  → http://127.0.0.1:5500 (App) │
  from the internet    │   ops.<domain>      → http://127.0.0.1:<ops-port> │
                       │   ssh.<domain>      → ssh://127.0.0.1:22          │
                       │   rdp.<domain>      → rdp://127.0.0.1:3389        │
                       │   (private net)     → MySQL 3306 via WARP only    │
                       └──────────────────────────────────────────────────┘
       LAN users (optional) → Proxy 443 → App 5500 (existing setup.bat path)
```

What this changes compared with the LAN-only design:
- Users reach the app at a **public hostname** with Cloudflare-managed TLS. The `.local` domain, mDNS, hosts entry and self-signed cert become a **LAN-only fallback**, not the main path.
- The server needs **no inbound ports from the internet**. The router keeps no port-forwards, and Windows Firewall keeps 443/80/22/5500 closed to everything except loopback (and the LAN if you keep LAN access).
- Ops traffic (ops app, SSH, RDP, DB) goes through **Cloudflare Access**: identity, MFA, device posture and an audit log for every session.
- The tunnel is now a **single point of remote access**. If cloudflared dies, every remote path goes with it, which is why there are watchdog, replica and fallback items below.
- Cloudflare edge limits now apply to the app: **upload body limit 100 MB on Free/Pro** (200 MB Business), and a **~125 s proxy read timeout (524)**.

---

## 0. What is on the box (managed components)

| Component | How it runs | Ports | Defined in |
|---|---|---|---|
| NavyPayroll-App (`server.js`) | WinSW service | 5500 | install-service.js |
| NavyPayroll-Proxy (`proxy.js`) | WinSW service: LAN-only after tunnel | 443 → 5500, 80 → 301 | install-service.js |
| NavyPayroll-Watcher (`watcher.js`) | WinSW service: restarts App on file change | — | install-service.js |
| NavyPayroll-mDNS (`mdns.js`) | WinSW service: LAN-only `.local` | UDP 5353 | install-service.js |
| **cloudflared** | Windows service (`cloudflared service install <token>`) | outbound 7844 / 443 | **new** |
| **Ops app + privileged agent** | Own Windows service(s) | 127.0.0.1 only | **new** |
| GitHub Actions runner | `actions.runner.*` service | outbound 443 | install-runner.js |
| OpenSSH Server | `sshd` | 22 (loopback/LAN only) | setup.bat |
| MySQL 8 | `MySQL*` service | 3306 (loopback only) | prerequisite |
| MSSQL (optional) / Redis (optional) | services | 1433 / 6379 | prerequisite |
| Chromium (Puppeteer) / jsreport | spawned by App | — | `.cache/puppeteer` |
| Self-signed TLS cert | `cert.pem`/`key.pem`: LAN path only | — | setup.bat |
| Firewall rules / URL ACLs / hosts entry | `NAVY_PAYROLL_*`, profile=any | — | setup.bat |
| In-app cron jobs | node-cron inside App | — | routes/index.js, emolument.scheduler.js, backup-db.js |
| Backups / restore history | `./backups`, `./cloud_backups`, `restores/` | — | backup-db.js, restore-db.js |
| Logs | WinSW roll-by-size 10 MB × 5 in `./logs` | — | install-service.js |
| External deps | Cloudflare, SMTP/Termii, Cloudinary, GitHub | outbound | .env keys |

---

## 1. Cloudflare Edge & Tunnel (new)

| # | Operation | Detail | Pri |
|---|---|---|---|
| 1.1 | Tunnel status | Connector health (healthy/degraded/down), connected edge locations, cloudflared version, uptime, via Cloudflare API + local `cloudflared` metrics endpoint | P0 |
| 1.2 | cloudflared service control | Start/stop/restart, start mode Automatic, recovery actions (restart on failure) | P0 |
| 1.3 | Tunnel watchdog | Local agent restarts cloudflared if metrics show 0 connections; alert if it stays down | P0 |
| 1.4 | Replicas | Run ≥2 cloudflared connectors for the same tunnel (second instance on this box, ideally one on a second machine on the LAN) | P1 |
| 1.5 | Ingress rules | Public hostname → local service map (payroll, ops, ssh, rdp); view/edit (remotely-managed tunnel via dashboard/API) | P0 |
| 1.6 | Origin target | Point tunnel at `http://127.0.0.1:5500` (App bound to loopback). If the App stays HTTPS, set `noTLSVerify`/`originServerName` deliberately | P0 |
| 1.7 | Tunnel token rotation | Token is the tunnel's only credential: store securely, rotate, re-install service | P1 |
| 1.8 | cloudflared updates | Version drift vs latest; scheduled update + restart | P1 |
| 1.9 | DNS records | View/edit records for the zone (proxied CNAMEs to `<tunnel-id>.cfargotunnel.com`) | P1 |
| 1.10 | Edge TLS settings | SSL mode, min TLS 1.2, HSTS, Always Use HTTPS, edge cert status | P0 |
| 1.11 | WAF | Managed rules on, custom rules (block admin/backup/restore paths from non-ops users, geo rules if relevant) | P0 |
| 1.12 | Edge rate limiting | Login, OTP, password reset, report/PDF endpoints: the app has **no rate limiter in code** today | P0 |
| 1.13 | Bot / DDoS | Bot Fight Mode / Super Bot Fight, Under Attack mode toggle from the ops app | P1 |
| 1.14 | Cache rules | Cache `public/` static assets; **bypass cache** for API/auth/report routes; purge cache on deploy | P0 |
| 1.15 | Upload limit handling | Edge caps request bodies (100 MB Free/Pro). Restore upload allows 10 GB → large restores must go over SSH/SFTP or chunked upload | P0 |
| 1.16 | Timeout handling | ~125 s edge read timeout. Payroll calculation finishes well under 90 s; **PDF printing is what exceeds it**. Handled by `middware/asyncExport.js` + `public/script/async-export.js`: exports done within 30 s return inline, longer ones become background jobs the browser polls (`/async-jobs/:id`). Ops: watch running/queued exports, durations, failures (`getStats()`) | P0 |
| 1.17 | WebSockets | Socket.IO through the tunnel: enable WebSockets on the zone, verify reconnect behaviour | P1 |
| 1.18 | Analytics & logs | Requests, threats blocked, 5xx/524 rates, top paths, top countries, from Cloudflare GraphQL Analytics API | P1 |
| 1.19 | Cloudflare notifications | Tunnel health alerts, DDoS alerts, origin error-rate alerts → ops channels | P0 |
| 1.20 | Cloudflare account security | 2FA on all members, least-privilege roles, scoped API tokens for the ops app, account audit log review | P0 |
| 1.21 | Maintenance page at the edge | Serve a maintenance page from Cloudflare (Worker/custom error page) when origin is down or during deploy/restore | P1 |

## 2. Zero Trust Remote Access (from anywhere)

| # | Operation | Detail | Pri |
|---|---|---|---|
| 2.1 | Access applications | One per ops hostname (ops, ssh, rdp) with policies: allowed emails/groups, MFA, session duration | P0 |
| 2.2 | Identity provider | Google/Microsoft/GitHub SSO or one-time PIN; no shared accounts | P0 |
| 2.3 | Ops app verifies Access JWT | Validate `Cf-Access-Jwt-Assertion` (team certs + AUD) in the ops app as well, so nothing that bypasses Access gets in | P0 |
| 2.4 | SSH via Access | `ssh.<domain>`: browser-rendered terminal or `cloudflared access ssh` ProxyCommand on admin laptops; port 22 closed to the internet | P0 |
| 2.5 | SSH short-lived certificates | Access-issued short-lived certs instead of long-lived authorized_keys | P2 |
| 2.6 | RDP via Access | Browser-based RDP or `cloudflared access rdp`; RDP never port-forwarded | P1 |
| 2.7 | DB access from anywhere | MySQL only via WARP private network route or `cloudflared access tcp`, never a public hostname | P1 |
| 2.8 | Device posture | Require WARP client / OS version / disk encryption on admin devices (optional) | P2 |
| 2.9 | Access audit logs | Who opened ops/ssh/rdp, from where, when; pulled into the ops app's audit timeline | P0 |
| 2.10 | Break-glass access | Documented fallback when the tunnel or Cloudflare is down: on-site person, LAN access, or a second independent channel (e.g. Tailscale/WARP connector on another path) | P0 |
| 2.11 | Offboarding | Remove user from IdP/Access group → instant loss of all remote access | P1 |

## 3. Host / Operating System

| # | Operation | Detail | Pri |
|---|---|---|---|
| 3.1 | Live host stats | CPU, RAM, disk per volume, uptime, top processes (node, mysqld, chrome, cloudflared) | P0 |
| 3.2 | Disk space guard | Alert at 80/90%: backups, logs, uploads, puppeteer temp share one drive | P0 |
| 3.3 | Windows Update | Pending updates, last install, install in maintenance window, pending-reboot flag | P0 |
| 3.4 | Controlled reboot (remote) | Pre-checks (no payroll run, no restore), reboot, then **confirm the tunnel reconnects** and all services return | P0 |
| 3.5 | Time sync (NTP) | `w32tm` status/resync: JWT expiry, cron windows, Access JWT validation depend on clock | P0 |
| 3.6 | Windows Event Log viewer | System / Application / Security, filtered by source | P1 |
| 3.7 | Power plan & auto-power-on | High Performance, no sleep/hibernate, BIOS restore-on-power-loss | P0 |
| 3.8 | Installed software inventory | Node, MySQL, OpenSSL, Git, Chrome, runner, cloudflared versions + drift | P1 |
| 3.9 | Local Windows accounts | Admins, last logon, unused accounts, service account password expiry | P1 |
| 3.10 | Windows Defender | Status, signatures age, scans, threats, exclusions | P1 |
| 3.11 | Temp / cache cleanup | `%TEMP%`, Chromium temp, `temp/`, orphaned attachments | P1 |
| 3.12 | Hostname | View/change (runner name derives from it) | P2 |

## 4. Hardware (physical machine)

| # | Operation | Detail | Pri |
|---|---|---|---|
| 4.1 | Disk health (SMART) | Reallocated sectors, wear, temp, predicted failure | P0 |
| 4.2 | RAID / Storage Spaces | Array state, rebuild progress | P1 |
| 4.3 | UPS integration | Battery %, on-battery alert, graceful shutdown order (App → MySQL → OS) | P0 |
| 4.4 | Temperatures / fans | Via WMI / hardware monitor | P2 |
| 4.5 | Asset record | Serial, specs, warranty, location, who has physical access | P2 |
| 4.6 | On-site contact | Named person who can power-cycle the box when remote access is gone | P0 |

## 5. Network & Internet Link

| # | Operation | Detail | Pri |
|---|---|---|---|
| 5.1 | Adapter & IP view | Active adapter, IP, gateway, DNS, link speed | P0 |
| 5.2 | WAN link health | Internet up/down, latency, packet loss, ISP outage history: **public access now depends on it** | P0 |
| 5.3 | Second WAN / failover | Backup ISP or LTE router; cloudflared reconnects over whichever link is up | P1 |
| 5.4 | Bandwidth usage | Upload throughput matters (PDFs, exports served out through the tunnel) | P1 |
| 5.5 | Outbound egress check | Tunnel needs outbound 7844 (UDP/TCP) or falls back to HTTP2/443: verify the router/ISP doesn't block it | P0 |
| 5.6 | LAN IP drift (LAN path only) | Live IP vs `LOCAL_IP` in env, cert SAN, hosts file. Matters only if LAN access is kept; tunnel does not care | P1 |
| 5.7 | Static IP / DHCP reservation | setup.bat promises it but never sets it | P1 |
| 5.8 | Bind mode | App → `127.0.0.1` when served only via tunnel; `0.0.0.0` only if LAN users hit it directly | P0 |
| 5.9 | mDNS / `.local` check | LAN fallback only | P2 |
| 5.10 | Connectivity tests | Cloudflare edge, GitHub, SMTP/Termii, Cloudinary reachability | P0 |

## 6. Firewall & Ports

| # | Operation | Detail | Pri |
|---|---|---|---|
| 6.1 | Rule list | All `NAVY_PAYROLL_*` rules + anything else inbound-allowed | P0 |
| 6.2 | Port map | Listener → PID → service for 22/80/443/3306/3389/5500/5353/6379/ops-port | P0 |
| 6.3 | Zero inbound from internet | Router: no port-forwards. Windows Firewall: 22/3389/3306/5500 loopback (or LAN admin subnet) only | P0 |
| 6.4 | Remove `profile=any` rules | Current rules open 5500/443/80/5353/22 on every profile, including Public | P0 |
| 6.5 | Exposure check | From outside: confirm the public IP answers on nothing. From LAN: only what's intended | P1 |
| 6.6 | Port conflict resolution | Guided version of setup.bat step 0 | P2 |

## 7. TLS / Certificates

| # | Operation | Detail | Pri |
|---|---|---|---|
| 7.1 | Edge certificate | Cloudflare-managed: status and expiry visible in ops app | P0 |
| 7.2 | Origin TLS | Tunnel → loopback can be plain HTTP. If HTTPS to origin is kept, use Cloudflare Origin CA cert | P1 |
| 7.3 | LAN self-signed cert | Details, SANs, regenerate (`bin/openssl.exe`), client trust distribution: LAN path only | P2 |
| 7.4 | Key file ACLs | `key.pem`, tunnel token/credentials: service account + admins only | P1 |

## 8. SSH / RDP (server side)

| # | Operation | Detail | Pri |
|---|---|---|---|
| 8.1 | sshd status | Running, auto start, version, listen address | P0 |
| 8.2 | Harden `sshd_config` | `PasswordAuthentication no`, `AllowUsers`/`AllowGroups`, `MaxAuthTries`, `ListenAddress 127.0.0.1` (+ LAN if needed) | P0 |
| 8.3 | Key management | Add/remove/rotate; admin keys in `C:\ProgramData\ssh\administrators_authorized_keys` with SYSTEM+Administrators-only ACL | P0 |
| 8.4 | Session & login audit | Active sessions, success/failure (OpenSSH/Operational log) correlated with Access logs | P1 |
| 8.5 | Default shell | PowerShell as SSH default shell | P2 |
| 8.6 | RDP | NLA on, allowed users, loopback/LAN-only listener | P1 |
| 8.7 | SFTP for large files | Uploading big SQL dumps for restore (bypasses edge 100 MB limit) | P0 |

## 9. Windows Services & Processes

| # | Operation | Detail | Pri |
|---|---|---|---|
| 9.1 | Service dashboard | App, Proxy, Watcher, mDNS, cloudflared, runner, sshd, MySQL, Redis, ops agent: state, PID, uptime, memory | P0 |
| 9.2 | Start / stop / restart | Per service, confirmation + audit entry | P0 |
| 9.3 | Crash-loop detection | WinSW restarts on failure (5s/10s/20s); alert on loops | P0 |
| 9.4 | Boot order | WinSW XML has no `<depend>` on MySQL; App can start before the DB | P0 |
| 9.5 | Node path pinning | WinSW XML hardcodes `process.execPath`; Node upgrade breaks all 4 services | P0 |
| 9.6 | Watcher in production | Restarts App on every .js write, including during deploy; disable in prod | P0 |
| 9.7 | Reinstall / uninstall services | Wrap `install-service.js` / `uninstall-service.js` | P1 |
| 9.8 | Service account | Move off LocalSystem to least-privilege account | P1 |
| 9.9 | Stray process cleanup | Orphaned `chrome.exe` / `node.exe` | P1 |
| 9.10 | Graceful restart | Drain in-flight requests/payroll runs; show users a maintenance page meanwhile | P1 |

## 10. Application Configuration & Secrets

| # | Operation | Detail | Pri |
|---|---|---|---|
| 10.1 | Env viewer/editor | `.env.local`, `.env.production`, `.env`: masked, diffed, validated against `.env.example` | P0 |
| 10.2 | Know which file is live | Services set `NODE_ENV=production` → `.env.production` loads; `ENV_FILE`/`FORCE_LOCAL` in WinSW XML are read by nothing | P0 |
| 10.3 | Public-hostname settings | Add public origin to CORS list (`server.js` only lists localhost/LAN/hicad.ng), `BASE_URL`, cookie `secure`/`sameSite`, `TRUST_PROXY` | P0 |
| 10.4 | Real client IP | Behind cloudflared every request comes from 127.0.0.1. Read `CF-Connecting-IP` for logging, audit trail and any per-IP limiter | P0 |
| 10.5 | Apply change + restart | Edit → validate → restart affected services | P0 |
| 10.6 | Secret rotation | JWT/refresh secrets, MySQL, SMTP, Termii, Cloudinary, GitHub PAT, tunnel token, Cloudflare API token | P1 |
| 10.7 | GitHub PAT on disk | Actions+Administration write PAT left in `.env.local` after runner registration: remove | P0 |
| 10.8 | Config history | Versioned snapshots of env, WinSW XML, sshd_config, my.ini, tunnel ingress | P1 |
| 10.9 | Feature toggles | `REDIS_ENABLED`, `USE_JSREPORT_FALLBACK`, `PDF_TAB_POOL_SIZE`, `DB_TRACE_QUERIES` | P2 |

## 11. Deployments & Releases

| # | Operation | Detail | Pri |
|---|---|---|---|
| 11.1 | Runner status | Online/offline/busy, version, last job | P0 |
| 11.2 | Deploy history | SHA, author, time, duration, result | P0 |
| 11.3 | Deployed version | SHA on disk vs `master` | P0 |
| 11.4 | Pre-deploy backup | Not done today | P0 |
| 11.5 | Health-gated deploy | Pipeline sleeps 15 s; no `/health` check, no fail on bad start | P0 |
| 11.6 | Rollback | Keep last N releases, one-click switch back | P0 |
| 11.7 | Migrations in pipeline | `migrate:up` not run; show `migrate:status` per DB | P0 |
| 11.8 | Cache purge on deploy | Purge Cloudflare cache for static assets after deploy | P0 |
| 11.9 | Maintenance mode | Edge maintenance page during deploy/restore | P1 |
| 11.10 | Build steps | `build:css` not in pipeline | P1 |
| 11.11 | Stale files | `robocopy /E` without `/PURGE` | P1 |
| 11.12 | Manual deploy / redeploy SHA | From the ops app | P1 |
| 11.13 | Runner re-registration & updates | Token expiry, `--replace`, version | P1 |
| 11.14 | Dependency audit | `npm audit`, outdated packages | P2 |

## 12. Database (MySQL)

| # | Operation | Detail | Pri |
|---|---|---|---|
| 12.1 | Service & connectivity | State, version, uptime, reachability of each configured DB | P0 |
| 12.2 | DB inventory | `hicaddata` + OFFICERS, WOFFICERS, RATINGS, RATINGS_A, RATINGS_B, JUNIOR_TRAINEE: size, tables, key row counts | P0 |
| 12.3 | Connections & pools | `SHOW PROCESSLIST`, threads vs `max_connections`, per-DB pool usage | P0 |
| 12.4 | Kill query/connection | Long-running or stuck queries | P0 |
| 12.5 | `bind-address=127.0.0.1` | MySQL never reachable from network; remote DB work via WARP/`cloudflared access tcp` | P0 |
| 12.6 | Users & grants | App user least privilege, no remote root, rotation | P0 |
| 12.7 | Schema health | Wrap `check-db-health.js` per DB | P0 |
| 12.8 | Migrations | Status/up/down per DB | P0 |
| 12.9 | Slow queries | Slow log, top N, link to endpoints (also explains 524s) | P1 |
| 12.10 | Locks & deadlocks | InnoDB status during payroll runs | P1 |
| 12.11 | Pool context diagnostics | Wrap `diagnose-db-pool.js` | P1 |
| 12.12 | `my.ini` tuning | Buffer pool for 32 GB box, connections, logs | P1 |
| 12.13 | Binary logs | Point-in-time recovery, retention | P1 |
| 12.14 | Read-only query console | SELECT with row limit + audit; writes need second approval | P1 |
| 12.15 | Data-fix scripts | `scripts/sql/` with dry-run + backup first | P1 |
| 12.16 | Datadir growth | Trend | P1 |
| 12.17 | Table maintenance | ANALYZE/OPTIMIZE/CHECK, duplicate indexes | P2 |
| 12.18 | Replica / standby | Read replica or warm standby | P2 |
| 12.19 | MSSQL equivalents | If adapter used | P2 |

## 13. Backup, Restore & Disaster Recovery

| # | Operation | Detail | Pri |
|---|---|---|---|
| 13.1 | Persistent schedules | `/backup/schedule` jobs are in-memory node-cron; lost on every restart/deploy. Move to the ops agent | P0 |
| 13.2 | All-DB backup | Every class DB + master, not just `req.current_class` | P0 |
| 13.3 | Off-site copy | Same disk today, `cloud_backups/` empty. Push encrypted copies off-site (Cloudflare R2 / S3 / Backblaze) | P0 |
| 13.4 | Retention | No pruning today; e.g. 7 daily / 4 weekly / 12 monthly | P0 |
| 13.5 | Verification | Checksums + scheduled test-restore into scratch DB | P0 |
| 13.6 | Status & alerts | Last success per DB, age, failures | P0 |
| 13.7 | Restore (remote-safe) | Async with progress (already exists); large dumps via SFTP or from off-site storage, not browser upload through the edge | P0 |
| 13.8 | Backup download over internet | CVE-2 path traversal on download; also restrict download to ops users behind Access | P0 |
| 13.9 | File backups | `.env*`, certs, tunnel credentials, `uploads/`, `preferences/`, `notifications/`, WinSW XML, my.ini | P0 |
| 13.10 | Encryption | Dumps hold payroll/bank data: encrypt at rest + in transit | P1 |
| 13.11 | Point-in-time recovery | Full + binlogs | P1 |
| 13.12 | Bare-metal rebuild runbook | New machine → prereqs → setup → cloudflared install → restore → verify; timed drill | P1 |
| 13.13 | Cloud failover option | Restore latest off-site backup to a VPS/Coolify and repoint the tunnel/DNS if the box is lost | P2 |
| 13.14 | RPO / RTO targets | Decide and measure | P1 |

## 14. Scheduled Jobs

| # | Operation | Detail | Pri |
|---|---|---|---|
| 14.1 | Job registry | Hourly attachment cleanup, emolument scheduler (every minute + daily), backup schedules | P0 |
| 14.2 | Last/next run, duration, result | Per job | P0 |
| 14.3 | Pause / resume / run now | Per job | P1 |
| 14.4 | Overlap guard | Every-minute job must not overlap itself | P1 |
| 14.5 | Legacy Task Scheduler entries | `NavyPayroll-App`/`-Proxy` tasks that setup.bat still ends: confirm removed | P1 |
| 14.6 | Ops-owned jobs | Backups, off-site sync, log rotation, disk cleanup, probes, tunnel watchdog | P0 |

## 15. Logs

| # | Operation | Detail | Pri |
|---|---|---|---|
| 15.1 | Live tail | App/Proxy/Watcher/mDNS, cloudflared, runner, MySQL error log, sshd | P0 |
| 15.2 | Search & filter | Time, level, route, user, client IP (from `CF-Connecting-IP`), Cloudflare Ray ID | P1 |
| 15.3 | Structured logs | morgan `dev` → JSON with request ID + Ray ID | P1 |
| 15.4 | Retention & off-box archive | WinSW keeps 5 × 10 MB | P1 |
| 15.5 | Error aggregation | Group stack traces, counts | P1 |
| 15.6 | Edge ↔ origin correlation | Match Cloudflare 5xx/524 events to origin logs by Ray ID | P2 |

## 16. Monitoring, Health & Alerting

| # | Operation | Detail | Pri |
|---|---|---|---|
| 16.1 | Deep health | `/health` is shallow; add DB per class, Redis, disk, Chromium. Keep public `/health` minimal, expose deep health only to ops | P0 |
| 16.2 | External uptime probes | From the internet against `payroll.<domain>/health` (now possible because it's public) | P0 |
| 16.3 | Dead-man's switch | Agent pushes heartbeats out; alert when they stop (box, power, WAN or tunnel down) | P0 |
| 16.4 | App metrics | Req/min, latency p50/p95, error rate, event-loop lag, heap, sockets | P1 |
| 16.5 | PDF engine metrics | Concurrent Chromium, queue depth, failures, RAM | P1 |
| 16.6 | Edge metrics | 4xx/5xx/524 rates, WAF blocks, rate-limit hits | P1 |
| 16.7 | Alert channels | Email, SMS (Termii), Telegram/WhatsApp, push to phone | P0 |
| 16.8 | Alert rules | Service down, crash loop, tunnel degraded, WAN down, disk, backup failed/stale, cert/edge issues, SSH/Access anomalies, MySQL connections high, 524 spike | P0 |
| 16.9 | Public status page | Hosted off-box (so it works when the server is down) | P2 |
| 16.10 | Active users | Sessions per role/class | P2 |

## 17. Security & Compliance (now internet-facing)

| # | Operation | Detail | Pri |
|---|---|---|---|
| 17.1 | Close audit findings before exposure | `SECURITY_AUDIT_REPORT.md`: 5 critical + 8 high, now reachable from the internet | P0 |
| 17.2 | Login rate limiting | readme claims 10/15 min per IP, but there is **no rate limiter in code**; add app-level (keyed on `CF-Connecting-IP`) + edge rule | P0 |
| 17.3 | Directory listing | `app.use("/public", serveIndex(...))` lists `public/` to anyone; remove or restrict | P0 |
| 17.4 | Admin/ops routes exposure | Backup, restore, users/roles, system control routes: restrict to ops behind Access or at least WAF path rules | P0 |
| 17.5 | Token in query string | Audit CVE-3: query-param tokens leak into Cloudflare/origin logs and browser history | P0 |
| 17.6 | File/folder ACLs | `.env*`, keys, tunnel creds, `backups/`, `uploads/` | P0 |
| 17.7 | Patch compliance | OS, MySQL, Node, OpenSSL, Chromium, cloudflared | P1 |
| 17.8 | Failed logins | App, SSH, RDP, Windows 4625, Access denials | P1 |
| 17.9 | Secret scanning | Repo + server (e.g. scratch scripts with hardcoded JWTs) | P1 |
| 17.10 | Data protection | 40k personnel PII: who can export/download, logging of exports | P1 |
| 17.11 | Pen test | External test against the public hostname before go-live | P1 |
| 17.12 | BitLocker | Physical box in a shared location | P2 |

## 18. External Dependencies

| # | Operation | Detail | Pri |
|---|---|---|---|
| 18.1 | Cloudflare | Account status, plan limits, API token validity, incidents (cloudflarestatus.com) | P0 |
| 18.2 | SMTP / Termii | Test send, last error, quota | P1 |
| 18.3 | Cloudinary | Reachability, credentials, usage | P2 |
| 18.4 | GitHub | API, runner connection, PAT/token validity | P1 |
| 18.5 | ISP | Contact, SLA, outage log | P1 |

## 19. Storage & Files

| # | Operation | Detail | Pri |
|---|---|---|---|
| 19.1 | Folder sizes | backups, uploads, logs, temp, `.cache/puppeteer`, runner `_work`, MySQL datadir | P0 |
| 19.2 | Cleanup actions | Old backups per retention, temp, `_work`, leftover `actions-runner.zip` | P1 |
| 19.3 | Upload integrity | Orphaned/missing attachments | P2 |
| 19.4 | Data volume | Move backups/uploads off C: | P2 |

## 20. Redis (when enabled)

| # | Operation | Detail | Pri |
|---|---|---|---|
| 20.1 | Status | Up, memory, keys, clients | P1 |
| 20.2 | Token blacklist | Count/TTL; flush on secret rotation | P2 |
| 20.3 | Bind/password | 127.0.0.1, `requirepass` | P1 |

## 21. Provisioning & Lifecycle

| # | Operation | Detail | Pri |
|---|---|---|---|
| 21.1 | Prerequisite checker | Node, MySQL, OpenSSL, Git, WinSW, runner chunks, cloudflared | P1 |
| 21.2 | Idempotent re-setup | Re-run single steps (cert, firewall, services, runner, sshd, tunnel) | P1 |
| 21.3 | Tunnel install step | Add `cloudflared service install <token>` to setup (bundle `cloudflared.exe` in `bin/` like WinSW) | P0 |
| 21.4 | Firewall step rewrite | Replace `profile=any` rules with loopback/LAN-scoped rules | P0 |
| 21.5 | New-server bootstrap | Same steps for a replacement server; tunnel moves with the token | P2 |
| 21.6 | Decommission | Unregister runner, delete tunnel connector, remove services/rules, wipe secrets | P2 |

## 22. Kaizen: Incidents, Changes & Continuous Improvement

| # | Operation | Detail | Pri |
|---|---|---|---|
| 22.1 | Ops action audit log | Who (Access identity), what, when, from where, result: immutable | P0 |
| 22.2 | Incident log | Timeline, impact, cause, fix, linked logs/metrics/Ray IDs | P1 |
| 22.3 | Postmortems | Template + owned action items | P1 |
| 22.4 | Change log | Config edits, deploys, restores, reboots, patches, Cloudflare changes, one timeline | P1 |
| 22.5 | Runbooks | App down, MySQL down, disk full, tunnel down, WAN down, Cloudflare outage, restore, rollback: runnable from the app | P1 |
| 22.6 | Maintenance windows | Schedule, notify users, auto edge maintenance page | P1 |
| 22.7 | Payroll calendar awareness | Block risky ops during month-end processing | P1 |
| 22.8 | Improvement backlog | This document's P0/P1 items to closure | P1 |
| 22.9 | KPIs | Uptime %, MTTR, deploy frequency, failed deploys, backup success %, restore drill time, 524 rate | P2 |

## 23. The Ops App Itself

| # | Operation | Detail | Pri |
|---|---|---|---|
| 23.1 | Separate services | Ops web + privileged agent run independent of NavyPayroll-App, so they can stop/restore/roll back it | P0 |
| 23.2 | Loopback-only | Listens on 127.0.0.1; reached only via `ops.<domain>` (tunnel + Access) or LAN admin subnet | P0 |
| 23.3 | Double auth | Cloudflare Access at the edge + Access JWT validation + own RBAC (viewer/operator/admin) in the app | P0 |
| 23.4 | Privileged agent isolation | Admin rights (services, firewall, netsh, updates) only in the agent; web UI talks to it over a local authenticated channel with an allow-list of actions, no arbitrary shell | P0 |
| 23.5 | Two-person approval | Restore, DB writes, firewall/tunnel changes, reboot during payroll | P1 |
| 23.6 | Works when App is down | Own port, own process, minimal shared dependencies | P0 |
| 23.7 | Off-box presence | Heartbeats + alerts that work when the box or tunnel is down (16.3) | P0 |
| 23.8 | Mobile-friendly UI | Ops from a phone | P1 |
| 23.9 | Self-backup | Ops config, audit log, job history | P1 |

---

## Gaps found in the current setup

**Before exposing to the internet (P0):**
1. **No rate limiting in code.** The readme says login is limited to 10 per 15 min per IP, but there is no `express-rate-limit` usage. Behind the tunnel every request also arrives from 127.0.0.1, so a naive per-IP limiter would throttle all users together. (17.2, 10.4, 1.12)
2. **Public directory listing.** `serveIndex` on `/public` lists the folder to anyone on the internet. (17.3)
3. **Audit criticals become internet-exploitable.** These include CVE-2 (backup download path traversal) and CVE-3 (tokens in query strings). (17.1, 17.5, 13.8)
4. **Admin, backup and restore routes sit on the same public hostname** as the 30k-user app. (17.4)
5. **CORS has no public origin.** It allows only localhost/LAN/hicad.ng, and `TRUST_PROXY` is unset. (10.3)
6. **Edge limits vs current behaviour.** Restore accepts up to 10 GB uploads, but the edge caps bodies at 100 MB on Free/Pro. Large PDF prints exceeded the ~125 s 524 timeout; the async export layer now handles this (payroll calculation itself stays under 90 s). (1.15, 1.16)
7. **Ports opened `profile=any`.** 5500, 443, 80, 22 and 5353 are open on every network profile, and the App listens on 0.0.0.0. (6.3, 6.4, 5.8)
8. **SSH left at defaults.** Password auth is on and it's reachable network-wide. (8.2)
9. **High-privilege GitHub PAT left on disk.** (10.7)

**Reliability (P0):**
10. Backup schedules live in memory, cover only one DB, have no off-site copy and no retention. (13.1–13.4)
11. Deploy has no pre-backup, migrations, health gate, rollback or cache purge. (11.4–11.8)
12. The Watcher double-restarts the App during deploy. (9.6)
13. The Node path is hardcoded in the WinSW XML, and there is no MySQL boot dependency. (9.4, 9.5)
14. `/health` doesn't check dependencies. (16.1)
15. **Remote access has a single point of failure.** It all goes through one cloudflared instance on one WAN link, with no watchdog, replica or break-glass path yet. (1.3, 1.4, 2.10, 5.2, 5.3)

**LAN path (P1, only if LAN access is kept):** DHCP IP drift against `LOCAL_IP`/cert/hosts (5.6, 5.7). Dead `ENV_FILE`/`FORCE_LOCAL` settings in WinSW (10.2).

---

## Suggested v1 (P0) cut for the ops app

**Edge & access:** tunnel status + watchdog + ingress view, WAF/rate-limit/cache rules, Cloudflare notifications, Access apps for ops/ssh, Access JWT check, break-glass runbook.
**Server:** service dashboard + controls, host/disk stats, firewall view/tighten, SSH hardening + keys, env viewer/editor.
**Delivery:** deploy history, runner status, pre-deploy backup, health gate, rollback, cache purge.
**Data:** MySQL status/connections/kill/migrations/schema health, persistent all-DB backups with retention + off-site + verification, remote-safe restore.
**Visibility:** job registry, live logs, deep health, external probes, dead-man's switch, alerts, ops audit log.
**Architecture:** separate loopback-only ops web + privileged agent.
