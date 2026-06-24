# 市場監測與交易平台 (Market Monitor & Trader)

Single unified web app (the `market-monitor` artifact, served at `/`) combining two formerly-separate products:
- **市場監測 / 持倉 / 策略** — 繁中 dashboard: TW/US/crypto market monitoring, manual holdings P&L, TradingView webhook signals.
- **交易下單** — OKX spot + perp trading terminal (live tickers, candle chart, account equity/holdings, market buy/sell by USDT notional with optional stop-loss, recent orders/fills, AI Trade Battle, auto-trade engine).

The order panel has an exchange selector (OKX active; 派網/Pionex stubbed as "待綁定" — planned, no backend yet). The old standalone `okx-trader` artifact is retired and parked at `/okx-classic/` (kept as a reversible backup, pending deletion).

## Security note

The API server exposes `/api/okx/*` without authentication and uses your server-side OKX API keys to place real orders. Keep the deployed URL private, and ideally only deploy with IP allow-listing or behind your own auth proxy. Stop-loss is only supported on buy orders (a sell of held base currency leaves no spot position to protect).

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

_Populate as you build — short repo map plus pointers to the source-of-truth file for DB schema, API contracts, theme files, etc._

## Architecture decisions

- AI integrations use the Replit AI Integrations proxy for all 4 providers (env vars `AI_INTEGRATIONS_{ANTHROPIC,OPENAI,GEMINI,OPENROUTER}_{BASE_URL,API_KEY}` are auto-provisioned). No user API keys required, charges go to Replit credits.
- For simplicity we install provider SDKs directly in `@workspace/api-server` (skipping the per-provider integration lib packages and `conversations`/`messages` DB schemas the templates ship with). Each request is one-shot — no chat history is persisted.
- Gemini SDK requires `httpOptions: { apiVersion: "" }` so the proxy URL isn't double-prefixed with `/v1beta`.
- OpenRouter uses the OpenAI SDK with the OpenRouter base URL — they're API-compatible.
- AI Battle endpoint (`POST /okx/ai/recommend`) calls all 4 providers in parallel via `Promise.all`; per-provider failures degrade gracefully (`ok: false` with `error`) rather than failing the whole response.

## Product

- Live OKX spot dashboard: tickers, 1H candle chart, account equity & holdings, market buy/sell with optional stop-loss, recent orders/fills.
- AI Trade Battle: clicking the panel above the order form fans out the same market context (ticker + last 48 1H candles + balance) to 4 models in parallel — Claude Sonnet 4.6, OpenAI GPT-5.4, Gemini 2.5 Pro, DeepSeek V4 Pro (via OpenRouter). Each returns a structured JSON decision (buy/sell/hold + size in USDT + optional stop-loss + 1-10 confidence + short reasoning). The user clicks Execute on whichever recommendation they want; nothing trades automatically.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
