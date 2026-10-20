# Kaizen — Ops Platform for the NAVY-PAYROLL Server

Kaizen is the operations app for the physical Windows server that runs NAVY-PAYROLL. You can use it from anywhere: over the LAN, or over the internet through Cloudflare Tunnel + Access.

| # | Document | What it settles |
|---|---|---|
| 00 | [../OPS-KAIZEN-INVENTORY.md](../OPS-KAIZEN-INVENTORY.md) | Every ops operation needed (the "what") |
| 01 | [01-system-plan.md](01-system-plan.md) | Goals, users, requirements, decisions, phases, risks |
| 02 | [02-architecture.md](02-architecture.md) | Components, trust boundaries, flows, failure modes, data model |
| 03 | [03-backend.md](03-backend.md) | Repo layout, API + Agent structure, module anatomy, conventions |
| 04 | [04-frontend.md](04-frontend.md) | Web app structure, routes, pages, components, UX rules |
| 05 | [05-contracts.md](05-contracts.md) | REST, SSE, Agent RPC, Payroll internal API, action catalog |
| 06 | [06-deployment.md](06-deployment.md) | Server layout, services, tunnel/Access, install, updates, payroll release flow |

Naming used throughout: **Kaizen Web** (SPA), **Kaizen API** (control plane), **Kaizen Agent** (privileged executor), **Payroll** (NAVY-PAYROLL app). `<domain>` is the production zone on Cloudflare.
