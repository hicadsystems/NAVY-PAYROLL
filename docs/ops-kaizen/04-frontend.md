# 04 — Frontend Structure (Kaizen Web)

## 1. Stack

- React 18 + TypeScript (strict) + Vite
- React Router (data routers), TanStack Query (server state), Zustand (tiny UI state: theme, sidebar, live-pause)
- Tailwind + shadcn/ui (Radix), lucide icons, Recharts for charts
- Typed API client generated from `packages/contracts` (zod → types; a thin `fetch` wrapper)
- Served by Kaizen API as static files from `/`, same origin, so Access cookies just work and no CORS is needed

## 2. Folder layout

```
apps/web/src/
├─ main.tsx                     QueryClient, Router, Theme, SSE provider
├─ app/
│  ├─ routes.tsx                route table (see §3), lazy-loaded pages
│  ├─ layout/                   AppShell (sidebar, topbar, status strip), MobileNav, Breadcrumbs
│  └─ providers/                AuthProvider (/api/me), SseProvider, ThemeProvider
├─ api/
│  ├─ client.ts                 fetch wrapper: envelope unwrap, AppError mapping, request id capture
│  ├─ endpoints/                one file per module: services.ts, backups.ts … (typed fns)
│  └─ queries/                  TanStack hooks: useServices(), useRestartService() …
├─ realtime/
│  ├─ sse.ts                    EventSource with backoff + Last-Event-ID
│  └─ useLiveTopic.ts           subscribe → patch query cache (services, alerts, actions, metrics)
├─ features/                    one folder per domain, mirrors API modules
│  ├─ overview/  services/  host/  network/  edge/  access/  ssh/  firewall/
│  ├─ database/  backups/  deploys/  jobs/  logs/  alerts/  actions/  approvals/
│  ├─ audit/  config/  security/  incidents/  runbooks/  users/  settings/
│  │   └─ <feature>/
│  │       ├─ pages/            route components
│  │       ├─ components/       feature-only components
│  │       └─ hooks/            feature-only hooks
├─ components/                  shared UI
│  ├─ StatusBadge  StatCard  Sparkline  TimeSeriesChart  DataTable  EmptyState  ErrorState
│  ├─ ActionButton              wraps "request action" + confirm + progress
│  ├─ ConfirmDangerDialog       risk-aware confirm (reason, typed confirmation, approval notice)
│  ├─ ActionProgressDrawer      live log lines + status for an action id
│  ├─ LogViewer                 virtualised, follow mode, level filter, search highlight
│  ├─ JsonView  CodeBlock  KeyValueList  CopyButton  RelativeTime  Can (RBAC gate)
├─ lib/                         format (bytes, durations, Lagos time), permissions, risk colors
└─ styles/                      tailwind.css, tokens (light/dark)
```

## 3. Routes

| Path | Page | Min role | Main data |
|---|---|---|---|
| `/` | Overview | viewer | `GET /api/overview`, SSE `*` |
| `/services` · `/services/:id` | Services, Service detail | viewer | services, logs, restarts |
| `/host` | Host (CPU/RAM/disk/process, Windows Update, power, time) | viewer | host, metrics |
| `/network` | Adapters, WAN, egress, IP drift | viewer | network |
| `/edge` | Tunnel, ingress, analytics, WAF/rate/cache status, maintenance page | viewer | edge |
| `/access` | Access sessions/logs, SSH keys + sshd, RDP, firewall | viewer (edit admin) | access, ssh, firewall |
| `/database` · `/database/:db` | Instance, DBs, processlist, migrations, SQL console | viewer (console operator) | db |
| `/backups` · `/backups/policies` · `/backups/restores` | Inventory, policies, restores | viewer | backups |
| `/deploys` · `/deploys/:id` | Current release, history, rollback | viewer | deploys, releases |
| `/jobs` | Kaizen/Agent/Payroll jobs, runs, run-now | viewer | jobs |
| `/logs` · `/logs/:source` | Sources list, live tail + search | viewer | logs + SSE |
| `/alerts` · `/alerts/rules` · `/alerts/channels` | Firing/acked/resolved, rules, channels | viewer (edit admin) | alerts |
| `/actions` · `/actions/:id` | Action history, live progress | viewer | actions + SSE |
| `/approvals` | Pending approvals | admin | approvals |
| `/audit` | Full audit trail with filters, CSV export | viewer | audit |
| `/config` · `/config/:target` | Env viewer (masked), versions, diff, edit | operator (edit admin) | config |
| `/security` | Findings tracker, exposure checks | viewer | security |
| `/incidents` · `/runbooks` | M6 | viewer | incidents, runbooks |
| `/users` · `/settings` | Users/roles, settings (payroll window, integrations) | admin | users, settings |

## 4. Page specs (v1)

**Overview**
- Top status strip: overall `ok/degraded/down` plus one chip each for Payroll, MySQL, Tunnel, Backups, Disk and Last deploy.
- Cards: active alerts (ack inline), services grid (state + restart), host gauges (CPU/RAM/disk), last backup per DB (age colour), Payroll exports running/queued, edge req/min + 5xx/524 rate.
- Everything updates live. A "Live/Paused" toggle stops SSE patching while you read.

**Services**
- Table: name, kind, state, uptime, memory, CPU, restarts 24 h, start mode, plus actions (start/stop/restart).
- Detail page: state timeline, recent log tail, WinSW config (read-only), dependencies, action history for this target.

**Database**
- Instance card: version, uptime, connections vs max, slow queries.
- DB table: size, tables, last backup, migrations pending.
- Processlist (auto-refresh 5 s) with kill.
- SQL console:
  - SELECT/SHOW/EXPLAIN only, a DB picker and a row limit
  - results grid with an export button
  - every query audited
  - the editor shows the "read-only" rule

**Backups**
- Inventory grouped by DB: newest first, with size, location (local/R2), verify status and age.
- Buttons: Run now, Verify, Restore.
- Restore wizard:
  1. pick backup → target (scratch DB or replace)
  2. maintenance mode on (pre-checked)
  3. pre-restore backup (forced on)
  4. reason
  5. approval notice → submit
  6. progress drawer

**Deploys**
- Current: sha, message, author, age, health. Release list (prepared/active/previous).
- History: steps with durations and the failure point.
- Rollback button on any previous release. Redeploy of any sha (operator, approval outside working hours).

**Logs**
- Source picker (App, Proxy, Watcher, mDNS, cloudflared, runner, MySQL error, sshd, Windows System/Application/Security).
- Virtualised viewer with follow mode, level filter and text search.
- The time-range query uses the REST endpoint. Live mode uses SSE.

**Alerts**
- Firing list with ack/silence (1 h/4 h/24 h) and history.
- Rules editor: metric/state picker, threshold, `for` duration, severity, channels. Dry-run shows whether the rule would fire now.
- Channels: add Telegram/email/SMS, send a test.

## 5. Dangerous-action UX (one component, used everywhere)

`<ActionButton type="service.restart" params={{serviceId}} />`
1. It reads the action definition (risk, approval, calendar block) from `GET /api/actions/catalog` (cached).
2. **low**: single click, toast on success.
3. **medium**: confirm dialog with an optional reason.
4. **high**: dialog with a required reason and the target name to type (e.g. `NavyPayroll-App`).
5. **critical**: as high, plus a banner explaining approvals ("needs 1/2 admin approvals") and the payroll-window warning.
6. On submit:
   - `202` → open the `ActionProgressDrawer` (SSE `action.progress`), with the state also shown in the global "Actions" tray in the topbar.
   - `pending_approval` → the tray shows "Waiting for approval" and approvers get a notification plus an `/approvals` badge.
7. Disabled state with a tooltip when RBAC denies it (`<Can permission>`), never hidden silently. Viewers should see that the action exists.

## 6. Data & realtime rules

- TanStack Query owns server state. Default `staleTime` is 10 s; lists polled at 30 s only when the SSE connection is down.
- SSE topics: `services`, `alerts`, `actions`, `metrics:host`, `metrics:payroll`, `deploys`, `backups`, `logs:<source>` (on demand). Events patch the query cache by key and never trigger refetch storms.
- Errors: the contract `error.code` maps to user-facing text (`AGENT_UNAVAILABLE` → "Server agent is offline — actions are disabled, data may be stale"). Always show the `requestId` with a copy button.
- Stale data indicator: every card shows "updated 12s ago" and turns amber if older than 3× its interval.

## 7. Look & feel

- Dense, calm, operational. Light and dark themes. Status colours: green ok, amber degraded, red down, slate unknown. Never colour-only: there is always an icon + label.
- Responsive:
  - Phones get a bottom nav (Overview, Alerts, Services, Actions, More).
  - Tables collapse to cards.
  - The primary phone actions are ack alert, restart service, run backup and rollback.
- Times are shown in Africa/Lagos with relative time and an exact tooltip.
- Accessibility: keyboard navigation for dialogs and tables, focus trap in confirms, `aria-live` for action progress.
