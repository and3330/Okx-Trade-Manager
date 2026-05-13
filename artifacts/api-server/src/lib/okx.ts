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

// ---------- Perpetual (SWAP) ----------

const TOP_PERP_INSTRUMENTS = [
  "BTC-USDT-SWAP",
  "ETH-USDT-SWAP",
  "SOL-USDT-SWAP",
  "BNB-USDT-SWAP",
  "XRP-USDT-SWAP",
  "DOGE-USDT-SWAP",
  "HYPE-USDT-SWAP",
  "AVAX-USDT-SWAP",
  "LINK-USDT-SWAP",
  "TON-USDT-SWAP",
  "PEPE-USDT-SWAP",
  "SUI-USDT-SWAP",
];

type OkxInstrumentRow = {
  instId: string;
  instType: string;
  ctVal: string;
  ctValCcy: string;
  lotSz: string;
  minSz: string;
  tickSz: string;
  lever: string;
  state: string;
};

export type PerpInstrumentMeta = {
  instId: string;
  baseCcy: string;
  ctVal: number;
  lotSz: number;
  minSz: number;
  tickSz: number;
  maxLeverage: number;
};

const instrumentCache = new Map<string, PerpInstrumentMeta>();

export async function fetchPerpInstrument(instId: string): Promise<PerpInstrumentMeta> {
  const cached = instrumentCache.get(instId);
  if (cached) return cached;
  const rows = await okxRequest<OkxInstrumentRow[]>(
    "GET",
    "/api/v5/public/instruments",
    { query: { instType: "SWAP", instId }, signed: false },
  );
  const r = rows[0];
  if (!r) throw new OkxError("NOT_FOUND", `Instrument ${instId} not found`, 404);
  const meta: PerpInstrumentMeta = {
    instId: r.instId,
    baseCcy: r.ctValCcy,
    ctVal: num(r.ctVal),
    lotSz: num(r.lotSz),
    minSz: num(r.minSz),
    tickSz: num(r.tickSz),
    maxLeverage: num(r.lever) || 50,
  };
  instrumentCache.set(instId, meta);
  return meta;
}

export type PerpTickerData = TickerData & { baseCcy: string };

export type AllPerpTickerRow = {
  instId: string;
  baseCcy: string;
  last: number;
  changePct24h: number;
  volUsd24h: number;
};

export async function fetchAllPerpTickers(): Promise<AllPerpTickerRow[]> {
  const rows = await okxRequest<OkxTickerRow[]>(
    "GET",
    "/api/v5/market/tickers",
    { query: { instType: "SWAP" }, signed: false },
  );
  const out: AllPerpTickerRow[] = [];
  for (const r of rows) {
    if (!r.instId.endsWith("-USDT-SWAP")) continue;
    const last = num(r.last);
    const open = num(r.open24h);
    if (last <= 0) continue;
    const changePct = open > 0 ? ((last - open) / open) * 100 : 0;
    const volUsd = num(r.volCcy24h) * last;
    out.push({
      instId: r.instId,
      baseCcy: r.instId.replace("-USDT-SWAP", ""),
      last,
      changePct24h: changePct,
      volUsd24h: volUsd,
    });
  }
  return out;
}

export async function fetchTopPerpTickers(): Promise<PerpTickerData[]> {
  const rows = await okxRequest<OkxTickerRow[]>(
    "GET",
    "/api/v5/market/tickers",
    { query: { instType: "SWAP" }, signed: false },
  );
  const wanted = new Set(TOP_PERP_INSTRUMENTS);
  const map = new Map<string, OkxTickerRow>();
  for (const r of rows) if (wanted.has(r.instId)) map.set(r.instId, r);
  return TOP_PERP_INSTRUMENTS.filter((id) => map.has(id)).map((id) => {
    const t = tickerFromRow(map.get(id)!);
    return { ...t, baseCcy: id.replace("-USDT-SWAP", "") };
  });
}

type OkxAccountConfigRow = {
  posMode: string;
};

export async function fetchPositionMode(): Promise<"net_mode" | "long_short_mode"> {
  const rows = await okxRequest<OkxAccountConfigRow[]>(
    "GET",
    "/api/v5/account/config",
  );
  const mode = rows[0]?.posMode;
  return mode === "long_short_mode" ? "long_short_mode" : "net_mode";
}

type OkxPositionRow = {
  instId: string;
  instType: string;
  posSide: string;
  pos: string;
  posCcy?: string;
  avgPx: string;
  markPx?: string;
  upl?: string;
  uplRatio?: string;
  margin?: string;
  imr?: string;
  lever: string;
  mgnMode: string;
  liqPx?: string;
  cTime?: string;
  uTime?: string;
};

export type PerpPositionData = {
  instId: string;
  posSide: "long" | "short" | "net";
  contracts: number;
  baseQty: number;
  avgEntryPx: number;
  markPx: number;
  unrealizedPnlUsd: number;
  unrealizedPnlPct: number;
  marginUsd: number;
  leverage: number;
  marginMode: "isolated" | "cross";
  liquidationPx: number | null;
  updatedAt: string;
};

export async function fetchPerpPositions(): Promise<PerpPositionData[]> {
  const rows = await okxRequest<OkxPositionRow[]>(
    "GET",
    "/api/v5/account/positions",
    { query: { instType: "SWAP" } },
  );
  const out: PerpPositionData[] = [];
  for (const r of rows) {
    const contractsRaw = num(r.pos);
    if (contractsRaw === 0) continue;
    let meta: PerpInstrumentMeta;
    try {
      meta = await fetchPerpInstrument(r.instId);
    } catch {
      continue;
    }
    const posSide: "long" | "short" | "net" =
      r.posSide === "long" || r.posSide === "short" ? r.posSide : "net";
    const signed = posSide === "short" ? -Math.abs(contractsRaw) : posSide === "long" ? Math.abs(contractsRaw) : contractsRaw;
    const baseQty = signed * meta.ctVal;
    const margin = num(r.margin ?? r.imr);
    const upl = num(r.upl);
    const uplPct = margin > 0 ? (upl / margin) * 100 : num(r.uplRatio) * 100;
    out.push({
      instId: r.instId,
      posSide,
      contracts: signed,
      baseQty,
      avgEntryPx: num(r.avgPx),
      markPx: num(r.markPx),
      unrealizedPnlUsd: upl,
      unrealizedPnlPct: uplPct,
      marginUsd: margin,
      leverage: num(r.lever),
      marginMode: r.mgnMode === "cross" ? "cross" : "isolated",
      liquidationPx: r.liqPx && r.liqPx !== "" ? num(r.liqPx) : null,
      updatedAt: r.uTime ? new Date(parseInt(r.uTime, 10)).toISOString() : new Date().toISOString(),
    });
  }
  return out;
}

export async function setLeverage(
  instId: string,
  leverage: number,
  mgnMode: "isolated" | "cross",
  posSide?: "long" | "short",
): Promise<void> {
  const body: Record<string, string> = {
    instId,
    lever: String(leverage),
    mgnMode,
  };
  if (posSide && mgnMode === "isolated") body["posSide"] = posSide;
  type Row = { lever: string };
  await okxRequest<Row[]>("POST", "/api/v5/account/set-leverage", { body });
}

export type PlacePerpOrderInput = {
  instId: string;
  side: "long" | "short";
  marginUsdt: number;
  leverage: number;
  takeProfitPrice?: number | null;
  stopLossPrice?: number | null;
  /** Optional client ID for the attached OCO algo so we can deterministically locate it after submission. */
  algoClOrdId?: string | null;
};

export type PlacePerpOrderOutput = {
  ordId: string;
  instId: string;
  side: "long" | "short";
  contracts: number;
  notionalUsd: number;
  markPx: number;
  leverage: number;
  status: string;
  message: string | null;
};

export async function placePerpMarketOrder(
  input: PlacePerpOrderInput,
): Promise<PlacePerpOrderOutput> {
  const { instId, side, marginUsdt, leverage } = input;
  if (marginUsdt <= 0) throw new OkxError("BAD_REQUEST", "Margin must be > 0", 400);
  if (leverage < 1) throw new OkxError("BAD_REQUEST", "Leverage must be >= 1", 400);

  const meta = await fetchPerpInstrument(instId);
  if (leverage > meta.maxLeverage) {
    throw new OkxError(
      "BAD_REQUEST",
      `Leverage ${leverage}x exceeds instrument max ${meta.maxLeverage}x`,
      400,
    );
  }
  const ticker = await fetchTicker(instId);
  if (ticker.last <= 0) throw new OkxError("BAD_PRICE", "No market price", 400);
  if (input.stopLossPrice && input.stopLossPrice > 0) {
    if (side === "long" && input.stopLossPrice >= ticker.last) {
      throw new OkxError("BAD_REQUEST", "Long stop-loss must be below last price", 400);
    }
    if (side === "short" && input.stopLossPrice <= ticker.last) {
      throw new OkxError("BAD_REQUEST", "Short stop-loss must be above last price", 400);
    }
  }
  if (input.takeProfitPrice && input.takeProfitPrice > 0) {
    if (side === "long" && input.takeProfitPrice <= ticker.last) {
      throw new OkxError("BAD_REQUEST", "Long take-profit must be above last price", 400);
    }
    if (side === "short" && input.takeProfitPrice >= ticker.last) {
      throw new OkxError("BAD_REQUEST", "Short take-profit must be below last price", 400);
    }
  }

  const notional = marginUsdt * leverage;
  const rawContracts = notional / (ticker.last * meta.ctVal);
  const contracts = Math.floor(rawContracts / meta.lotSz) * meta.lotSz;
  if (contracts < meta.minSz) {
    throw new OkxError(
      "BAD_REQUEST",
      `Computed size ${rawContracts.toFixed(4)} below min ${meta.minSz} contracts. Increase margin or leverage.`,
      400,
    );
  }

  const posMode = await fetchPositionMode();
  const posSide: "long" | "short" | undefined =
    posMode === "long_short_mode" ? side : undefined;
  const orderSide = side === "long" ? "buy" : "sell";

  // Set leverage (idempotent on OKX)
  try {
    await setLeverage(instId, leverage, "isolated", posSide);
  } catch (err) {
    logger.warn({ err, instId, leverage }, "set-leverage failed (continuing)");
  }

  const body: Record<string, unknown> = {
    instId,
    tdMode: "isolated",
    side: orderSide,
    ordType: "market",
    sz: String(contracts),
  };
  if (posSide) body["posSide"] = posSide;

  const algo: Record<string, string> = {};
  if (input.takeProfitPrice && input.takeProfitPrice > 0) {
    algo["tpTriggerPx"] = String(input.takeProfitPrice);
    algo["tpOrdPx"] = "-1";
  }
  if (input.stopLossPrice && input.stopLossPrice > 0) {
    algo["slTriggerPx"] = String(input.stopLossPrice);
    algo["slOrdPx"] = "-1";
  }
  if (Object.keys(algo).length > 0) {
    if (input.algoClOrdId) algo["algoClOrdId"] = input.algoClOrdId;
    body["attachAlgoOrds"] = [algo];
  }

  type Row = { ordId: string; sCode: string; sMsg: string };
  const rows = await okxRequest<Row[]>("POST", "/api/v5/trade/order", { body });
  const r = rows[0];
  if (!r) throw new OkxError("NO_RESPONSE", "OKX returned no order", 502);
  if (r.sCode !== "0") throw new OkxError(r.sCode, r.sMsg || "Order rejected", 400);

  return {
    ordId: r.ordId,
    instId,
    side,
    contracts,
    notionalUsd: contracts * meta.ctVal * ticker.last,
    markPx: ticker.last,
    leverage,
    status: "submitted",
    message: null,
  };
}

export type PendingAlgoOrder = {
  algoId: string;
  algoClOrdId: string | null;
  instId: string;
  ordType: string;
  slTriggerPx: number | null;
  tpTriggerPx: number | null;
  side: string;
  posSide: string | null;
  sz: string;
};

type OkxAlgoRow = {
  algoId: string;
  algoClOrdId?: string;
  instId: string;
  ordType: string;
  slTriggerPx?: string;
  tpTriggerPx?: string;
  side: string;
  posSide?: string;
  sz: string;
  state?: string;
};

export async function fetchPendingAlgoOrders(instId: string): Promise<PendingAlgoOrder[]> {
  // OKX requires ordType: attached SL+TP becomes "oco"; SL-only or TP-only becomes "conditional".
  // The endpoint accepts only one ordType per call, so query both and merge.
  const queryBoth = async (ordType: string) => {
    try {
      return await okxRequest<OkxAlgoRow[]>(
        "GET",
        "/api/v5/trade/orders-algo-pending",
        { query: { instType: "SWAP", instId, ordType } },
      );
    } catch (e) {
      logger.warn({ err: e, ordType, instId }, "orders-algo-pending fetch failed");
      return [] as OkxAlgoRow[];
    }
  };
  const [oco, cond] = await Promise.all([queryBoth("oco"), queryBoth("conditional")]);
  const rows = [...oco, ...cond];
  return rows.map((r) => ({
    algoId: r.algoId,
    algoClOrdId: r.algoClOrdId && r.algoClOrdId !== "" ? r.algoClOrdId : null,
    instId: r.instId,
    ordType: r.ordType,
    slTriggerPx: r.slTriggerPx && r.slTriggerPx !== "" ? num(r.slTriggerPx) : null,
    tpTriggerPx: r.tpTriggerPx && r.tpTriggerPx !== "" ? num(r.tpTriggerPx) : null,
    side: r.side,
    posSide: r.posSide ?? null,
    sz: r.sz,
  }));
}

export async function amendAlgoSlTrigger(args: {
  instId: string;
  algoId: string;
  newSlTriggerPx: number;
}): Promise<void> {
  const body: Record<string, unknown> = {
    instId: args.instId,
    algoId: args.algoId,
    newSlTriggerPx: String(args.newSlTriggerPx),
    newSlOrdPx: "-1",
  };
  type Row = { sCode: string; sMsg: string };
  const rows = await okxRequest<Row[]>("POST", "/api/v5/trade/amend-algos", { body });
  const r = rows[0];
  if (!r) throw new OkxError("NO_RESPONSE", "OKX returned no amend result", 502);
  if (r.sCode !== "0") throw new OkxError(r.sCode, r.sMsg || "Amend rejected", 400);
}

export type ClosePerpInput = {
  instId: string;
  posSide?: "long" | "short" | "net";
  marginMode?: "isolated" | "cross";
};

export async function closePerpPosition(
  input: ClosePerpInput,
): Promise<{ instId: string; status: string }> {
  // Auto-resolve marginMode and posSide from the actual open position when not provided,
  // so we don't blindly send "isolated" against a cross-margin position (or vice versa).
  let marginMode = input.marginMode;
  let posSide = input.posSide;
  if (!marginMode || !posSide) {
    const positions = await fetchPerpPositions().catch(() => [] as PerpPositionData[]);
    const match = positions.find(
      (p) => p.instId === input.instId && (!posSide || posSide === "net" || p.posSide === posSide),
    );
    if (!match) {
      throw new OkxError("NO_POSITION", `No open position to close on ${input.instId}`, 404);
    }
    if (!marginMode) marginMode = match.marginMode;
    if (!posSide) posSide = match.posSide;
  }
  const body: Record<string, string> = {
    instId: input.instId,
    mgnMode: marginMode,
  };
  if (posSide && posSide !== "net") body["posSide"] = posSide;
  type Row = { instId: string };
  await okxRequest<Row[]>("POST", "/api/v5/trade/close-position", { body });
  return { instId: input.instId, status: "closed" };
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

// ---------- Public market context (no auth) ----------

const PUBLIC_BASE_URL = OKX_BASE_URL;

async function publicGet<T = unknown>(
  path: string,
  query?: Record<string, string>,
): Promise<T> {
  let url = `${PUBLIC_BASE_URL}${path}`;
  if (query && Object.keys(query).length > 0) {
    url += `?${new URLSearchParams(query).toString()}`;
  }
  const res = await fetch(url);
  const json = (await res.json().catch(() => ({}))) as OkxResponse<T>;
  if (!res.ok || (json.code && json.code !== "0")) {
    throw new OkxError(
      String(json.code ?? res.status),
      json.msg || `OKX HTTP ${res.status}`,
      res.status >= 500 ? 502 : 400,
    );
  }
  return json.data;
}

async function publicPost<T = unknown>(
  path: string,
  body: unknown,
): Promise<T> {
  const res = await fetch(`${PUBLIC_BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const json = (await res.json().catch(() => ({}))) as OkxResponse<T>;
  if (!res.ok || (json.code && json.code !== "0")) {
    throw new OkxError(
      String(json.code ?? res.status),
      json.msg || `OKX HTTP ${res.status}`,
      res.status >= 500 ? 502 : 400,
    );
  }
  return json.data;
}

// --- Technical indicators (OKX AIGC endpoint) ---

export type IndicatorBar =
  | "3m" | "5m" | "15m" | "1H" | "4H" | "12Hutc" | "1Dutc" | "3Dutc" | "1Wutc";

export type IndicatorRequestSpec = {
  code: string; // e.g. "RSI", "MACD", "BB", "ATR"
  paramList?: number[];
};

type IndicatorPoint = { ts: string; values: Record<string, string | number> };
type IndicatorBucket = Record<string, IndicatorPoint[]>;
type IndicatorTimeframeBlock = { indicators: IndicatorBucket };
type IndicatorRow = {
  instId: string;
  timeframes: Record<string, IndicatorTimeframeBlock>;
};
type IndicatorResponseRow = { data: IndicatorRow[] };

export type IndicatorResultByCode = Record<
  string,
  { ts: string; values: Record<string, number> }
>;

export async function fetchIndicators(
  instId: string,
  bar: IndicatorBar,
  specs: IndicatorRequestSpec[],
): Promise<IndicatorResultByCode> {
  const indicators: Record<string, { paramList?: number[] }> = {};
  for (const s of specs) indicators[s.code] = s.paramList ? { paramList: s.paramList } : {};
  const body = { instId, timeframes: [bar], indicators };
  const data = await publicPost<IndicatorResponseRow[]>(
    "/api/v5/aigc/mcp/indicators",
    body,
  );
  const block = data[0]?.data?.[0]?.timeframes?.[bar]?.indicators;
  const out: IndicatorResultByCode = {};
  if (!block) return out;
  for (const code of Object.keys(block)) {
    const point = block[code]?.[0];
    if (!point) continue;
    const numeric: Record<string, number> = {};
    for (const k of Object.keys(point.values)) {
      const v = point.values[k];
      const n = typeof v === "string" ? parseFloat(v) : v;
      if (Number.isFinite(n)) numeric[k] = n as number;
    }
    out[code] = { ts: point.ts, values: numeric };
  }
  return out;
}

export type MultiTimeframeIndicators = Record<
  string, // bar
  IndicatorResultByCode
>;

const STANDARD_INDICATORS: IndicatorRequestSpec[] = [
  { code: "RSI", paramList: [14] },
  { code: "MACD", paramList: [12, 26, 9] },
  { code: "BB", paramList: [20, 2] },
  { code: "ATR", paramList: [14] },
  { code: "ADX", paramList: [14] },
  { code: "EMA", paramList: [20] },
  { code: "SUPERTREND", paramList: [10, 3] },
  { code: "STOCHRSI", paramList: [14, 14, 3, 3] },
  { code: "OBV" },
];

const STANDARD_BARS: IndicatorBar[] = ["15m", "1H", "4H", "1Dutc"];

// OKX indicator endpoint rejects more than ~6 indicators in one request, so split into batches.
const INDICATOR_BATCHES: IndicatorRequestSpec[][] = [
  [
    { code: "RSI", paramList: [14] },
    { code: "MACD", paramList: [12, 26, 9] },
    { code: "BB", paramList: [20, 2] },
    { code: "ATR", paramList: [14] },
    { code: "ADX", paramList: [14] },
  ],
  [
    { code: "EMA", paramList: [20] },
    { code: "SUPERTREND", paramList: [10, 3] },
    { code: "STOCHRSI", paramList: [14, 14, 3, 3] },
    { code: "OBV" },
  ],
];
void STANDARD_INDICATORS;

export async function fetchStandardMultiTimeframeIndicators(
  instId: string,
): Promise<MultiTimeframeIndicators> {
  const entries = await Promise.all(
    STANDARD_BARS.map(async (bar) => {
      const batchResults = await Promise.all(
        INDICATOR_BATCHES.map(async (batch) => {
          try {
            return await fetchIndicators(instId, bar, batch);
          } catch (err) {
            logger.warn({ err, instId, bar, batchSize: batch.length }, "indicators fetch failed");
            return {} as IndicatorResultByCode;
          }
        }),
      );
      const merged: IndicatorResultByCode = {};
      for (const r of batchResults) Object.assign(merged, r);
      return [bar, merged] as const;
    }),
  );
  const out: MultiTimeframeIndicators = {};
  for (const [bar, r] of entries) out[bar] = r;
  return out;
}

export function summarizeIndicators(byBar: MultiTimeframeIndicators): string {
  const lines: string[] = [];
  for (const bar of STANDARD_BARS) {
    const r = byBar[bar];
    if (!r || Object.keys(r).length === 0) continue;
    const parts: string[] = [];
    const rsi = r["RSI"]?.values["14"];
    if (rsi != null) {
      const tag = rsi >= 70 ? " [超買]" : rsi <= 30 ? " [超賣]" : "";
      parts.push(`RSI ${rsi.toFixed(1)}${tag}`);
    }
    const macd = r["MACD"]?.values;
    if (macd) {
      const dif = macd["dif"];
      const dea = macd["dea"];
      const hist = macd["macd"];
      if (dif != null && dea != null && hist != null) {
        const cross = dif > dea ? "多頭" : "空頭";
        parts.push(`MACD ${cross}(dif ${dif.toFixed(2)} dea ${dea.toFixed(2)} hist ${hist.toFixed(2)})`);
      }
    }
    const bb = r["BB"]?.values;
    if (bb && bb["upper"] != null && bb["lower"] != null && bb["middle"] != null) {
      parts.push(`BB ${bb["lower"].toFixed(2)}~${bb["middle"].toFixed(2)}~${bb["upper"].toFixed(2)}`);
    }
    const atr = r["ATR"]?.values["14"];
    if (atr != null) parts.push(`ATR ${atr.toFixed(2)}`);
    const adx = r["ADX"]?.values["14"] ?? r["ADX"]?.values["adx"];
    if (adx != null) {
      const tag = adx >= 25 ? " [強趨勢]" : adx < 20 ? " [盤整]" : "";
      parts.push(`ADX ${adx.toFixed(1)}${tag}`);
    }
    const ema = r["EMA"]?.values["20"];
    if (ema != null) parts.push(`EMA20 ${ema.toFixed(2)}`);
    const st = r["SUPERTREND"]?.values;
    if (st) {
      const dir = st["direction"] ?? st["trend"] ?? null;
      const val = st["supertrend"] ?? st["value"] ?? null;
      if (dir != null) parts.push(`SUPERTREND ${dir > 0 ? "多" : "空"}${val != null ? ` @${val.toFixed(2)}` : ""}`);
    }
    const stoch = r["STOCHRSI"]?.values;
    if (stoch && stoch["k"] != null && stoch["d"] != null) {
      parts.push(`StochRSI K${stoch["k"].toFixed(1)}/D${stoch["d"].toFixed(1)}`);
    }
    const obv = r["OBV"]?.values["obv"] ?? r["OBV"]?.values["value"];
    if (obv != null) parts.push(`OBV ${obv.toExponential(2)}`);
    lines.push(`[${bar}] ${parts.join("  ")}`);
  }
  return lines.join("\n");
}

// Pull a single ATR(14) value at a given bar — used for SL distance defaults.
export async function fetchAtr(
  instId: string,
  bar: IndicatorBar = "1H",
): Promise<number | null> {
  try {
    const r = await fetchIndicators(instId, bar, [{ code: "ATR", paramList: [14] }]);
    const v = r["ATR"]?.values["14"];
    return v != null && Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

// --- Funding / OI / sentiment ---

type FundingRow = {
  instId: string;
  fundingRate: string;
  nextFundingRate?: string;
  fundingTime: string;
  nextFundingTime?: string;
};

export type FundingRateData = {
  instId: string;
  fundingRate: number;
  nextFundingRate: number | null;
  fundingTime: string;
  nextFundingTime: string | null;
};

export async function fetchFundingRate(instId: string): Promise<FundingRateData | null> {
  try {
    const rows = await publicGet<FundingRow[]>("/api/v5/public/funding-rate", { instId });
    const r = rows[0];
    if (!r) return null;
    return {
      instId: r.instId,
      fundingRate: num(r.fundingRate),
      nextFundingRate: r.nextFundingRate ? num(r.nextFundingRate) : null,
      fundingTime: r.fundingTime ? new Date(parseInt(r.fundingTime, 10)).toISOString() : "",
      nextFundingTime: r.nextFundingTime ? new Date(parseInt(r.nextFundingTime, 10)).toISOString() : null,
    };
  } catch (err) {
    logger.warn({ err, instId }, "funding-rate fetch failed");
    return null;
  }
}

type OpenInterestRow = { instId: string; oi: string; oiCcy: string; ts: string };
export type OpenInterestData = {
  instId: string;
  oi: number;
  oiCcy: number;
  ts: string;
};

export async function fetchOpenInterest(instId: string): Promise<OpenInterestData | null> {
  try {
    const rows = await publicGet<OpenInterestRow[]>(
      "/api/v5/public/open-interest",
      { instType: "SWAP", instId },
    );
    const r = rows[0];
    if (!r) return null;
    return {
      instId: r.instId,
      oi: num(r.oi),
      oiCcy: num(r.oiCcy),
      ts: new Date(parseInt(r.ts, 10)).toISOString(),
    };
  } catch (err) {
    logger.warn({ err, instId }, "open-interest fetch failed");
    return null;
  }
}

type LongShortRow = [string, string]; // [ts, ratio]
export type LongShortRatioData = { ratio: number; ts: string };

export async function fetchLongShortRatio(ccy: string): Promise<LongShortRatioData | null> {
  try {
    const rows = await publicGet<LongShortRow[]>(
      "/api/v5/rubik/stat/contracts/long-short-account-ratio",
      { ccy, period: "1H" },
    );
    const r = rows[0];
    if (!r) return null;
    return { ts: new Date(parseInt(r[0], 10)).toISOString(), ratio: num(r[1]) };
  } catch (err) {
    logger.warn({ err, ccy }, "long-short-ratio fetch failed");
    return null;
  }
}

type TakerVolumeRow = [string, string, string]; // [ts, sellVol, buyVol]
export type TakerVolumeData = { ts: string; buyVol: number; sellVol: number; buyRatio: number };

export async function fetchTakerVolume(ccy: string): Promise<TakerVolumeData | null> {
  try {
    const rows = await publicGet<TakerVolumeRow[]>(
      "/api/v5/rubik/stat/taker-volume",
      { ccy, instType: "CONTRACTS", period: "1H" },
    );
    const r = rows[0];
    if (!r) return null;
    const sell = num(r[1]);
    const buy = num(r[2]);
    const total = buy + sell;
    return {
      ts: new Date(parseInt(r[0], 10)).toISOString(),
      buyVol: buy,
      sellVol: sell,
      buyRatio: total > 0 ? buy / total : 0.5,
    };
  } catch (err) {
    logger.warn({ err, ccy }, "taker-volume fetch failed");
    return null;
  }
}

export type MarketContextBundle = {
  fundingRate: FundingRateData | null;
  openInterest: OpenInterestData | null;
  longShortRatio: LongShortRatioData | null;
  takerVolume: TakerVolumeData | null;
};

export async function fetchMarketContextBundle(instId: string): Promise<MarketContextBundle> {
  const ccy = instId.split("-")[0] ?? "BTC";
  const [fundingRate, openInterest, longShortRatio, takerVolume] = await Promise.all([
    fetchFundingRate(instId),
    fetchOpenInterest(instId),
    fetchLongShortRatio(ccy),
    fetchTakerVolume(ccy),
  ]);
  return { fundingRate, openInterest, longShortRatio, takerVolume };
}

export function summarizeMarketContext(bundle: MarketContextBundle): string {
  const lines: string[] = [];
  if (bundle.fundingRate) {
    const ann = bundle.fundingRate.fundingRate * 3 * 365 * 100;
    lines.push(
      `資金費率: ${(bundle.fundingRate.fundingRate * 100).toFixed(4)}% / 8h (年化約 ${ann.toFixed(1)}%)` +
        (bundle.fundingRate.nextFundingRate != null
          ? `,下期預測 ${(bundle.fundingRate.nextFundingRate * 100).toFixed(4)}%`
          : ""),
    );
  }
  if (bundle.openInterest) {
    lines.push(`未平倉 OI: ${bundle.openInterest.oiCcy.toFixed(0)} 幣 / ${bundle.openInterest.oi.toFixed(0)} 張`);
  }
  if (bundle.longShortRatio) {
    const r = bundle.longShortRatio.ratio;
    const tag = r > 1.5 ? " [散戶極度看多→反向警示]" : r < 0.7 ? " [散戶極度看空→反向警示]" : "";
    lines.push(`散戶多空比: ${r.toFixed(2)}${tag}`);
  }
  if (bundle.takerVolume) {
    const pct = bundle.takerVolume.buyRatio * 100;
    const tag = pct > 60 ? " [主動買壓強]" : pct < 40 ? " [主動賣壓強]" : "";
    lines.push(`主動買賣比: 買 ${pct.toFixed(1)}%${tag}`);
  }
  return lines.length > 0 ? lines.join("\n") : "(無情緒資料)";
}
