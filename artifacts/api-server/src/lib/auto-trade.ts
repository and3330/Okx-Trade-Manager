import { db, autoTradeConfigTable, aiDecisionsTable, autoTradeExecutionsTable } from "@workspace/db";
import { eq, gte, desc, sql } from "drizzle-orm";
import { logger } from "./logger";
import {
  runResearchPipeline,
  computeConsensus,
  type AiRecommendation,
  PROVIDERS,
} from "./ai-pipeline";
import {
  fetchAccountBalance,
  fetchPerpPositions,
  placePerpMarketOrder,
  closePerpPosition,
  fetchTicker,
  fetchAtr,
  type AccountBalanceData,
  type PerpPositionData,
} from "./okx";

const SINGLETON_ID = 1;

export type AutoTradeConfig = {
  enabled: boolean;
  whitelist: string[];
  maxMarginPctPerTrade: number;
  maxDailyLossPct: number;
  maxConcurrentPositions: number;
  maxLeverage: number;
  minConsensusCount: number;
  minAvgConfidence: number;
  cooldownMinutes: number;
  killUntil: string | null;
  updatedAt: string;
};

const DEFAULT_CONFIG: Omit<AutoTradeConfig, "updatedAt" | "killUntil"> = {
  enabled: false,
  whitelist: [
    "BTC-USDT-SWAP",
    "ETH-USDT-SWAP",
    "SOL-USDT-SWAP",
    "HYPE-USDT-SWAP",
    "BNB-USDT-SWAP",
    "XRP-USDT-SWAP",
    "DOGE-USDT-SWAP",
    "AVAX-USDT-SWAP",
    "SUI-USDT-SWAP",
    "LINK-USDT-SWAP",
  ],
  maxMarginPctPerTrade: 5,
  maxDailyLossPct: 10,
  maxConcurrentPositions: 3,
  maxLeverage: 10,
  minConsensusCount: 3,
  minAvgConfidence: 7,
  cooldownMinutes: 30,
};

function rowToConfig(row: typeof autoTradeConfigTable.$inferSelect): AutoTradeConfig {
  return {
    enabled: row.enabled,
    whitelist: row.whitelist ?? DEFAULT_CONFIG.whitelist,
    maxMarginPctPerTrade: parseFloat(row.maxMarginPctPerTrade as unknown as string),
    maxDailyLossPct: parseFloat(row.maxDailyLossPct as unknown as string),
    maxConcurrentPositions: row.maxConcurrentPositions,
    maxLeverage: row.maxLeverage,
    minConsensusCount: row.minConsensusCount,
    minAvgConfidence: row.minAvgConfidence,
    cooldownMinutes: row.cooldownMinutes,
    killUntil: row.killUntil ? row.killUntil.toISOString() : null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function getOrCreateConfig(): Promise<AutoTradeConfig> {
  const existing = await db.select().from(autoTradeConfigTable).where(eq(autoTradeConfigTable.id, SINGLETON_ID)).limit(1);
  if (existing.length > 0) return rowToConfig(existing[0]!);
  // Race-safe insert — concurrent callers will both find a row on re-select.
  await db.insert(autoTradeConfigTable).values({
    id: SINGLETON_ID,
    enabled: DEFAULT_CONFIG.enabled,
    whitelist: DEFAULT_CONFIG.whitelist,
    maxMarginPctPerTrade: String(DEFAULT_CONFIG.maxMarginPctPerTrade),
    maxDailyLossPct: String(DEFAULT_CONFIG.maxDailyLossPct),
    maxConcurrentPositions: DEFAULT_CONFIG.maxConcurrentPositions,
    maxLeverage: DEFAULT_CONFIG.maxLeverage,
    minConsensusCount: DEFAULT_CONFIG.minConsensusCount,
    minAvgConfidence: DEFAULT_CONFIG.minAvgConfidence,
    cooldownMinutes: DEFAULT_CONFIG.cooldownMinutes,
  }).onConflictDoNothing();
  const after = await db.select().from(autoTradeConfigTable).where(eq(autoTradeConfigTable.id, SINGLETON_ID)).limit(1);
  return rowToConfig(after[0]!);
}

export type ConfigPatch = {
  enabled?: boolean | null;
  whitelist?: string[] | null;
  maxMarginPctPerTrade?: number | null;
  maxDailyLossPct?: number | null;
  maxConcurrentPositions?: number | null;
  maxLeverage?: number | null;
  minConsensusCount?: number | null;
  minAvgConfidence?: number | null;
  cooldownMinutes?: number | null;
};

export async function updateConfig(patch: ConfigPatch): Promise<AutoTradeConfig> {
  await getOrCreateConfig();
  const update: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.enabled != null) update["enabled"] = patch.enabled;
  if (patch.whitelist != null) update["whitelist"] = patch.whitelist;
  if (patch.maxMarginPctPerTrade != null) update["maxMarginPctPerTrade"] = String(patch.maxMarginPctPerTrade);
  if (patch.maxDailyLossPct != null) update["maxDailyLossPct"] = String(patch.maxDailyLossPct);
  if (patch.maxConcurrentPositions != null) update["maxConcurrentPositions"] = patch.maxConcurrentPositions;
  if (patch.maxLeverage != null) update["maxLeverage"] = Math.min(patch.maxLeverage, 50);
  if (patch.minConsensusCount != null) update["minConsensusCount"] = Math.max(2, Math.min(4, patch.minConsensusCount));
  if (patch.minAvgConfidence != null) update["minAvgConfidence"] = Math.max(1, Math.min(10, patch.minAvgConfidence));
  if (patch.cooldownMinutes != null) update["cooldownMinutes"] = Math.max(5, patch.cooldownMinutes);
  // If user re-enables, clear any stale killUntil
  if (patch.enabled === true) update["killUntil"] = null;
  const [row] = await db.update(autoTradeConfigTable).set(update).where(eq(autoTradeConfigTable.id, SINGLETON_ID)).returning();
  return rowToConfig(row!);
}

export async function killEngine(): Promise<AutoTradeConfig> {
  await getOrCreateConfig();
  const until = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const [row] = await db.update(autoTradeConfigTable).set({
    enabled: false, killUntil: until, updatedAt: new Date(),
  }).where(eq(autoTradeConfigTable.id, SINGLETON_ID)).returning();
  return rowToConfig(row!);
}

// ---------- Decision recording ----------

export async function recordDecision(args: {
  instId: string; mode: string; lastPrice: number;
  technicalSummary: string | null; sentimentSummary: string | null;
  recommendations: AiRecommendation[];
  consensusAction: string | null; consensusConfidence: number | null;
  triggeredBy: "user" | "auto";
}): Promise<number> {
  const [row] = await db.insert(aiDecisionsTable).values({
    instId: args.instId,
    mode: args.mode,
    lastPrice: String(args.lastPrice),
    technicalSummary: args.technicalSummary,
    sentimentSummary: args.sentimentSummary,
    recommendations: args.recommendations,
    consensusAction: args.consensusAction,
    consensusConfidence: args.consensusConfidence,
    triggeredBy: args.triggeredBy,
  }).returning({ id: aiDecisionsTable.id });
  return row!.id;
}

// ---------- Cycle ----------

type GuardrailResult =
  | { ok: true; reason?: undefined }
  | { ok: false; reason: string };

async function checkGlobalGuardrails(
  cfg: AutoTradeConfig,
  balance: AccountBalanceData | null,
  positions: PerpPositionData[],
): Promise<GuardrailResult> {
  if (!cfg.enabled) return { ok: false, reason: "engine_disabled" };
  if (cfg.killUntil && new Date(cfg.killUntil) > new Date()) return { ok: false, reason: "killed" };
  if (!balance || balance.totalEquityUsd <= 0) return { ok: false, reason: "no_balance" };
  // Daily loss check — combine 24h realized PnL with current open-position UNREALIZED PnL.
  // Without unrealized inclusion, a 50% drawdown on an open trade is invisible to the kill-switch.
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const recent = await db.select({
    pnl: autoTradeExecutionsTable.realizedPnlUsdt,
  }).from(autoTradeExecutionsTable).where(gte(autoTradeExecutionsTable.createdAt, since));
  const realized = recent.reduce((s, r) => s + (r.pnl ? parseFloat(r.pnl as unknown as string) : 0), 0);
  const unrealized = positions.reduce((s, p) => s + (Number.isFinite(p.unrealizedPnlUsd) ? p.unrealizedPnlUsd : 0), 0);
  const totalPnl = realized + unrealized;
  const lossLimit = -1 * (balance.totalEquityUsd * cfg.maxDailyLossPct) / 100;
  if (totalPnl < lossLimit) {
    await killEngine();
    return { ok: false, reason: `daily_loss_breached realized=${realized.toFixed(2)} unrealized=${unrealized.toFixed(2)} limit=${lossLimit.toFixed(2)}` };
  }
  return { ok: true };
}

async function inCooldown(instId: string, cooldownMin: number): Promise<boolean> {
  const since = new Date(Date.now() - cooldownMin * 60 * 1000);
  const recent = await db.select({ id: autoTradeExecutionsTable.id })
    .from(autoTradeExecutionsTable)
    .where(sql`${autoTradeExecutionsTable.instId} = ${instId} AND ${autoTradeExecutionsTable.createdAt} >= ${since.toISOString()}`)
    .limit(1);
  return recent.length > 0;
}

export type RunCycleEntry = {
  instId: string;
  action: string;
  reason: string | null;
  executionId: number | null;
};

export type RunCycleResult = {
  ranAt: string;
  perInstrument: RunCycleEntry[];
};

let cycleInProgress = false;
let lastCycleAt: Date | null = null;

export function getLastCycleAt(): Date | null { return lastCycleAt; }

export async function runCycle(opts: { force?: boolean } = {}): Promise<RunCycleResult> {
  if (cycleInProgress) return { ranAt: new Date().toISOString(), perInstrument: [{ instId: "*", action: "skipped", reason: "cycle_already_running", executionId: null }] };
  cycleInProgress = true;
  const ranAt = new Date();
  lastCycleAt = ranAt;
  const out: RunCycleEntry[] = [];
  try {
    const cfg = await getOrCreateConfig();
    const balance = await fetchAccountBalance().catch(() => null);
    const positions = await fetchPerpPositions().catch(() => [] as PerpPositionData[]);
    if (!opts.force) {
      const g = await checkGlobalGuardrails(cfg, balance, positions);
      if (!g.ok) {
        out.push({ instId: "*", action: "skipped", reason: g.reason, executionId: null });
        return { ranAt: ranAt.toISOString(), perInstrument: out };
      }
    }
    if (!balance) {
      out.push({ instId: "*", action: "skipped", reason: "no_balance", executionId: null });
      return { ranAt: ranAt.toISOString(), perInstrument: out };
    }
    const heldUsdt = balance.assets.find((a) => a.ccy === "USDT")?.available ?? 0;
    const openCount = positions.length;

    for (const instId of cfg.whitelist) {
      try {
        const entry = await processInstrument({
          cfg, instId, balance, heldUsdt, positions, openCount: openCount + out.filter((e) => e.action === "executed_open").length,
        });
        out.push(entry);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error({ err, instId }, "auto-trade per-instrument failed");
        out.push({ instId, action: "error", reason: msg, executionId: null });
      }
    }
    return { ranAt: ranAt.toISOString(), perInstrument: out };
  } finally {
    cycleInProgress = false;
  }
}

async function processInstrument(args: {
  cfg: AutoTradeConfig;
  instId: string;
  balance: AccountBalanceData;
  heldUsdt: number;
  positions: PerpPositionData[];
  openCount: number;
}): Promise<RunCycleEntry> {
  const { cfg, instId, balance, heldUsdt, positions, openCount } = args;

  // Cooldown
  if (await inCooldown(instId, cfg.cooldownMinutes)) {
    return { instId, action: "skipped", reason: "cooldown", executionId: null };
  }

  // Pipeline (use cfg-bounded margin/leverage so AI sees the cap)
  const maxMarginByPct = (balance.totalEquityUsd * cfg.maxMarginPctPerTrade) / 100;
  const maxMarginUsdt = Math.max(10, Math.min(maxMarginByPct, heldUsdt));
  const maxLeverage = cfg.maxLeverage;

  const pipeline = await runResearchPipeline({
    instId, mode: "perp", maxMarginUsdt, maxLeverage,
  });
  const consensus = computeConsensus(pipeline.recommendations);

  // Always record decision
  const decisionId = await recordDecision({
    instId,
    mode: "perp",
    lastPrice: pipeline.lastPrice,
    technicalSummary: pipeline.technicalSummary,
    sentimentSummary: pipeline.sentimentSummary,
    recommendations: pipeline.recommendations,
    consensusAction: consensus.action,
    consensusConfidence: Math.round(consensus.avgConfidence),
    triggeredBy: "auto",
  });

  // Quorum guard: require at least minConsensusCount providers to have responded successfully —
  // otherwise a degraded fleet (e.g. 3 of 4 responding, all agreeing) "fails open" into a weaker quorum.
  const successCount = pipeline.recommendations.filter((r) => r.ok && r.action).length;
  if (successCount < cfg.minConsensusCount) {
    return { instId, action: "skipped", reason: `insufficient_quorum ${successCount}/${cfg.minConsensusCount} models responded`, executionId: null };
  }
  // Apply consensus thresholds
  if (consensus.action === "hold" || consensus.action == null) {
    return { instId, action: "hold", reason: `no_consensus (counts=${consensus.count})`, executionId: null };
  }
  if (consensus.count < cfg.minConsensusCount) {
    return { instId, action: "skipped", reason: `consensus_too_low ${consensus.count}/${cfg.minConsensusCount}`, executionId: null };
  }
  if (consensus.avgConfidence < cfg.minAvgConfidence) {
    return { instId, action: "skipped", reason: `confidence_too_low ${consensus.avgConfidence.toFixed(1)}/${cfg.minAvgConfidence}`, executionId: null };
  }

  const existingPos = positions.find((p) => p.instId === instId);

  // Close action
  if (consensus.action === "close") {
    if (!existingPos) return { instId, action: "skipped", reason: "no_position_to_close", executionId: null };
    try {
      await closePerpPosition({ instId });
      const ticker = await fetchTicker(instId).catch(() => null);
      const closePx = ticker?.last ?? null;
      const realized = closePx != null ? existingPos.unrealizedPnlUsd : null;
      const [exec] = await db.insert(autoTradeExecutionsTable).values({
        decisionId, instId, side: "close",
        marginUsdt: null, leverage: null, contracts: String(Math.abs(existingPos.contracts)),
        entryPrice: String(existingPos.avgEntryPx),
        ordId: null, status: "submitted", reason: "consensus_close",
        realizedPnlUsdt: realized != null ? String(realized) : null,
        closePrice: closePx != null ? String(closePx) : null,
        closedAt: new Date(),
        chosenProviderId: consensus.chosenProviderId,
      }).returning({ id: autoTradeExecutionsTable.id });
      return { instId, action: "executed_close", reason: null, executionId: exec!.id };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const [exec] = await db.insert(autoTradeExecutionsTable).values({
        decisionId, instId, side: "close",
        status: "failed", reason: msg,
        chosenProviderId: consensus.chosenProviderId,
      }).returning({ id: autoTradeExecutionsTable.id });
      return { instId, action: "failed_close", reason: msg, executionId: exec!.id };
    }
  }

  // Open action — but cap concurrent positions
  if (!existingPos && openCount >= cfg.maxConcurrentPositions) {
    return { instId, action: "skipped", reason: `max_positions ${openCount}/${cfg.maxConcurrentPositions}`, executionId: null };
  }
  // If existing position is opposite side, skip (would need close first; we did not consensus-close, so abstain)
  if (existingPos) {
    const existingSide = existingPos.posSide === "short" || existingPos.contracts < 0 ? "short" : "long";
    if (existingSide !== consensus.action) {
      return { instId, action: "skipped", reason: `opposite_position_open (${existingSide})`, executionId: null };
    }
  }

  const side = consensus.action as "long" | "short";
  const margin = Math.max(10, Math.min(consensus.medianMarginUsdt ?? maxMarginUsdt, maxMarginUsdt));
  const leverage = Math.max(1, Math.min(consensus.medianLeverage ?? cfg.maxLeverage, cfg.maxLeverage));

  // Force SL via ATR if not provided
  let stopLossPrice = consensus.medianStopLossPrice;
  if (stopLossPrice == null) {
    const atr = await fetchAtr(instId, "1H");
    if (atr != null && atr > 0 && pipeline.lastPrice > 0) {
      stopLossPrice = side === "long" ? pipeline.lastPrice - atr * 1.5 : pipeline.lastPrice + atr * 1.5;
    }
  }
  // Sanity check SL: must exist, be positive, and on the correct side of entry with non-trivial distance (>=0.1%).
  if (stopLossPrice == null || stopLossPrice <= 0) {
    return { instId, action: "skipped", reason: "no_stop_loss_available", executionId: null };
  }
  const minDistance = pipeline.lastPrice * 0.001;
  if (side === "long" && stopLossPrice >= pipeline.lastPrice - minDistance) {
    return { instId, action: "skipped", reason: `invalid_sl_long sl=${stopLossPrice} px=${pipeline.lastPrice}`, executionId: null };
  }
  if (side === "short" && stopLossPrice <= pipeline.lastPrice + minDistance) {
    return { instId, action: "skipped", reason: `invalid_sl_short sl=${stopLossPrice} px=${pipeline.lastPrice}`, executionId: null };
  }

  const takeProfitPrice = consensus.medianTakeProfitPrice;

  try {
    const result = await placePerpMarketOrder({
      instId, side, marginUsdt: margin, leverage,
      stopLossPrice, takeProfitPrice,
    });
    const [exec] = await db.insert(autoTradeExecutionsTable).values({
      decisionId, instId, side,
      marginUsdt: String(margin), leverage,
      contracts: String(result.contracts),
      entryPrice: String(result.markPx),
      ordId: result.ordId,
      status: "submitted", reason: "consensus_open",
      chosenProviderId: consensus.chosenProviderId,
    }).returning({ id: autoTradeExecutionsTable.id });
    return { instId, action: "executed_open", reason: null, executionId: exec!.id };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const [exec] = await db.insert(autoTradeExecutionsTable).values({
      decisionId, instId, side,
      marginUsdt: String(margin), leverage,
      status: "failed", reason: msg,
      chosenProviderId: consensus.chosenProviderId,
    }).returning({ id: autoTradeExecutionsTable.id });
    return { instId, action: "failed_open", reason: msg, executionId: exec!.id };
  }
}

// ---------- Scheduler ----------

let timer: NodeJS.Timeout | null = null;
let lastTriggeredHour = -1;

export function startScheduler(): void {
  if (timer) return;
  timer = setInterval(() => {
    void (async () => {
      try {
        const now = new Date();
        // Trigger once per hour at the first minute
        if (now.getMinutes() === 1 && now.getHours() !== lastTriggeredHour) {
          lastTriggeredHour = now.getHours();
          const cfg = await getOrCreateConfig().catch(() => null);
          if (!cfg || !cfg.enabled) return;
          if (cfg.killUntil && new Date(cfg.killUntil) > now) return;
          logger.info({ minute: now.getMinutes() }, "auto-trade cycle starting");
          const result = await runCycle();
          logger.info({ entries: result.perInstrument.length }, "auto-trade cycle done");
        }
      } catch (err) {
        logger.error({ err }, "scheduler tick failed");
      }
    })();
  }, 60 * 1000);
  logger.info("auto-trade scheduler started");
}

// ---------- Status & Listing ----------

export async function getStatus(): Promise<{
  enabled: boolean; killed: boolean; killUntil: string | null;
  lastCycleAt: string | null; nextCycleAt: string | null;
  recentExecutionCount: number; openPositionCount: number;
  dailyRealizedPnlUsdt: number; currentEquityUsdt: number;
  message: string | null;
}> {
  const cfg = await getOrCreateConfig();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const recent = await db.select({ pnl: autoTradeExecutionsTable.realizedPnlUsdt })
    .from(autoTradeExecutionsTable)
    .where(gte(autoTradeExecutionsTable.createdAt, since));
  const realized = recent.reduce((s, r) => s + (r.pnl ? parseFloat(r.pnl as unknown as string) : 0), 0);
  const balance = await fetchAccountBalance().catch(() => null);
  const positions = await fetchPerpPositions().catch(() => [] as PerpPositionData[]);
  const killed = !!(cfg.killUntil && new Date(cfg.killUntil) > new Date());
  const now = new Date();
  const nextCycle = new Date(now);
  nextCycle.setHours(now.getMinutes() >= 1 ? now.getHours() + 1 : now.getHours());
  nextCycle.setMinutes(1, 0, 0);
  return {
    enabled: cfg.enabled,
    killed,
    killUntil: cfg.killUntil,
    lastCycleAt: lastCycleAt?.toISOString() ?? null,
    nextCycleAt: cfg.enabled && !killed ? nextCycle.toISOString() : null,
    recentExecutionCount: recent.length,
    openPositionCount: positions.length,
    dailyRealizedPnlUsdt: realized,
    currentEquityUsdt: balance?.totalEquityUsd ?? 0,
    message: killed ? "Engine killed (24h cooldown after daily-loss breach or manual kill)" : null,
  };
}

export async function listDecisions(limit: number): Promise<unknown[]> {
  const rows = await db.select().from(aiDecisionsTable).orderBy(desc(aiDecisionsTable.createdAt)).limit(limit);
  return rows.map((r) => ({
    id: r.id,
    createdAt: r.createdAt.toISOString(),
    instId: r.instId,
    mode: r.mode,
    lastPrice: parseFloat(r.lastPrice as unknown as string),
    technicalSummary: r.technicalSummary,
    sentimentSummary: r.sentimentSummary,
    consensusAction: r.consensusAction,
    consensusConfidence: r.consensusConfidence,
    triggeredBy: r.triggeredBy,
    recommendations: r.recommendations,
  }));
}

export async function listExecutions(limit: number): Promise<unknown[]> {
  const rows = await db.select().from(autoTradeExecutionsTable).orderBy(desc(autoTradeExecutionsTable.createdAt)).limit(limit);
  return rows.map((r) => ({
    id: r.id,
    createdAt: r.createdAt.toISOString(),
    decisionId: r.decisionId,
    instId: r.instId,
    side: r.side,
    marginUsdt: r.marginUsdt ? parseFloat(r.marginUsdt as unknown as string) : null,
    leverage: r.leverage,
    contracts: r.contracts ? parseFloat(r.contracts as unknown as string) : null,
    entryPrice: r.entryPrice ? parseFloat(r.entryPrice as unknown as string) : null,
    ordId: r.ordId,
    status: r.status,
    reason: r.reason,
    realizedPnlUsdt: r.realizedPnlUsdt ? parseFloat(r.realizedPnlUsdt as unknown as string) : null,
    closePrice: r.closePrice ? parseFloat(r.closePrice as unknown as string) : null,
    closedAt: r.closedAt ? r.closedAt.toISOString() : null,
    chosenProviderId: r.chosenProviderId,
  }));
}

export async function getLeaderboard(): Promise<{
  providerId: string; providerLabel: string;
  totalSuggestions: number; executedCount: number;
  winCount: number; lossCount: number;
  winRate: number; totalRealizedPnlUsdt: number;
}[]> {
  const decisions = await db.select().from(aiDecisionsTable).orderBy(desc(aiDecisionsTable.createdAt)).limit(500);
  const executions = await db.select().from(autoTradeExecutionsTable).orderBy(desc(autoTradeExecutionsTable.createdAt)).limit(500);

  const stats = new Map<string, { suggestions: number; executions: number; wins: number; losses: number; pnl: number }>();
  for (const p of PROVIDERS) {
    stats.set(p.id, { suggestions: 0, executions: 0, wins: 0, losses: 0, pnl: 0 });
  }
  for (const d of decisions) {
    const recs = (d.recommendations as AiRecommendation[] | null) ?? [];
    for (const r of recs) {
      if (r.ok && r.action && r.action !== "hold") {
        const s = stats.get(r.providerId);
        if (s) s.suggestions += 1;
      }
    }
  }
  for (const e of executions) {
    if (!e.chosenProviderId) continue;
    const s = stats.get(e.chosenProviderId);
    if (!s) continue;
    s.executions += 1;
    if (e.realizedPnlUsdt != null) {
      const pnl = parseFloat(e.realizedPnlUsdt as unknown as string);
      s.pnl += pnl;
      if (pnl > 0) s.wins += 1;
      else if (pnl < 0) s.losses += 1;
    }
  }
  return PROVIDERS.map((p) => {
    const s = stats.get(p.id)!;
    const closed = s.wins + s.losses;
    return {
      providerId: p.id,
      providerLabel: p.label,
      totalSuggestions: s.suggestions,
      executedCount: s.executions,
      winCount: s.wins,
      lossCount: s.losses,
      winRate: closed > 0 ? s.wins / closed : 0,
      totalRealizedPnlUsdt: s.pnl,
    };
  });
}
