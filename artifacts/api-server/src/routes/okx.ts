import { Router, type IRouter } from "express";
import {
  GetAccountBalanceResponse,
  GetAccountSummaryResponse,
  ListTopTickersResponse,
  GetTickerResponse,
  GetTickerParams,
  GetCandlesResponse,
  ListOrdersResponse,
  ListRecentFillsResponse,
  PlaceOrderBody,
} from "@workspace/api-zod";
import {
  fetchAccountBalance,
  fetchAccountSummary,
  fetchTopTickers,
  fetchTicker,
  fetchCandles,
  fetchOrders,
  fetchRecentFills,
  placeMarketOrder,
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

router.get("/okx/account/balance", async (req, res): Promise<void> => {
  try {
    const data = await fetchAccountBalance();
    res.json(GetAccountBalanceResponse.parse(data));
  } catch (err) {
    req.log.error({ err }, "balance failed");
    const { status, body } = handleOkxError(err);
    res.status(status).json(body);
  }
});

router.get("/okx/account/summary", async (req, res): Promise<void> => {
  try {
    const data = await fetchAccountSummary();
    res.json(GetAccountSummaryResponse.parse(data));
  } catch (err) {
    req.log.error({ err }, "summary failed");
    const { status, body } = handleOkxError(err);
    res.status(status).json(body);
  }
});

router.get("/okx/market/tickers", async (req, res): Promise<void> => {
  try {
    const data = await fetchTopTickers();
    res.json(ListTopTickersResponse.parse(data));
  } catch (err) {
    req.log.error({ err }, "tickers failed");
    const { status, body } = handleOkxError(err);
    res.status(status).json(body);
  }
});

router.get("/okx/market/ticker/:instId", async (req, res): Promise<void> => {
  const params = GetTickerParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  try {
    const data = await fetchTicker(params.data.instId);
    res.json(GetTickerResponse.parse(data));
  } catch (err) {
    req.log.error({ err }, "ticker failed");
    const { status, body } = handleOkxError(err);
    res.status(status).json(body);
  }
});

router.get("/okx/market/candles/:instId", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.instId)
    ? req.params.instId[0]
    : req.params.instId;
  if (typeof raw !== "string" || raw.length === 0) {
    res.status(400).json({ error: "instId required" });
    return;
  }
  try {
    const data = await fetchCandles(raw);
    res.json(GetCandlesResponse.parse(data));
  } catch (err) {
    req.log.error({ err }, "candles failed");
    const { status, body } = handleOkxError(err);
    res.status(status).json(body);
  }
});

router.get("/okx/trade/orders", async (req, res): Promise<void> => {
  try {
    const data = await fetchOrders();
    res.json(ListOrdersResponse.parse(data));
  } catch (err) {
    req.log.error({ err }, "orders failed");
    const { status, body } = handleOkxError(err);
    res.status(status).json(body);
  }
});

router.post("/okx/trade/orders", async (req, res): Promise<void> => {
  const parsed = PlaceOrderBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  try {
    const data = await placeMarketOrder({
      instId: parsed.data.instId,
      side: parsed.data.side,
      notionalUsd: parsed.data.notionalUsd,
      stopLossPrice: parsed.data.stopLossPrice ?? null,
    });
    req.log.info({ ordId: data.ordId, instId: data.instId }, "order placed");
    res.status(201).json(data);
  } catch (err) {
    req.log.error({ err }, "place order failed");
    const { status, body } = handleOkxError(err);
    res.status(status).json(body);
  }
});

router.get("/okx/trade/orders/recent-fills", async (req, res): Promise<void> => {
  try {
    const data = await fetchRecentFills();
    res.json(ListRecentFillsResponse.parse(data));
  } catch (err) {
    req.log.error({ err }, "fills failed");
    const { status, body } = handleOkxError(err);
    res.status(status).json(body);
  }
});

export default router;
