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

router.get("/monitor/holdings", async (req, res) => {
  const rows = await db
    .select()
    .from(holdingsTable)
    .orderBy(desc(holdingsTable.createdAt));

  const cryptoSymbols = [
    ...new Set(rows.filter((r) => r.market === "crypto").map((r) => r.symbol)),
  ];
  const priceMap = cryptoSymbols.length
    ? await fetchCryptoPrices(cryptoSymbols)
    : {};

  const enriched = rows.map((r) => {
    let currentPrice: number | null = null;
    let priceSource: "live" | "manual" | "none" = "none";
    if (r.market === "crypto") {
      if (priceMap[r.symbol] != null) {
        currentPrice = priceMap[r.symbol];
        priceSource = "live";
      }
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
