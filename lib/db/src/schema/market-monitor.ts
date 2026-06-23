import { pgTable, serial, text, numeric, timestamp, jsonb } from "drizzle-orm/pg-core";

export const watchlistTable = pgTable("watchlist", {
  id: serial("id").primaryKey(),
  symbol: text("symbol").notNull(),
  market: text("market").notNull(),
  displayName: text("display_name").notNull(),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const monitorSignalsTable = pgTable("monitor_signals", {
  id: serial("id").primaryKey(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  symbol: text("symbol"),
  action: text("action"),
  price: numeric("price"),
  message: text("message"),
  source: text("source").notNull().default("tradingview"),
  raw: jsonb("raw"),
});

export const monitorSettingsTable = pgTable("monitor_settings", {
  id: serial("id").primaryKey(),
  webhookPassphrase: text("webhook_passphrase").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const holdingsTable = pgTable("holdings", {
  id: serial("id").primaryKey(),
  symbol: text("symbol").notNull(),
  market: text("market").notNull(),
  displayName: text("display_name").notNull(),
  exchange: text("exchange"),
  quantity: numeric("quantity").notNull(),
  costPerUnit: numeric("cost_per_unit").notNull(),
  fee: numeric("fee"),
  manualPrice: numeric("manual_price"),
  buyDate: timestamp("buy_date", { withTimezone: true }),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Watchlist = typeof watchlistTable.$inferSelect;
export type MonitorSignal = typeof monitorSignalsTable.$inferSelect;
export type MonitorSettings = typeof monitorSettingsTable.$inferSelect;
export type Holding = typeof holdingsTable.$inferSelect;
