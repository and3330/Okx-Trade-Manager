import { Router, type IRouter } from "express";
import {
  ListPerpTickersResponse,
  GetPerpInstrumentParams,
  GetPerpInstrumentResponse,
  ListPerpPositionsResponse,
  PlacePerpOrderBody,
  ClosePerpPositionBody,
  ClosePerpPositionResponse,
} from "@workspace/api-zod";
import {
  fetchTopPerpTickers,
  fetchPerpInstrument,
  fetchPerpPositions,
  placePerpMarketOrder,
  closePerpPosition,
  OkxError,
} from "../lib/okx";

const router: IRouter = Router();

function handleOkxError(err: unknown): { status: number; body: { error: string; code?: string } } {
  if (err instanceof OkxError) {
    return { status: err.status, body: { error: err.message, code: err.code } };
  }
  const msg = err instanceof Error ? err.message : String(err);
  return { status: 500, body: { error: msg } };
}

router.get("/okx/perp/tickers", async (req, res): Promise<void> => {
  try {
    const data = await fetchTopPerpTickers();
    res.json(ListPerpTickersResponse.parse(data));
  } catch (err) {
    req.log.error({ err }, "perp tickers failed");
    const { status, body } = handleOkxError(err);
    res.status(status).json(body);
  }
});

router.get("/okx/perp/instruments/:instId", async (req, res): Promise<void> => {
  const params = GetPerpInstrumentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  try {
    const data = await fetchPerpInstrument(params.data.instId);
    res.json(GetPerpInstrumentResponse.parse(data));
  } catch (err) {
    req.log.error({ err }, "perp instrument failed");
    const { status, body } = handleOkxError(err);
    res.status(status).json(body);
  }
});

router.get("/okx/perp/positions", async (req, res): Promise<void> => {
  try {
    const data = await fetchPerpPositions();
    res.json(ListPerpPositionsResponse.parse(data));
  } catch (err) {
    req.log.error({ err }, "perp positions failed");
    const { status, body } = handleOkxError(err);
    res.status(status).json(body);
  }
});

router.post("/okx/perp/orders", async (req, res): Promise<void> => {
  const parsed = PlacePerpOrderBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  try {
    const data = await placePerpMarketOrder({
      instId: parsed.data.instId,
      side: parsed.data.side,
      marginUsdt: parsed.data.marginUsdt,
      leverage: parsed.data.leverage,
      takeProfitPrice: parsed.data.takeProfitPrice ?? null,
      stopLossPrice: parsed.data.stopLossPrice ?? null,
    });
    res.status(201).json(data);
  } catch (err) {
    req.log.error({ err }, "perp place order failed");
    const { status, body } = handleOkxError(err);
    res.status(status).json(body);
  }
});

router.post("/okx/perp/orders/close", async (req, res): Promise<void> => {
  const parsed = ClosePerpPositionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  try {
    const data = await closePerpPosition({
      instId: parsed.data.instId,
      posSide: parsed.data.posSide ?? undefined,
      marginMode: parsed.data.marginMode ?? undefined,
    });
    res.json(ClosePerpPositionResponse.parse(data));
  } catch (err) {
    req.log.error({ err }, "perp close failed");
    const { status, body } = handleOkxError(err);
    res.status(status).json(body);
  }
});

export default router;
