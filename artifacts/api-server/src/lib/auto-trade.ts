import { db, autoTradeConfigTable, aiDecisionsTable, autoTradeExecutionsTable } from "@workspace/db";
import { eq, gte, desc, sql } from "drizzle-orm";
import { logger } from "./logger";
import {
  runResearchPipeline,
  runMarketScanner,
  computeConsensus,
  scoreSizeMultiplier,
  scoreMaxLeverage,
  type AiRecommendation,
  type ProviderWeights,
  PROVIDERS,
} from "./ai-pipeline";
import {
  fetchAccountBalance,
  fetchPerpPositions,
  placePerpMarketOrder,
  closePerpPosition,
  fetchTicker,
  fetchAtr,
  fetchPendingAlgoOrders,
  amendAlgoSlTrigger,
  fetchPositionsHistory,
  fetchAlgoOrderHistoryByAlgoId,
  fetchPerpInstrument,
  placeStandaloneReduceOnlyAlgo,
  type AccountBalanceData,
  type PerpPositionData,
} from "./okx";
import type { AutoTradeExecution } from "@workspace/db";
import { and, isNull, isNotNull } from "drizzle-orm";

const SINGLETON_ID = 1;

export type AutoTradeConfig = {
  enabled: boolean;
  whitelist: string[];
  scannerEnabled: boolean;
  scannerPickCount: number;
  scannerMinVolUsd24h: number;
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
    "BNB-USDT-SWAP",
  ],
  scannerEnabled: true,
  scannerPickCount: 3,
  scannerMinVolUsd24h: 50_000_000,
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
    scannerEnabled: row.scannerEnabled,
    scannerPickCount: row.scannerPickCount,
    scannerMinVolUsd24h: parseFloat(row.scannerMinVolUsd24h as unknown as string),
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
    scannerEnabled: DEFAULT_CONFIG.scannerEnabled,
    scannerPickCount: DEFAULT_CONFIG.scannerPickCount,
    scannerMinVolUsd24h: String(DEFAULT_CONFIG.scannerMinVolUsd24h),
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
  scannerEnabled?: boolean | null;
  scannerPickCount?: number | null;
  scannerMinVolUsd24h?: number | null;
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
  if (patch.whitelist != null) {
    // Sanitize: only valid OKX perp instId format, prevents arbitrary text reaching scanner prompts
    const valid = patch.whitelist
      .map((s) => s.trim().toUpperCase())
      .filter((s) => /^[A-Z0-9]{1,12}-USDT-SWAP$/.test(s));
    update["whitelist"] = Array.from(new Set(valid));
  }
  if (patch.scannerEnabled != null) update["scannerEnabled"] = patch.scannerEnabled;
  if (patch.scannerPickCount != null) update["scannerPickCount"] = Math.max(0, Math.min(10, patch.scannerPickCount));
  if (patch.scannerMinVolUsd24h != null) update["scannerMinVolUsd24h"] = String(Math.max(0, patch.scannerMinVolUsd24h));
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

    // Stage 0: market scanner (fail-safe — falls back to core whitelist only on any error)
    const finalInstruments: string[] = [...cfg.whitelist];
    if (cfg.scannerEnabled && cfg.scannerPickCount > 0) {
      try {
        const scan = await runMarketScanner({
          pickCount: cfg.scannerPickCount,
          minVolUsd24h: cfg.scannerMinVolUsd24h,
          exclude: cfg.whitelist,
        });
        if (scan.error) {
          logger.warn({ error: scan.error, considered: scan.candidatesConsidered }, "scanner produced no picks");
          out.push({ instId: "scanner", action: "skipped", reason: `scanner_${scan.error}`, executionId: null });
        } else {
          for (const id of scan.picks) {
            if (!finalInstruments.includes(id)) finalInstruments.push(id);
          }
          out.push({ instId: "scanner", action: "scanner_picked", reason: scan.picks.join(","), executionId: null });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error({ err }, "scanner threw, falling back to core only");
        out.push({ instId: "scanner", action: "error", reason: msg, executionId: null });
      }
    }

    for (const instId of finalInstruments) {
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

// ---------- Provider weights (T005) ----------
//
// Weight each AI by its recent closed-trade win rate, refreshed every 5 min so we don't
// hammer the DB inside the hot processInstrument loop. Sample size <5 → neutral 1.0
// (avoid early over-fitting). Win rate maps linearly to a [0.5, 1.5] weight band so
// no single model dominates entirely.
const PROVIDER_WEIGHTS_TTL_MS = 5 * 60 * 1000;
const PROVIDER_WEIGHTS_LOOKBACK = 20;
type CachedWeights = { at: number; map: ReadonlyMap<string, number> };
let providerWeightsCache: CachedWeights | null = null;

async function getProviderWeights(): Promise<ProviderWeights> {
  const now = Date.now();
  if (providerWeightsCache && now - providerWeightsCache.at < PROVIDER_WEIGHTS_TTL_MS) {
    return providerWeightsCache.map;
  }
  const map = new Map<string, number>();
  try {
    // Most recent N closed executions per provider, computed via grouped iteration on a single query.
    const rows = await db
      .select({
        chosenProviderId: autoTradeExecutionsTable.chosenProviderId,
        realizedPnlUsdt: autoTradeExecutionsTable.realizedPnlUsdt,
      })
      .from(autoTradeExecutionsTable)
      .where(
        and(
          isNotNull(autoTradeExecutionsTable.chosenProviderId),
          isNotNull(autoTradeExecutionsTable.realizedPnlUsdt),
          eq(autoTradeExecutionsTable.status, "closed"),
        ),
      )
      .orderBy(desc(autoTradeExecutionsTable.createdAt))
      .limit(PROVIDER_WEIGHTS_LOOKBACK * Math.max(PROVIDERS.length, 1) * 4);

    const stats = new Map<string, { wins: number; total: number }>();
    for (const r of rows) {
      const pid = r.chosenProviderId;
      if (!pid) continue;
      const s = stats.get(pid) ?? { wins: 0, total: 0 };
      if (s.total >= PROVIDER_WEIGHTS_LOOKBACK) continue;
      const pnl = parseFloat(r.realizedPnlUsdt as unknown as string);
      if (!Number.isFinite(pnl)) continue;
      s.total += 1;
      if (pnl > 0) s.wins += 1;
      stats.set(pid, s);
    }
    for (const p of PROVIDERS) {
      const s = stats.get(p.id);
      if (!s || s.total < 5) {
        map.set(p.id, 1);
        continue;
      }
      const winRate = s.wins / s.total;
      // Linear: winRate 0 → 0.5, 0.5 → 1.0, 1.0 → 1.5
      const weight = Math.max(0.5, Math.min(1.5, 0.5 + winRate));
      map.set(p.id, weight);
    }
  } catch (err) {
    logger.warn({ err }, "getProviderWeights failed; defaulting to neutral");
    for (const p of PROVIDERS) map.set(p.id, 1);
  }
  providerWeightsCache = { at: now, map };
  return map;
}

// ---------- Dynamic position sizing (T001) ----------
//
// Map average-confidence (1-10) to a desired margin% of equity, then cap at the user's
// hard ceiling cfg.maxMarginPctPerTrade. Below confidence 7 we wouldn't open anyway
// (gated by minAvgConfidence), so the curve only matters for 7-10.
//   conf 7 → 3%, 8 → 5%, 9 → 7%, 10 → 8%   (linear interpolation)
function confidenceMarginPct(avgConfidence: number, capPct: number): number {
  let desired: number;
  if (avgConfidence <= 7) desired = 3;
  else if (avgConfidence >= 10) desired = 8;
  else {
    // 7→3, 8→5, 9→7, 10→8
    const points: ReadonlyArray<readonly [number, number]> = [[7, 3], [8, 5], [9, 7], [10, 8]];
    const lo = points[Math.floor(avgConfidence) - 7]!;
    const hi = points[Math.ceil(avgConfidence) - 7]!;
    if (lo[0] === hi[0]) desired = lo[1];
    else {
      const t = (avgConfidence - lo[0]) / (hi[0] - lo[0]);
      desired = lo[1] + t * (hi[1] - lo[1]);
    }
  }
  return Math.max(0.5, Math.min(desired, capPct));
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

  // (Cooldown moved below consensus computation — close votes bypass cooldown.)

  // Pipeline (use cfg-bounded margin/leverage so AI sees the cap)
  const maxMarginByPct = (balance.totalEquityUsd * cfg.maxMarginPctPerTrade) / 100;
  const maxMarginUsdt = Math.max(10, Math.min(maxMarginByPct, heldUsdt));
  const maxLeverage = cfg.maxLeverage;

  const [pipeline, providerWeights] = await Promise.all([
    runResearchPipeline({ instId, mode: "perp", maxMarginUsdt, maxLeverage }),
    getProviderWeights(),
  ]);
  const consensus = computeConsensus(pipeline.recommendations, providerWeights);

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

  // Regime filter (T004): close votes still go through, but new opens are filtered.
  // Choppy = total skip; ranging = require an extra confidence point above the threshold.
  const isOpenAction = consensus.action === "long" || consensus.action === "short";
  const effectiveMinConf = isOpenAction && consensus.regimeMajority === "ranging"
    ? cfg.minAvgConfidence + 1
    : cfg.minAvgConfidence;
  if (isOpenAction && consensus.regimeMajority === "choppy") {
    return { instId, action: "skipped", reason: `regime_choppy (skip new opens)`, executionId: null };
  }
  if (consensus.avgConfidence < effectiveMinConf) {
    const tag = effectiveMinConf > cfg.minAvgConfidence ? ` (regime=${consensus.regimeMajority}, +1)` : "";
    return { instId, action: "skipped", reason: `confidence_too_low ${consensus.avgConfidence.toFixed(1)}/${effectiveMinConf}${tag}`, executionId: null };
  }

  const existingPos = positions.find((p) => p.instId === instId);

  // Close action
  if (consensus.action === "close") {
    if (!existingPos) return { instId, action: "skipped", reason: "no_position_to_close", executionId: null };
    try {
      await closePerpPosition({ instId });
      const ticker = await fetchTicker(instId).catch(() => null);
      const closePx = ticker?.last ?? null;
      const baseRealized = closePx != null ? existingPos.unrealizedPnlUsd : null;

      // If we have a matching open execution row (engine-opened), update it in place so
      // the trailing tick won't also reconcile it as an external close (would double-count PnL).
      // We fetch full row so we can fold in any prior TP1 leg PnL.
      const existingOpen = await db
        .select()
        .from(autoTradeExecutionsTable)
        .where(
          and(
            eq(autoTradeExecutionsTable.instId, instId),
            eq(autoTradeExecutionsTable.status, "submitted"),
            isNull(autoTradeExecutionsTable.closedAt),
          ),
        )
        .orderBy(desc(autoTradeExecutionsTable.id))
        .limit(1);

      if (existingOpen.length > 0) {
        const openRow = existingOpen[0]!;
        // If TP1 already filled, current unrealizedPnl reflects only the remaining half.
        // Add the recorded TP1 leg so the row total reflects the whole trade.
        let realized = baseRealized;
        if (realized != null && openRow.tp1FilledAt && openRow.tp1RealizedPnl != null) {
          const tp1 = parseFloat(openRow.tp1RealizedPnl as unknown as string);
          if (Number.isFinite(tp1)) realized += tp1;
        }
        await db
          .update(autoTradeExecutionsTable)
          .set({
            status: "closed",
            realizedPnlUsdt: realized != null ? String(realized) : null,
            closePrice: closePx != null ? String(closePx) : null,
            closedAt: new Date(),
            closeReason: "ai",
          })
          .where(eq(autoTradeExecutionsTable.id, openRow.id));
        return { instId, action: "executed_close", reason: null, executionId: openRow.id };
      }
      const realized = baseRealized;

      // No engine-opened row to attach to (e.g., user manually opened the position) — insert a new closing record.
      const [exec] = await db.insert(autoTradeExecutionsTable).values({
        decisionId, instId, side: "close",
        marginUsdt: null, leverage: null, contracts: String(Math.abs(existingPos.contracts)),
        entryPrice: String(existingPos.avgEntryPx),
        ordId: null, status: "closed", reason: "consensus_close",
        realizedPnlUsdt: realized != null ? String(realized) : null,
        closePrice: closePx != null ? String(closePx) : null,
        closedAt: new Date(),
        closeReason: "ai",
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

  // Cooldown gate: only blocks new opens. Close votes already returned above.
  if (await inCooldown(instId, cfg.cooldownMinutes)) {
    return { instId, action: "skipped", reason: "cooldown", executionId: null };
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

  // ── Strategy hard gate (Minervini + Qullamaggie + Schwartz, crypto-adjusted) ──
  // Even if AI consensus says "long", we refuse to trade if any 禁止 rule fires:
  //   price < 4H EMA200, funding > 0.03%, RSI > 85, score ≤ 2, missing ATR.
  // This is the safety belt — AI may misread; deterministic checks are absolute.
  const checklist = side === "long" ? pipeline.strategyLong : pipeline.strategyShort;
  if (!checklist) {
    return { instId, action: "skipped", reason: "strategy_checklist_unavailable", executionId: null };
  }
  if (checklist.hardBlocks.length > 0) {
    return {
      instId,
      action: "skipped",
      reason: `strategy_hard_block (score=${checklist.score}/7, ${checklist.hardBlocks.join("; ")})`,
      executionId: null,
    };
  }
  if (checklist.score <= 2) {
    return {
      instId,
      action: "skipped",
      reason: `strategy_score_too_low ${checklist.score}/7 (need ≥ 3)`,
      executionId: null,
    };
  }

  // Dynamic position sizing (T001): scale margin% by avg confidence, capped at user setting.
  const dynamicPct = confidenceMarginPct(consensus.avgConfidence, cfg.maxMarginPctPerTrade);
  const dynamicMaxMargin = Math.max(10, Math.min((balance.totalEquityUsd * dynamicPct) / 100, heldUsdt));
  // Strategy score scales the margin too: 3-4→30% / 5→50% / 6→70% / 7→100%.
  // Final cap = min(confidence-based cap, score-based cap, AI-suggested median).
  const scoreMult = scoreSizeMultiplier(checklist.score);
  const scoreMaxMargin = Math.max(10, dynamicMaxMargin * scoreMult);
  const effectiveMaxMargin = Math.min(dynamicMaxMargin, scoreMaxMargin);
  const margin = Math.max(10, Math.min(consensus.medianMarginUsdt ?? effectiveMaxMargin, effectiveMaxMargin));
  // Leverage capped by both user setting and strategy-score table (7→10x / 5-6→5x / 3-4→3x).
  const scoreLevCap = scoreMaxLeverage(checklist.score);
  const effectiveMaxLev = Math.min(cfg.maxLeverage, scoreLevCap);
  const leverage = Math.max(1, Math.min(consensus.medianLeverage ?? effectiveMaxLev, effectiveMaxLev));

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

  // Force TP via confidence-tiered R:R if model didn't provide one.
  // High conviction (avg confidence >= 9) → let profit run with 3:1; otherwise 2:1.
  let takeProfitPrice = consensus.medianTakeProfitPrice;
  if (takeProfitPrice == null) {
    const slDistance = Math.abs(pipeline.lastPrice - stopLossPrice);
    const rrRatio = consensus.avgConfidence >= 9 ? 3 : 2;
    if (slDistance > 0) {
      takeProfitPrice = side === "long"
        ? pipeline.lastPrice + slDistance * rrRatio
        : pipeline.lastPrice - slDistance * rrRatio;
    }
  }
  // Sanity check TP: must be on profit side with non-trivial distance.
  if (takeProfitPrice != null) {
    const tp = takeProfitPrice;
    if (side === "long" && tp <= pipeline.lastPrice + minDistance) takeProfitPrice = null;
    if (side === "short" && tp >= pipeline.lastPrice - minDistance) takeProfitPrice = null;
  }

  // Deterministic client ID for the attached OCO algo so we can locate it without ambiguity.
  // Format: "at" + decisionId + "x" + 8 random hex chars (OKX algoClOrdId max ~32 chars, alphanumeric).
  const algoClOrdId = `at${decisionId}x${Math.random().toString(16).slice(2, 10)}`;

  try {
    const result = await placePerpMarketOrder({
      instId, side, marginUsdt: margin, leverage,
      stopLossPrice, takeProfitPrice,
      algoClOrdId: stopLossPrice != null || takeProfitPrice != null ? algoClOrdId : null,
    });
    // Match the algo we just attached by algoClOrdId. Bounded retry handles eventual consistency.
    let capturedAlgoSlId: string | null = null;
    let capturedAlgoTpId: string | null = null;
    if (stopLossPrice != null || takeProfitPrice != null) {
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          const algos = await fetchPendingAlgoOrders(instId);
          const ours = algos.find((a) => a.algoClOrdId === algoClOrdId);
          if (ours) {
            if (ours.slTriggerPx != null) capturedAlgoSlId = ours.algoId;
            if (ours.tpTriggerPx != null) capturedAlgoTpId = ours.algoId;
            break;
          }
        } catch (e) {
          logger.warn({ err: e, instId, attempt }, "fetch algo IDs attempt failed");
        }
        await new Promise((r) => setTimeout(r, 400));
      }
      if (!capturedAlgoSlId) {
        logger.warn({ instId, algoClOrdId }, "could not locate attached algo by client ID; trailing disabled for this trade");
      }
    }
    // Partial TP (T006): place a standalone reduce-only TP1 algo on ~50% of contracts at +1.5R.
    // Best-effort — failure here doesn't roll back the trade (the attached OCO still fully protects).
    //
    // Skip TP1 entirely on add-on entries (existingPos same-side). The TP1-fill detection in
    // trailing tick compares live position size to ~half of THIS order's contracts, but on an
    // add-on the live size would be (existing + new) and the half-comparison would never match,
    // so TP1 would silently never be recorded. Disabling it here keeps reconciliation honest.
    let capturedAlgoTp1Id: string | null = null;
    if (existingPos) {
      logger.info({ instId }, "partial-TP1 skipped (add-on entry; pyramiding incompatible with half-fill detection)");
    } else try {
      const meta = await fetchPerpInstrument(instId);
      const lotSz = meta.lotSz > 0 ? meta.lotSz : 1;
      const minSz = meta.minSz > 0 ? meta.minSz : 1;
      const halfRaw = result.contracts / 2;
      const halfContracts = Math.floor(halfRaw / lotSz) * lotSz;
      const remaining = result.contracts - halfContracts;
      const rDistance = Math.abs(result.markPx - stopLossPrice);
      const tp1Price = side === "long"
        ? result.markPx + 1.5 * rDistance
        : result.markPx - 1.5 * rDistance;
      if (
        halfContracts >= minSz &&
        remaining >= minSz &&
        rDistance > 0 &&
        tp1Price > 0
      ) {
        const tp1ClOrdId = `at${decisionId}t${Math.random().toString(16).slice(2, 10)}`;
        const placed = await placeStandaloneReduceOnlyAlgo({
          instId,
          posSide: side,
          sz: halfContracts,
          ordType: "conditional",
          tpTriggerPx: tp1Price,
          algoClOrdId: tp1ClOrdId,
        });
        capturedAlgoTp1Id = placed.algoId;
        logger.info({ instId, halfContracts, tp1Price, algoId: placed.algoId }, "partial-TP1 algo placed");
      } else {
        logger.info(
          { instId, contracts: result.contracts, halfContracts, remaining, minSz },
          "partial-TP1 skipped (size below split threshold)",
        );
      }
    } catch (err) {
      logger.warn({ err, instId }, "partial-TP1 algo placement failed (continuing without TP1)");
    }

    const [exec] = await db.insert(autoTradeExecutionsTable).values({
      decisionId, instId, side,
      marginUsdt: String(margin), leverage,
      contracts: String(result.contracts),
      entryPrice: String(result.markPx),
      ordId: result.ordId,
      status: "submitted", reason: "consensus_open",
      chosenProviderId: consensus.chosenProviderId,
      algoSlId: capturedAlgoSlId,
      algoTpId: capturedAlgoTpId,
      algoTp1Id: capturedAlgoTp1Id,
      originalContracts: String(result.contracts),
      regime: consensus.regimeMajority,
      initialSlPrice: String(stopLossPrice),
      trailingStage: 0,
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

// ---------- Trailing stop ----------

/**
 * Two-stage trailing stop, evaluated every minute:
 *   - Stage 0 → 1: when unrealized profit reaches +1R, move SL up to entry price (break-even).
 *   - Stage 1 → 2: when unrealized profit reaches +2R, move SL to entry +1R (lock 1R profit).
 *
 * R = |entry - initialSlPrice|. Only ratchets in the favorable direction.
 */
let trailingTickRunning = false;

export async function runTrailingTick(): Promise<void> {
  if (trailingTickRunning) return; // single-flight: skip if previous tick still running
  trailingTickRunning = true;
  try {
    await runTrailingTickInner();
  } finally {
    trailingTickRunning = false;
  }
}

async function detectPartialTp1Fill(row: AutoTradeExecution, pos: PerpPositionData): Promise<boolean> {
  // Returns true if we just recorded a TP1 partial fill (caller should NOT reconcile as full close).
  if (row.tp1FilledAt) return true; // already recorded — treat remaining trailing as normal
  if (!row.algoTp1Id) return false;
  const original = row.originalContracts
    ? Math.abs(parseFloat(row.originalContracts as unknown as string))
    : 0;
  if (!(original > 0)) return false;
  const current = Math.abs(pos.contracts);
  const half = original / 2;
  // Position should be ~half of original (within 15% tolerance to absorb lotSz rounding).
  if (Math.abs(current - half) / original > 0.15) return false;

  try {
    const state = await fetchAlgoOrderHistoryByAlgoId(row.algoTp1Id);
    if (!state || state.state !== "effective") return false;
    const entry = row.entryPrice ? parseFloat(row.entryPrice as unknown as string) : 0;
    const closedContracts = original - current;
    // Estimate realized PnL from the TP1 trigger price (best available estimate
    // without per-fill data; close enough since TP1 is a market trigger).
    // We need ctVal — fetch instrument meta. Failure → fall back to null PnL but still mark filled.
    let tp1Pnl: number | null = null;
    try {
      const meta = await fetchPerpInstrument(row.instId);
      const initialSl = row.initialSlPrice ? parseFloat(row.initialSlPrice as unknown as string) : 0;
      const r = Math.abs(entry - initialSl);
      const tp1Px = row.side === "long" ? entry + 1.5 * r : entry - 1.5 * r;
      const sign = row.side === "long" ? 1 : -1;
      tp1Pnl = sign * (tp1Px - entry) * closedContracts * meta.ctVal;
    } catch (err) {
      logger.warn({ err, instId: row.instId }, "tp1 PnL estimate failed");
    }
    await db
      .update(autoTradeExecutionsTable)
      .set({
        tp1FilledAt: new Date(),
        tp1RealizedPnl: tp1Pnl != null ? String(tp1Pnl) : null,
      })
      .where(eq(autoTradeExecutionsTable.id, row.id));
    logger.info(
      { execId: row.id, instId: row.instId, closedContracts, tp1Pnl },
      "partial-TP1 fill detected and recorded; trailing continues on remainder",
    );
    return true;
  } catch (err) {
    logger.warn({ err, execId: row.id }, "detectPartialTp1Fill failed");
    return false;
  }
}

async function reconcileClosedExecution(row: AutoTradeExecution): Promise<void> {
  // 1) Determine close reason. In OCO the SL/TP share one algoId, so we must use
  //    the triggered leg's `actualSide` ("sl" or "tp") rather than which id was effective.
  let closeReason: string | null = null;
  try {
    const algoIds = new Set<string>();
    if (row.algoSlId) algoIds.add(row.algoSlId);
    if (row.algoTpId) algoIds.add(row.algoTpId);
    let anyLookupSucceeded = false;
    let triggered = false;
    for (const algoId of algoIds) {
      const state = await fetchAlgoOrderHistoryByAlgoId(algoId);
      if (state) anyLookupSucceeded = true;
      if (state?.state === "effective") {
        triggered = true;
        if (state.actualSide === "tp") closeReason = "tp";
        else if (state.actualSide === "sl") closeReason = "sl";
        else closeReason = "sl"; // single-leg conditional w/o actualSide → assume SL
        break;
      }
    }
    if (!triggered && anyLookupSucceeded) closeReason = "manual";
    // If algoIds was empty OR all lookups failed, leave closeReason null and retry next tick.
  } catch (err) {
    logger.warn({ err, execId: row.id }, "reconcile: algo state lookup failed");
  }

  // 2) Match the closed position by size (closeTotalPos ≈ row.contracts within 5%) within a
  //    time window starting at our entry. Take the most recent matching row.
  let realizedPnl: number | null = null;
  let closePx: number | null = null;
  let matched = false;
  try {
    const sinceMs = row.createdAt instanceof Date ? row.createdAt.getTime() - 60_000 : 0;
    const history = await fetchPositionsHistory({
      instId: row.instId,
      afterMs: sinceMs,
      limit: 50,
    });
    const ourContracts = row.contracts
      ? Math.abs(parseFloat(row.contracts as unknown as string))
      : 0;
    // After a TP1 partial fill the final close size is ~half of the original. We accept
    // either the full original size or the half-size as a valid match (within 15%).
    const expectedSizes = [ourContracts];
    if (row.tp1FilledAt && ourContracts > 0) expectedSizes.push(ourContracts / 2);
    let best: (typeof history)[number] | null = null;
    for (const h of history) {
      if (expectedSizes.length > 0 && expectedSizes[0]! > 0) {
        const matchAny = expectedSizes.some(
          (sz) => sz > 0 && Math.abs(h.closeTotalPos - sz) / sz <= 0.15,
        );
        if (!matchAny) continue;
      }
      if (!best || h.uTime > best.uTime) best = h;
    }
    if (best) {
      realizedPnl = best.realizedPnl;
      closePx = best.closeAvgPx;
      matched = true;
      // Add the previously-recorded TP1 leg's PnL to the final realized total so
      // the row's realizedPnlUsdt reflects the full trade, not just the second half.
      if (row.tp1FilledAt && row.tp1RealizedPnl != null && realizedPnl != null) {
        const tp1 = parseFloat(row.tp1RealizedPnl as unknown as string);
        if (Number.isFinite(tp1)) realizedPnl += tp1;
      }
    }
  } catch (err) {
    logger.warn({ err, execId: row.id, instId: row.instId }, "reconcile: positions-history fetch failed");
  }

  // 3) Don't finalize unless we got SOMETHING usable. Otherwise retry next minute.
  if (!matched && closeReason == null) {
    logger.warn({ execId: row.id, instId: row.instId }, "reconcile: no data yet; will retry next tick");
    return;
  }

  await db
    .update(autoTradeExecutionsTable)
    .set({
      closedAt: new Date(),
      status: "closed",
      closeReason: closeReason ?? "unknown",
      realizedPnlUsdt: realizedPnl != null ? String(realizedPnl) : row.realizedPnlUsdt,
      closePrice: closePx != null ? String(closePx) : row.closePrice,
    })
    .where(eq(autoTradeExecutionsTable.id, row.id));

  logger.info(
    { execId: row.id, instId: row.instId, closeReason, realizedPnl, matched },
    "auto-trade execution reconciled after external close",
  );
}

async function runTrailingTickInner(): Promise<void> {
  // Pull all submitted-and-not-closed open executions that still have an algo SL we can amend.
  const open = await db
    .select()
    .from(autoTradeExecutionsTable)
    .where(
      and(
        eq(autoTradeExecutionsTable.status, "submitted"),
        isNull(autoTradeExecutionsTable.closedAt),
        isNotNull(autoTradeExecutionsTable.algoSlId),
        isNotNull(autoTradeExecutionsTable.entryPrice),
        isNotNull(autoTradeExecutionsTable.initialSlPrice),
      ),
    );
  if (open.length === 0) return;

  // Fetch live positions once and index by instId.
  const positions = await fetchPerpPositions().catch(() => [] as PerpPositionData[]);
  const posByInst = new Map(positions.map((p) => [p.instId, p]));

  for (let row of open) {
    const side = row.side as "long" | "short";
    if (side !== "long" && side !== "short") continue;

    const pos = posByInst.get(row.instId);
    if (!pos || pos.contracts === 0) {
      // Position closed externally (TP/SL hit, manual). Reconcile realized PnL & reason.
      await reconcileClosedExecution(row);
      continue;
    }

    // Partial-TP1 fill detection: if pos has shrunk to ~half of original AND TP1 algo fired,
    // record the partial without closing the row, then continue trailing on the remainder.
    const tp1JustHandled = await detectPartialTp1Fill(row, pos);
    if (tp1JustHandled && !row.tp1FilledAt) {
      // We just wrote tp1FilledAt this tick — refresh local row so subsequent stages see it.
      row = { ...row, tp1FilledAt: new Date() };
    }

    const entry = Number(row.entryPrice);
    const initialSl = Number(row.initialSlPrice);
    const mark = pos.markPx;
    if (!(entry > 0) || !(initialSl > 0) || !(mark > 0)) continue;

    const rDistance = Math.abs(entry - initialSl);
    if (rDistance <= 0) continue;

    const profitR = side === "long" ? (mark - entry) / rDistance : (entry - mark) / rDistance;
    const stage = row.trailingStage ?? 0;

    let targetStage = stage;
    let targetSl: number | null = null;

    if (stage < 2 && profitR >= 2) {
      targetStage = 2;
      targetSl = side === "long" ? entry + rDistance : entry - rDistance;
    } else if (stage < 1 && profitR >= 1) {
      targetStage = 1;
      targetSl = entry; // break-even
    }

    if (targetSl == null || targetStage === stage) continue;

    try {
      await amendAlgoSlTrigger({
        instId: row.instId,
        algoId: row.algoSlId!,
        newSlTriggerPx: targetSl,
      });
      // Conditional update: only advance if stage hasn't moved underneath us.
      const updated = await db
        .update(autoTradeExecutionsTable)
        .set({ trailingStage: targetStage })
        .where(
          and(
            eq(autoTradeExecutionsTable.id, row.id),
            eq(autoTradeExecutionsTable.trailingStage, stage),
          ),
        )
        .returning({ id: autoTradeExecutionsTable.id });
      if (updated.length === 0) {
        logger.warn(
          { instId: row.instId, expectedStage: stage },
          "trailing stage advanced concurrently; amend already applied to OKX",
        );
      } else {
        logger.info(
          { instId: row.instId, side, stage: targetStage, newSl: targetSl, profitR: profitR.toFixed(2) },
          "trailing-stop ratcheted",
        );
      }
    } catch (err) {
      logger.warn({ err, instId: row.instId, algoId: row.algoSlId }, "trailing-stop amend failed");
    }
  }
}

// ---------- Scheduler ----------

let timer: NodeJS.Timeout | null = null;
let lastTriggeredHour = -1;

export function startScheduler(): void {
  if (timer) return;
  timer = setInterval(() => {
    void (async () => {
      const now = new Date();
      try {
        const cfg = await getOrCreateConfig().catch(() => null);
        const enabled = !!cfg?.enabled;
        const killed = !!(cfg?.killUntil && new Date(cfg.killUntil) > now);

        // Trailing-stop check runs every minute when engine is enabled (not killed).
        if (enabled && !killed) {
          await runTrailingTick().catch((err) =>
            logger.error({ err }, "trailing tick failed"),
          );
        }

        // Hourly consensus cycle at HH:01.
        if (now.getMinutes() === 1 && now.getHours() !== lastTriggeredHour) {
          lastTriggeredHour = now.getHours();
          if (!enabled || killed) return;
          logger.info({ minute: now.getMinutes() }, "auto-trade cycle starting");
          const result = await runCycle();
          logger.info({ entries: result.perInstrument.length }, "auto-trade cycle done");
        }
      } catch (err) {
        logger.error({ err }, "scheduler tick failed");
      }
    })();
  }, 60 * 1000);
  logger.info("auto-trade scheduler started (trailing + hourly cycle)");
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
