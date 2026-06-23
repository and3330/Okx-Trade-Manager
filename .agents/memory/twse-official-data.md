---
name: TWSE official Taiwan stock data
description: How to pull real Taiwan stock quotes & daily candles from official TWSE public endpoints
---

# Official TWSE data (free, no API key)

Both endpoints work from the Replit env and need a non-empty `User-Agent` header. Browser cannot call them directly (CORS) — always proxy through the backend.

## Realtime-ish quotes — MIS
`https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=tse_2330.tw|otc_6488.tw|tse_t00.tw&json=1&delay=0`
- Returns `{ msgArray: [...] }`. Match each result by field `c` (the code).
- Channel prefix matters: listed = `tse_<code>.tw`, OTC/上櫃 = `otc_<code>.tw`, TAIEX index = `tse_t00.tw`. We don't know a code's market up front, so query BOTH `tse_` and `otc_` per numeric code and pick whichever returns.
- Key fields: `z`=last trade price (**is `"-"` before the first trade of the day** → fall back to `y` for valuation but keep change null so we don't show a fake flat move), `y`=prev close, `o`/`h`/`l`, `v`=volume, `n`=name, `t`=time.

## Daily OHLC history — STOCK_DAY
`https://www.twse.com.tw/exchangeReport/STOCK_DAY?response=json&date=YYYYMM01&stockNo=2330`
- Returns ONE calendar month per call. Fetch the last ~4 months in parallel and merge for a useful chart.
- `stat` must be `"OK"`; future/empty months return a "沒有符合條件的資料" stat.
- `data` rows: `[日期, 成交股數, 成交金額, 開盤價, 最高價, 最低價, 收盤價, ...]`.
- **Dates are ROC format** `115/06/01` → Gregorian year = `1911 + 115` = 2026. Prices have thousands commas.
- Per-stock only — the **index `t00` has NO daily report**, so the candle chart special-cases it (prompt user to pick a stock).

## In market-monitor
- Backend: `GET /monitor/tw/quotes?codes=` and `GET /monitor/tw/candles?code=` in `artifacts/api-server/src/routes/monitor.ts`; 台股 holdings auto-priced live by reusing the quotes fetch.
- Frontend renders candles with `lightweight-charts` v5 (API is `chart.addSeries(CandlestickSeries, opts)`, NOT the removed `addCandlestickSeries`).
- **Taiwan color convention: red = up, green = down** (opposite of US). Applied in TwChart/TwQuotes intentionally.
