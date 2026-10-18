# 01 — System Plan

## 1. Purpose

Run, observe, change and recover the NAVY-PAYROLL server safely from anywhere. Every action is authenticated, authorised and audited, and nothing depends on the thing being repaired.

## 2. Scope

**In scope (v1):** everything marked P0 in `OPS-KAIZEN-INVENTORY.md`:
- edge & tunnel, remote access, services, host, firewall, SSH
- config, deploys/rollback, MySQL
- backups/restore, jobs, logs, health/alerts, audit

**Later:** P1/P2 items (incidents, runbooks, two-person approval for more actions, KPIs, replicas, cloud failover).

**Out of scope:**
- a general remote shell in the browser (SSH via Access covers that)
- editing payroll business data
- managing machines other than this server (the design leaves room for it)

## 3. Users & roles

| Role | Who | Can |
|---|---|---|
| **viewer** | Management, support staff | See everything except secrets; no actions |
| **operator** | Day-to-day ops / devs | Low and medium risk actions: restart services, run backups, purge cache, ack alerts, run read-only SQL |
| **admin** | Lead engineers (2–3 people) | Everything; approves high and critical actions; manages users, rules, policies |
| **system** | Kaizen itself (scheduler, watchdogs) | Scheduled actions only, always audited as `system` |

Identity comes from **Cloudflare Access** (SSO / one-time PIN). Kaizen maps each verified email to one of these roles.

## 4. Goals

1. **Operate from anywhere.** No VPN or LAN needed. Ops reach `ops.<domain>` behind Access, and SSH/RDP through Access.
2. **Independence.** Kaizen keeps working when Payroll, MySQL or the internet link is down, to the extent physics allows.
3. **Safe by default.**
   - Allow-listed actions only.
   - Risk levels.
   - Approvals for destructive actions.
   - Payroll-calendar blocks.
4. **Know before users do.** Health checks, external probes, a dead-man's switch and alerts to phones.
5. **Recoverable.**
   - Verified off-site backups.
   - One-click rollback.
   - A rehearsed restore.
6. **Kaizen.**
   - Every action, change and incident is recorded.
   - The improvement backlog is visible and measured.

## 5. Non-functional requirements

| Area | Requirement |
|---|---|
| Availability | Kaizen API ≥ 99.5% monthly. The Agent's core loops (heartbeat, watchdogs, scheduled backups) keep running when the API is down |
| Independence | No runtime dependency on Payroll, on Payroll's MySQL or on Redis. Own data store (SQLite). Own Node runtime |
| Security | Access JWT verified on every request. RBAC in the API. Agent reachable only through a local named pipe with HMAC. No inbound internet ports. Secrets DPAPI-encrypted at rest |
| Auditability | 100% of mutating requests and actions are written to an append-only audit table before execution and updated after |
| Footprint | API + Agent < 300 MB RAM, < 3% average CPU on the i7/32 GB box |
| Latency | Dashboard load < 2 s over the tunnel. Live metrics tick every 5 s. Log tail lag < 2 s |
| Data retention | Metrics: 1-min resolution for 14 days, 1-hour rollups for 400 days. Audit: forever (archived yearly). Action logs: 180 days |
| Usability | Works on a phone (responsive). Every destructive action needs a typed confirmation and a reason |
| Portability | Bundled Node runtime and binaries. Install/upgrade with one script. Machine-specific values only in config |

## 6. Key decisions (ADR summary)

| # | Decision | Why | Rejected |
|---|---|---|---|
| D1 | **Separate product (own repo, own services)**, not inside Payroll | Must stop, restore and roll back Payroll. Different security boundary | Admin pages inside Payroll |
| D2 | **Split API (unprivileged) / Agent (privileged)** | Web-facing process never holds admin rights. Agent exposes allow-listed actions only | Single admin process |
| D3 | **Agent ↔ API over a Windows named pipe + HMAC** | Not network-reachable, ACL-restricted, no port to firewall | Localhost HTTP, gRPC |
| D4 | **SQLite (WAL) for Kaizen state** | Zero dependency, survives MySQL outages, simple backups | Reuse MySQL, PostgreSQL |
| D5 | **Node 22 + TypeScript everywhere; Express 5 + zod** | Team's stack; shared types via `packages/contracts` | Go/.NET agent (team skill), Fastify (team familiarity) |
| D6 | **React + Vite + TanStack Query + Tailwind/shadcn** for the web | Team knows React/TS; fast; typed client from contracts | Vanilla JS like Payroll |
| D7 | **Cloudflare Access as the front door + Access JWT check + local RBAC** | MFA/SSO without building it; defence in depth | Own login with TOTP (kept only as LAN break-glass) |
| D8 | **SSE for live data** (metrics, logs, action progress) | Works through tunnel and proxies; one-way is enough | WebSockets |
| D9 | **Actions are asynchronous records** (`POST` → `202 actionId` → SSE progress) | Long operations, approvals, audit and retries share one model | Synchronous RPC endpoints |
| D10 | **Payroll releases as folders + junction switch** | Atomic switch, instant rollback, no robocopy drift | In-place robocopy (current) |
| D11 | **Off-site backups to S3-compatible storage (Cloudflare R2 default)**, AES-256-GCM client-side encryption | Same vendor as the edge; no egress fees; provider-agnostic API | Copies on the same disk (current) |
| D12 | **External dead-man's switch** (Healthchecks.io / Better Stack / a Cloudflare Worker) | Only something outside the box can report that the box is gone | Internal-only alerts |
| D13 | **Bundled portable Node runtime** for Kaizen (and recommended for Payroll) | Removes the "WinSW XML hardcodes Node path" failure | System-wide Node |

## 7. Phases & acceptance criteria

Indicative sizing assumes 1–2 developers. Each phase ships to the real server behind Access.

| Phase | Content | Done when | Size |
|---|---|---|---|
| **M0 — Foundation** | Monorepo, contracts package, API skeleton (auth, RBAC, audit, errors), Agent skeleton (pipe, HMAC, action registry), SQLite + migrations, Web shell (layout, auth, routing), install script, Cloudflare Access app for `ops.<domain>` | Login through Access shows your role. A no-op action round-trips Web → API → Agent → audit | M |
| **M1 — See** | Services dashboard + start/stop/restart, host metrics + charts, disk guard, log sources + live tail, Payroll deep health (needs Payroll `/internal/ops`), external probe + heartbeat, alert rules + Telegram/email channels | Killing NavyPayroll-App raises an alert on a phone within 2 min, and an operator restarts it from the phone | M |
| **M2 — Protect data** | Backup policies, all-DB scheduled backups by the Agent, encryption + R2 upload, retention, verify (checksum + scratch restore), restore flow with maintenance mode + approval | Nightly backups of all 7 DBs land in R2. A weekly automated test-restore passes. A restore drill is timed and recorded | L |
| **M3 — Ship safely** | Release folders + junction for Payroll, deploy pipeline via Kaizen (pre-backup, `npm ci`, migrate, switch, restart, health gate, cache purge, auto-rollback), deploy history, manual rollback | A bad commit auto-rolls back within 2 min with no manual steps | L |
| **M4 — Edge & access** | Tunnel status + watchdog, ingress view, Cloudflare analytics, WAF/rate-limit/cache rule status, maintenance page, Access logs into audit, SSH key mgmt + sshd hardening, firewall view/tighten | Port scan of the public IP shows nothing open. SSH works only via Access. Tunnel restart is automatic | M |
| **M5 — DB & config** | MySQL instance/DB/processlist/kill, migrations status, read-only SQL console, env viewer/editor (masked, versioned, approval), Windows Update view/install | Operator kills a runaway query from the phone. An env change goes through approval and is versioned | M |
| **M6 — Kaizen loop** | Incidents + timeline, runbooks (scripted), change log, KPIs (uptime, MTTR, deploy fail rate, backup success, restore time), security findings tracker | Monthly ops review can be run entirely from Kaizen | M |

## 8. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Tunnel/Cloudflare outage locks everyone out | No remote ops | Break-glass: LAN login with TOTP, on-site contact, second channel (Tailscale) documented and tested quarterly |
| Agent compromise = SYSTEM on the box | Total | No arbitrary command action; allow-listed PowerShell scripts with typed params; pipe ACL; HMAC; code signing of releases; audit |
| Kaizen bug takes Payroll down (bad restart, bad restore) | Outage | Risk levels, approvals, payroll-calendar blocks, dry-runs, pre-action backups, typed confirmations |
| Backups silently broken | Data loss | Checksums, automated weekly scratch restore, alert on stale/failed |
| Single physical box | Hardware loss | Off-site encrypted backups + bare-metal runbook + optional cloud failover (P2) |
| Scope creep into a full RMM | Never ships | Phase gates above. P1/P2 stay in the backlog until M5 is done |

## 9. Open decisions for the team

1. Public hostnames: `payroll.<domain>`, `ops.<domain>`, `ssh.<domain>`, `rdp.<domain>`. Final `<domain>`?
2. Cloudflare plan (Free/Pro is enough unless >100 MB uploads or Enterprise timeouts are needed).
3. Identity provider for Access (Google Workspace / Microsoft / GitHub / one-time PIN).
4. Off-site backup target (R2 default) and retention (7 daily / 4 weekly / 12 monthly proposed).
5. Alert channels (Telegram bot + email proposed; Termii SMS for critical).
6. Approval policy: which actions need a second admin.
7. Payroll calendar: which days/hours block high-risk actions (e.g. 20th–5th).
8. Keep LAN access to Payroll (proxy/mDNS) or tunnel-only.
