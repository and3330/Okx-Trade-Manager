import { createHmac } from "node:crypto";
import { logger } from "./logger";

const OKX_BASE_URL = process.env["OKX_BASE_URL"] ?? "https://www.okx.com";

function getCreds(): { key: string; secret: string; passphrase: string } {
  const key = process.env["OKX_API_KEY"];
  const secret = process.env["OKX_API_SECRET"];
  const passphrase = process.env["OKX_API_PASSPHRASE"];
  if (!key || !secret || !passphrase) {
    throw new Error(
      "OKX credentials missing — set OKX_API_KEY, OKX_API_SECRET, OKX_API_PASSPHRASE",
    );
  }
  return { key, secret, passphrase };
}

function sign(
  timestamp: string,
  method: string,
  requestPath: string,
  body: string,
  secret: string,
): string {
  return createHmac("sha256", secret)
    .update(timestamp + method + requestPath + body)
    .digest("base64");
}

export type OkxResponse<T> = {
  code: string;
  msg: string;
  data: T;
};

export class OkxError extends Error {
  code: string;
  status: number;
  constructor(code: string, msg: string, status = 502) {
    super(msg);
    this.code = code;
    this.status = status;
  }
}

export async function okxRequest<T = unknown>(
  method: "GET" | "POST",
  path: string,
  options: { query?: Record<string, string>; body?: unknown; signed?: boolean } = {},
): Promise<T> {
  const { query, body, signed = true } = options;
  let requestPath = path;
  if (query && Object.keys(query).length > 0) {
    const qs = new URLSearchParams(query).toString();
    requestPath = `${path}?${qs}`;
  }

  const url = `${OKX_BASE_URL}${requestPath}`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  const bodyStr = body ? JSON.stringify(body) : "";

  if (signed) {
    const { key, secret, passphrase } = getCreds();
    const timestamp = new Date().toISOString();
    const signature = sign(timestamp, method, requestPath, bodyStr, secret);
    headers["OK-ACCESS-KEY"] = key;
    headers["OK-ACCESS-SIGN"] = signature;
    headers["OK-ACCESS-TIMESTAMP"] = timestamp;
    headers["OK-ACCESS-PASSPHRASE"] = passphrase;
  }

  const res = await fetch(url, {
    method,
    headers,
    body: method === "POST" ? bodyStr : undefined,
  });

  let json: OkxResponse<T>;
  try {
    json = (await res.json()) as OkxResponse<T>;
  } catch {
    throw new OkxError("HTTP_ERROR", `OKX HTTP ${res.status}`, 502);
  }

  if (!res.ok || json.code !== "0") {
    logger.warn(
      { code: json.code, msg: json.msg, path, status: res.status },
      "OKX API error",
    );
    throw new OkxError(
      json.code || String(res.status),
      json.msg || `OKX HTTP ${res.status}`,
      res.status >= 500 ? 502 : 400,
    );
  }

  return json.data;
}

const num = (v: unknown): number => {
  const n = typeof v === "string" ? parseFloat(v) : (v as number);
  return Number.isFinite(n) ? n : 0;
};

// ---------- Account ----------

type OkxBalanceDetail = {
  ccy: string;
  cashBal?: string;
  availBal?: string;
  availEq?: string;
  frozenBal?: string;
  eqUsd?: string;
  eq?: string;
};

type OkxBalanceRow = {
  totalEq?: string;
  uTime?: string;
  details?: OkxBalanceDetail[];
};

export type AssetBalanceData = {
  ccy: string;
  available: number;
  frozen: number;
  equityUsd: number;
};

export type AccountBalanceData = {
  totalEquityUsd: number;
  assets: AssetBalanceData[];
  updatedAt: string;
};

export async function fetchAccountBalance(): Promise<AccountBalanceData> {
  const data = await okxRequest<OkxBalanceRow[]>(
    "GET",
    "/api/v5/account/balance",
  );
  const row = data[0];
  if (!row) {
    return { totalEquityUsd: 0, assets: [], updatedAt: new Date().toISOString() };
  }
  const assets: AssetBalanceData[] = (row.details ?? [])
    .map((d) => ({
      ccy: d.ccy,
      available: num(d.availBal ?? d.availEq ?? d.cashBal),
      frozen: num(d.frozenBal),
      equityUsd: num(d.eqUsd),
    }))
    .filter((a) => a.available > 0 || a.frozen > 0 || a.equityUsd > 0)
    .sort((a, b) => b.equityUsd - a.equityUsd);

  const updatedAt = row.uTime
    ? new Date(parseInt(row.uTime, 10)).toISOString()
    : new Date().toISOString();

  return {
    totalEquityUsd: num(row.totalEq),
    assets,
    updatedAt,
  };
}

// ---------- Market ----------

type OkxTickerRow = {
  instId: string;
  last: string;
  open24h: string;
  high24h: string;
  low24h: string;
  vol24h: string;
  volCcy24h: string;
};

export type TickerData = {
  instId: string;
  last: number;
  open24h: number;
  high24h: number;
  low24h: number;
  vol24h: number;
  changePct24h: number;
};

const TOP_INSTRUMENTS = [
  "BTC-USDT",
  "ETH-USDT",
  "SOL-USDT",
  "BNB-USDT",
  "XRP-USDT",
  "DOGE-USDT",
  "ADA-USDT",
  "AVAX-USDT",
  "LINK-USDT",
  "TON-USDT",
  "MATIC-USDT",
  "DOT-USDT",
];

function tickerFromRow(r: OkxTickerRow): TickerData {
  const last = num(r.last);
  const open = num(r.open24h);
  const changePct = open > 0 ? ((last - open) / open) * 100 : 0;
  return {
    instId: r.instId,
    last,
    open24h: open,
    high24h: num(r.high24h),
    low24h: num(r.low24h),
    vol24h: num(r.vol24h),
    changePct24h: changePct,
  };
}

export async function fetchTopTickers(): Promise<TickerData[]> {
  const rows = await okxRequest<OkxTickerRow[]>(
    "GET",
    "/api/v5/market/tickers",
    { query: { instType: "SPOT" }, signed: false },
  );
  const wanted = new Set(TOP_INSTRUMENTS);
  const map = new Map<string, OkxTickerRow>();
  for (const r of rows) {
    if (wanted.has(r.instId)) map.set(r.instId, r);
  }
  return TOP_INSTRUMENTS.filter((id) => map.has(id)).map((id) =>
    tickerFromRow(map.get(id)!),
  );
}

export async function fetchTicker(instId: string): Promise<TickerData> {
  const rows = await okxRequest<OkxTickerRow[]>(
    "GET",
    "/api/v5/market/ticker",
    { query: { instId }, signed: false },
  );
  const row = rows[0];
  if (!row) throw new OkxError("NOT_FOUND", `Ticker ${instId} not found`, 404);
  return tickerFromRow(row);
}

export type CandleData = {
  ts: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export async function fetchCandles(instId: string): Promise<CandleData[]> {
  // OKX returns candles newest-first, each as [ts, o, h, l, c, vol, volCcy, volCcyQuote, confirm]
  const rows = await okxRequest<string[][]>(
    "GET",
    "/api/v5/market/candles",
    { query: { instId, bar: "1H", limit: "100" }, signed: false },
  );
  return rows
    .slice()
    .reverse()
    .map((r) => ({
      ts: new Date(parseInt(r[0]!, 10)).toISOString(),
      open: num(r[1]),
      high: num(r[2]),
      low: num(r[3]),
      close: num(r[4]),
      volume: num(r[5]),
    }));
}

// ---------- Trade ----------

type OkxOrderRow = {
  ordId: string;
  instId: string;
  side: string;
  ordType: string;
  state: string;
  sz: string;
  px?: string;
  avgPx?: string;
  notionalUsd?: string;
  cTime: string;
};

export type OrderData = {
  ordId: string;
  instId: string;
  side: "buy" | "sell";
  ordType: string;
  state: string;
  sz: number;
  px: number | null;
  avgPx: number | null;
  notionalUsd: number | null;
  createdAt: string;
};

function orderFromRow(r: OkxOrderRow): OrderData {
  return {
    ordId: r.ordId,
    instId: r.instId,
    side: r.side === "sell" ? "sell" : "buy",
    ordType: r.ordType,
    state: r.state,
    sz: num(r.sz),
    px: r.px ? num(r.px) : null,
    avgPx: r.avgPx && r.avgPx !== "" ? num(r.avgPx) : null,
    notionalUsd: r.notionalUsd ? num(r.notionalUsd) : null,
    createdAt: new Date(parseInt(r.cTime, 10)).toISOString(),
  };
}

export async function fetchOrders(): Promise<OrderData[]> {
  const [pending, history] = await Promise.all([
    okxRequest<OkxOrderRow[]>("GET", "/api/v5/trade/orders-pending", {
      query: { instType: "SPOT" },
    }),
    okxRequest<OkxOrderRow[]>("GET", "/api/v5/trade/orders-history", {
      query: { instType: "SPOT", limit: "50" },
    }),
  ]);
  const all = [...pending, ...history].map(orderFromRow);
  // Dedupe by ordId
  const seen = new Set<string>();
  const out: OrderData[] = [];
  for (const o of all) {
    if (seen.has(o.ordId)) continue;
    seen.add(o.ordId);
    out.push(o);
  }
  out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return out.slice(0, 50);
}

type OkxFillRow = {
  tradeId: string;
  ordId?: string;
  instId: string;
  side: string;
  fillSz: string;
  fillPx: string;
  ts: string;
};

export type FillData = {
  tradeId: string;
  ordId: string | null;
  instId: string;
  side: "buy" | "sell";
  fillSz: number;
  fillPx: number;
  ts: string;
};

export async function fetchRecentFills(): Promise<FillData[]> {
  const rows = await okxRequest<OkxFillRow[]>(
    "GET",
    "/api/v5/trade/fills",
    { query: { instType: "SPOT", limit: "50" } },
  );
  return rows.map((r) => ({
    tradeId: r.tradeId,
    ordId: r.ordId ?? null,
    instId: r.instId,
    side: r.side === "sell" ? "sell" : "buy",
    fillSz: num(r.fillSz),
    fillPx: num(r.fillPx),
    ts: new Date(parseInt(r.ts, 10)).toISOString(),
  }));
}

// ---------- Place order ----------

export type PlaceOrderInput = {
  instId: string;
  side: "buy" | "sell";
  notionalUsd: number;
  stopLossPrice?: number | null;
};

export type PlaceOrderOutput = {
  ordId: string;
  instId: string;
  side: string;
  status: string;
  algoId: string | null;
  message: string | null;
};

export async function placeMarketOrder(
  input: PlaceOrderInput,
): Promise<PlaceOrderOutput> {
  const { instId, side, notionalUsd, stopLossPrice } = input;

  // Stop-loss only makes sense for BUY (you have a base-currency position to
  // protect afterwards). Reject SL on sell to avoid confusing inverse logic.
  if (stopLossPrice && stopLossPrice > 0 && side !== "buy") {
    throw new OkxError(
      "BAD_REQUEST",
      "Stop-loss is only supported for buy orders on spot",
      400,
    );
  }

  // Compute base-currency size from USDT notional via current ticker.
  // We need this both for SELL orders (sz must be base) and for the SL
  // algo order that closes the bought position.
  const ticker = await fetchTicker(instId);
  if (ticker.last <= 0) {
    throw new OkxError("BAD_PRICE", "Could not determine market price", 400);
  }
  const baseSize = notionalUsd / ticker.last;
  const baseSizeStr = baseSize.toFixed(8);

  // Parent order: BUY uses tgtCcy=quote_ccy with sz=USDT notional. SELL
  // uses base size.
  const parentBody: Record<string, string> = {
    instId,
    tdMode: "cash",
    side,
    ordType: "market",
    sz: side === "buy" ? String(notionalUsd) : baseSizeStr,
  };
  if (side === "buy") parentBody["tgtCcy"] = "quote_ccy";

  type PlaceOrderRow = { ordId: string; sCode: string; sMsg: string };

  const rows = await okxRequest<PlaceOrderRow[]>(
    "POST",
    "/api/v5/trade/order",
    { body: parentBody },
  );
  const row = rows[0];
  if (!row) throw new OkxError("NO_RESPONSE", "OKX returned no order", 502);
  if (row.sCode !== "0") {
    throw new OkxError(row.sCode, row.sMsg || "Order rejected", 400);
  }

  let algoId: string | null = null;
  let message: string | null = null;

  if (stopLossPrice && stopLossPrice > 0 && side === "buy") {
    try {
      // Sell-side conditional algo to close the long via market on trigger.
      // sz must be in base currency for a sell.
      const algoBody: Record<string, string> = {
        instId,
        tdMode: "cash",
        side: "sell",
        ordType: "conditional",
        slTriggerPx: String(stopLossPrice),
        slOrdPx: "-1",
        sz: baseSizeStr,
      };

      type AlgoRow = { algoId: string; sCode: string; sMsg: string };
      const algo = await okxRequest<AlgoRow[]>(
        "POST",
        "/api/v5/trade/order-algo",
        { body: algoBody },
      );
      const aRow = algo[0];
      if (aRow && aRow.sCode === "0") {
        algoId = aRow.algoId;
      } else if (aRow) {
        message = `Order placed but stop-loss failed: ${aRow.sMsg}`;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      message = `Order placed but stop-loss failed: ${msg}`;
      logger.warn({ err }, "Stop-loss algo order failed");
    }
  }

  return {
    ordId: row.ordId,
    instId,
    side,
    status: "submitted",
    algoId,
    message,
  };
}

export async function fetchAccountSummary(): Promise<{
  totalEquityUsd: number;
  assetCount: number;
  openOrderCount: number;
  topAssets: AssetBalanceData[];
  updatedAt: string;
}> {
  const [bal, pending] = await Promise.all([
    fetchAccountBalance(),
    okxRequest<unknown[]>("GET", "/api/v5/trade/orders-pending", {
      query: { instType: "SPOT" },
    }).catch(() => [] as unknown[]),
  ]);
  return {
    totalEquityUsd: bal.totalEquityUsd,
    assetCount: bal.assets.length,
    openOrderCount: pending.length,
    topAssets: bal.assets.slice(0, 5),
    updatedAt: bal.updatedAt,
  };
}
