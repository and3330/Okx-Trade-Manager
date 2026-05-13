import { Router, type IRouter } from "express";
import Anthropic from "@anthropic-ai/sdk";
import {
  AnalyzeMarketBody,
  AnalyzeMarketResponse,
} from "@workspace/api-zod";
import { fetchTicker, fetchCandles, fetchAccountBalance, OkxError } from "../lib/okx";

const router: IRouter = Router();

const MODEL = "claude-sonnet-4-6";

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (client) return client;
  const baseURL = process.env["AI_INTEGRATIONS_ANTHROPIC_BASE_URL"];
  const apiKey = process.env["AI_INTEGRATIONS_ANTHROPIC_API_KEY"];
  if (!baseURL || !apiKey) {
    throw new Error("Anthropic AI integration not configured");
  }
  client = new Anthropic({ baseURL, apiKey });
  return client;
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

    // Compress candles into a compact context block
    const recent = candles.slice(-48); // last 48 hourly candles (~2 days)
    const candleLines = recent
      .map(
        (c) =>
          `${c.ts.slice(5, 16).replace("T", " ")}  O:${c.open}  H:${c.high}  L:${c.low}  C:${c.close}  V:${c.volume.toFixed(2)}`,
      )
      .join("\n");

    const baseAsset = instId.split("-")[0] ?? instId;
    const heldBase = balance?.assets.find((a) => a.ccy === baseAsset);
    const heldUsdt = balance?.assets.find((a) => a.ccy === "USDT");
    const portfolioCtx = balance
      ? `Account total equity: $${balance.totalEquityUsd.toFixed(2)} USD\n` +
        `Holdings of ${baseAsset}: ${heldBase ? heldBase.available : 0}\n` +
        `Holdings of USDT: ${heldUsdt ? heldUsdt.available : 0}`
      : "Account data unavailable.";

    const prompt = `You are a concise crypto market analyst. The user is looking at ${instId} on OKX spot.

Current ticker:
- Last price: ${ticker.last}
- 24h change: ${ticker.changePct24h.toFixed(2)}%
- 24h high: ${ticker.high24h}
- 24h low: ${ticker.low24h}
- 24h volume: ${ticker.vol24h}

Recent 1H candles (oldest -> newest, last 48):
${candleLines}

Portfolio context:
${portfolioCtx}

Write a short markdown analysis (under 250 words) with these sections, no preamble:
- **Trend**: short-term direction and momentum read from the candles.
- **Key levels**: nearby support and resistance suggested by the data.
- **Volatility & volume**: notable observations.
- **Suggestion**: a non-binding, clearly-hedged view (e.g. "lean bullish, scale in", "wait for break", "no clear edge"). Mention how the user's existing ${baseAsset} or USDT balance might inform sizing.

End with a one-line disclaimer that this is not financial advice. Use plain numbers, no emojis.`;

    const message = await getClient().messages.create({
      model: MODEL,
      max_tokens: 8192,
      messages: [{ role: "user", content: prompt }],
    });

    const block = message.content[0];
    const analysis = block && block.type === "text" ? block.text : "";

    if (!analysis) {
      throw new Error("Empty response from AI");
    }

    res.json(
      AnalyzeMarketResponse.parse({
        instId,
        analysis,
        generatedAt: new Date().toISOString(),
        model: MODEL,
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

export default router;
