import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { GoogleGenAI } from "@google/genai";
import {
  fetchTicker,
  fetchCandles,
  fetchAccountBalance,
  fetchPerpInstrument,
  fetchPerpPositions,
  fetchStandardMultiTimeframeIndicators,
  fetchMarketContextBundle,
  summarizeIndicators,
  summarizeMarketContext,
  fetchAtr,
  fetchAllPerpTickers,
  type TickerData,
  type CandleData,
  type AccountBalanceData,
  type PerpPositionData,
  type PerpInstrumentMeta,
  type MarketContextBundle,
  type MultiTimeframeIndicators,
} from "./okx";
import { logger } from "./logger";

export const ANTHROPIC_MODEL = "claude-sonnet-4-6";
export const OPENAI_MODEL = "gpt-5.4";
export const GEMINI_MODEL = "gemini-2.5-pro";
export const OPENROUTER_MODEL = "deepseek/deepseek-v4-pro";

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
  geminiClient = new GoogleGenAI({ apiKey, httpOptions: { apiVersion: "", baseUrl: baseURL } });
  return geminiClient;
}

type ProviderRunner = (prompt: string, jsonMode: boolean) => Promise<string>;

export type Provider = {
  id: string;
  label: string;
  model: string;
  run: ProviderRunner;
};

export const PROVIDERS: ReadonlyArray<Provider> = [
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
    run: async (prompt, jsonMode) => {
      const res = await getOpenAI().chat.completions.create({
        model: OPENAI_MODEL,
        max_completion_tokens: 8192,
        ...(jsonMode ? { response_format: { type: "json_object" as const } } : {}),
        messages: [{ role: "user", content: prompt }],
      });
      return res.choices[0]?.message?.content ?? "";
    },
  },
  {
    id: "gemini",
    label: "Gemini 2.5 Pro",
    model: GEMINI_MODEL,
    run: async (prompt, jsonMode) => {
      const res = await getGemini().models.generateContent({
        model: GEMINI_MODEL,
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: jsonMode
          ? { responseMimeType: "application/json", maxOutputTokens: 8192 }
          : { maxOutputTokens: 4096 },
      });
      return res.text ?? "";
    },
  },
  {
    id: "openrouter",
    label: "DeepSeek V4 Pro",
    model: OPENROUTER_MODEL,
    run: async (prompt, jsonMode) => {
      const res = await getOpenRouter().chat.completions.create({
        model: OPENROUTER_MODEL,
        max_tokens: 8192,
        ...(jsonMode ? { response_format: { type: "json_object" as const } } : {}),
        messages: [{ role: "user", content: prompt }],
      });
      return res.choices[0]?.message?.content ?? "";
    },
  },
];

export type RawDecision = {
  action?: unknown;
  sizeUsdt?: unknown;
  marginUsdt?: unknown;
  leverage?: unknown;
  takeProfitPrice?: unknown;
  stopLossPrice?: unknown;
  confidence?: unknown;
  reasoning?: unknown;
};

export function parseDecision(raw: string): RawDecision {
  const trimmed = raw.trim();
  const fenceStripped = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
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

export type NormalizedSpotDecision = {
  action: "buy" | "sell" | "hold";
  sizeUsdt: number | null;
  stopLossPrice: number | null;
  confidence: number | null;
  reasoning: string;
};
export type NormalizedPerpDecision = {
  action: "long" | "short" | "close" | "hold";
  marginUsdt: number | null;
  leverage: number | null;
  takeProfitPrice: number | null;
  stopLossPrice: number | null;
  sizeUsdt: null;
  confidence: number | null;
  reasoning: string;
};

export function normalizeSpotDecision(
  d: RawDecision,
  caps: { lastPrice: number; heldBase: number; heldUsdt: number; maxBuyUsdt: number },
): NormalizedSpotDecision {
  const actionRaw = String(d.action ?? "").toLowerCase();
  let action: "buy" | "sell" | "hold" =
    actionRaw === "buy" || actionRaw === "sell" || actionRaw === "hold" ? actionRaw : "hold";
  if (action === "sell" && caps.heldBase <= 0) action = "hold";
  if (action === "buy" && caps.heldUsdt <= 0) action = "hold";
  let sizeUsdt: number | null = null;
  if (action === "buy" && typeof d.sizeUsdt === "number" && d.sizeUsdt > 0) {
    sizeUsdt = Math.min(d.sizeUsdt, caps.maxBuyUsdt);
  } else if (action === "sell" && typeof d.sizeUsdt === "number" && d.sizeUsdt > 0) {
    sizeUsdt = Math.min(d.sizeUsdt, caps.heldBase * caps.lastPrice);
  }
  if (sizeUsdt != null && sizeUsdt <= 0) { sizeUsdt = null; action = "hold"; }
  let stopLossPrice: number | null = null;
  if (action === "buy" && typeof d.stopLossPrice === "number" && d.stopLossPrice > 0 && d.stopLossPrice < caps.lastPrice) {
    stopLossPrice = d.stopLossPrice;
  }
  const confRaw = typeof d.confidence === "number" ? Math.round(d.confidence) : null;
  const confidence = confRaw == null ? null : Math.max(1, Math.min(10, confRaw));
  const reasoning = typeof d.reasoning === "string" ? d.reasoning.trim() : "";
  return { action, sizeUsdt, stopLossPrice, confidence, reasoning };
}

export function normalizePerpDecision(
  d: RawDecision,
  caps: {
    lastPrice: number;
    heldUsdt: number;
    maxMarginUsdt: number;
    maxLeverage: number;
    hasPosition: boolean;
  },
): NormalizedPerpDecision {
  const actionRaw = String(d.action ?? "").toLowerCase();
  let action: "long" | "short" | "close" | "hold" =
    actionRaw === "long" || actionRaw === "short" || actionRaw === "close" || actionRaw === "hold"
      ? actionRaw : "hold";
  if (action === "close" && !caps.hasPosition) action = "hold";
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
    if (!marginUsdt || !leverage) { action = "hold"; marginUsdt = null; leverage = null; }
    else {
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
  return { action, marginUsdt, leverage, takeProfitPrice, stopLossPrice, sizeUsdt: null, confidence, reasoning };
}

// ---------- Stage 0: Market scanner ----------

export type ScannerResult = {
  picks: string[];
  candidatesConsidered: number;
  rawResponse: string | null;
  error: string | null;
};

export async function runMarketScanner(opts: {
  pickCount: number;
  minVolUsd24h: number;
  exclude: string[];
}): Promise<ScannerResult> {
  const { pickCount, minVolUsd24h, exclude } = opts;
  const target = Math.max(1, Math.min(10, pickCount));
  const excludeSet = new Set(exclude);
  let universe: Awaited<ReturnType<typeof fetchAllPerpTickers>>;
  try {
    universe = await fetchAllPerpTickers();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { picks: [], candidatesConsidered: 0, rawResponse: null, error: `fetch_universe_failed: ${msg}` };
  }
  const candidates = universe
    .filter((t) => t.volUsd24h >= minVolUsd24h && !excludeSet.has(t.instId))
    .sort((a, b) => b.volUsd24h - a.volUsd24h)
    .slice(0, 80); // cap prompt size
  if (candidates.length === 0) {
    return { picks: [], candidatesConsidered: 0, rawResponse: null, error: "no_candidates" };
  }
  const tableLines = candidates.map((c) =>
    `${c.baseCcy.padEnd(8)} px=${c.last} 24h=${c.changePct24h.toFixed(2)}% volUsd=${(c.volUsd24h / 1_000_000).toFixed(1)}M`
  ).join("\n");
  const coreList = exclude.length > 0 ? exclude.map((s) => s.replace("-USDT-SWAP", "")).join(", ") : "(無)";
  const prompt = `你是一位永續合約市場掃描員。下方是 OKX 上 24h 成交額 >= ${(minVolUsd24h / 1_000_000).toFixed(0)}M USDT 的 USDT 永續合約清單(已按量排序),請從中挑出最值得進一步深入分析的 ${target} 個機會幣。

已經會固定分析的核心幣(請勿重複): ${coreList}

候選清單(共 ${candidates.length} 個):
${tableLines}

挑選原則(由強到弱):
1. 24h 漲跌出現異常動能(顯著放量配合方向性突破),不要只追漲幅
2. 有明確的多空訊號可以給技術分析師接著看,不要選盤整無方向的
3. 流動性夠(已過濾,但仍以高量者優先)
4. 多樣化,避免全選同類型(例如不要 4 個都是 meme)

只回 JSON,不要多餘文字,結構:
{"picks":["XXX-USDT-SWAP", ...],"reasoning":"一句話說明這批挑選的整體邏輯"}

picks 必須是 ${target} 個 instId 字串(必須出現在候選清單中,結尾必須是 -USDT-SWAP)。`;
  let raw: string;
  try {
    raw = await PROVIDERS[0]!.run(prompt, true);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { picks: [], candidatesConsidered: candidates.length, rawResponse: null, error: `claude_failed: ${msg}` };
  }
  let parsed: { picks?: unknown };
  try {
    parsed = parseDecision(raw) as { picks?: unknown };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { picks: [], candidatesConsidered: candidates.length, rawResponse: raw, error: `parse_failed: ${msg}` };
  }
  const validInstIds = new Set(candidates.map((c) => c.instId));
  const picks: string[] = [];
  if (Array.isArray(parsed.picks)) {
    for (const p of parsed.picks) {
      if (typeof p !== "string") continue;
      const id = p.trim();
      if (validInstIds.has(id) && !picks.includes(id)) picks.push(id);
      if (picks.length >= target) break;
    }
  }
  return { picks, candidatesConsidered: candidates.length, rawResponse: raw, error: picks.length === 0 ? "empty_picks" : null };
}

// ---------- Stage 1: Technical agent ----------

async function runTechnicalAgent(
  instId: string,
  ticker: TickerData,
  candles: CandleData[],
  indicatorText: string,
): Promise<string> {
  const last48 = candles.slice(-48);
  const candleLines = last48
    .map((c) => `${c.ts.slice(5, 16).replace("T", " ")} O:${c.open} H:${c.high} L:${c.low} C:${c.close}`)
    .join("\n");
  const prompt = `你是一位資深技術分析師,正在分析 ${instId}。最新價 ${ticker.last}, 24h 漲跌 ${ticker.changePct24h.toFixed(2)}%, 24h 高/低 ${ticker.high24h}/${ticker.low24h}。

多時框技術指標:
${indicatorText}

最近 48 根 1H K 線(舊->新):
${candleLines}

請用繁體中文寫一段精簡(250 字以內)的純技術觀點,只談技術面,不講基本面或情緒面。需含:
1. 多時框趨勢結論(15m/1H/4H/1D 是否共振)。
2. 重要動能訊號(RSI/MACD/StochRSI 背離或突破)。
3. 關鍵支撐壓力位(用 BB / EMA20 / Supertrend 數值)。
4. 短線方向判斷(看多/看空/盤整),用一句話定調。

直接給結論,不要前言、不要免責。`;
  try {
    const res = await PROVIDERS[0]!.run(prompt, false);
    return res.trim() || "(技術分析失敗,請稍後再試)";
  } catch (err) {
    logger.warn({ err }, "technical agent failed");
    return "(技術分析失敗)";
  }
}

// ---------- Stage 2: Sentiment / funding agent ----------

async function runSentimentAgent(
  instId: string,
  contextText: string,
  ticker: TickerData,
): Promise<string> {
  const prompt = `你是一位專注永續合約資金面與情緒面的分析師,正在看 ${instId} (最新價 ${ticker.last})。

資金面與情緒面數據:
${contextText}

請用繁體中文寫一段精簡(200 字以內)的情緒/資金面觀點,不要重複技術面。需含:
1. 資金費率對多空成本的影響(極端值是否暗示反轉)。
2. OI 與多空比的訊號。
3. 主動買賣比的方向性。
4. 風險警示(若有)。

直接給結論,不要前言、不要免責。`;
  try {
    const res = await PROVIDERS[2]!.run(prompt, false);
    return res.trim() || "(情緒分析失敗,請稍後再試)";
  } catch (err) {
    logger.warn({ err }, "sentiment agent failed");
    return "(情緒分析失敗)";
  }
}

// ---------- Stage 3 prompt builders ----------

function buildSpotDecisionPrompt(args: {
  instId: string;
  ticker: TickerData;
  baseAsset: string;
  heldBase: number;
  heldUsdt: number;
  technical: string;
  sentiment: string;
  maxBuyUsdt: number;
}): string {
  const { instId, ticker, baseAsset, heldBase, heldUsdt, technical, sentiment, maxBuyUsdt } = args;
  return `你是一位有紀律的短線加密貨幣交易員,基於以下分析師報告做最終決策。

標的: ${instId} (現貨, 最新價 ${ticker.last})

【技術分析師觀點】
${technical}

【情緒/資金面分析師觀點】
${sentiment}

【帳戶】
- USDT 可用: ${heldUsdt}
- ${baseAsset} 可用: ${heldBase}

請決定一個動作: buy / sell / hold。
限制:
- buy: sizeUsdt 必須 > 0 且 <= ${maxBuyUsdt.toFixed(2)}。
- sell: 只在持有 ${baseAsset} 時合理,sizeUsdt 是換算的 USDT。
- stopLossPrice 只適用 buy,且必須 < ${ticker.last}。
- confidence 1-10。
- reasoning 用繁體中文 2-4 句,明確說你採信技術面還是情緒面、為什麼。

只回 JSON,結構:
{"action":"buy"|"sell"|"hold","sizeUsdt":number|null,"stopLossPrice":number|null,"confidence":integer,"reasoning":string}`;
}

function buildPerpDecisionPrompt(args: {
  instId: string;
  ticker: TickerData;
  meta: PerpInstrumentMeta;
  position: PerpPositionData | null;
  heldUsdt: number;
  technical: string;
  sentiment: string;
  maxMarginUsdt: number;
  maxLeverage: number;
}): string {
  const { instId, ticker, meta, position, heldUsdt, technical, sentiment, maxMarginUsdt, maxLeverage } = args;
  const posCtx = position
    ? `現有 ${position.posSide === "short" || position.contracts < 0 ? "空" : "多"}倉 ${Math.abs(position.contracts)} 張, 均價 ${position.avgEntryPx}, 槓桿 ${position.leverage}x, 未實現 ${position.unrealizedPnlUsd.toFixed(2)} USDT (${position.unrealizedPnlPct.toFixed(2)}%)`
    : "目前無倉位";
  return `你是一位有紀律的合約交易員,基於以下分析師報告做最終決策。

標的: ${instId} (USDT 永續, 每張 ${meta.ctVal} ${meta.baseCcy}, 最小 ${meta.minSz} 張, 最高槓桿 ${meta.maxLeverage}x)
最新價: ${ticker.last}

【技術分析師觀點】
${technical}

【情緒/資金面分析師觀點】
${sentiment}

【帳戶】
- USDT 可用保證金: ${heldUsdt}
- ${posCtx}

請決定一個動作: long / short / close / hold。
限制:
- ${position ? `若想停利停損平倉用 close。同向加倉用 long/short。反向先 close。` : `無倉位不要回 close。`}
- 開倉: marginUsdt > 0 且 <= ${maxMarginUsdt.toFixed(2)}。leverage 1~${maxLeverage}。
- TP/SL 觸發價: 多單 TP > ${ticker.last}、SL < ${ticker.last};空單相反。可填 null。
- confidence 1-10。
- reasoning 繁體中文 2-4 句,明確說你採信技術還是情緒、為何。

只回 JSON:
{"action":"long"|"short"|"close"|"hold","marginUsdt":number|null,"leverage":integer|null,"takeProfitPrice":number|null,"stopLossPrice":number|null,"confidence":integer,"reasoning":string}`;
}

// ---------- Pipeline output types ----------

export type AiRecommendation = {
  providerId: string;
  providerLabel: string;
  model: string;
  latencyMs: number;
  ok: boolean;
  error: string | null;
  action: string | null;
  sizeUsdt: number | null;
  marginUsdt: number | null;
  leverage: number | null;
  takeProfitPrice: number | null;
  stopLossPrice: number | null;
  confidence: number | null;
  reasoning: string | null;
};

export type ResearchResult = {
  instId: string;
  mode: "spot" | "perp";
  generatedAt: string;
  lastPrice: number;
  technicalSummary: string | null;
  sentimentSummary: string | null;
  indicatorTextByBar: string | null;
  contextText: string | null;
  fundingRate: number | null;
  openInterestCcy: number | null;
  longShortRatio: number | null;
  takerBuyRatio: number | null;
  atr1H: number | null;
  recommendations: AiRecommendation[];
};

export type RunPipelineOptions = {
  instId: string;
  mode: "spot" | "perp";
  maxMarginUsdt?: number;
  maxLeverage?: number;
};

// ---------- Main pipeline ----------

export async function runResearchPipeline(opts: RunPipelineOptions): Promise<ResearchResult> {
  const { instId, mode } = opts;
  const userMaxMargin = opts.maxMarginUsdt && opts.maxMarginUsdt > 0 ? opts.maxMarginUsdt : 200;
  const userMaxLev = opts.maxLeverage && opts.maxLeverage > 0 ? opts.maxLeverage : 20;

  // Stage 0: parallel data fetch
  const [ticker, candles, balance, indicatorsByBar, contextBundle, atr] = await Promise.all([
    fetchTicker(instId),
    fetchCandles(instId),
    fetchAccountBalance().catch(() => null as AccountBalanceData | null),
    fetchStandardMultiTimeframeIndicators(instId).catch(() => ({} as MultiTimeframeIndicators)),
    mode === "perp"
      ? fetchMarketContextBundle(instId).catch(() => ({
          fundingRate: null, openInterest: null, longShortRatio: null, takerVolume: null,
        } as MarketContextBundle))
      : Promise.resolve({ fundingRate: null, openInterest: null, longShortRatio: null, takerVolume: null } as MarketContextBundle),
    fetchAtr(instId, "1H"),
  ]);

  const indicatorText = summarizeIndicators(indicatorsByBar);
  const contextText = summarizeMarketContext(contextBundle);

  // Stage 1 + 2 in parallel
  const [technicalSummary, sentimentSummary] = await Promise.all([
    runTechnicalAgent(instId, ticker, candles, indicatorText || "(無技術指標資料)"),
    mode === "perp" && contextText !== "(無情緒資料)"
      ? runSentimentAgent(instId, contextText, ticker)
      : Promise.resolve("(現貨模式不分析資金面)"),
  ]);

  // Stage 3: 4-model decision battle
  let prompt: string;
  let normalizer: (raw: RawDecision) => NormalizedSpotDecision | NormalizedPerpDecision;
  let perpExtras: { meta: PerpInstrumentMeta; position: PerpPositionData | null } | null = null;
  let heldUsdt = 0;
  let heldBase = 0;

  if (mode === "perp") {
    const [meta, positions] = await Promise.all([
      fetchPerpInstrument(instId),
      fetchPerpPositions().catch(() => [] as PerpPositionData[]),
    ]);
    heldUsdt = balance?.assets.find((a) => a.ccy === "USDT")?.available ?? 0;
    const position = positions.find((p) => p.instId === instId) ?? null;
    const maxLeverage = Math.min(userMaxLev, meta.maxLeverage);
    const maxMarginUsdt = Math.min(userMaxMargin, heldUsdt > 0 ? heldUsdt : userMaxMargin);
    perpExtras = { meta, position };
    prompt = buildPerpDecisionPrompt({
      instId, ticker, meta, position, heldUsdt,
      technical: technicalSummary, sentiment: sentimentSummary,
      maxMarginUsdt, maxLeverage,
    });
    normalizer = (raw) =>
      normalizePerpDecision(raw, {
        lastPrice: ticker.last, heldUsdt, maxMarginUsdt, maxLeverage, hasPosition: !!position,
      });
  } else {
    const baseAsset = instId.split("-")[0] ?? instId;
    heldBase = balance?.assets.find((a) => a.ccy === baseAsset)?.available ?? 0;
    heldUsdt = balance?.assets.find((a) => a.ccy === "USDT")?.available ?? 0;
    const maxBuyUsdt = Math.min(heldUsdt, 1000);
    prompt = buildSpotDecisionPrompt({
      instId, ticker, baseAsset, heldBase, heldUsdt,
      technical: technicalSummary, sentiment: sentimentSummary,
      maxBuyUsdt,
    });
    normalizer = (raw) =>
      normalizeSpotDecision(raw, { lastPrice: ticker.last, heldBase, heldUsdt, maxBuyUsdt });
  }

  const recommendations: AiRecommendation[] = await Promise.all(
    PROVIDERS.map(async (p): Promise<AiRecommendation> => {
      const startedAt = Date.now();
      try {
        const raw = await p.run(prompt, true);
        if (!raw.trim()) throw new Error("Empty response");
        const decision = normalizer(parseDecision(raw));
        const isSpot = "sizeUsdt" in decision && (decision as NormalizedSpotDecision).action !== "hold" && mode === "spot";
        return {
          providerId: p.id,
          providerLabel: p.label,
          model: p.model,
          latencyMs: Date.now() - startedAt,
          ok: true,
          error: null,
          action: decision.action,
          sizeUsdt: isSpot ? (decision as NormalizedSpotDecision).sizeUsdt : (mode === "spot" ? (decision as NormalizedSpotDecision).sizeUsdt : null),
          marginUsdt: mode === "perp" ? (decision as NormalizedPerpDecision).marginUsdt : null,
          leverage: mode === "perp" ? (decision as NormalizedPerpDecision).leverage : null,
          takeProfitPrice: mode === "perp" ? (decision as NormalizedPerpDecision).takeProfitPrice : null,
          stopLossPrice: decision.stopLossPrice ?? null,
          confidence: decision.confidence,
          reasoning: decision.reasoning || null,
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        logger.warn({ provider: p.id, err: msg }, "stage 3 provider failed");
        return {
          providerId: p.id, providerLabel: p.label, model: p.model,
          latencyMs: Date.now() - startedAt, ok: false, error: msg,
          action: null, sizeUsdt: null, marginUsdt: null, leverage: null,
          takeProfitPrice: null, stopLossPrice: null, confidence: null, reasoning: null,
        };
      }
    }),
  );

  void perpExtras;
  void heldBase;

  return {
    instId,
    mode,
    generatedAt: new Date().toISOString(),
    lastPrice: ticker.last,
    technicalSummary,
    sentimentSummary,
    indicatorTextByBar: indicatorText || null,
    contextText: contextText || null,
    fundingRate: contextBundle.fundingRate?.fundingRate ?? null,
    openInterestCcy: contextBundle.openInterest?.oiCcy ?? null,
    longShortRatio: contextBundle.longShortRatio?.ratio ?? null,
    takerBuyRatio: contextBundle.takerVolume?.buyRatio ?? null,
    atr1H: atr,
    recommendations,
  };
}

// ---------- Consensus computation ----------

export type Consensus = {
  action: "long" | "short" | "close" | "buy" | "sell" | "hold" | null;
  count: number;
  avgConfidence: number;
  totalProviders: number;
  medianMarginUsdt: number | null;
  medianLeverage: number | null;
  medianStopLossPrice: number | null;
  medianTakeProfitPrice: number | null;
  medianSizeUsdt: number | null;
  chosenProviderId: string | null;
};

function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

export function computeConsensus(recs: AiRecommendation[]): Consensus {
  const valid = recs.filter((r) => r.ok && r.action);
  const counts = new Map<string, AiRecommendation[]>();
  for (const r of valid) {
    const a = r.action!;
    if (!counts.has(a)) counts.set(a, []);
    counts.get(a)!.push(r);
  }
  // Find non-hold action with the largest count (ties broken by avg confidence)
  let bestAction: string | null = null;
  let bestList: AiRecommendation[] = [];
  for (const [a, list] of counts.entries()) {
    if (a === "hold") continue;
    if (list.length > bestList.length) { bestAction = a; bestList = list; }
    else if (list.length === bestList.length && bestList.length > 0) {
      const avgA = list.reduce((s, r) => s + (r.confidence ?? 0), 0) / list.length;
      const avgB = bestList.reduce((s, r) => s + (r.confidence ?? 0), 0) / bestList.length;
      if (avgA > avgB) { bestAction = a; bestList = list; }
    }
  }
  if (!bestAction || bestList.length === 0) {
    return {
      action: "hold", count: counts.get("hold")?.length ?? 0,
      avgConfidence: 0, totalProviders: recs.length,
      medianMarginUsdt: null, medianLeverage: null,
      medianStopLossPrice: null, medianTakeProfitPrice: null, medianSizeUsdt: null,
      chosenProviderId: null,
    };
  }
  const avgConf = bestList.reduce((s, r) => s + (r.confidence ?? 0), 0) / bestList.length;
  const margins = bestList.map((r) => r.marginUsdt).filter((v): v is number => v != null);
  const levs = bestList.map((r) => r.leverage).filter((v): v is number => v != null);
  const sls = bestList.map((r) => r.stopLossPrice).filter((v): v is number => v != null);
  const tps = bestList.map((r) => r.takeProfitPrice).filter((v): v is number => v != null);
  const sizes = bestList.map((r) => r.sizeUsdt).filter((v): v is number => v != null);
  const chosen = [...bestList].sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))[0]!;
  return {
    action: bestAction as Consensus["action"],
    count: bestList.length,
    avgConfidence: avgConf,
    totalProviders: recs.length,
    medianMarginUsdt: median(margins),
    medianLeverage: levs.length ? Math.round(median(levs)!) : null,
    medianStopLossPrice: median(sls),
    medianTakeProfitPrice: median(tps),
    medianSizeUsdt: median(sizes),
    chosenProviderId: chosen.providerId,
  };
}
