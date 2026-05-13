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
  fetchPerpInstrument,
  fetchPerpPositions,
  OkxError,
  type TickerData,
  type CandleData,
  type AccountBalanceData,
  type PerpPositionData,
  type PerpInstrumentMeta,
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

function buildPerpContext(
  instId: string,
  ticker: TickerData,
  candles: CandleData[],
  meta: PerpInstrumentMeta,
  position: PerpPositionData | null,
  heldUsdt: number,
): string {
  const recent = candles.slice(-48);
  const candleLines = recent
    .map(
      (c) =>
        `${c.ts.slice(5, 16).replace("T", " ")}  O:${c.open}  H:${c.high}  L:${c.low}  C:${c.close}  V:${c.volume.toFixed(2)}`,
    )
    .join("\n");

  const posCtx = position
    ? `現有倉位:${position.posSide === "short" || position.contracts < 0 ? "Short" : "Long"} ${Math.abs(position.contracts)} 張(約 ${Math.abs(position.baseQty).toFixed(4)} ${meta.baseCcy}),均價 ${position.avgEntryPx},${position.leverage}x ${position.marginMode},未實現損益 ${position.unrealizedPnlUsd.toFixed(2)} USDT (${position.unrealizedPnlPct.toFixed(2)}%)`
    : "目前無倉位。";

  return `合約:${instId} (OKX USDT 本位永續, 最高槓桿 ${meta.maxLeverage}x, 每張 ${meta.ctVal} ${meta.baseCcy}, 最小 ${meta.minSz} 張, 跳動價 ${meta.tickSz})

當前行情:
- 最新價:${ticker.last}
- 24h 漲跌:${ticker.changePct24h.toFixed(2)}%
- 24h 高/低:${ticker.high24h} / ${ticker.low24h}
- 24h 成交量(張):${ticker.vol24h}

近 48 根 1H K 線(舊 -> 新):
${candleLines}

帳戶狀況:
- 可用 USDT 保證金:${heldUsdt}
- ${posCtx}`;
}

function buildPerpRecommendPrompt(
  ctx: string,
  instId: string,
  baseCcy: string,
  heldUsdt: number,
  lastPrice: number,
  hasPosition: boolean,
  posSide: "long" | "short" | null,
  maxMarginUsdt: number,
  maxLeverage: number,
): string {
  const closeNote = hasPosition
    ? `若認為應該停利/停損平倉,action 用 "close",其它金額/槓桿/止盈止損都填 null。`
    : `目前無倉位,不要回 "close"。`;
  return `你是一位有紀律的合約短線交易員,在 OKX 永續合約 (${instId}) 上做決策。

${ctx}

請針對接下來幾小時決定一個具體動作:long(做多)、short(做空)、close(平倉)、或 hold(觀望)。

限制:
- ${closeNote}
- 開新倉時 marginUsdt 必須 > 0 且 <= ${maxMarginUsdt.toFixed(2)} USDT(受限於可用保證金與 200 USDT 上限)。
- leverage 必須是 1 到 ${maxLeverage} 之間的整數,槓桿越高風險越大。
- 名目部位 = marginUsdt × leverage。建議搭配止盈/止損控管風險。
- takeProfitPrice 與 stopLossPrice 為觸發價:做多時 TP 必須 > 最新價 (${lastPrice})、SL 必須 < 最新價;做空相反。不需要設可填 null。
- ${hasPosition ? `已有 ${posSide} 倉位,如果想加倉請用同方向動作;如果方向相反請先 close 再開新倉(本次 prompt 只能回一個動作,先選最重要的)。` : ""}
- confidence:1-10 整數。
- reasoning:用繁體中文 2-4 句解釋,純文字無 markdown。

只回傳一個 JSON 物件,結構嚴格符合(不需要的欄位請填 null,不要省略):
{
  "action": "long" | "short" | "close" | "hold",
  "marginUsdt": number | null,
  "leverage": integer | null,
  "takeProfitPrice": number | null,
  "stopLossPrice": number | null,
  "confidence": integer,
  "reasoning": string
}`;
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
  marginUsdt?: unknown;
  leverage?: unknown;
  takeProfitPrice?: unknown;
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

function normalizePerpDecision(
  d: RawDecision,
  caps: {
    lastPrice: number;
    heldUsdt: number;
    maxMarginUsdt: number;
    maxLeverage: number;
    hasPosition: boolean;
    posSide: "long" | "short" | null;
  },
): {
  action: "long" | "short" | "close" | "hold";
  marginUsdt: number | null;
  leverage: number | null;
  takeProfitPrice: number | null;
  stopLossPrice: number | null;
  sizeUsdt: number | null;
  confidence: number | null;
  reasoning: string;
} {
  const actionRaw = String(d.action ?? "").toLowerCase();
  let action: "long" | "short" | "close" | "hold" =
    actionRaw === "long" || actionRaw === "short" || actionRaw === "close" || actionRaw === "hold"
      ? actionRaw
      : "hold";

  // Can't close if no position
  if (action === "close" && !caps.hasPosition) action = "hold";
  // Can't open if no margin
  if ((action === "long" || action === "short") && caps.heldUsdt <= 0) action = "hold";

  let marginUsdt: number | null = null;
  let leverage: number | null = null;
  let takeProfitPrice: number | null = null;
  let stopLossPrice: number | null = null;

  if (action === "long" || action === "short") {
    if (typeof d.marginUsdt === "number" && d.marginUsdt > 0) {
      marginUsdt = Math.min(d.marginUsdt, caps.maxMarginUsdt);
    }
    if (typeof d.leverage === "number" && d.leverage >= 1) {
      leverage = Math.max(1, Math.min(caps.maxLeverage, Math.round(d.leverage)));
    }
    if (!marginUsdt || !leverage) {
      action = "hold";
      marginUsdt = null;
      leverage = null;
    } else {
      // TP/SL: must be on correct side of price
      if (typeof d.takeProfitPrice === "number" && d.takeProfitPrice > 0) {
        if (action === "long" && d.takeProfitPrice > caps.lastPrice) takeProfitPrice = d.takeProfitPrice;
        if (action === "short" && d.takeProfitPrice < caps.lastPrice) takeProfitPrice = d.takeProfitPrice;
      }
      if (typeof d.stopLossPrice === "number" && d.stopLossPrice > 0) {
        if (action === "long" && d.stopLossPrice < caps.lastPrice) stopLossPrice = d.stopLossPrice;
        if (action === "short" && d.stopLossPrice > caps.lastPrice) stopLossPrice = d.stopLossPrice;
      }
    }
  }

  const confRaw = typeof d.confidence === "number" ? Math.round(d.confidence) : null;
  const confidence = confRaw == null ? null : Math.max(1, Math.min(10, confRaw));
  const reasoning = typeof d.reasoning === "string" ? d.reasoning.trim() : "";

  return {
    action,
    marginUsdt,
    leverage,
    takeProfitPrice,
    stopLossPrice,
    sizeUsdt: null,
    confidence,
    reasoning,
  };
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
  const mode = parsed.data.mode === "perp" ? "perp" : "spot";
  const userMaxMargin =
    typeof parsed.data.marginUsdt === "number" && parsed.data.marginUsdt > 0
      ? parsed.data.marginUsdt
      : 200;
  const userMaxLev =
    typeof parsed.data.maxLeverage === "number" && parsed.data.maxLeverage > 0
      ? parsed.data.maxLeverage
      : 20;

  try {
    if (mode === "perp") {
      const [ticker, candles, balance, meta, positions] = await Promise.all([
        fetchTicker(instId),
        fetchCandles(instId),
        fetchAccountBalance().catch(() => null),
        fetchPerpInstrument(instId),
        fetchPerpPositions().catch(() => [] as PerpPositionData[]),
      ]);
      const heldUsdt = balance?.assets.find((a) => a.ccy === "USDT")?.available ?? 0;
      const position = positions.find((p) => p.instId === instId) ?? null;
      const posSide: "long" | "short" | null = position
        ? position.posSide === "short" || position.contracts < 0
          ? "short"
          : "long"
        : null;
      const maxLeverage = Math.min(userMaxLev, meta.maxLeverage);
      const maxMarginUsdt = Math.min(userMaxMargin, heldUsdt > 0 ? heldUsdt : userMaxMargin);
      const ctx = buildPerpContext(instId, ticker, candles, meta, position, heldUsdt);
      const prompt = buildPerpRecommendPrompt(
        ctx,
        instId,
        meta.baseCcy,
        heldUsdt,
        ticker.last,
        !!position,
        posSide,
        maxMarginUsdt,
        maxLeverage,
      );

      const recommendations = await Promise.all(
        PROVIDERS.map(async (p) => {
          const startedAt = Date.now();
          try {
            const raw = await p.run(prompt);
            if (!raw.trim()) throw new Error("Empty response");
            const decision = normalizePerpDecision(parseDecision(raw), {
              lastPrice: ticker.last,
              heldUsdt,
              maxMarginUsdt,
              maxLeverage,
              hasPosition: !!position,
              posSide,
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
            req.log.warn({ provider: p.id, err: msg }, "ai perp recommend provider failed");
            return {
              providerId: p.id,
              providerLabel: p.label,
              model: p.model,
              latencyMs: Date.now() - startedAt,
              ok: false as const,
              error: msg,
              action: null,
              sizeUsdt: null,
              marginUsdt: null,
              leverage: null,
              takeProfitPrice: null,
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
      return;
    }

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
