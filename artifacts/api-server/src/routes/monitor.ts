import { Router, type IRouter } from "express";
import { randomBytes } from "node:crypto";
import { eq, desc } from "drizzle-orm";
import {
  db,
  watchlistTable,
  monitorSignalsTable,
  monitorSettingsTable,
} from "@workspace/db";
import {
  AddWatchlistItemBody,
  ReceiveTradingViewWebhookBody,
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

export default router;
