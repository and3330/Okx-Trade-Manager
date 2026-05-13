import {
  pgTable,
  serial,
  text,
  jsonb,
  timestamp,
  boolean,
  integer,
  numeric,
} from "drizzle-orm/pg-core";

export const autoTradeConfigTable = pgTable("auto_trade_config", {
  id: integer("id").primaryKey(),
  enabled: boolean("enabled").notNull().default(false),
  whitelist: jsonb("whitelist").$type<string[]>().notNull().default([
    "BTC-USDT-SWAP",
    "ETH-USDT-SWAP",
    "SOL-USDT-SWAP",
    "HYPE-USDT-SWAP",
  ]),
  maxMarginPctPerTrade: numeric("max_margin_pct_per_trade").notNull().default("5"),
  maxDailyLossPct: numeric("max_daily_loss_pct").notNull().default("10"),
  maxConcurrentPositions: integer("max_concurrent_positions").notNull().default(3),
  maxLeverage: integer("max_leverage").notNull().default(10),
  minConsensusCount: integer("min_consensus_count").notNull().default(3),
  minAvgConfidence: integer("min_avg_confidence").notNull().default(7),
  cooldownMinutes: integer("cooldown_minutes").notNull().default(30),
  killUntil: timestamp("kill_until", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const aiDecisionsTable = pgTable("ai_decisions", {
  id: serial("id").primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  instId: text("inst_id").notNull(),
  mode: text("mode").notNull(),
  lastPrice: numeric("last_price").notNull(),
  technicalSummary: text("technical_summary"),
  sentimentSummary: text("sentiment_summary"),
  recommendations: jsonb("recommendations").notNull(),
  consensusAction: text("consensus_action"),
  consensusConfidence: integer("consensus_confidence"),
  triggeredBy: text("triggered_by").notNull(),
});

export const autoTradeExecutionsTable = pgTable("auto_trade_executions", {
  id: serial("id").primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  decisionId: integer("decision_id"),
  instId: text("inst_id").notNull(),
  side: text("side").notNull(),
  marginUsdt: numeric("margin_usdt"),
  leverage: integer("leverage"),
  contracts: numeric("contracts"),
  entryPrice: numeric("entry_price"),
  ordId: text("ord_id"),
  status: text("status").notNull(),
  reason: text("reason"),
  realizedPnlUsdt: numeric("realized_pnl_usdt"),
  closePrice: numeric("close_price"),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  chosenProviderId: text("chosen_provider_id"),
});

export type AutoTradeConfig = typeof autoTradeConfigTable.$inferSelect;
export type AiDecision = typeof aiDecisionsTable.$inferSelect;
export type AutoTradeExecution = typeof autoTradeExecutionsTable.$inferSelect;
