import { Router, type IRouter } from "express";
import {
  getOrCreateConfig,
  updateConfig,
  killEngine,
  runCycle,
  getStatus,
  listDecisions,
  listExecutions,
  getLeaderboard,
  type ConfigPatch,
} from "../lib/auto-trade";
import {
  fetchPerpPositions,
  fetchPendingAlgoOrders,
  placeStandaloneReduceOnlyAlgo,
  cancelAlgos,
} from "../lib/okx";
import { db, autoTradeExecutionsTable } from "@workspace/db";
import { and, eq, isNull, inArray } from "drizzle-orm";

const router: IRouter = Router();

/**
 * One-shot: rebuild all SL/TP algos on currently-open positions using fixed slPct/tpPct.
 * Safe sequence per position:
 *   1. Place new reduce-only OCO (full size, mark-price ± slPct/tpPct)
 *   2. If new placement succeeded → cancel all OTHER algos on that instId
 *   3. If new placement failed → leave old algos in place, report error
 * At no point is the position unprotected.
 */
router.post("/okx/auto/rebuild-algos", async (req, res): Promise<void> => {
  try {
    const cfg = await getOrCreateConfig();
    const slPct = cfg.slPct / 100;
    const tpPct = cfg.tpPct / 100;
    const positions = await fetchPerpPositions();
    const results: Array<{
      instId: string;
      posSide: string;
      newAlgoId: string | null;
      cancelledAlgoIds: string[];
      sl: number | null;
      tp: number | null;
      error: string | null;
    }> = [];

    for (const p of positions) {
      // In long_short_mode posSide is "long"/"short"; in net_mode it's "net" and direction
      // is encoded in contracts sign (positive=long, negative=short).
      const posSide: "long" | "short" =
        p.posSide === "long" || p.posSide === "short"
          ? p.posSide
          : p.contracts >= 0
            ? "long"
            : "short";
      if (p.markPx <= 0) {
        results.push({ instId: p.instId, posSide, newAlgoId: null, cancelledAlgoIds: [], sl: null, tp: null, error: "no_mark_price" });
        continue;
      }
      const size = Math.abs(p.contracts);
      if (size <= 0) continue;

      const sl = posSide === "long" ? p.markPx * (1 - slPct) : p.markPx * (1 + slPct);
      const tp = posSide === "long" ? p.markPx * (1 + tpPct) : p.markPx * (1 - tpPct);
      const clOrdId = `rb${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.slice(0, 32);

      let newAlgoId: string | null = null;
      try {
        const r = await placeStandaloneReduceOnlyAlgo({
          instId: p.instId,
          posSide,
          sz: size,
          ordType: "oco",
          tpTriggerPx: tp,
          slTriggerPx: sl,
          algoClOrdId: clOrdId,
        });
        newAlgoId = r.algoId;
      } catch (e) {
        results.push({ instId: p.instId, posSide, newAlgoId: null, cancelledAlgoIds: [], sl, tp, error: `place_new_failed: ${e instanceof Error ? e.message : String(e)}` });
        continue;
      }

      // New OCO is in place → safe to cancel any others.
      const cancelledAlgoIds: string[] = [];
      try {
        const pending = await fetchPendingAlgoOrders(p.instId);
        const old = pending.filter((a) => a.algoId !== newAlgoId);
        if (old.length > 0) {
          await cancelAlgos(old.map((a) => ({ instId: a.instId, algoId: a.algoId })));
          cancelledAlgoIds.push(...old.map((a) => a.algoId));
        }
      } catch (e) {
        results.push({ instId: p.instId, posSide, newAlgoId, cancelledAlgoIds, sl, tp, error: `cancel_old_failed_but_new_active: ${e instanceof Error ? e.message : String(e)}` });
        continue;
      }
      results.push({ instId: p.instId, posSide, newAlgoId, cancelledAlgoIds, sl, tp, error: null });
    }

    req.log.info({ count: results.length, ok: results.filter((r) => !r.error).length }, "rebuild-algos completed");
    res.json({ slPct: cfg.slPct, tpPct: cfg.tpPct, results });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

/**
 * One-shot: clean up "zombie" submitted rows that have no corresponding OKX position.
 * This happens when SL/TP closes a position but the row never got reconciled
 * (pre-F1/F2 fix: rows missing algoSlId were excluded from reconcile loop).
 * Marks every submitted row for an instId without a live position as 'closed' / 'zombie_cleanup'.
 */
router.post("/okx/auto/cleanup-zombies", async (req, res): Promise<void> => {
  try {
    const positions = await fetchPerpPositions();
    const liveInstIds = positions
      .filter((p) => p.contracts !== 0)
      .map((p) => p.instId);

    const allOpen = await db
      .select({ id: autoTradeExecutionsTable.id, instId: autoTradeExecutionsTable.instId })
      .from(autoTradeExecutionsTable)
      .where(
        and(
          eq(autoTradeExecutionsTable.status, "submitted"),
          isNull(autoTradeExecutionsTable.closedAt),
        ),
      );

    const zombies = allOpen.filter((r) => !liveInstIds.includes(r.instId));
    if (zombies.length === 0) {
      res.json({ cleaned: 0, liveInstIds, message: "no zombies found" });
      return;
    }

    const zombieIds = zombies.map((z) => z.id);
    const now = new Date();
    await db
      .update(autoTradeExecutionsTable)
      .set({
        status: "closed",
        closedAt: now,
        closeReason: "zombie_cleanup",
        realizedPnlUsdt: "0",
      })
      .where(inArray(autoTradeExecutionsTable.id, zombieIds));

    req.log.info({ cleaned: zombieIds.length, liveInstIds }, "zombie cleanup complete");
    res.json({ cleaned: zombieIds.length, liveInstIds, zombieInstIds: [...new Set(zombies.map((z) => z.instId))] });
  } catch (err) {
    req.log.error({ err }, "cleanup-zombies failed");
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.get("/okx/auto/config", async (_req, res): Promise<void> => {
  try {
    const cfg = await getOrCreateConfig();
    res.json(cfg);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.put("/okx/auto/config", async (req, res): Promise<void> => {
  try {
    const body = (req.body ?? {}) as ConfigPatch;
    const cfg = await updateConfig(body);
    res.json(cfg);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.get("/okx/auto/status", async (_req, res): Promise<void> => {
  try {
    res.json(await getStatus());
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.post("/okx/auto/kill", async (_req, res): Promise<void> => {
  try {
    await killEngine();
    res.json(await getStatus());
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.post("/okx/auto/run-now", async (req, res): Promise<void> => {
  try {
    req.log.info("manual auto-trade cycle triggered");
    const result = await runCycle({ force: false });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.get("/okx/auto/decisions", async (req, res): Promise<void> => {
  try {
    const limit = Math.min(parseInt((req.query["limit"] as string) ?? "50", 10) || 50, 200);
    res.json(await listDecisions(limit));
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.get("/okx/auto/executions", async (req, res): Promise<void> => {
  try {
    const limit = Math.min(parseInt((req.query["limit"] as string) ?? "50", 10) || 50, 200);
    res.json(await listExecutions(limit));
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.get("/okx/auto/leaderboard", async (_req, res): Promise<void> => {
  try {
    res.json(await getLeaderboard());
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
