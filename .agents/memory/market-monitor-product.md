---
name: market-monitor product
description: The second product in this monorepo — a TradingView-fed market monitoring dashboard, distinct from the OKX trader.
---

# 每日市場監測 (market-monitor artifact)

A繁中 React dashboard, separate product from the OKX auto-trader but in the same pnpm monorepo. Three tabs: 台股 / 美股 / 虛擬貨幣. It is an 輔助工具 (assistant), not an auto-trader.

## Key decisions / constraints

- **TWSE (台股) cannot be shown via TradingView free embeds** — exchange licensing blocks it. The Taiwan tab intentionally shows a "資料來源建置中" notice. US + crypto are fully live. See `tradingview-embed-limits.md`. Do NOT "fix" the Taiwan notice — it is honest and deliberate.
- **Strategy monitoring is webhook-based, not polling.** The user runs their own Pine strategy on a paid TradingView plan and points a TradingView Alert webhook at `POST /api/monitor/webhook/tradingview`. The webhook only works once the app is DEPLOYED — TradingView cannot reach the dev/preview URL.
- **Webhook auth = a single shared passphrase**, auto-generated and stored as a singleton settings row. The `/api/monitor/*` surface is otherwise unauthenticated, same accepted constraint as the OKX product (single-user, keep URL private).

## getOrCreateSettings must stay singleton

`monitor_settings` is pinned to `id=1` and created via `insert(...).onConflictDoNothing()` then `select where id=1`.
**Why:** an earlier `select limit 1` then conditional insert was racy — concurrent first-time requests could create multiple rows with different passphrases, and unordered `limit(1)` reads would then make the "active" passphrase drift, causing intermittent webhook 401s even with previously-copied credentials.
**How to apply:** never revert to "select then insert if empty" for settings; always read/write the fixed id=1 row.

## Holdings/portfolio P/L is per-market, never cross-currency

`holdings` rows carry a `market` (tw|us|crypto). The dashboard shows P/L **subtotals per market**, never one grand total.
**Why:** the three markets settle in different currencies (tw=TWD, us=USD, crypto=USDT). Summing cost/market-value across them produces a meaningless number. The user explicitly prefers honest gaps over wrong figures (寧錯過不做錯).
**How to apply:** keep totals grouped by market; if you ever add a grand total, it must be currency-aware (FX conversion), not a naive sum.

## Holdings current price: live for crypto, manual for us/tw

`GET /monitor/holdings` enriches each row with `currentPrice` + `priceSource`. Crypto = live from Binance public ticker (`/api/v3/ticker/price`, parse the part after `:` in the TV symbol, 4s `AbortSignal.timeout`). us/tw = the user's `manualPrice` (inline-editable in the table via PATCH); no free live source. Rows with no price show "—" and are excluded from market value & P/L.

## Watchlist market is an enum

`market` is constrained to `tw|us|crypto` in the OpenAPI spec (and thus the generated `WatchlistInputMarket` union + Zod validator). The dashboard tab switching relies on these exact values. Adding a market means updating the enum in `openapi.yaml`, re-running codegen, and adding the tab in `Dashboard.tsx`.
