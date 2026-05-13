import { Router, type IRouter } from "express";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { GoogleGenAI } from "@google/genai";
import {
  AnalyzeMarketBody,
  AnalyzeMarketResponse,
  RecommendTradeBody,
  RecommendTradeResponse,
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

const router: IRouter = Router();

const ANTHROPIC_MODEL = "claude-sonnet-4-6";
const OPENAI_MODEL = "gpt-5.4";
const GEMINI_MODEL = "gemini-2.5-pro";
const OPENROUTER_MODEL = "deepseek/deepseek-v4-pro";

let anthropicClient: Anthropic | null = null;
function getAnthropic(): Anthropic {
  if (anthropicClient) return anthropicClient;
  const baseURL = process.env["AI_INTEGRATIONS_ANTHROPIC_BASE_URL"];
  const apiKey = process.env["AI_INTEGRATIONS_ANTHROPIC_API_KEY"];
  if (!baseURL || !apiKey) throw new Error("Anthropic AI integration not configured");
  anthropicClient = new Anthropic({ baseURL, apiKey });
  return anthropicClient;
}

let openaiClient: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (openaiClient) return openaiClient;
  const baseURL = process.env["AI_INTEGRATIONS_OPENAI_BASE_URL"];
  const apiKey = process.env["AI_INTEGRATIONS_OPENAI_API_KEY"];
  if (!baseURL || !apiKey) throw new Error("OpenAI AI integration not configured");
  openaiClient = new OpenAI({ baseURL, apiKey });
  return openaiClient;
}

let openrouterClient: OpenAI | null = null;
function getOpenRouter(): OpenAI {
  if (openrouterClient) return openrouterClient;
  const baseURL = process.env["AI_INTEGRATIONS_OPENROUTER_BASE_URL"];
  const apiKey = process.env["AI_INTEGRATIONS_OPENROUTER_API_KEY"];
  if (!baseURL || !apiKey) throw new Error("OpenRouter AI integration not configured");
  openrouterClient = new OpenAI({ baseURL, apiKey });
  return openrouterClient;
}

let geminiClient: GoogleGenAI | null = null;
function getGemini(): GoogleGenAI {
  if (geminiClient) return geminiClient;
  const baseURL = process.env["AI_INTEGRATIONS_GEMINI_BASE_URL"];
  const apiKey = process.env["AI_INTEGRATIONS_GEMINI_API_KEY"];
  if (!baseURL || !apiKey) throw new Error("Gemini AI integration not configured");
  geminiClient = new GoogleGenAI({
    apiKey,
    httpOptions: { apiVersion: "", baseUrl: baseURL },
  });
  return geminiClient;
}

function buildMarketContext(
  instId: string,
  ticker: TickerData,
  candles: CandleData[],
  balance: AccountBalanceData | null,
): { context: string; baseAsset: string; heldBaseAvail: number; heldUsdtAvail: number } {
  const recent = candles.slice(-48);
  const candleLines = recent
    .map(
      (c) =>
        `${c.ts.slice(5, 16).replace("T", " ")}  O:${c.open}  H:${c.high}  L:${c.low}  C:${c.close}  V:${c.volume.toFixed(2)}`,
    )
    .join("\n");

  const baseAsset = instId.split("-")[0] ?? instId;
  const heldBase = balance?.assets.find((a) => a.ccy === baseAsset);
  const heldUsdt = balance?.assets.find((a) => a.ccy === "USDT");
  const heldBaseAvail = heldBase?.available ?? 0;
  const heldUsdtAvail = heldUsdt?.available ?? 0;

  const portfolioCtx = balance
    ? `Account total equity: $${balance.totalEquityUsd.toFixed(2)} USD\n` +
      `Holdings of ${baseAsset}: ${heldBaseAvail}\n` +
      `Holdings of USDT: ${heldUsdtAvail}`
    : "Account data unavailable.";

  const context = `Instrument: ${instId} (OKX spot)

Current ticker:
- Last price: ${ticker.last}
- 24h change: ${ticker.changePct24h.toFixed(2)}%
- 24h high: ${ticker.high24h}
- 24h low: ${ticker.low24h}
- 24h volume: ${ticker.vol24h}

Recent 1H candles (oldest -> newest, last 48):
${candleLines}

Portfolio context:
${portfolioCtx}`;

  return { context, baseAsset, heldBaseAvail, heldUsdtAvail };
}

function buildAnalysisPrompt(ctx: string, instId: string, baseAsset: string): string {
  return `You are a concise crypto market analyst. The user is looking at ${instId} on OKX spot.

${ctx}

Write a short markdown analysis (under 250 words) with these sections, no preamble:
- **Trend**: short-term direction and momentum read from the candles.
- **Key levels**: nearby support and resistance suggested by the data.
- **Volatility & volume**: notable observations.
- **Suggestion**: a non-binding, clearly-hedged view (e.g. "lean bullish, scale in", "wait for break", "no clear edge"). Mention how the user's existing ${baseAsset} or USDT balance might inform sizing.

End with a one-line disclaimer that this is not financial advice. Use plain numbers, no emojis.`;
}

function buildRecommendPrompt(
  ctx: string,
  instId: string,
  baseAsset: string,
  heldBase: number,
  heldUsdt: number,
  lastPrice: number,
): string {
  const maxBuy = Math.min(heldUsdt, 1000);
  const maxSellUsdt = heldBase * lastPrice;
  return `You are a disciplined short-term crypto trader looking at ${instId} on OKX spot.

${ctx}

Decide on ONE concrete action for the next few hours: buy, sell, or hold.

Constraints:
- This is a SPOT account, no leverage, no shorting. A "sell" only makes sense if the user already holds ${baseAsset} (currently ${heldBase}).
- For a buy, sizeUsdt must be > 0 and <= ${maxBuy.toFixed(2)} (capped to available USDT, max $1000 per call).
- For a sell, sizeUsdt is the USDT-equivalent of how much ${baseAsset} to sell, must be > 0 and <= ${maxSellUsdt.toFixed(2)}.
- For a hold, set sizeUsdt to null and stopLossPrice to null.
- A stopLossPrice only applies to buys. For sells or holds set stopLossPrice to null. If you do set one, it must be strictly below the current last price (${lastPrice}).
- confidence is an integer 1-10 expressing how sure you are.
- reasoning: 2-4 sentences, plain text, no markdown.

Respond with ONLY a single JSON object, no prose, no markdown fences, matching exactly this schema:
{
  "action": "buy" | "sell" | "hold",
  "sizeUsdt": number | null,
  "stopLossPrice": number | null,
  "confidence": integer (1-10),
  "reasoning": string
}`;
}

type RawDecision = {
  action?: unknown;
  sizeUsdt?: unknown;
  stopLossPrice?: unknown;
  confidence?: unknown;
  reasoning?: unknown;
};

function parseDecision(raw: string): RawDecision {
  const trimmed = raw.trim();
  // Strip ```json fences if present
  const fenceStripped = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  // Try direct parse first, then fall back to first { ... } block
  try {
    return JSON.parse(fenceStripped) as RawDecision;
  } catch {
    const start = fenceStripped.indexOf("{");
    const end = fenceStripped.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) {
      throw new Error("Model did not return JSON");
    }
    return JSON.parse(fenceStripped.slice(start, end + 1)) as RawDecision;
  }
}

function normalizeDecision(
  d: RawDecision,
  caps: { lastPrice: number; heldBase: number; heldUsdt: number; maxBuyUsdt: number },
): {
  action: "buy" | "sell" | "hold";
  sizeUsdt: number | null;
  stopLossPrice: number | null;
  confidence: number | null;
  reasoning: string;
} {
  const actionRaw = String(d.action ?? "").toLowerCase();
  let action: "buy" | "sell" | "hold" =
    actionRaw === "buy" || actionRaw === "sell" || actionRaw === "hold" ? actionRaw : "hold";

  // Can't sell if no base holdings -> downgrade to hold
  if (action === "sell" && caps.heldBase <= 0) action = "hold";
  // Can't buy if no USDT -> downgrade to hold
  if (action === "buy" && caps.heldUsdt <= 0) action = "hold";

  let sizeUsdt: number | null = null;
  if (action === "buy" && typeof d.sizeUsdt === "number" && d.sizeUsdt > 0) {
    sizeUsdt = Math.min(d.sizeUsdt, caps.maxBuyUsdt);
  } else if (action === "sell" && typeof d.sizeUsdt === "number" && d.sizeUsdt > 0) {
    const maxSellUsdt = caps.heldBase * caps.lastPrice;
    sizeUsdt = Math.min(d.sizeUsdt, maxSellUsdt);
  }
  if (sizeUsdt != null && sizeUsdt <= 0) {
    sizeUsdt = null;
    action = "hold";
  }

  // Stop-loss only valid for buys, must be strictly below current price
  let stopLossPrice: number | null = null;
  if (
    action === "buy" &&
    typeof d.stopLossPrice === "number" &&
    d.stopLossPrice > 0 &&
    d.stopLossPrice < caps.lastPrice
  ) {
    stopLossPrice = d.stopLossPrice;
  }

  const confRaw = typeof d.confidence === "number" ? Math.round(d.confidence) : null;
  const confidence = confRaw == null ? null : Math.max(1, Math.min(10, confRaw));

  const reasoning = typeof d.reasoning === "string" ? d.reasoning.trim() : "";

  return { action, sizeUsdt, stopLossPrice, confidence, reasoning };
}

type ProviderRunner = (prompt: string) => Promise<string>;

const PROVIDERS: ReadonlyArray<{
  id: string;
  label: string;
  model: string;
  run: ProviderRunner;
}> = [
  {
    id: "anthropic",
    label: "Claude Sonnet 4.6",
    model: ANTHROPIC_MODEL,
    run: async (prompt) => {
      const msg = await getAnthropic().messages.create({
        model: ANTHROPIC_MODEL,
        max_tokens: 2048,
        messages: [{ role: "user", content: prompt }],
      });
      const block = msg.content[0];
      return block && block.type === "text" ? block.text : "";
    },
  },
  {
    id: "openai",
    label: "OpenAI GPT-5.4",
    model: OPENAI_MODEL,
    run: async (prompt) => {
      const res = await getOpenAI().chat.completions.create({
        model: OPENAI_MODEL,
        max_completion_tokens: 8192,
        response_format: { type: "json_object" },
        messages: [{ role: "user", content: prompt }],
      });
      return res.choices[0]?.message?.content ?? "";
    },
  },
  {
    id: "gemini",
    label: "Gemini 2.5 Pro",
    model: GEMINI_MODEL,
    run: async (prompt) => {
      const res = await getGemini().models.generateContent({
        model: GEMINI_MODEL,
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: { responseMimeType: "application/json", maxOutputTokens: 8192 },
      });
      return res.text ?? "";
    },
  },
  {
    id: "openrouter",
    label: "DeepSeek V4 Pro",
    model: OPENROUTER_MODEL,
    run: async (prompt) => {
      const res = await getOpenRouter().chat.completions.create({
        model: OPENROUTER_MODEL,
        max_tokens: 8192,
        response_format: { type: "json_object" },
        messages: [{ role: "user", content: prompt }],
      });
      return res.choices[0]?.message?.content ?? "";
    },
  },
];

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

    const { context, baseAsset } = buildMarketContext(instId, ticker, candles, balance);
    const prompt = buildAnalysisPrompt(context, instId, baseAsset);

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
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

router.post("/okx/ai/recommend", async (req, res): Promise<void> => {
  const parsed = RecommendTradeBody.safeParse(req.body);
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

    const { context, baseAsset, heldBaseAvail, heldUsdtAvail } = buildMarketContext(
      instId,
      ticker,
      candles,
      balance,
    );
    const prompt = buildRecommendPrompt(
      context,
      instId,
      baseAsset,
      heldBaseAvail,
      heldUsdtAvail,
      ticker.last,
    );

    const recommendations = await Promise.all(
      PROVIDERS.map(async (p) => {
        const startedAt = Date.now();
        try {
          const raw = await p.run(prompt);
          if (!raw.trim()) throw new Error("Empty response");
          const decision = normalizeDecision(parseDecision(raw), {
            lastPrice: ticker.last,
            heldBase: heldBaseAvail,
            heldUsdt: heldUsdtAvail,
            maxBuyUsdt: Math.min(heldUsdtAvail, 1000),
          });
          return {
            providerId: p.id,
            providerLabel: p.label,
            model: p.model,
            latencyMs: Date.now() - startedAt,
            ok: true as const,
            error: null,
            ...decision,
          };
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          req.log.warn({ provider: p.id, err: msg }, "ai recommend provider failed");
          return {
            providerId: p.id,
            providerLabel: p.label,
            model: p.model,
            latencyMs: Date.now() - startedAt,
            ok: false as const,
            error: msg,
            action: null,
            sizeUsdt: null,
            stopLossPrice: null,
            confidence: null,
            reasoning: null,
          };
        }
      }),
    );

    res.json(
      RecommendTradeResponse.parse({
        instId,
        generatedAt: new Date().toISOString(),
        lastPrice: ticker.last,
        recommendations,
      }),
    );
  } catch (err) {
    req.log.error({ err }, "ai recommend failed");
    if (err instanceof OkxError) {
      res.status(err.status).json({ error: err.message, code: err.code });
      return;
    }
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

export default router;
