import { Router, type IRouter } from "express";
import { randomBytes } from "node:crypto";
import { eq, desc } from "drizzle-orm";
import {
  db,
  watchlistTable,
  monitorSignalsTable,
  monitorSettingsTable,
  holdingsTable,
} from "@workspace/db";
import {
  AddWatchlistItemBody,
  ReceiveTradingViewWebhookBody,
  AddHoldingBody,
  UpdateHoldingBody,
} from "@workspace/api-zod";

const router: IRouter = Router();

async function getOrCreateSettings() {
  // Singleton row pinned to id=1. onConflictDoNothing makes concurrent
  // first-time requests safe: one insert wins, the rest no-op, and every
  // caller then reads the same row (no passphrase drift).
  await db
    .insert(monitorSettingsTable)
    .values({ id: 1, webhookPassphrase: randomBytes(18).toString("base64url") })
    .onConflictDoNothing();
  const [settings] = await db
    .select()
    .from(monitorSettingsTable)
    .where(eq(monitorSettingsTable.id, 1));
  return settings;
}

router.get("/monitor/watchlist", async (req, res) => {
  const items = await db
    .select()
    .from(watchlistTable)
    .orderBy(desc(watchlistTable.createdAt));
  return res.json(items);
});

router.post("/monitor/watchlist", async (req, res) => {
  const parsed = AddWatchlistItemBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid watchlist input" });
  }
  const { symbol, market, displayName, note } = parsed.data;
  const [created] = await db
    .insert(watchlistTable)
    .values({ symbol, market, displayName, note: note ?? null })
    .returning();
  req.log.info({ symbol, market }, "added watchlist item");
  return res.json(created);
});

router.delete("/monitor/watchlist/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: "invalid id" });
  }
  await db.delete(watchlistTable).where(eq(watchlistTable.id, id));
  return res.json({ ok: true });
});

router.get("/monitor/signals", async (req, res) => {
  const items = await db
    .select()
    .from(monitorSignalsTable)
    .orderBy(desc(monitorSignalsTable.receivedAt))
    .limit(100);
  return res.json(items);
});

router.get("/monitor/settings", async (req, res) => {
  const settings = await getOrCreateSettings();
  return res.json({ webhookPassphrase: settings.webhookPassphrase });
});

router.post("/monitor/webhook/tradingview", async (req, res) => {
  const parsed = ReceiveTradingViewWebhookBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ ok: false });
  }
  const settings = await getOrCreateSettings();
  if (parsed.data.passphrase !== settings.webhookPassphrase) {
    req.log.warn("rejected webhook: bad passphrase");
    return res.status(401).json({ ok: false });
  }
  const { ticker, symbol, action, price, message } = parsed.data;
  await db.insert(monitorSignalsTable).values({
    symbol: symbol ?? ticker ?? null,
    action: action ?? null,
    price: price != null ? String(price) : null,
    message: message ?? null,
    source: "tradingview",
    raw: req.body,
  });
  req.log.info({ symbol: symbol ?? ticker, action }, "received tradingview signal");
  return res.json({ ok: true });
});

async function fetchCryptoPrices(
  symbols: string[],
): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  await Promise.all(
    symbols.map(async (sym) => {
      const pair = sym.includes(":") ? sym.split(":")[1] : sym;
      try {
        const r = await fetch(
          `https://api.binance.com/api/v3/ticker/price?symbol=${encodeURIComponent(pair)}`,
          { signal: AbortSignal.timeout(4000) },
        );
        if (!r.ok) return;
        const j = (await r.json()) as { price?: string };
        if (j.price) out[sym] = Number(j.price);
      } catch {
        /* live price unavailable — degrade to no price */
      }
    }),
  );
  return out;
}

// --- Taiwan stock data (official TWSE public endpoints) ---

const TW_UA = "Mozilla/5.0 (compatible; market-monitor/1.0)";

function num(s: unknown): number | null {
  if (typeof s !== "string") return typeof s === "number" ? s : null;
  const cleaned = s.replace(/,/g, "").trim();
  if (cleaned === "" || cleaned === "-" || cleaned === "--") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function normalizeTwCode(raw: string): string {
  const c = raw.replace(/^TWSE:/i, "").trim();
  if (/^taiex$/i.test(c)) return "t00";
  return c.toLowerCase();
}

type TwQuote = {
  code: string;
  name: string;
  price: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  prevClose: number | null;
  change: number | null;
  changePct: number | null;
  volume: number | null;
  time: string | null;
  source: "live" | "none";
};

// MIS realtime: query both tse_ and otc_ channels so listed and OTC codes
// both resolve without us knowing the market up front. The index (t00) is
// TWSE-only.
async function fetchTwQuotes(codes: string[]): Promise<TwQuote[]> {
  const norm = [...new Set(codes.map(normalizeTwCode))].filter(Boolean);
  if (norm.length === 0) return [];

  const channels = norm.flatMap((c) =>
    c === "t00" ? [`tse_${c}.tw`] : [`tse_${c}.tw`, `otc_${c}.tw`],
  );
  const url = `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=${encodeURIComponent(
    channels.join("|"),
  )}&json=1&delay=0&_=${Date.now()}`;

  let msgArray: Record<string, string>[] = [];
  try {
    const r = await fetch(url, {
      headers: { "User-Agent": TW_UA },
      signal: AbortSignal.timeout(5000),
    });
    if (r.ok) {
      const j = (await r.json()) as { msgArray?: Record<string, string>[] };
      msgArray = Array.isArray(j.msgArray) ? j.msgArray : [];
    }
  } catch {
    /* upstream unavailable — degrade to "none" quotes below */
  }

  const byCode = new Map<string, Record<string, string>>();
  for (const m of msgArray) {
    const c = (m.c ?? "").toLowerCase();
    if (c && !byCode.has(c)) byCode.set(c, m);
  }

  return norm.map((code) => {
    const m = byCode.get(code);
    if (!m) {
      return {
        code,
        name: code,
        price: null,
        open: null,
        high: null,
        low: null,
        prevClose: null,
        change: null,
        changePct: null,
        volume: null,
        time: null,
        source: "none",
      };
    }
    const last = num(m.z); // last traded price; "-" before the first trade
    const prevClose = num(m.y);
    // Fall back to prevClose for valuation when no trade has printed yet, but
    // keep change null so we never show a misleading flat move.
    const price = last ?? prevClose;
    const change = last != null && prevClose != null ? last - prevClose : null;
    const changePct =
      change != null && prevClose ? (change / prevClose) * 100 : null;
    return {
      code,
      name: m.n ?? code,
      price,
      open: num(m.o),
      high: num(m.h),
      low: num(m.l),
      prevClose,
      change,
      changePct,
      volume: num(m.v),
      time: m.t ?? m["%"] ?? null,
      source: price != null ? "live" : "none",
    };
  });
}

type TwCandle = {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
};

// STOCK_DAY returns one calendar month of daily OHLC per call. Fetch the last
// few months and merge so the chart has useful history.
async function fetchTwCandles(code: string): Promise<TwCandle[]> {
  const norm = normalizeTwCode(code);
  if (!norm || norm === "t00") return []; // index has no per-stock daily report

  const now = new Date();
  const months: string[] = [];
  for (let i = 0; i < 4; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const ym = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}01`;
    months.push(ym);
  }

  const perMonth = await Promise.all(
    months.map(async (date) => {
      try {
        const r = await fetch(
          `https://www.twse.com.tw/exchangeReport/STOCK_DAY?response=json&date=${date}&stockNo=${encodeURIComponent(
            norm,
          )}`,
          { headers: { "User-Agent": TW_UA }, signal: AbortSignal.timeout(5000) },
        );
        if (!r.ok) return [];
        const j = (await r.json()) as {
          stat?: string;
          data?: string[][];
        };
        if (j.stat !== "OK" || !Array.isArray(j.data)) return [];
        return j.data;
      } catch {
        return [];
      }
    }),
  );

  const seen = new Set<string>();
  const candles: TwCandle[] = [];
  for (const rows of perMonth) {
    for (const row of rows) {
      // [日期, 成交股數, 成交金額, 開盤價, 最高價, 最低價, 收盤價, ...]
      const rocDate = row[0]; // e.g. "115/06/01"
      const parts = rocDate?.split("/");
      if (!parts || parts.length !== 3) continue;
      const year = 1911 + Number(parts[0]);
      const iso = `${year}-${parts[1]}-${parts[2]}`;
      if (seen.has(iso)) continue;
      const open = num(row[3]);
      const high = num(row[4]);
      const low = num(row[5]);
      const close = num(row[6]);
      if (open == null || high == null || low == null || close == null)
        continue;
      seen.add(iso);
      candles.push({ time: iso, open, high, low, close, volume: num(row[1]) });
    }
  }
  candles.sort((a, b) => a.time.localeCompare(b.time));
  return candles;
}

router.get("/monitor/tw/quotes", async (req, res) => {
  const codes = String(req.query.codes ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (codes.length === 0) {
    return res.status(400).json({ error: "codes query param required" });
  }
  try {
    const quotes = await fetchTwQuotes(codes);
    return res.json(quotes);
  } catch (err) {
    req.log.error({ err }, "tw quotes failed");
    return res.status(502).json({ error: "tw quotes upstream failed" });
  }
});

router.get("/monitor/tw/candles", async (req, res) => {
  const code = String(req.query.code ?? "").trim();
  if (!code) {
    return res.status(400).json({ error: "code query param required" });
  }
  try {
    const candles = await fetchTwCandles(code);
    return res.json(candles);
  } catch (err) {
    req.log.error({ err }, "tw candles failed");
    return res.status(502).json({ error: "tw candles upstream failed" });
  }
});

router.get("/monitor/holdings", async (req, res) => {
  const rows = await db
    .select()
    .from(holdingsTable)
    .orderBy(desc(holdingsTable.createdAt));

  const cryptoSymbols = [
    ...new Set(rows.filter((r) => r.market === "crypto").map((r) => r.symbol)),
  ];
  const twSymbols = [
    ...new Set(rows.filter((r) => r.market === "tw").map((r) => r.symbol)),
  ];
  const [priceMap, twQuotes] = await Promise.all([
    cryptoSymbols.length
      ? fetchCryptoPrices(cryptoSymbols)
      : Promise.resolve<Record<string, number>>({}),
    twSymbols.length
      ? fetchTwQuotes(twSymbols)
      : Promise.resolve<TwQuote[]>([]),
  ]);
  const twPriceMap = new Map<string, number>();
  for (const sym of twSymbols) {
    const code = normalizeTwCode(sym);
    const q = twQuotes.find((x) => x.code === code);
    if (q?.price != null) twPriceMap.set(sym, q.price);
  }

  const enriched = rows.map((r) => {
    let currentPrice: number | null = null;
    let priceSource: "live" | "manual" | "none" = "none";
    if (r.market === "crypto") {
      if (priceMap[r.symbol] != null) {
        currentPrice = priceMap[r.symbol];
        priceSource = "live";
      }
    } else if (r.market === "tw" && twPriceMap.has(r.symbol)) {
      currentPrice = twPriceMap.get(r.symbol)!;
      priceSource = "live";
    } else if (r.manualPrice != null) {
      currentPrice = Number(r.manualPrice);
      priceSource = "manual";
    }
    return { ...r, currentPrice, priceSource };
  });

  return res.json(enriched);
});

router.post("/monitor/holdings", async (req, res) => {
  const parsed = AddHoldingBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid holding input" });
  }
  const d = parsed.data;
  const [created] = await db
    .insert(holdingsTable)
    .values({
      symbol: d.symbol,
      market: d.market,
      displayName: d.displayName,
      exchange: d.exchange ?? null,
      quantity: String(d.quantity),
      costPerUnit: String(d.costPerUnit),
      fee: d.fee != null ? String(d.fee) : null,
      manualPrice: d.manualPrice != null ? String(d.manualPrice) : null,
      buyDate: d.buyDate ? new Date(d.buyDate) : null,
      note: d.note ?? null,
    })
    .returning();
  req.log.info({ symbol: d.symbol, market: d.market }, "added holding");
  return res.json(created);
});

router.patch("/monitor/holdings/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: "invalid id" });
  }
  const parsed = UpdateHoldingBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid holding update" });
  }
  const d = parsed.data;
  const patch: Partial<typeof holdingsTable.$inferInsert> = {};
  if (d.exchange !== undefined) patch.exchange = d.exchange;
  if (d.displayName !== undefined) patch.displayName = d.displayName;
  if (d.quantity !== undefined) patch.quantity = String(d.quantity);
  if (d.costPerUnit !== undefined) patch.costPerUnit = String(d.costPerUnit);
  if (d.fee !== undefined) patch.fee = d.fee != null ? String(d.fee) : null;
  if (d.manualPrice !== undefined)
    patch.manualPrice = d.manualPrice != null ? String(d.manualPrice) : null;
  if (d.buyDate !== undefined)
    patch.buyDate = d.buyDate ? new Date(d.buyDate) : null;
  if (d.note !== undefined) patch.note = d.note;

  if (Object.keys(patch).length === 0) {
    const [row] = await db
      .select()
      .from(holdingsTable)
      .where(eq(holdingsTable.id, id));
    if (!row) return res.status(404).json({ error: "not found" });
    return res.json(row);
  }

  const [updated] = await db
    .update(holdingsTable)
    .set(patch)
    .where(eq(holdingsTable.id, id))
    .returning();
  if (!updated) return res.status(404).json({ error: "not found" });
  return res.json(updated);
});

router.delete("/monitor/holdings/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: "invalid id" });
  }
  await db.delete(holdingsTable).where(eq(holdingsTable.id, id));
  return res.json({ ok: true });
});

export default router;
