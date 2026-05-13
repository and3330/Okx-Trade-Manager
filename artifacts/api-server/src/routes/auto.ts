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

const router: IRouter = Router();

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
