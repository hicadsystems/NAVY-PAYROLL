# 03 — Backend Structure (API + Agent)

## 1. Repository

Separate repo: `hicadsystems/kaizen` (npm workspaces).

```
kaizen/
├─ apps/
│  ├─ api/                     Kaizen API (control plane)
│  ├─ agent/                   Kaizen Agent (privileged executor)
│  └─ web/                     Kaizen Web (SPA) — see 04-frontend.md
├─ packages/
│  ├─ contracts/               zod schemas + TS types: REST, SSE events, actions, agent RPC
│  ├─ shared/                  ulid, time, errors, logger factory, hmac, retry, crypto helpers
│  └─ eslint-config/ tsconfig/ shared tooling
├─ deploy/
│  ├─ install-kaizen.ps1       first install (see 06-deployment.md)
│  ├─ update-kaizen.ps1        upgrade / rollback of Kaizen itself
│  ├─ winsw/                   KaizenAPI.xml, KaizenAgent.xml templates
│  └─ cloudflared/             ingress reference config
├─ scripts/                    dev helpers (mock agent, seed db)
├─ .github/workflows/          ci.yml, release.yml
└─ package.json                workspaces, root scripts
```

Rules:
- `contracts` is the single source of truth. API handlers, Agent handlers and the Web client import the same schemas.
- `apps/*` never import each other, only `packages/*`.

## 2. API — `apps/api`

```
apps/api/src/
├─ main.ts                     bootstrap: config → db migrate → agent client → scheduler → http
├─ app.ts                      express app factory (used by tests)
├─ config/
│  ├─ index.ts                 zod-validated config (file + env + DPAPI secrets)
│  └─ secrets.ts               DPAPI read via Agent at start (api never stores plaintext on disk)
├─ db/
│  ├─ sqlite.ts                better-sqlite3 open (WAL, busy_timeout, foreign_keys)
│  ├─ migrate.ts
│  └─ migrations/0001_init.sql …
├─ http/
│  ├─ middleware/
│  │  ├─ requestContext.ts     request id (ULID), cf-ray, client ip (CF-Connecting-IP)
│  │  ├─ accessAuth.ts         verify Cf-Access-Jwt-Assertion (jose, JWKS cache) → req.identity
│  │  ├─ loadUser.ts           email → user/role; unknown email → 403 (admins invite users)
│  │  ├─ rbac.ts               requirePermission('backups:run') …
│  │  ├─ audit.ts              writes audit row for every non-GET before handler, finalises after
│  │  ├─ validate.ts           zod body/query/params → 400 VALIDATION_FAILED
│  │  ├─ rateLimit.ts          per-user for mutating routes
│  │  └─ errorHandler.ts       AppError → contract error envelope
│  ├─ sse.ts                   SSE hub: topics, heartbeat ping every 15 s, Last-Event-ID replay (ring buffer)
│  └─ router.ts                mounts module routers under /api
├─ modules/
│  ├─ me/                      GET /api/me
│  ├─ overview/                aggregated status
│  ├─ services/                registry + state + control actions
│  ├─ host/                    system info, metrics query
│  ├─ network/                 adapters, wan, egress, ip drift
│  ├─ firewall/
│  ├─ edge/                    cloudflare: tunnel, analytics, cache purge, maintenance, rules status
│  ├─ access/                  cloudflare access logs → audit
│  ├─ ssh/                     sshd status, keys, config hardening
│  ├─ db/                      mysql instances, databases, processlist, kill, migrations, ro-query
│  ├─ backups/                 policies, list, run, verify, restores
│  ├─ deploys/                 releases, deploys, rollback, runner webhook
│  ├─ jobs/                    kaizen + agent + payroll jobs registry, runs, run-now
│  ├─ logs/                    sources, query, stream
│  ├─ alerts/                  rules, evaluation loop, alerts, channels, notifier
│  ├─ actions/                 action engine, catalog, approvals, dispatch, progress
│  ├─ audit/                   query
│  ├─ config/                  env files (masked view, versioned edit)
│  ├─ security/                findings tracker, exposure checks
│  ├─ incidents/  runbooks/    (M6)
│  ├─ users/                   invite, role change, deactivate (admin)
│  └─ settings/
├─ integrations/
│  ├─ agentClient.ts           named pipe JSON-RPC client: request/notify, HMAC, timeouts, reconnect
│  ├─ payrollClient.ts         /internal/ops/* with X-Ops-Token
│  ├─ mysqlClient.ts           read-only pool (kaizen_ro), statement allow-list for console
│  ├─ cloudflare.ts            REST + GraphQL, scoped token
│  ├─ github.ts                octokit: runs, runners, commits
│  ├─ r2.ts                    list/head objects for backup inventory
│  └─ notifiers/ telegram.ts email.ts sms.ts webhook.ts
├─ scheduler/
│  ├─ index.ts                 croner registry, persisted next/last run in `jobs`
│  └─ tasks/                   alertsEvaluate, metricsRollup, retentionPrune, cfAnalyticsSync, githubSync, payrollPoll
└─ lib/                        appError.ts, paging.ts, time.ts, mask.ts, policy.ts (calendar blocks)
```

### 2.1 Module anatomy (every module looks the same)

```
modules/backups/
├─ backups.routes.ts      router: path → [validate, rbac] → controller fn
├─ backups.controller.ts  HTTP ⇄ service (no business logic, no SQL)
├─ backups.service.ts     business logic, policies, calls repo / agentClient / actions
├─ backups.repo.ts        SQL only (prepared statements), returns typed rows
├─ backups.actions.ts     action definitions this module owns (registered into catalog)
└─ backups.test.ts
```

Layering rules:
- routes → controller → service → (repo | integrations | actions). Never upward, never sideways between modules' repos.
- Any state change goes through `actions.engine.request()`, including internal ones. That gives one place for RBAC re-check, policy, approvals, audit, SSE.
- The service layer never calls `child_process`. OS work goes through the Agent.

### 2.2 Action engine (`modules/actions`)

```ts
// registered by each module
defineAction({
  type: 'service.restart',
  risk: 'medium',                     // low | medium | high | critical
  minRole: 'operator',
  approval: 'none',                   // none | one_admin | two_admins
  blockedDuringPayrollWindow: false,
  params: z.object({ serviceId: z.string() }),
  target: p => p.serviceId,
  executor: 'agent',                  // agent | internal
  timeoutMs: 120_000,
  preflight: async (p, ctx) => {...}, // optional checks (e.g. not restarting KaizenAPI from itself)
});
```
Engine lifecycle:
- `requested → (pending_approval) → queued → running → succeeded | failed | cancelled | rejected | timed_out`
- One action per target at a time. Same-target requests are rejected with `CONFLICT`, or queued for idempotent types like `backup.run`.
- Every transition writes `actions` + `audit` and emits SSE `action.updated`.
- Progress lines from the Agent go to `C:\Kaizen\data\actions\<id>.log` plus SSE `action.progress`.

### 2.3 Policy (`lib/policy.ts`)
- Payroll window from settings, e.g. `{ days: [20..31, 1..5], hours: "07:00-22:00" }`. While inside it, `blockedDuringPayrollWindow` actions require an admin override with a reason.
- Self-protection: the API refuses `service.stop` on `KaizenAPI`/`KaizenAgent`/`cloudflared` unless the request came from LAN break-glass.
- Rate limits: max 3 restarts of the same service per 10 min.

### 2.4 Auth details
- The Access JWT comes in the `Cf-Access-Jwt-Assertion` header (or the `CF_Authorization` cookie). Verify against `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`, check `aud` = the Kaizen Access app AUD, and `iss`.
- `req.identity = { email, sub, country, jti }` → `loadUser` → `req.user = { id, email, role, permissions }`.
- Permissions are derived from role by a static map in `contracts/permissions.ts`.
- Break-glass mode (setting `breakGlass.enabled`, default off):
  - local login with email + password + TOTP
  - allowed only when the request comes from the LAN subnet and not through cloudflared
  - everything is audited with `actor_type=user, via=breakglass`

## 3. Agent — `apps/agent`

```
apps/agent/src/
├─ main.ts                   load config → open pipe server → start collectors → start loops
├─ config.ts                 C:\ProgramData\Kaizen\agent\agent.json (written by API via config.apply)
├─ ipc/
│  ├─ pipeServer.ts          \\.\pipe\kaizen-agent, ACL set at creation, NDJSON framing
│  ├─ auth.ts                HMAC verify, ±30 s skew, nonce cache (5 min)
│  └─ dispatcher.ts          method → handler, param validation (contracts), concurrency guard
├─ actions/                  one file per action type (only these can run)
│  ├─ service.control.ts     start/stop/restart via sc.exe / WinSW exe
│  ├─ host.reboot.ts
│  ├─ firewall.apply.ts
│  ├─ ssh.keys.ts  ssh.config.ts
│  ├─ cloudflared.restart.ts
│  ├─ backup.run.ts  backup.verify.ts  restore.run.ts
│  ├─ release.prepare.ts  release.activate.ts  release.rollback.ts  migrate.run.ts
│  ├─ env.write.ts           writes payroll env with backup version, never logs content
│  ├─ winupdate.scan.ts  winupdate.install.ts
│  └─ files.cleanup.ts
├─ collectors/
│  ├─ metrics.ts             cpu, mem, disks, net, per-process (node/mysqld/chrome/cloudflared) every 5 s
│  ├─ services.ts            state of registered services every 10 s + on change
│  ├─ eventlog.ts            new System/Application/Security/OpenSSH events (bookmark-based)
│  └─ files.ts               log tailing (WinSW logs, MySQL error log, cloudflared log)
├─ loops/                    run independently of the API
│  ├─ heartbeat.ts           every 60 s → HEARTBEAT_URL with {api, agent, payroll, mysql, tunnel, disk}
│  ├─ watchdog.ts            service expected=running but stopped → restart (max 3/10 min) → record
│  ├─ tunnelWatchdog.ts      cloudflared metrics: 0 connections for 60 s → restart
│  ├─ backupScheduler.ts     executes backup policies (croner) even when API is down
│  └─ diskGuard.ts           >90% → prune temp/old local backups per policy, alert
├─ runner/
│  ├─ ps.ts                  run bundled .ps1 with -File and typed args (never string-built commands)
│  ├─ exec.ts                spawn with timeout, kill tree, output line streaming
│  └─ outbox.ts              durable queue (JSON lines) for results/events while API is unreachable
└─ scripts/                  *.ps1 shipped with the agent (signed); Pester tests alongside
```

Agent rules:
- Only methods defined in `contracts/agent-rpc.ts` exist. There is no `exec`, `shell` or `eval` method.
- PowerShell scripts take typed parameters (`param([ValidatePattern(...)][string]$ServiceName)`). Arguments are passed as an array, never through a concatenated command line.
- Service names, paths and DB names are checked against registries in `agent.json` (allow-lists), not just against format.
- Long actions stream `progress` notifications. Results also go to the outbox, so the API can pick them up after a restart.

## 4. Collectors & retention

| Data | Source | Interval | Store |
|---|---|---|---|
| Host metrics | Agent `metrics.ts` | 5 s (UI live) → 1-min avg stored | `metric_samples` 14 d → `metric_rollups` 400 d |
| Service state | Agent `services.ts` | 10 s + change events | in-memory + `audit` on change |
| Payroll deep health | API `payrollPoll` | 30 s | latest in memory, failures → alerts |
| Async exports | Payroll `/internal/ops/exports` | 15 s | metrics series `payroll.exports.running/queued/duration` |
| MySQL status | API `mysqlClient` | 30 s | metrics series `mysql.threads_connected`, `mysql.slow_queries`… |
| Tunnel | Agent (local metrics `127.0.0.1:20241/metrics`) + API (CF API) | 15 s / 60 s | metrics + state |
| Edge analytics | API `cfAnalyticsSync` | 5 min | rollups |
| GitHub runs | API `githubSync` | 2 min + webhook | `deploys` |

## 5. Payroll-side work required (small, in NAVY-PAYROLL)

1. `routes/internal-ops.js` mounted at `/internal/ops`, guarded by loopback + `OPS_INTERNAL_TOKEN` (contract in 05 §6).
2. Cron registry wrapper: replace direct `cron.schedule` calls with `registerJob(id, cron, fn)` so jobs can be listed, run now and paused.
3. Maintenance flag middleware: returns 503 with a maintenance page when enabled, except `/internal/ops` and `/health`.
4. Deep health that checks each class DB, Redis (if enabled), disk and Chromium.
5. Expose `asyncExport.getStats()` (already written).

## 6. Conventions

- TypeScript `strict`, no `any` in contracts. ESLint + Prettier shared config.
- Errors: throw `AppError(code, message, details?)`. The error handler maps it to the contract envelope. Unknown errors → `INTERNAL` with the request id; the stack is logged and never returned.
- Logging: pino JSON to `C:\Kaizen\logs\{api,agent}.log`, with daily rotation and 30 files. Include `requestId`, `actionId`, `userEmail`. Secrets go through `mask()`.
- Time: store UTC ISO-8601 and display Africa/Lagos in the Web.
- IDs: ULID for actions/audit/alerts/backups. Natural keys for services (`navypayroll-app`) and releases (git sha).
- Config precedence: defaults < `C:\Kaizen\config\kaizen.json` < env < DPAPI secrets.
- Tests:
  - unit tests per service
  - API tests with a mock agent (`scripts/mock-agent.ts` implements the RPC contract)
  - Pester tests for every `.ps1`
  - a Playwright smoke test of the main pages against the mock stack
- Definition of done for any action:
  - contract entry
  - RBAC + risk set
  - audit verified in a test
  - Agent allow-list updated
  - UI confirm dialog
  - runbook note
