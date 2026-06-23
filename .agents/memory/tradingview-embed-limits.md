---
name: TradingView free embed exchange limits
description: Which markets the free TradingView embed widgets can and cannot show
---

# TradingView free embed exchange data limits

Free embeddable TradingView widgets (the `s3.tradingview.com/external-embedding/*.js` ones) do NOT carry data entitlements for restricted exchanges. **Taiwan (TWSE/TPEX, all `TWSE:*` symbols incl. `TWSE:TAIEX`, `TWSE:2330`) is blocked** — the chart shows a "此商品僅在 TradingView 上可用" popup and quote widgets show warning icons. Changing the symbol does not help; it is a licensing block, not a bug.

**Works fine in free embeds:** US (NASDAQ/NYSE/FOREXCOM/indices), crypto (BINANCE:*), forex.

**Why:** exchange redistribution agreements forbid serving TWSE data through third-party free embeds.

**How to apply:** never rely on TradingView free embeds for Taiwan-stock data. In `market-monitor` the 台股 tab now uses **official TWSE data via backend proxy** (see [TWSE official data](twse-official-data.md)), not embeds — rendered with TradingView Lightweight Charts (open source). The old "資料來源建置中" notice is gone. NYSE:TSM ADR can proxy TSMC only (USD-priced, misleading) — not used.
