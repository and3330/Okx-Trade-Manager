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
  return `你是一位精簡的加密貨幣市場分析師。使用者正在 OKX 現貨看 ${instId}。

${ctx}

請用繁體中文撰寫一段精簡的 markdown 分析(400 字以內),不要前言,包含以下小節:
- **趨勢**:從 K 線判讀短期方向與動能。
- **關鍵價位**:資料中浮現的鄰近支撐與壓力。
- **波動與成交量**:值得注意的觀察。
- **建議**:非強制性、明確帶保留口吻的看法(例如「偏多,可分批進場」「等突破再進」「方向不明,觀望」)。提到使用者目前的 ${baseAsset} 或 USDT 餘額可如何影響倉位大小。

最後加一行免責聲明,說明這不是投資建議。數字直接寫,不要使用 emoji。`;
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
  return `你是一位有紀律的短線加密貨幣交易員,正在 OKX 現貨看 ${instId}。

${ctx}

請針對接下來幾小時決定一個具體動作:buy(買入)、sell(賣出)、或 hold(觀望)。

限制:
- 這是現貨帳戶,沒有槓桿、不能做空。"sell" 只在使用者已經持有 ${baseAsset} 時(目前 ${heldBase})才合理。
- 若是 buy,sizeUsdt 必須 > 0 且 <= ${maxBuy.toFixed(2)}(受限於可用 USDT,單次最多 $1000)。
- 若是 sell,sizeUsdt 是要賣掉 ${baseAsset} 換算成 USDT 的金額,必須 > 0 且 <= ${maxSellUsdt.toFixed(2)}。
- 若是 hold,sizeUsdt 與 stopLossPrice 都設為 null。
- stopLossPrice 只適用於 buy。sell 或 hold 時設為 null。若有設定,必須嚴格低於目前最新價 (${lastPrice})。
- confidence 是 1-10 的整數,代表你的把握程度。
- reasoning 請用「繁體中文」,2-4 句話,純文字,不要 markdown。

只回傳一個 JSON 物件,不要附加任何說明文字、不要 markdown code fence,結構必須完全符合:
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
