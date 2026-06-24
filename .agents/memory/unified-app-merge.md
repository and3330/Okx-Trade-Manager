---
name: Unified app merge (monitor + OKX trader)
description: The two products are now one app; which artifact is the live front door and what's deferred.
---

# Unified market-monitor + OKX trader

The two formerly-separate web artifacts were merged into ONE product.

- **`market-monitor` is the unified app, served at `/`** — holds market monitoring + OKX trading + holdings + strategy.
- **`okx-trader` is retired**, parked at `/okx-classic/` (not deleted — reversible backup, pending user
  confirmation to delete). Build new features in `market-monitor`, not here.

**Why the merge was low-friction:** both artifacts shared identical shadcn ui sets, the `@/` alias, and
`@workspace/api-client-react`, and the backend (`/okx/*` etc. in the shared `api-server`) was untouched.
Keep that parity in mind before splitting UI back out into a lib.

**Pionex (派網) — deferred, NOT built.** User wants ordering to also bind Pionex; the trade UI only stubs it
(disabled "待綁定" selector). When building it: same shape as OKX — user-supplied API key + secret as Replit
secrets, HMAC-signed server-side; no Replit integration exists for Pionex.
