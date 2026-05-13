import { Router, type IRouter } from "express";
import {
  AnalyzeMarketBody,
  AnalyzeMarketResponse,
  RecommendTradeBody,
  RecommendTradeResponse,
  RunResearchPipelineBody,
} from "@workspace/api-zod";
import {
  fetchTicker,
  fetchCandles,
  fetchAccountBalance,
  OkxError,
  type TickerData,
  type CandleData,
  type AccountBalanceData,
} from "../lib/okx";
import {
  runResearchPipeline,
  computeConsensus,
  PROVIDERS,
  ANTHROPIC_MODEL,
} from "../lib/ai-pipeline";
import { recordDecision } from "../lib/auto-trade";
import Anthropic from "@anthropic-ai/sdk";

const router: IRouter = Router();

let anthropicClient: Anthropic | null = null;
function getAnthropic(): Anthropic {
  if (anthropicClient) return anthropicClient;
  const baseURL = process.env["AI_INTEGRATIONS_ANTHROPIC_BASE_URL"];
  const apiKey = process.env["AI_INTEGRATIONS_ANTHROPIC_API_KEY"];
  if (!baseURL || !apiKey) throw new Error("Anthropic AI integration not configured");
  anthropicClient = new Anthropic({ baseURL, apiKey });
  return anthropicClient;
}

void PROVIDERS;

function buildLegacyAnalysisPrompt(
  instId: string,
  ticker: TickerData,
  candles: CandleData[],
  balance: AccountBalanceData | null,
): { prompt: string } {
  const baseAsset = instId.split("-")[0] ?? instId;
  const heldBase = balance?.assets.find((a) => a.ccy === baseAsset)?.available ?? 0;
  const heldUsdt = balance?.assets.find((a) => a.ccy === "USDT")?.available ?? 0;
  const recent = candles.slice(-48);
  const candleLines = recent
    .map((c) => `${c.ts.slice(5, 16).replace("T", " ")}  O:${c.open}  H:${c.high}  L:${c.low}  C:${c.close}`)
    .join("\n");
  const portfolioCtx = balance
    ? `Account total equity: $${balance.totalEquityUsd.toFixed(2)} USD\nHoldings of ${baseAsset}: ${heldBase}\nHoldings of USDT: ${heldUsdt}`
    : "Account data unavailable.";
  const prompt = `你是一位精簡的加密貨幣市場分析師。使用者正在 OKX 現貨看 ${instId}。

Instrument: ${instId} (OKX spot)

Current ticker:
- Last price: ${ticker.last}
- 24h change: ${ticker.changePct24h.toFixed(2)}%
- 24h high: ${ticker.high24h}
- 24h low: ${ticker.low24h}

Recent 1H candles (oldest -> newest, last 48):
${candleLines}

Portfolio context:
${portfolioCtx}

請用繁體中文撰寫一段精簡的 markdown 分析(400 字以內),不要前言,包含以下小節:
- **趨勢**:從 K 線判讀短期方向與動能。
- **關鍵價位**:資料中浮現的鄰近支撐與壓力。
- **波動與成交量**:值得注意的觀察。
- **建議**:非強制性、明確帶保留口吻的看法。提到使用者目前的 ${baseAsset} 或 USDT 餘額可如何影響倉位大小。

最後加一行免責聲明,說明這不是投資建議。數字直接寫,不要使用 emoji。`;
  return { prompt };
}

router.post("/okx/ai/analyze", async (req, res): Promise<void> => {
  const parsed = AnalyzeMarketBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { instId } = parsed.data;
  try {
    const [ticker, candles, balance] = await Promise.all([
      fetchTicker(instId),
      fetchCandles(instId),
      fetchAccountBalance().catch(() => null),
    ]);
    const { prompt } = buildLegacyAnalysisPrompt(instId, ticker, candles, balance);
    const message = await getAnthropic().messages.create({
      model: ANTHROPIC_MODEL,
      max_tokens: 8192,
      messages: [{ role: "user", content: prompt }],
    });
    const block = message.content[0];
    const analysis = block && block.type === "text" ? block.text : "";
    if (!analysis) throw new Error("Empty response from AI");
    res.json(
      AnalyzeMarketResponse.parse({
        instId,
        analysis,
        generatedAt: new Date().toISOString(),
        model: ANTHROPIC_MODEL,
      }),
    );
  } catch (err) {
    req.log.error({ err }, "ai analyze failed");
    if (err instanceof OkxError) {
      res.status(err.status).json({ error: err.message, code: err.code });
      return;
    }
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

async function runAndPersist(args: {
  instId: string;
  mode: "spot" | "perp";
  maxMarginUsdt?: number;
  maxLeverage?: number;
  triggeredBy: "user" | "auto";
}) {
  const result = await runResearchPipeline({
    instId: args.instId,
    mode: args.mode,
    maxMarginUsdt: args.maxMarginUsdt,
    maxLeverage: args.maxLeverage,
  });
  const consensus = computeConsensus(result.recommendations);
  // Fire-and-forget DB persistence; never block response
  recordDecision({
    instId: args.instId,
    mode: args.mode,
    lastPrice: result.lastPrice,
    technicalSummary: result.technicalSummary,
    sentimentSummary: result.sentimentSummary,
    recommendations: result.recommendations,
    consensusAction: consensus.action,
    consensusConfidence: Math.round(consensus.avgConfidence),
    triggeredBy: args.triggeredBy,
  }).catch(() => {});
  return result;
}

router.post("/okx/ai/research", async (req, res): Promise<void> => {
  const parsed = RunResearchPipelineBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { instId } = parsed.data;
  const mode = parsed.data.mode === "perp" ? "perp" : "spot";
  try {
    const result = await runAndPersist({
      instId,
      mode,
      maxMarginUsdt: parsed.data.marginUsdt ?? undefined,
      maxLeverage: parsed.data.maxLeverage ?? undefined,
      triggeredBy: "user",
    });
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "ai research failed");
    if (err instanceof OkxError) {
      res.status(err.status).json({ error: err.message, code: err.code });
      return;
    }
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Backward-compat: same shape as old /recommend, just powered by the pipeline.
router.post("/okx/ai/recommend", async (req, res): Promise<void> => {
  const parsed = RecommendTradeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { instId } = parsed.data;
  const mode = parsed.data.mode === "perp" ? "perp" : "spot";
  try {
    const result = await runAndPersist({
      instId,
      mode,
      maxMarginUsdt: parsed.data.marginUsdt ?? undefined,
      maxLeverage: parsed.data.maxLeverage ?? undefined,
      triggeredBy: "user",
    });
    res.json(
      RecommendTradeResponse.parse({
        instId: result.instId,
        generatedAt: result.generatedAt,
        lastPrice: result.lastPrice,
        recommendations: result.recommendations,
      }),
    );
  } catch (err) {
    req.log.error({ err }, "ai recommend failed");
    if (err instanceof OkxError) {
      res.status(err.status).json({ error: err.message, code: err.code });
      return;
    }
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
