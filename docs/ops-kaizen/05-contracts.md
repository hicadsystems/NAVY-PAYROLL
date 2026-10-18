# 05 — Contracts

These are the source of truth for `packages/contracts`. Types are written in TypeScript notation, and each one is implemented as a zod schema with the same name.

## 1. Conventions

| Item        | Rule                                                                                                                               |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Base path   | `/api` (Kaizen API), `/internal/ops` (Payroll), pipe `\\.\pipe\kaizen-agent` (Agent)                                               |
| Format      | JSON, UTF-8, camelCase keys                                                                                                        |
| Time        | ISO-8601 UTC strings (`2026-10-18T19:53:00.000Z`); durations in ms; sizes in bytes                                                 |
| IDs         | ULID strings for actions, audit, alerts, backups, deploys, incidents; slugs for services (`navypayroll-app`); git sha for releases |
| Auth        | `Cf-Access-Jwt-Assertion` header (or `CF_Authorization` cookie) on every `/api` call                                               |
| Idempotency | Mutating `POST`s accept `Idempotency-Key` (ULID); repeats within 24 h return the original response                                 |
| Pagination  | Cursor: `?limit=50&cursor=<opaque>` → `meta.page.nextCursor`                                                                       |
| Versioning  | Additive changes only within `/api`; breaking change → `/api/v2`. Contracts package is semver'd                                    |
| Request id  | Response header `X-Request-Id` (ULID); echoed in errors and audit                                                                  |

### 1.1 Envelope

```ts
type Ok<T> = {
  data: T;
  meta?: {
    requestId: string;
    page?: { limit: number; nextCursor: string | null };
  };
};
type Err = {
  error: {
    code: ErrorCode;
    message: string;
    details?: unknown;
    requestId: string;
  };
};
```

### 1.2 Error codes

| Code                | HTTP | Meaning                                                                    |
| ------------------- | ---- | -------------------------------------------------------------------------- |
| `UNAUTHENTICATED`   | 401  | Missing/invalid Access JWT                                                 |
| `FORBIDDEN`         | 403  | Role lacks permission, or email not invited                                |
| `VALIDATION_FAILED` | 400  | zod failure; `details` = flattened issues                                  |
| `NOT_FOUND`         | 404  |                                                                            |
| `CONFLICT`          | 409  | Another action running on the same target / state changed                  |
| `POLICY_BLOCKED`    | 423  | Payroll window, self-protection, rate limit on restarts; `details.reason`  |
| `APPROVAL_REQUIRED` | 202  | Not an error body. Returned as an Action with `status: "pending_approval"` |
| `AGENT_UNAVAILABLE` | 503  | Pipe not reachable                                                         |
| `UPSTREAM_FAILED`   | 502  | Cloudflare/GitHub/Payroll/MySQL call failed; `details.upstream`            |
| `RATE_LIMITED`      | 429  | `Retry-After` header                                                       |
| `INTERNAL`          | 500  | Logged with requestId                                                      |

## 2. Roles & permissions

```ts
type Role = "viewer" | "operator" | "admin";
type Permission =
  | "overview:read"
  | "services:read"
  | "services:control"
  | "host:read"
  | "host:reboot"
  | "host:update"
  | "network:read"
  | "firewall:read"
  | "firewall:write"
  | "edge:read"
  | "edge:purge"
  | "edge:maintenance"
  | "edge:write"
  | "access:read"
  | "ssh:read"
  | "ssh:write"
  | "db:read"
  | "db:query"
  | "db:kill"
  | "db:migrate"
  | "backups:read"
  | "backups:run"
  | "backups:policy"
  | "restores:run"
  | "deploys:read"
  | "deploys:run"
  | "deploys:rollback"
  | "jobs:read"
  | "jobs:run"
  | "jobs:toggle"
  | "logs:read"
  | "alerts:read"
  | "alerts:ack"
  | "alerts:write"
  | "actions:read"
  | "approvals:decide"
  | "audit:read"
  | "config:read"
  | "config:write"
  | "security:read"
  | "security:write"
  | "incidents:read"
  | "incidents:write"
  | "runbooks:run"
  | "users:admin"
  | "settings:admin";
```

| Permission group                                                                                                                                                                                                                                                                   | viewer | operator | admin |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | -------- | ----- |
| all `*:read` (config values masked for all; secrets never returned)                                                                                                                                                                                                                | ✓      | ✓        | ✓     |
| `services:control`, `backups:run`, `edge:purge`, `alerts:ack`, `db:query`, `db:kill`, `jobs:run`, `runbooks:run`, `incidents:write`, `deploys:rollback`                                                                                                                            |        | ✓        | ✓     |
| `host:reboot`, `host:update`, `firewall:write`, `edge:write`, `edge:maintenance`, `ssh:write`, `db:migrate`, `restores:run`, `deploys:run`, `config:write`, `backups:policy`, `alerts:write`, `jobs:toggle`, `approvals:decide`, `security:write`, `users:admin`, `settings:admin` |        |          | ✓     |

## 3. Shared models

```ts
type Health = "ok" | "degraded" | "down" | "unknown";
type Risk = "low" | "medium" | "high" | "critical";

type Check = {
  id: string;
  name: string;
  status: Health;
  message?: string;
  checkedAt: string;
  latencyMs?: number;
};

type Service = {
  id: string; // navypayroll-app, navypayroll-proxy, navypayroll-watcher, navypayroll-mdns,
  // kaizen-api, kaizen-agent, cloudflared, actions-runner, sshd, mysql, redis
  name: string;
  kind: "winsw" | "windows" | "cloudflared" | "runner";
  state: "running" | "stopped" | "starting" | "stopping" | "paused" | "unknown";
  expectedState: "running" | "stopped" | "any";
  startMode: "auto" | "delayed-auto" | "manual" | "disabled";
  pid: number | null;
  uptimeSec: number | null;
  memoryBytes: number | null;
  cpuPct: number | null;
  restarts24h: number;
  dependsOn: string[];
  managed: boolean;
};

type ActionStatus =
  | "pending_approval"
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "rejected"
  | "cancelled"
  | "timed_out";

type Action = {
  id: string;
  type: ActionType;
  target: string | null;
  params: Record<string, unknown>;
  risk: Risk;
  status: ActionStatus;
  reason: string | null;
  requestedBy: { type: "user" | "system" | "runner"; email?: string };
  approvalsRequired: 0 | 1 | 2;
  approvals: {
    by: string;
    decision: "approve" | "reject";
    comment?: string;
    at: string;
  }[];
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  progress: number | null; // 0..100 when known
  result: unknown | null;
  error: { code: string; message: string } | null;
};

type AuditEntry = {
  id: string;
  ts: string;
  actor: {
    type: "user" | "system" | "runner";
    email?: string;
    ip?: string;
    via?: "access" | "breakglass";
  };
  event: string; // e.g. "action.requested", "config.viewed", "user.role_changed"
  target: string | null;
  actionId: string | null;
  status: "requested" | "succeeded" | "failed" | "info";
  summary: string;
  cfRay?: string;
  requestId: string;
  details?: Record<string, unknown>;
};

type MetricSeries = {
  name: string;
  unit: "pct" | "bytes" | "bytes/s" | "count" | "ms" | "req/s";
  points: [ts: string, value: number][];
};
```

## 4. REST endpoints (Kaizen API)

Unless noted: `GET` → `Ok<T>`; mutating calls create an Action → `202 Ok<Action>`.

### 4.1 Identity & overview

| Method | Path            | Perm          | Response                                                        |
| ------ | --------------- | ------------- | --------------------------------------------------------------- |
| GET    | `/api/me`       | —             | `{ email, name, role: Role, permissions: Permission[] }`        |
| GET    | `/api/overview` | overview:read | `{ status: Health; checks: Check[]; services: Pick<Service,'id' |
| GET    | `/api/events`   | overview:read | **SSE** stream (see §5)                                         |

### 4.2 Services & host

| Method | Path                        | Perm             | Body / Query                                             | Response                                                                                                                                                                                      |
| ------ | --------------------------- | ---------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/services`             | services:read    |                                                          | `Service[]`                                                                                                                                                                                   |
| GET    | `/api/services/:id`         | services:read    |                                                          | `Service & { recentActions: Action[]; stateHistory: { state, at }[] }`                                                                                                                        |
| POST   | `/api/services/:id/control` | services:control | `{ op: 'start'\|'stop'\|'restart'; reason?: string }`    | `Action` (`service.start                                                                                                                                                                      |
| GET    | `/api/host`                 | host:read        |                                                          | `{ hostname, os, uptimeSec, cpu: {model, cores}, memBytes, disks: {mount, sizeBytes, usedBytes, smart?: Health}[], timeSync: {source, offsetMs}, pendingReboot: boolean, powerPlan: string }` |
| GET    | `/api/metrics`              | host:read        | `?series=host.cpu,host.mem,disk.C.used&from&to&step=60s` | `MetricSeries[]`                                                                                                                                                                              |
| GET    | `/api/host/updates`         | host:read        |                                                          | `{ lastInstalledAt, pending: { kb, title, severity, sizeBytes }[] }`                                                                                                                          |
| POST   | `/api/host/updates/install` | host:update      | `{ kbs?: string[]; rebootIfNeeded: boolean; reason }`    | `Action` (`host.updates.install`)                                                                                                                                                             |
| POST   | `/api/host/reboot`          | host:reboot      | `{ reason; delaySec?: number }`                          | `Action` (`host.reboot`)                                                                                                                                                                      |

### 4.3 Network, firewall, SSH, edge, access

| Method  | Path                         | Perm                         | Body                                                                 | Response                                                                                                                                                                                                                            |
| ------- | ---------------------------- | ---------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET     | `/api/network`               | network:read                 |                                                                      | `{ adapters: { name, ipv4, gateway, dns: string[], linkMbps, dhcp: boolean }[]; wan: { up: boolean; latencyMs; lossPct; publicIp }; egress: { cf7844: boolean; cf443: boolean }; ipDrift: { envLocalIp, liveIp, drift: boolean } }` |
| GET     | `/api/firewall/rules`        | firewall:read                |                                                                      | `{ name, enabled, direction, action, protocol, localPorts, remoteAddresses, profiles, risky: boolean }[]`                                                                                                                           |
| POST    | `/api/firewall/apply`        | firewall:write               | `{ ruleset: 'kaizen-baseline'; dryRun: boolean; reason }`            | `Action` (`firewall.apply`); dry-run result lists the diff                                                                                                                                                                          |
| GET     | `/api/ssh`                   | ssh:read                     |                                                                      | `{ running, listen: string[], passwordAuth: boolean, keys: { fingerprint, comment, addedAt }[] }`                                                                                                                                   |
| POST    | `/api/ssh/keys`              | ssh:write                    | `{ publicKey: string; comment: string; reason }`                     | `Action` (`ssh.keys.add`)                                                                                                                                                                                                           |
| DELETE  | `/api/ssh/keys/:fingerprint` | ssh:write                    | `{ reason }`                                                         | `Action` (`ssh.keys.remove`)                                                                                                                                                                                                        |
| POST    | `/api/ssh/harden`            | ssh:write                    | `{ dryRun: boolean; reason }`                                        | `Action` (`ssh.config.harden`)                                                                                                                                                                                                      |
| GET     | `/api/edge/tunnel`           | edge:read                    |                                                                      | `{ id, name, status: 'healthy'\|'degraded'\|'down'\|'inactive', connectors: { id, version, originIp, connections: { colo, openedAt }[] }[], ingress: { hostname, service }[] }`                                                     |
| GET     | `/api/edge/analytics`        | edge:read                    | `?from&to`                                                           | `{ requests: MetricSeries; status: { code, count }[]; threats: number; top: { path, count }[] }`                                                                                                                                    |
| GET     | `/api/edge/rules`            | edge:read                    |                                                                      | `{ waf: { managed: boolean; custom: { name, action, enabled }[] }; rateLimits: { name, path, threshold, periodSec }[]; cache: { name, expression, cache: boolean }[] }`                                                             |
| POST    | `/api/edge/cache/purge`      | edge:purge                   | `{ scope: 'static' \| 'everything' \| { urls: string[] }; reason? }` | `Action` (`edge.cache.purge`)                                                                                                                                                                                                       |
| GET/PUT | `/api/edge/maintenance`      | edge:read / edge:maintenance | PUT `{ enabled: boolean; message: string; until?: string; reason }`  | `{ enabled, message, until }` / `Action` (`edge.maintenance.set`)                                                                                                                                                                   |
| POST    | `/api/edge/tunnel/restart`   | services:control             | `{ reason? }`                                                        | `Action` (`cloudflared.restart`)                                                                                                                                                                                                    |
| GET     | `/api/access/logs`           | access:read                  | `?from&to&app=ops\|ssh\|rdp`                                         | `{ ts, email, app, allowed: boolean, country, ip, rayId }[]`                                                                                                                                                                        |

### 4.4 Database

| Method | Path                           | Perm       | Body / Query                                                     | Response                                                                                                                                                                                                                                            |
| ------ | ------------------------------ | ---------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/db/instance`             | db:read    |                                                                  | `{ version, uptimeSec, threadsConnected, maxConnections, slowQueries, bufferPoolBytes, datadirBytes }`                                                                                                                                              |
| GET    | `/api/db/databases`            | db:read    |                                                                  | `{ name, payrollClass, sizeBytes, tables, lastBackupAt, pendingMigrations: number }[]`                                                                                                                                                              |
| GET    | `/api/db/processlist`          | db:read    |                                                                  | `{ id, user, host, db, command, timeSec, state, info }[]` (info truncated to 2 KB)                                                                                                                                                                  |
| POST   | `/api/db/processlist/:id/kill` | db:kill    | `{ mode: 'query' \| 'connection'; reason }`                      | `Action` (`db.kill`)                                                                                                                                                                                                                                |
| GET    | `/api/db/migrations`           | db:read    |                                                                  | `{ database, applied: string[], pending: string[] }[]`                                                                                                                                                                                              |
| POST   | `/api/db/migrations/run`       | db:migrate | `{ databases: string[]; dryRun: boolean; reason }`               | `Action` (`db.migrate`)                                                                                                                                                                                                                             |
| POST   | `/api/db/query`                | db:query   | `{ database: string; sql: string; limit?: number /* ≤ 5000 */ }` | `{ columns: { name, type }[], rows: unknown[][], truncated: boolean, durationMs: number }` — only `SELECT`/`SHOW`/`EXPLAIN`/`DESCRIBE` (parser-checked, executed as `kaizen_ro` with `MAX_EXECUTION_TIME(30000)`), always audited with the SQL text |

### 4.5 Backups & restores

```ts
type BackupPolicy = {
  id: string;
  name: string;
  databases: string[] | "all";
  schedule: string /* cron, Lagos */;
  retention: { daily: number; weekly: number; monthly: number };
  targets: ("local" | "r2")[];
  encrypt: true;
  enabled: boolean;
};
type Backup = {
  id: string;
  policyId: string | null;
  database: string;
  startedAt: string;
  finishedAt: string | null;
  status: "running" | "succeeded" | "failed";
  sizeBytes: number | null;
  sha256: string | null;
  locations: { target: "local" | "r2"; key: string }[];
  verify: {
    status: "pending" | "passed" | "failed" | "never";
    at: string | null;
  };
};
```

| Method     | Path                        | Perm                          | Body / Query                                                                                                                     | Response                                                                            |
| ---------- | --------------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| GET        | `/api/backups`              | backups:read                  | `?database&status&cursor`                                                                                                        | `Backup[]`                                                                          |
| GET        | `/api/backups/summary`      | backups:read                  |                                                                                                                                  | `{ database, lastSuccessAt, ageSec, lastVerifyAt, health: Health }[]`               |
| POST       | `/api/backups/run`          | backups:run                   | `{ databases: string[] \| 'all'; targets?: ('local'\|'r2')[]; reason? }`                                                         | `Action` (`backup.run`)                                                             |
| POST       | `/api/backups/:id/verify`   | backups:run                   | `{ deep: boolean /* scratch restore */ }`                                                                                        | `Action` (`backup.verify`)                                                          |
| GET/POST   | `/api/backups/policies`     | backups:read / backups:policy | `BackupPolicy` (without id)                                                                                                      | `BackupPolicy[]` / `BackupPolicy`                                                   |
| PUT/DELETE | `/api/backups/policies/:id` | backups:policy                | `BackupPolicy`                                                                                                                   | `BackupPolicy`                                                                      |
| GET        | `/api/restores`             | backups:read                  |                                                                                                                                  | `{ id, backupId, targetDatabase, mode, status, startedAt, finishedAt, actionId }[]` |
| POST       | `/api/restores`             | restores:run                  | `{ backupId; target: { database: string; mode: 'scratch' \| 'replace' }; maintenance: boolean; preRestoreBackup: true; reason }` | `Action` (`restore.run`, critical, 2 approvals for `replace`)                       |

### 4.6 Deploys

```ts
type Release = {
  sha: string;
  message: string;
  author: string;
  createdAt: string;
  status: "prepared" | "active" | "previous" | "failed" | "pruned";
};
type Deploy = {
  id: string;
  sha: string;
  previousSha: string | null;
  trigger: "runner" | "manual";
  status: "running" | "succeeded" | "failed" | "rolled_back";
  startedAt: string;
  finishedAt: string | null;
  steps: {
    name:
      | "backup"
      | "prepare"
      | "install"
      | "migrate"
      | "activate"
      | "restart"
      | "health_gate"
      | "purge_cache"
      | "rollback";
    status: "pending" | "running" | "ok" | "failed" | "skipped";
    durationMs: number | null;
    message?: string;
  }[];
  actionId: string;
};
```

| Method | Path                             | Perm                            | Body                                                | Response                                              |
| ------ | -------------------------------- | ------------------------------- | --------------------------------------------------- | ----------------------------------------------------- |
| GET    | `/api/deploys/current`           | deploys:read                    |                                                     | `{ release: Release; health: Health; since: string }` |
| GET    | `/api/deploys` · `/api/releases` | deploys:read                    | `?cursor`                                           | `Deploy[]` · `Release[]`                              |
| POST   | `/api/deploys`                   | deploys:run **or** runner token | `{ sha: string; reason?: string }`                  | `Action` (`deploy.run`)                               |
| POST   | `/api/deploys/rollback`          | deploys:rollback                | `{ toSha?: string /* default previous */; reason }` | `Action` (`deploy.rollback`)                          |

Runner auth: `Authorization: Bearer <KAIZEN_RUNNER_TOKEN>` accepted **only** from `127.0.0.1` without a Cf header, and only for `POST /api/deploys` with a `sha` on `master`. Audited as `actor.type = 'runner'`.

### 4.7 Jobs, logs, alerts

| Method              | Path                            | Perm                       | Body / Query                                   | Response                                                                                                                     |
| ------------------- | ------------------------------- | -------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| GET                 | `/api/jobs`                     | jobs:read                  |                                                | `{ id, owner: 'kaizen'\|'agent'\|'payroll', name, schedule, enabled, lastRunAt, lastStatus, lastDurationMs, nextRunAt }[]`   |
| GET                 | `/api/jobs/:id/runs`            | jobs:read                  | `?cursor`                                      | `{ id, startedAt, finishedAt, status, outputTail }[]`                                                                        |
| POST                | `/api/jobs/:id/run`             | jobs:run                   | `{ reason? }`                                  | `Action` (`job.run`)                                                                                                         |
| POST                | `/api/jobs/:id/toggle`          | jobs:toggle                | `{ enabled: boolean; reason }`                 | `Action` (`job.toggle`)                                                                                                      |
| GET                 | `/api/logs/sources`             | logs:read                  |                                                | `{ id, name, kind: 'file'\|'eventlog', path?: string }[]`                                                                    |
| GET                 | `/api/logs/:source`             | logs:read                  | `?from&to&level&q&limit=500&cursor`            | `{ ts, level, message, fields?: Record<string,unknown> }[]`                                                                  |
| GET                 | `/api/logs/:source/stream`      | logs:read                  | `?level&q`                                     | **SSE** `log.line`                                                                                                           |
| GET                 | `/api/alerts`                   | alerts:read                | `?state=firing\|acked\|resolved&cursor`        | `{ id, ruleId, name, severity: 'info'\|'warning'\|'critical', state, startedAt, ackedBy, resolvedAt, message, lastValue }[]` |
| POST                | `/api/alerts/:id/ack`           | alerts:ack                 | `{ silenceMinutes?: 60\|240\|1440; comment? }` | alert                                                                                                                        |
| GET/POST/PUT/DELETE | `/api/alerts/rules[/:id]`       | alerts:read / alerts:write | `AlertRule`                                    | `AlertRule`                                                                                                                  |
| GET/POST/PUT/DELETE | `/api/alerts/channels[/:id]`    | alerts:read / alerts:write | `{ kind, name, config }` (secrets write-only)  | channel (config masked)                                                                                                      |
| POST                | `/api/alerts/channels/:id/test` | alerts:write               |                                                | `{ delivered: boolean; error?: string }`                                                                                     |

```ts
type AlertRule = {
  id: string;
  name: string;
  enabled: boolean;
  severity: "info" | "warning" | "critical";
  when:
    | {
        kind: "metric";
        series: string;
        op: ">" | "<" | ">=" | "<=";
        value: number;
        forSec: number;
      }
    | { kind: "state"; target: string; equals: string; forSec: number } // e.g. service navypayroll-app != running
    | {
        kind: "age";
        target: "backup:<db>" | "backup:any";
        olderThanSec: number;
      }
    | { kind: "check"; checkId: string; status: Health; forSec: number };
  channels: string[];
  renotifyMin: number;
};
```

### 4.8 Actions, approvals, audit

| Method | Path                                | Perm               | Body / Query                                            | Response                                                                                          |
| ------ | ----------------------------------- | ------------------ | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| GET    | `/api/actions/catalog`              | actions:read       |                                                         | `{ type, risk, minRole, approval, blockedDuringPayrollWindow, paramsSchema /* JSON Schema */ }[]` |
| POST   | `/api/actions`                      | per type           | `{ type: ActionType; params: object; reason?: string }` | `Action` (generic entry point; module endpoints are thin aliases)                                 |
| GET    | `/api/actions` · `/api/actions/:id` | actions:read       | `?status&type&target&cursor`                            | `Action[]` · `Action & { logTail: string[] }`                                                     |
| GET    | `/api/actions/:id/stream`           | actions:read       |                                                         | **SSE** `action.progress`, `action.updated`                                                       |
| POST   | `/api/actions/:id/cancel`           | requester or admin | `{ reason }`                                            | `Action` (only `pending_approval`/`queued`)                                                       |
| GET    | `/api/approvals`                    | approvals:decide   | `?state=pending`                                        | `Action[]`                                                                                        |
| POST   | `/api/approvals/:actionId`          | approvals:decide   | `{ decision: 'approve' \| 'reject'; comment? }`         | `Action` — requester cannot approve own action                                                    |
| GET    | `/api/audit`                        | audit:read         | `?actor&event&target&from&to&cursor`                    | `AuditEntry[]`                                                                                    |
| GET    | `/api/audit/export.csv`             | audit:read         | same filters                                            | CSV                                                                                               |

### 4.9 Config, security, users, settings

| Method         | Path                           | Perm                           | Body                                                                                                               | Response                                                                                                                                      |
| -------------- | ------------------------------ | ------------------------------ | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| GET            | `/api/config/targets`          | config:read                    |                                                                                                                    | `{ id: 'payroll.env.production' \| 'payroll.env.local' \| 'payroll.winsw.app' \| 'sshd_config' \| 'mysql.my.ini', path, versions: number }[]` |
| GET            | `/api/config/:target`          | config:read                    |                                                                                                                    | `{ entries: { key, value: string \| '••••••', secret: boolean, required: boolean, missing: boolean }[]; sha256; updatedAt }`                  |
| GET            | `/api/config/:target/versions` | config:read                    |                                                                                                                    | `{ id, sha256, author, reason, ts }[]`                                                                                                        |
| PUT            | `/api/config/:target`          | config:write                   | `{ set: Record<string,string>; unset: string[]; baseSha256: string; restart: string[] /* service ids */; reason }` | `Action` (`config.update`, high, 1 approval) — `409 CONFLICT` if `baseSha256` stale                                                           |
| GET/POST/PATCH | `/api/security/findings[/:id]` | security:read / security:write | `{ title, source, ref, severity, status, owner, dueAt, notes }`                                                    | finding                                                                                                                                       |
| GET            | `/api/security/exposure`       | security:read                  |                                                                                                                    | `{ port, listening: boolean, boundTo: string[], firewallOpen: boolean, expected: 'loopback'\|'lan'\|'none', ok: boolean }[]`                  |
| GET/POST/PATCH | `/api/users[/:id]`             | users:admin                    | `{ email, name, role, active }`                                                                                    | user                                                                                                                                          |
| GET/PUT        | `/api/settings/:section`       | settings:admin                 | sections: `payrollWindow`, `integrations`, `heartbeat`, `retention`, `breakGlass`                                  | section JSON (secrets write-only)                                                                                                             |

### 4.10 Incidents & runbooks (M6)

`GET/POST/PATCH /api/incidents[/:id]`, `POST /api/incidents/:id/events` `{ kind: 'note'|'action'|'status', text, ref? }`, `GET /api/runbooks`, `POST /api/runbooks/:id/run` `{ reason }` → `Action` (`runbook.run`, which runs its steps as child actions).

## 5. SSE (`GET /api/events`, `text/event-stream`)

- Each message: `id: <ulid>`, `event: <type>`, `data: <json>`.
- The server sends `: ping` every 15 s.
- The client reconnects with `Last-Event-ID` and the server replays up to 1,000 recent events.
- `?topics=services,alerts,actions,metrics:host` filters the stream.

| Event                                              | Data                                                  |
| -------------------------------------------------- | ----------------------------------------------------- |
| `service.state`                                    | `{ id, state, prevState, at }`                        |
| `metric.tick`                                      | `{ series: string; ts; value }[]` (batched every 5 s) |
| `alert.fired` / `alert.updated` / `alert.resolved` | alert                                                 |
| `action.updated`                                   | `Action`                                              |
| `action.progress`                                  | `{ actionId, pct: number \| null, line: string, ts }` |
| `deploy.updated`                                   | `Deploy`                                              |
| `backup.updated`                                   | `Backup`                                              |
| `check.changed`                                    | `Check`                                               |
| `log.line` (stream endpoint only)                  | `{ source, ts, level, message }`                      |

## 6. Payroll internal ops API (`/internal/ops`, in NAVY-PAYROLL)

Guard:

- remote address must be loopback
- `X-Ops-Token` must equal `OPS_INTERNAL_TOKEN` (constant-time compare)
- cloudflared must never route here: the ingress rule and the WAF block `/internal/*` at the edge as defence in depth

| Method  | Path                            | Response                                                                                                                                                                             |
| ------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GET     | `/internal/ops/version`         | `{ sha, startedAt, node, env, serverMode, pid }`                                                                                                                                     |
| GET     | `/internal/ops/health/deep`     | `{ status: Health; checks: { mysql: { [db: string]: { status: Health; latencyMs } }; redis?: Check; disk: Check; chromium: Check; eventLoopLagMs: number; heapUsedBytes: number } }` |
| GET     | `/internal/ops/exports`         | `asyncExport.getStats()` → `{ enabled, running, queued, maxConcurrent, inlineMs, jobs: { jobId, status, method, url, createdAt, elapsedMs, size, error }[] }`                        |
| GET     | `/internal/ops/jobs`            | `{ id, name, schedule, enabled, running: boolean, lastRunAt, lastStatus, lastDurationMs, lastError }[]`                                                                              |
| POST    | `/internal/ops/jobs/:id/run`    | `{ started: boolean }` (409 if already running)                                                                                                                                      |
| POST    | `/internal/ops/jobs/:id/toggle` | `{ enabled: boolean }`                                                                                                                                                               |
| GET     | `/internal/ops/sessions`        | `{ activeUsers: number; byRole: Record<string, number>; byClass: Record<string, number> }` (counts only, no PII)                                                                     |
| GET/PUT | `/internal/ops/maintenance`     | `{ enabled: boolean; message: string; until: string \| null }`                                                                                                                       |

## 7. Agent RPC (named pipe, JSON-RPC 2.0, NDJSON)

Envelope (every request):

```json
{
  "jsonrpc": "2.0",
  "id": "01J…",
  "method": "service.control",
  "params": { "serviceId": "navypayroll-app", "op": "restart" },
  "auth": {
    "ts": 1760813580123,
    "nonce": "b64…",
    "sig": "hex(HMAC_SHA256(secret, id + method + ts + nonce + sha256(canonical(params))))"
  },
  "ctx": { "actionId": "01J…", "actor": "ops@example.com" }
}
```

Notifications from Agent: `{ "jsonrpc": "2.0", "method": "progress", "params": { "actionId", "pct", "line", "ts" } }` and `{ "method": "event", "params": { "type", "data" } }` (service state changes, outbox items).

| Method                                                                  | Params                                                                                     | Result                                                      | Notes                                 |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------- | ------------------------------------- |
| `agent.hello`                                                           | `{ apiVersion }`                                                                           | `{ agentVersion, hostname, capabilities: string[] }`        | handshake                             |
| `system.info`                                                           | —                                                                                          | host object (§4.2)                                          |                                       |
| `metrics.sample`                                                        | `{ processes?: string[] }`                                                                 | `{ ts, cpuPct, memUsedBytes, disks[], net[], processes[] }` |                                       |
| `service.list`                                                          | —                                                                                          | `Service[]` (OS view)                                       | registry from agent.json              |
| `service.control`                                                       | `{ serviceId, op }`                                                                        | `{ state }`                                                 | allow-listed ids only                 |
| `eventlog.query`                                                        | `{ log: 'System'\|'Application'\|'Security'\|'OpenSSH/Operational', from, level?, limit }` | entries                                                     |                                       |
| `file.tail` / `file.query`                                              | `{ sourceId, lines? \| from,to,q }`                                                        | lines                                                       | sourceId → path via allow-list        |
| `firewall.list` / `firewall.apply`                                      | `{ ruleset, dryRun }`                                                                      | `{ diff, applied }`                                         |                                       |
| `ssh.status` / `ssh.keys.add` / `ssh.keys.remove` / `ssh.config.harden` | typed                                                                                      | typed                                                       |                                       |
| `cloudflared.status` / `cloudflared.restart`                            | —                                                                                          | `{ connections, version }`                                  |                                       |
| `backup.run`                                                            | `{ databases, targets, actionId }`                                                         | `Backup[]`                                                  | streams progress                      |
| `backup.verify`                                                         | `{ backupId, deep }`                                                                       | `{ passed, details }`                                       |                                       |
| `restore.run`                                                           | `{ backupId, database, mode, preBackup: true }`                                            | `{ restored: true, preBackupId }`                           |                                       |
| `release.prepare`                                                       | `{ sha }`                                                                                  | `{ path }`                                                  | git archive + shared links + npm ci   |
| `release.activate`                                                      | `{ sha }`                                                                                  | `{ previousSha }`                                           | junction switch + restart             |
| `migrate.run`                                                           | `{ databases, dryRun }`                                                                    | `{ applied: string[], pending: string[] }`                  |                                       |
| `env.write`                                                             | `{ target, content_b64, sha256 }`                                                          | `{ versionId }`                                             | content never logged                  |
| `winupdate.scan` / `winupdate.install`                                  | typed                                                                                      | typed                                                       |                                       |
| `host.reboot`                                                           | `{ delaySec }`                                                                             | `{ scheduledAt }`                                           |                                       |
| `config.apply`                                                          | `{ agentConfig }`                                                                          | `{ ok }`                                                    | API pushes registries, policies, URLs |
| `outbox.drain`                                                          | `{ max }`                                                                                  | `{ items: { id, type, data }[] }`                           | API acks with `outbox.ack {ids}`      |

Agent errors: JSON-RPC `error: { code, message, data: { appCode } }` where `appCode` uses the same set as §1.2 plus `NOT_ALLOWED` (method/target not in allow-list) and `AUTH_FAILED`.

## 8. Action catalog (v1)

| Type                               | Risk            | Min role       | Approval             | Payroll-window block                        | Executor                |
| ---------------------------------- | --------------- | -------------- | -------------------- | ------------------------------------------- | ----------------------- |
| `service.start`                    | low             | operator       | —                    | —                                           | agent                   |
| `service.restart`                  | medium          | operator       | —                    | —                                           | agent                   |
| `service.stop`                     | high            | admin          | —                    | ✓                                           | agent                   |
| `cloudflared.restart`              | medium          | operator       | —                    | —                                           | agent                   |
| `host.reboot`                      | critical        | admin          | 1 admin              | ✓                                           | agent                   |
| `host.updates.install`             | high            | admin          | —                    | ✓                                           | agent                   |
| `firewall.apply`                   | critical        | admin          | 1 admin              | ✓                                           | agent                   |
| `ssh.keys.add` / `ssh.keys.remove` | high            | admin          | —                    | —                                           | agent                   |
| `ssh.config.harden`                | high            | admin          | —                    | —                                           | agent                   |
| `edge.cache.purge`                 | low             | operator       | —                    | —                                           | internal (CF API)       |
| `edge.maintenance.set`             | medium          | admin          | —                    | —                                           | internal (CF + Payroll) |
| `db.kill`                          | medium          | operator       | —                    | —                                           | internal (mysql)        |
| `db.migrate`                       | high            | admin          | 1 admin              | ✓                                           | agent                   |
| `backup.run`                       | low             | operator       | —                    | —                                           | agent                   |
| `backup.verify`                    | low             | operator       | —                    | —                                           | agent                   |
| `restore.run` (scratch)            | high            | admin          | —                    | —                                           | agent                   |
| `restore.run` (replace)            | critical        | admin          | 2 admins             | ✓                                           | agent                   |
| `deploy.run`                       | high            | admin / runner | — (runner on master) | ✓ (runner deploys queued until window ends) | agent                   |
| `deploy.rollback`                  | high            | operator       | — (fast recovery)    | —                                           | agent                   |
| `config.update`                    | high            | admin          | 1 admin              | ✓                                           | agent                   |
| `job.run`                          | low             | operator       | —                    | —                                           | internal / payroll      |
| `job.toggle`                       | medium          | admin          | —                    | —                                           | internal / payroll      |
| `runbook.run`                      | per steps (max) | operator       | per steps            | per steps                                   | internal                |

## 9. Outbound payloads

**Heartbeat** (`POST HEARTBEAT_URL` every 60 s, from Agent):

```json
{
  "host": "NAVY-SRV01",
  "ts": "…",
  "agent": "1.0.0",
  "status": "ok|degraded|down",
  "parts": {
    "api": "ok",
    "payroll": "ok",
    "mysql": "ok",
    "tunnel": "ok",
    "disk": "ok",
    "lastBackupAgeSec": 3600
  }
}
```

**Alert notification** (Telegram/email/SMS/webhook body):

```json
{
  "alertId": "01J…",
  "severity": "critical",
  "state": "firing|resolved",
  "name": "Payroll App down",
  "message": "navypayroll-app is stopped for 120s",
  "startedAt": "…",
  "link": "https://ops.<domain>/alerts/01J…"
}
```

Telegram text form: `🔴 CRITICAL · Payroll App down — navypayroll-app is stopped for 120s · 19:53 WAT · ops.<domain>/alerts/…`
