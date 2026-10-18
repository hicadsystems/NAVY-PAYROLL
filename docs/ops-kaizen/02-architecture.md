# 02 — Architecture

## 1. Context

```
   Ops team (phone/laptop, anywhere)            Payroll users (30k+)
              │ HTTPS                                  │ HTTPS
   ┌──────────▼────────────────────────────────────────▼──────────┐
   │ Cloudflare: DNS · TLS · WAF · rate limit · Access (ops/ssh/rdp)│
   └──────────┬───────────────────────────── outbound-only tunnel ─┘
              │
 ┌────────────▼────────────── Windows server (no inbound internet ports) ──────────────┐
 │  cloudflared ─┬─ ops.<domain>     → 127.0.0.1:7700  Kaizen API (+ serves Kaizen Web) │
 │               ├─ payroll.<domain> → 127.0.0.1:5500  Payroll App                      │
 │               ├─ ssh.<domain>     → 127.0.0.1:22    sshd                             │
 │               └─ rdp.<domain>     → 127.0.0.1:3389  RDP                              │
 │                                                                                      │
 │  Kaizen API  (NT SERVICE\KaizenAPI, unprivileged)                                    │
 │    ├── SQLite  C:\Kaizen\data\kaizen.db   (users, audit, actions, metrics, alerts…)  │
 │    ├── named pipe \\.\pipe\kaizen-agent  ──►  Kaizen Agent (LocalSystem, privileged) │
 │    ├── HTTP 127.0.0.1:5500/internal/ops  ──►  Payroll (deep health, jobs, exports…)  │
 │    ├── mysql2 (ops read-only user)       ──►  MySQL 127.0.0.1:3306                   │
 │    └── HTTPS ► Cloudflare API · GitHub API · Telegram/SMTP/Termii                    │
 │                                                                                      │
 │  Kaizen Agent                                                                        │
 │    ├── allow-listed actions → PowerShell scripts / sc / netsh / mysqldump / WinSW    │
 │    ├── collectors: metrics (5 s), services, event log, files                         │
 │    ├── core loops (run even if API is down): heartbeat, tunnel/service watchdogs,    │
 │    │   scheduled backups, retention, disk guard                                      │
 │    └── HTTPS ► R2 (backups) · heartbeat URL                                          │
 └──────────────────────────────────────────────────────────────────────────────────────┘
              │ heartbeat every 60 s
   External dead-man's switch (Healthchecks / Better Stack / CF Worker) → alerts if silent
```

## 2. Components

| Component | Runs as | Responsibility | Must NOT |
|---|---|---|---|
| **Kaizen Web** | Static SPA served by the API | UI. Typed client generated from contracts. SSE subscriptions | Hold secrets; talk to anything except the API |
| **Kaizen API** | Windows service, virtual account `NT SERVICE\KaizenAPI`, `127.0.0.1:7700` | Auth (Access JWT), RBAC, validation, audit, action orchestration + approvals, scheduler (non-critical jobs), alert evaluation, integrations (Cloudflare, GitHub, Payroll, MySQL read-only), data store owner | Run privileged OS operations directly |
| **Kaizen Agent** | Windows service, `LocalSystem` | Execute allow-listed actions; collect host data; core safety loops; write files outside Kaizen's folder | Accept network connections; run arbitrary commands; call Cloudflare/GitHub APIs (except heartbeat + R2) |
| **Kaizen Store** | SQLite file (WAL), owned by API | Users, roles, audit, actions, approvals, metrics, alerts, policies, settings, incidents | Be shared with Payroll |
| **Agent state** | `C:\ProgramData\Kaizen\agent\` (JSON config + local queue) | Config pushed by API; buffered results while API is down | — |
| **Payroll `/internal/ops`** | Inside Payroll, loopback only + token | Deep health, async-export stats, cron registry/run-now, maintenance flag, version | Be reachable through the tunnel |

## 3. Trust boundaries

1. **Internet → Cloudflare.** Access enforces identity + MFA for `ops`/`ssh`/`rdp`. Nothing reaches the box unauthenticated except `payroll.<domain>`.
2. **cloudflared → Kaizen API.** The API listens on loopback only and verifies `Cf-Access-Jwt-Assertion` (signature, `aud`, `iss`, `exp`) on **every** request. Requests without a valid JWT are rejected, even from loopback. The only exception is LAN break-glass mode, which is off by default.
3. **API → Agent.**
   - The named pipe ACL allows `NT SERVICE\KaizenAPI` and `BUILTIN\Administrators` only.
   - Every message is HMAC-SHA256 signed with a shared secret (DPAPI-protected), with timestamp ±30 s and nonce replay protection.
   - The Agent validates params against its own copy of the action schema.
4. **API → Payroll.** HTTP to 127.0.0.1 with the `X-Ops-Token` header. Payroll serves `/internal/ops/*` only to loopback callers with the right token.
5. **API → MySQL.** Dedicated `kaizen_ro` user: `SELECT`, `PROCESS`, `SHOW VIEW`, `REPLICATION CLIENT` + `CONNECTION_ADMIN` for kill. Writes go only through Agent actions (mysqldump/mysql restore) using a separate `kaizen_backup` user.

## 4. Core flows

### 4.1 Read (dashboard)
`Web → GET /api/... → API`. The API serves from SQLite (metrics, cached state) or asks the Agent (`service.list`, `system.info`), with a 2–5 s cache. Live data streams over `GET /api/events` (SSE).

### 4.2 Action (anything that changes state)
```
Web  POST /api/actions {type, target, params, reason}
API  validate (zod) → RBAC (role ≥ action.minRole) → policy (calendar block, rate, risk)
     → write audit(status=requested) → create action row
     ├─ risk needs approval → status=pending_approval → notify admins → wait
     └─ else → status=queued
API  dispatch to Agent: agent.action.run {actionId, type, params}  (or internal handler)
Agent run script → stream progress notifications → final result
API  update action + audit(status=succeeded|failed) → SSE action.* events → alerts if failed
Web  shows progress live; final state is in Audit
```

### 4.3 Scheduled backup (Agent core loop, survives API outage)
```
Agent reads policy from agent.json → for each DB: mysqldump --single-transaction --routines --events
→ gzip → AES-256-GCM (per-file key wrapped with master key) → sha256 → write to staging
→ upload to R2 (multipart) → verify remote ETag/size → record result in local queue
→ API ingests queue (or later, if it was down) → retention prune (GFS) → alert on failure/staleness
Weekly: download latest → decrypt → restore into kaizen_scratch_<db> → row-count sanity → drop
```

### 4.4 Payroll deploy (M3)
```
GitHub push master → self-hosted runner job: POST /api/deploys {sha} (runner token)
API: action deploy.run (risk high; auto-approved for runner on master, blocked during payroll window)
Agent:
  1. backup.run (all DBs, local only, fast)          5. switch junction current → releases\<sha>
  2. release.prepare: git archive <sha> → releases\<sha>, link shared\ (.env, uploads, notifications, preferences, logs, temp)
  3. npm ci --omit=dev in release (bundled node)       6. restart NavyPayroll-App
  4. migrations (dry-run → apply)                     7. health gate: /internal/ops/health/deep green for 60 s
     on failure → switch junction back → restart → mark rolled_back
API: purge Cloudflare cache (static) → record deploy → notify
```

### 4.5 Alerting
Rules are evaluated every 15 s in the API over the latest samples and states. Fired alerts are deduplicated (fingerprint) and routed by severity: info → UI, warning → Telegram, critical → Telegram + email + SMS. They re-notify every 30 min until acknowledged and auto-resolve with a "resolved" message.
The Agent separately sends a heartbeat every 60 s carrying a summary status. If the box, power, WAN or tunnel dies, the external monitor alerts.

## 5. Failure modes — what still works

| Failure | Payroll | Kaizen Web (remote) | Agent loops | Alert path |
|---|---|---|---|---|
| Payroll App crashed | ✗ | ✓ restart it | ✓ watchdog restarts after N fails | ✓ |
| MySQL down | ✗ | ✓ (own SQLite) — start MySQL | ✓ | ✓ |
| Kaizen API down | ✓ | ✗ (use SSH via Access → `sc start KaizenAPI`) | ✓ backups, watchdogs, heartbeat | ✓ heartbeat carries `api=down` |
| Agent down | ✓ | read-only (cached), actions fail `AGENT_UNAVAILABLE` | ✗ | ✓ API alerts + heartbeat stops → external alert |
| cloudflared down | ✗ public | ✗ remote; ✓ LAN break-glass | ✓ tunnel watchdog restarts it | ✓ external monitor (probe + heartbeat if WAN ok) |
| WAN down | ✗ public | ✗ remote; ✓ LAN | ✓ (uploads queue) | ✓ external monitor (heartbeat missing) |
| Cloudflare outage | ✗ public | ✗ remote; ✓ LAN | ✓ | ✓ external monitor (if not on Cloudflare) |
| Power loss | ✗ | ✗ | ✗ | ✓ external monitor; UPS triggers graceful shutdown |

## 6. Data model (SQLite)

```
users(id, email UNIQUE, name, role, active, created_at, last_seen_at)
sessions(id, user_id, access_jti, ip, user_agent, created_at, last_seen_at)            -- informational
audit(id ULID PK, ts, actor_type['user','system','runner'], actor_id, actor_email, ip, cf_ray,
      method, path, action_id NULL, event, target, summary, status, details_json)       -- append-only (trigger blocks UPDATE/DELETE except status/details on same row once)
actions(id ULID, type, target, params_json, risk, status, reason, requested_by, created_at,
        queued_at, started_at, finished_at, result_json, error, log_path)
approvals(id, action_id, approver_id, decision['approve','reject'], comment, ts)
services(id, name, kind, managed BOOL, expected_state, depends_on_json)                 -- registry
metric_samples(series, ts, value)  PK(series, ts)                                       -- 1-min, 14 d
metric_rollups(series, bucket_ts, min, max, avg)                                        -- 1-h, 400 d
alert_rules(id, name, expr_json, severity, for_seconds, channels_json, enabled)
alerts(id, rule_id, fingerprint, state['firing','acked','resolved'], started_at, acked_by, acked_at, resolved_at, last_value, message)
channels(id, kind['telegram','email','sms','webhook'], config_enc, enabled)
backup_policies(id, databases_json, schedule_cron, retention_json, target, encrypt BOOL, enabled)
backups(id, policy_id, database, started_at, finished_at, size_bytes, sha256, location, encrypted, status, verified_at, verify_status, error)
restores(id, backup_id, target_database, mode, action_id, status, started_at, finished_at, error)
releases(sha, created_at, path, status['prepared','active','previous','failed','pruned'])
deploys(id, sha, previous_sha, action_id, trigger['runner','manual'], status, started_at, finished_at, steps_json, error)
jobs(id, owner['kaizen','agent','payroll'], name, schedule, enabled, last_run_at, last_status, next_run_at)
job_runs(id, job_id, started_at, finished_at, status, output_tail)
config_versions(id, target['payroll.env.production',...], content_enc, sha256, author, reason, ts)
incidents(id, title, severity, status, started_at, resolved_at, summary, cause, fix)
incident_events(id, incident_id, ts, kind, text, ref)
runbooks(id, name, steps_json, version)
findings(id, source, ref, title, severity, status, owner, due_at, notes)
settings(section PK, json)
kv(key PK, value)                                                                       -- cursors, last sync stamps
```
Migrations are numbered SQL files (`api/src/db/migrations/0001_init.sql`, …), applied at API start inside a transaction.

## 7. Technology stack

| Concern | Choice |
|---|---|
| Runtime | Node 22 LTS, portable `node.exe` bundled per release |
| Language | TypeScript (strict), ESM |
| API framework | Express 5 + zod (validation), pino (logs), `jose` (Access JWT) |
| DB | `better-sqlite3` (WAL), hand-written SQL + small repository layer |
| Scheduler | `croner` |
| Agent IPC | `node:net` named pipe, newline-delimited JSON-RPC 2.0, HMAC |
| Host data | PowerShell (`Get-CimInstance`, `Get-Counter`, `Get-WinEvent`, `Get-NetFirewallRule`), `systeminformation` for quick samples |
| Services | WinSW for Kaizen's own services; `sc.exe` / PowerShell for control |
| MySQL | `mysql2/promise` (read-only), `mysqldump`/`mysql` binaries via Agent |
| Storage | `@aws-sdk/client-s3` (R2), Node `crypto` AES-256-GCM streams |
| Integrations | Cloudflare REST + GraphQL API, GitHub REST (`@octokit/rest`), Telegram Bot API, SMTP (nodemailer), Termii |
| Web | React 18, Vite, React Router, TanStack Query, Tailwind, shadcn/ui, Recharts, zod (shared) |
| Testing | Vitest (unit), Supertest (API), Playwright (web smoke), Pester (PowerShell scripts) |
| Packaging | esbuild bundles for API + Agent, Vite build for Web, zip per release with checksums |
