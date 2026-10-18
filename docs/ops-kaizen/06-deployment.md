# 06 — Deployment

## 1. Server layout

```
C:\Kaizen\
├─ app\
│  ├─ current\                 → junction to releases\<version>
│  └─ releases\<version>\
│     ├─ node\node.exe         bundled Node 22 (portable), used by both services
│     ├─ api\                  api.js (esbuild bundle) + node_modules\better-sqlite3 (win-x64 prebuilt)
│     ├─ agent\                agent.js + scripts\*.ps1 (signed)
│     ├─ web\                  built SPA (served by API)
│     └─ VERSION, SHA256SUMS
├─ bin\                        winsw.exe, KaizenAPI.exe/.xml, KaizenAgent.exe/.xml, cloudflared.exe
├─ config\kaizen.json          non-secret config (hostnames, paths, registries)
├─ data\
│  ├─ kaizen.db (+ -wal, -shm) SQLite
│  ├─ actions\<id>.log         action output
│  └─ staging\                 backup staging before upload
└─ logs\                       api.log, agent.log, winsw logs

C:\ProgramData\Kaizen\         ACL: SYSTEM + Administrators (+ read for NT SERVICE\KaizenAPI on api\)
├─ secrets.dpapi               DPAPI (LocalMachine) blob: HMAC key, CF token, GH token, R2 keys,
│                              backup master key, Telegram/SMTP/Termii creds, OPS_INTERNAL_TOKEN, runner token
└─ agent\agent.json, outbox\   Agent config + durable outbox

D:\Backups\                    (or a second disk) local backup copies, outside the project folders

C:\NavyPayroll\                Payroll moves to release folders (M3)
├─ current\                    → junction to releases\<sha>
├─ releases\<sha>\             git archive of that commit + node_modules
├─ shared\                     persistent across releases
│  ├─ .env.production  .env.local  cert.pem  key.pem
│  ├─ uploads\  notifications\  preferences\  restores\  logs\  temp\
└─ bin\                        winsw.exe, NavyPayroll-*.exe/.xml (point at C:\NavyPayroll\current), node\node.exe
```

Inside each Payroll release, `uploads`, `notifications`, `preferences`, `restores`, `logs`, `temp` and the env/cert files are junctions or symlinks into `shared\`, created by `release.prepare`.

## 2. Services

| Service | Account | Start | Depends on | Listens |
|---|---|---|---|---|
| `KaizenAgent` | LocalSystem | Automatic | — | named pipe only |
| `KaizenAPI` | `NT SERVICE\KaizenAPI` (virtual account) | Automatic (delayed) | KaizenAgent | `127.0.0.1:7700` |
| `cloudflared` | LocalSystem (default install) | Automatic, recovery: restart ×3 | — | outbound only; metrics `127.0.0.1:20241` |
| `MySQL80` | existing | Automatic | — | `127.0.0.1:3306` (`bind-address`) |
| `NavyPayroll-App` | → dedicated account later (P1) | Automatic (delayed) | **MySQL80** (add `<depend>`) | `127.0.0.1:5500` (`SERVER_MODE=localhost`) |
| `NavyPayroll-Proxy` / `-mDNS` | existing | only if LAN access is kept | NavyPayroll-App | LAN 443/80 / 5353 |
| `NavyPayroll-Watcher` | — | **Disabled in production** | — | — |
| `actions.runner.*` | existing | Automatic | — | outbound only |
| `sshd` | existing | Automatic | — | `127.0.0.1:22` (+ admin LAN if wanted) |

The WinSW XML for every service uses `%BASE%\..\current\node\node.exe` (bundled Node), not `process.execPath` of whatever Node was installed when setup ran.

## 3. Network & Cloudflare

**Tunnel (remotely managed). Ingress, in order:**

| Public hostname | Service | Access app |
|---|---|---|
| `payroll.<domain>` | `http://127.0.0.1:5500` | none (public); WAF blocks `/internal/*` |
| `ops.<domain>` | `http://127.0.0.1:7700` | **Kaizen**: allow group `kaizen-users`, MFA required, session 12 h |
| `ssh.<domain>` | `ssh://127.0.0.1:22` | **SSH**: allow group `kaizen-admins`, session 8 h |
| `rdp.<domain>` | `rdp://127.0.0.1:3389` | **RDP** (browser-based): `kaizen-admins` |
| catch-all | `http_status:404` | |

**Firewall baseline** (`firewall.apply ruleset=kaizen-baseline`):
- remove `NAVY_PAYROLL_*` `profile=any` rules
- allow 443/80/5353 only from the LAN subnet and only if LAN access is kept
- 22 and 3389 from the admin LAN subnet only
- 3306, 5500 and 7700 stay loopback (bind-address plus no rule)
- outbound open (cloudflared needs 7844 UDP/TCP or 443)

**Cloudflare API token** (stored in DPAPI): Zone Read, Cache Purge, Zone Analytics Read, Cloudflare Tunnel Read, Access: Audit Logs Read, Zone WAF Read (Edit only if the Kaizen edge-write features are enabled).

**GitHub**: fine-grained token, read-only on Actions, Contents and Metadata for `NAVY-PAYROLL` + `kaizen`. Once the runner is registered, the runner-registration PAT is **removed** from Payroll's `.env.local`.

## 4. Secrets

- Stored in one DPAPI-LocalMachine encrypted blob, written by `install-kaizen.ps1` / the API settings page through `env.write`-style Agent calls.
- At start the Agent decrypts it and hands the API only what it needs over the pipe (`secrets.get` scoped list).
- Rotation: Settings → Integrations → rotate → new value is written and the services restart. Audited.
- The backup master key is also exported **once** at install as a printed/USB recovery copy, kept off-site. Without it, encrypted backups cannot be restored on a new machine.

## 5. First install — `deploy/install-kaizen.ps1`

Run as Administrator on the server:
1. **Preflight**:
   - Windows version, admin rights, disk space, existing Payroll services, MySQL service name
   - outbound reachability to `api.cloudflare.com`, `github.com` and the R2 endpoint
2. Create `C:\Kaizen\…`, `C:\ProgramData\Kaizen\…` with ACLs; create the virtual account service identity.
3. Extract release zip → `releases\<version>`; verify `SHA256SUMS` and the script signatures; create `current` junction.
4. **Interactive config** (or `-ConfigFile`):
   - domain, hostnames, LAN subnet, MySQL bin path
   - R2 bucket/endpoint/keys, Cloudflare token + account/zone/tunnel ids, Access team + AUD
   - GitHub token, Telegram bot/chat, SMTP, heartbeat URL
   - first admin emails
5. Generate the HMAC key, runner token, `OPS_INTERNAL_TOKEN` and backup master key → DPAPI blob. Print the recovery sheet for the master key.
6. MySQL:
   - create `kaizen_ro` (SELECT, PROCESS, SHOW VIEW, REPLICATION CLIENT, CONNECTION_ADMIN)
   - create `kaizen_backup` (SELECT, SHOW VIEW, TRIGGER, LOCK TABLES, EVENT, RELOAD, PROCESS + restore rights on scratch DBs)
   - set `bind-address=127.0.0.1` (ask first; restart MySQL in a maintenance window)
7. Install `cloudflared` as a service with the tunnel token if it isn't installed yet. Verify the connector is healthy.
8. Register `KaizenAgent`, then `KaizenAPI` with WinSW; start; wait for `GET http://127.0.0.1:7700/healthz` → ok.
9. Seed the DB:
   - first admins
   - default alert rules (service down, disk > 85/95%, backup age > 26 h, tunnel down, Payroll deep health down, MySQL connections > 80%, 524 rate > 1%)
   - default backup policy (all DBs, 01:30 WAT daily, 7/4/12, local + R2)
   - payroll window
10. Add `OPS_INTERNAL_TOKEN` to Payroll `shared\.env.production` and restart Payroll (needs the Payroll `/internal/ops` release).
11. Print a summary: URLs, Access apps to verify, next steps (firewall baseline dry-run, SSH hardening dry-run).

Kaizen's own `/healthz` (no auth, loopback only) returns `{ status, version, db: ok, agent: ok }` for local scripts and the watchdog.

## 6. Updating Kaizen

**CI (GitHub-hosted, `kaizen` repo)**:
- `ci.yml` (PRs): typecheck, lint, unit + API tests (mock agent), Pester, web build, Playwright smoke.
- `release.yml` (tag `v*`):
  - build web (Vite) and bundle API + Agent (esbuild)
  - add portable Node 22 win-x64 + better-sqlite3 prebuilt
  - sign `.ps1` scripts
  - zip `kaizen-<version>-win-x64.zip` + `SHA256SUMS` → GitHub Release

**On the server** (`update-kaizen.ps1 -Version 1.2.0`, or Kaizen Settings → Update, which runs the same script as a detached helper):
1. Download the release, verify checksum and signatures, extract to `releases\<version>`.
2. Back up `kaizen.db` (`VACUUM INTO data\kaizen-<old>.db`).
3. Stop `KaizenAPI` → switch the `current` junction → start `KaizenAPI` (DB migrations run on start) → wait for `/healthz`.
4. Restart `KaizenAgent` using a detached helper, since the Agent can't restart itself mid-call. Wait for the `agent.hello` handshake.
5. On any failure: switch the junction back, restore the DB copy, restart both, and alert.
6. Keep the last 3 releases, prune older ones.

## 7. Payroll deploy flow (M3, replaces the robocopy workflow)

New `.github/workflows/deploy.yml` in NAVY-PAYROLL (self-hosted runner):
```yaml
name: Deploy to Server
on:
  push:
    branches: [master]
jobs:
  deploy:
    runs-on: self-hosted
    steps:
      - name: Request deploy from Kaizen
        shell: powershell
        run: |
          $body = @{ sha = "${{ github.sha }}"; reason = "push by ${{ github.actor }}" } | ConvertTo-Json
          $r = Invoke-RestMethod -Method Post -Uri http://127.0.0.1:7700/api/deploys `
               -Headers @{ Authorization = "Bearer $env:KAIZEN_RUNNER_TOKEN" } -ContentType 'application/json' -Body $body
          $id = $r.data.id
          do { Start-Sleep 5; $a = (Invoke-RestMethod -Uri "http://127.0.0.1:7700/api/actions/$id" `
               -Headers @{ Authorization = "Bearer $env:KAIZEN_RUNNER_TOKEN" }).data }
          while ($a.status -in @('queued','running','pending_approval'))
          if ($a.status -ne 'succeeded') { throw "Deploy $($a.status): $($a.error.message)" }
    env:
      KAIZEN_RUNNER_TOKEN: ${{ secrets.KAIZEN_RUNNER_TOKEN }}
```
Kaizen performs these steps (see 02 §4.4):
1. backup
2. prepare (`git archive` → releases, shared links, `npm ci --omit=dev` with bundled Node)
3. migrate (dry-run → apply)
4. activate (junction)
5. restart App
6. health gate (deep health green for 60 s)
7. purge Cloudflare static cache
8. auto-rollback on any failure from step 4 onward

The runner token also needs read access to `GET /api/actions/:id` (loopback only). The GitHub job fails visibly if the deploy fails or rolls back.

**One-time migration from the current in-place layout:**
1. Snapshot: full backup of all DBs + copy of `C:\Projects\NAVY-PAYROLL` (or wherever it lives today).
2. Create `C:\NavyPayroll\shared\` and move `.env*`, `cert/key.pem`, `uploads`, `notifications`, `preferences`, `restores` into it.
3. `release.prepare` for the current master sha. Verify that the shared links resolve.
4. Re-register the Payroll WinSW services against `C:\NavyPayroll\current` with bundled Node, `<depend>MySQL80</depend>`, `SERVER_MODE=localhost`. Disable `NavyPayroll-Watcher`.
5. Switch traffic: cloudflared ingress → `127.0.0.1:5500` and smoke-test (login, payroll register PDF, payslip). Keep the old folder for 2 weeks as a fallback.

## 8. Environments

| Env | Where | Agent | Purpose |
|---|---|---|---|
| dev | developer laptop | `scripts/mock-agent.ts` (implements RPC contract with fake data) or real Agent on a Windows VM | build features |
| staging | Windows VM (or spare PC) with MySQL + a copy of Payroll + its own tunnel `ops-staging.<domain>` | real | test actions, install/update scripts, restore drills |
| prod | the physical server | real | — |

## 9. Kaizen's own resilience

- Nightly `VACUUM INTO` of `kaizen.db` → included in the R2 upload set (encrypted).
- The Agent watchdog restarts `KaizenAPI` if `/healthz` fails 3× (and vice versa, `KaizenAPI` reports a missing Agent).
- If Kaizen is down: SSH via Access → `sc query KaizenAPI`, `Get-Content C:\Kaizen\logs\api.log -Tail 100`, `sc start KaizenAPI`.
- Break-glass (LAN): enable in settings ahead of time. It requires TOTP and is audited.

## 10. Go-live checklist

- [ ] Cloudflare: tunnel healthy; 4 hostnames; Access apps + groups + MFA; WAF managed rules on; `/internal/*` blocked; rate-limit on login; cache bypass for API routes; notifications on tunnel health
- [ ] Payroll: `/internal/ops` released; `SERVER_MODE=localhost`, `BIND_ADDRESS=127.0.0.1`; CORS public origin; real client IP from `CF-Connecting-IP`; `serveIndex` on `/public` removed; audit CVE fixes merged
- [ ] Firewall baseline applied (dry-run reviewed); external port scan clean
- [ ] SSH hardened; keys loaded; password auth off; SSH via Access tested from outside
- [ ] Kaizen installed; first admins log in; roles correct; audit shows the logins
- [ ] Alerts: test message received on every channel; heartbeat monitor configured, and stopping the Agent triggers an external alert
- [ ] Backups: first run succeeded for all DBs; R2 objects present and encrypted; deep verify passed; restore drill timed and recorded
- [ ] Deploy: test commit → auto deploy succeeded; deliberately broken commit → auto rollback succeeded
- [ ] Recovery sheet (backup master key, break-glass TOTP seed, Cloudflare account recovery) stored off-site
- [ ] Runbooks written for: App down, MySQL down, disk full, tunnel down, WAN down, Cloudflare outage, restore, rollback
