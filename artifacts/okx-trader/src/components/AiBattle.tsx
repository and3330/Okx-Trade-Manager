import { useState } from "react";
import {
  useRunResearchPipeline,
  usePlaceOrder,
  usePlacePerpOrder,
  useClosePerpPosition,
  getListOrdersQueryKey,
  getListRecentFillsQueryKey,
  getGetAccountBalanceQueryKey,
  getGetAccountSummaryQueryKey,
  getListPerpPositionsQueryKey,
} from "@workspace/api-client-react";

type Mode = "spot" | "perp";

type AiRecommendation = {
  providerId: string;
  providerLabel: string;
  model: string;
  latencyMs: number;
  ok: boolean;
  error?: string | null;
  action?: "buy" | "sell" | "hold" | "long" | "short" | "close" | null;
  sizeUsdt?: number | null;
  marginUsdt?: number | null;
  leverage?: number | null;
  stopLossPrice?: number | null;
  takeProfitPrice?: number | null;
  confidence?: number | null;
  reasoning?: string | null;
};
type ResearchResponse = {
  instId: string;
  mode: string;
  generatedAt: string;
  lastPrice: number;
  technicalSummary?: string | null;
  sentimentSummary?: string | null;
  indicatorTextByBar?: string | null;
  contextText?: string | null;
  fundingRate?: number | null;
  longShortRatio?: number | null;
  takerBuyRatio?: number | null;
  atr1H?: number | null;
  recommendations: AiRecommendation[];
};
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { format } from "date-fns";

type Rec = AiRecommendation;

function actionStyles(action: string | null | undefined) {
  if (action === "buy" || action === "long") return "bg-[#00e59b]/15 text-[#00e59b] border-[#00e59b]/40";
  if (action === "sell" || action === "short") return "bg-[#ff4d4d]/15 text-[#ff4d4d] border-[#ff4d4d]/40";
  if (action === "close") return "bg-amber-500/15 text-amber-400 border-amber-500/40";
  return "bg-muted text-muted-foreground border-border";
}

function executeButtonClass(action: string | null | undefined) {
  if (action === "buy" || action === "long") return "bg-[#00e59b] text-[#003d29] hover:bg-[#00cc8a]";
  if (action === "sell" || action === "short") return "bg-[#ff4d4d] text-white hover:bg-[#e63939]";
  if (action === "close") return "bg-amber-500 text-black hover:bg-amber-400";
  return "bg-muted text-muted-foreground";
}

export default function AiBattle({ instId, mode = "spot" }: { instId: string; mode?: Mode }) {
  const queryClient = useQueryClient();
  const [data, setData] = useState<ResearchResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<{ rec: Rec; instId: string } | null>(null);
  const [showStage1, setShowStage1] = useState(true);
  const [showStage2, setShowStage2] = useState(true);
  const [showIndicators, setShowIndicators] = useState(false);

  const recommend = useRunResearchPipeline();
  const placeOrder = usePlaceOrder();
  const placePerp = usePlacePerpOrder();
  const closePerp = useClosePerpPosition();

  const onRun = () => {
    setError(null);
    recommend.mutate(
      { data: { instId, mode } as any },
      {
        onSuccess: (res) => setData(res as unknown as ResearchResponse),
        onError: (err: unknown) => {
          const e = err as { data?: { error?: string }; message?: string };
          setError(e?.data?.error || e?.message || "AI 對戰失敗");
        },
      },
    );
  };

  const stale = !!(data && data.instId !== instId);
  const recs = data?.recommendations ?? [];
  const recsInstId = data?.instId ?? instId;
  const baseLabel = recsInstId.replace("-USDT-SWAP", "").replace("-USDT", "");
  const submitting = placeOrder.isPending || placePerp.isPending || closePerp.isPending;

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: getListOrdersQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListRecentFillsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetAccountBalanceQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetAccountSummaryQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListPerpPositionsQueryKey() });
  };

  const handleConfirmExecute = () => {
    if (!pending) return;
    const { rec, instId: pendingInstId } = pending;
    const a = rec.action;

    if (a === "buy" || a === "sell") {
      if (!rec.sizeUsdt) { setPending(null); return; }
      placeOrder.mutate(
        { data: { instId: pendingInstId, side: a, notionalUsd: rec.sizeUsdt, stopLossPrice: rec.stopLossPrice ?? undefined } },
        {
          onSuccess: (r) => { toast.success(`已依 ${rec.providerLabel} 下單：${r.ordId}`); setPending(null); invalidateAll(); },
          onError: (err: any) => { toast.error(`下單失敗：${err?.data?.error || err?.message}`); setPending(null); },
        },
      );
    } else if (a === "long" || a === "short") {
      if (!rec.marginUsdt || !rec.leverage) { setPending(null); return; }
      placePerp.mutate(
        {
          data: {
            instId: pendingInstId,
            side: a,
            marginUsdt: rec.marginUsdt,
            leverage: rec.leverage,
            takeProfitPrice: rec.takeProfitPrice ?? undefined,
            stopLossPrice: rec.stopLossPrice ?? undefined,
          },
        },
        {
          onSuccess: (r) => { toast.success(`已依 ${rec.providerLabel} 開倉：${r.contracts} 張`); setPending(null); invalidateAll(); },
          onError: (err: any) => { toast.error(`下單失敗：${err?.data?.error || err?.message}`); setPending(null); },
        },
      );
    } else if (a === "close") {
      closePerp.mutate(
        { data: { instId: pendingInstId, marginMode: "isolated" } },
        {
          onSuccess: () => { toast.success(`已依 ${rec.providerLabel} 平倉`); setPending(null); invalidateAll(); },
          onError: (err: any) => { toast.error(`平倉失敗：${err?.data?.error || err?.message}`); setPending(null); },
        },
      );
    } else {
      setPending(null);
    }
  };

  function actionPill(r: Rec) {
    if (!r.ok) return <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded border border-destructive/40 bg-destructive/15 text-destructive">錯誤</span>;
    if (!r.action) return null;
    return (
      <span className={cn("text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded border", actionStyles(r.action))}>
        {actionLabel(r.action)}
        {r.confidence != null && <span className="ml-1 opacity-70">· {r.confidence}/10</span>}
      </span>
    );
  }

  function renderTradeMeta(r: Rec) {
    const isPerpOpen = r.action === "long" || r.action === "short";
    const isSpotTrade = r.action === "buy" || r.action === "sell";
    if (isPerpOpen) {
      return (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-mono mb-2">
          {r.marginUsdt != null && <span><span className="text-muted-foreground">保證金:</span> <span className="text-foreground">{r.marginUsdt.toFixed(2)} USDT</span></span>}
          {r.leverage != null && <span><span className="text-muted-foreground">槓桿:</span> <span className="text-foreground">{r.leverage}x</span></span>}
          {r.takeProfitPrice != null && <span><span className="text-muted-foreground">止盈:</span> <span className="text-foreground">{r.takeProfitPrice}</span></span>}
          {r.stopLossPrice != null && <span><span className="text-muted-foreground">止損:</span> <span className="text-foreground">{r.stopLossPrice}</span></span>}
        </div>
      );
    }
    if (isSpotTrade) {
      return (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-mono mb-2">
          {r.sizeUsdt != null && <span><span className="text-muted-foreground">金額:</span> <span className="text-foreground">{r.sizeUsdt.toFixed(2)} USDT</span></span>}
          {r.stopLossPrice != null && <span><span className="text-muted-foreground">止損:</span> <span className="text-foreground">{r.stopLossPrice}</span></span>}
        </div>
      );
    }
    return null;
  }

  function actionLabel(action: string | null | undefined) {
    if (action === "buy") return "買入";
    if (action === "sell") return "賣出";
    if (action === "long") return "做多";
    if (action === "short") return "做空";
    if (action === "close") return "平倉";
    if (action === "hold") return "觀望";
    return action ?? "";
  }

  function executeLabel(r: Rec) {
    if (r.action === "buy" || r.action === "sell") return `執行 ${actionLabel(r.action)} ${r.sizeUsdt?.toFixed(2)} USDT`;
    if (r.action === "long" || r.action === "short") return `執行 ${actionLabel(r.action)} ${r.marginUsdt?.toFixed(0)}U @${r.leverage}x`;
    if (r.action === "close") return "執行平倉";
    return "執行";
  }

  function isExecutable(r: Rec) {
    if (!r.ok) return false;
    if (r.action === "buy" || r.action === "sell") return !!r.sizeUsdt && r.sizeUsdt > 0;
    if (r.action === "long" || r.action === "short") return !!r.marginUsdt && !!r.leverage;
    if (r.action === "close") return true;
    return false;
  }

  return (
    <div className="border-b border-border">
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-card">
        <div className="flex flex-col">
          <span className="text-xs font-semibold text-muted-foreground tracking-wider uppercase">
            AI 交易對戰 {mode === "perp" && <span className="text-amber-400">· 合約</span>}
          </span>
          {data && !stale && (
            <span className="text-[10px] text-muted-foreground mt-0.5">
              {format(new Date(data.generatedAt), "HH:mm:ss")} · 最新價 {data.lastPrice}
            </span>
          )}
        </div>
        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onRun} disabled={recommend.isPending}>
          {recommend.isPending ? "分析中..." : data && !stale ? "重跑" : `分析 ${baseLabel}`}
        </Button>
      </div>

      <div className="p-3 max-h-[520px] overflow-y-auto space-y-2">
        {error && <div className="text-xs text-destructive font-mono whitespace-pre-wrap">{error}</div>}
        {!error && !data && !recommend.isPending && (
          <p className="text-xs text-muted-foreground leading-relaxed px-1 py-2">
            {mode === "perp"
              ? `按下按鈕跑完整 3 階段 AI 研究（技術分析 → 資金/情緒分析 → 4 模型決策）針對 ${instId} 永續合約。確認後才送單。`
              : `按下按鈕對 ${instId} 跑完整 3 階段 AI 研究（技術分析 → 4 模型決策）。需手動點「執行」才會真的下單。`}
          </p>
        )}
        {recommend.isPending && <div className="text-xs text-muted-foreground font-mono px-1 py-2">第 1 + 2 階段平行進行中，接著 4 模型決策...</div>}

        {data && !stale && (data.technicalSummary || data.sentimentSummary || data.indicatorTextByBar) && (
          <div className="space-y-2 mb-2">
            {data.technicalSummary && (
              <div className="border border-border rounded-md bg-background/40">
                <button
                  type="button"
                  onClick={() => setShowStage1(!showStage1)}
                  className="w-full flex items-center justify-between px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-[#00e59b] hover:bg-muted/30"
                >
                  <span>① 技術分析師 · Claude</span>
                  <span className="opacity-60">{showStage1 ? "▾" : "▸"}</span>
                </button>
                {showStage1 && <p className="px-3 pb-2 text-[11px] text-muted-foreground leading-snug whitespace-pre-wrap">{data.technicalSummary}</p>}
              </div>
            )}
            {data.sentimentSummary && data.sentimentSummary !== "(現貨模式不分析資金面)" && data.sentimentSummary !== "(spot mode skips funding analysis)" && (
              <div className="border border-border rounded-md bg-background/40">
                <button
                  type="button"
                  onClick={() => setShowStage2(!showStage2)}
                  className="w-full flex items-center justify-between px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-amber-400 hover:bg-muted/30"
                >
                  <span>② 資金/情緒分析師 · Gemini</span>
                  <span className="opacity-60">{showStage2 ? "▾" : "▸"}</span>
                </button>
                {showStage2 && <p className="px-3 pb-2 text-[11px] text-muted-foreground leading-snug whitespace-pre-wrap">{data.sentimentSummary}</p>}
              </div>
            )}
            {data.indicatorTextByBar && (
              <div className="border border-border rounded-md bg-background/40">
                <button
                  type="button"
                  onClick={() => setShowIndicators(!showIndicators)}
                  className="w-full flex items-center justify-between px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground hover:bg-muted/30"
                >
                  <span>多時框指標原始值 (15m/1H/4H/1D)</span>
                  <span className="opacity-60">{showIndicators ? "▾" : "▸"}</span>
                </button>
                {showIndicators && <pre className="px-3 pb-2 text-[10px] text-muted-foreground font-mono whitespace-pre-wrap">{data.indicatorTextByBar}</pre>}
              </div>
            )}
            <div className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground px-1 pt-1">③ 4 模型決策</div>
          </div>
        )}

        {stale && (
          <div className="text-xs text-amber-400 px-1">
            目前顯示的是 {data?.instId} 的結果，點「重跑」可更新為 {instId}。
          </div>
        )}

        {recs.map((r) => (
          <div key={r.providerId} className="border border-border rounded-md p-3 bg-background/40">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-xs font-semibold text-foreground truncate">{r.providerLabel}</span>
                <span className="text-[10px] text-muted-foreground font-mono shrink-0">{r.latencyMs}ms</span>
              </div>
              {actionPill(r)}
            </div>

            {r.ok ? (
              <>
                {renderTradeMeta(r)}
                {r.reasoning && <p className="text-[11px] text-muted-foreground leading-snug whitespace-pre-wrap mb-2">{r.reasoning}</p>}
                {isExecutable(r) && (
                  <Button
                    size="sm"
                    className={cn("h-7 text-[11px] uppercase font-bold tracking-wider w-full", executeButtonClass(r.action), stale && "opacity-50 cursor-not-allowed")}
                    disabled={stale}
                    onClick={() => setPending({ rec: r, instId: recsInstId })}
                  >
                    {stale ? `舊資料 — 請對 ${instId} 重跑` : executeLabel(r)}
                  </Button>
                )}
              </>
            ) : (
              <p className="text-[11px] text-destructive/80 font-mono whitespace-pre-wrap break-all">{r.error}</p>
            )}
          </div>
        ))}
      </div>

      <AlertDialog open={!!pending} onOpenChange={(o) => !o && setPending(null)}>
        <AlertDialogContent className="bg-card border-border">
          <AlertDialogHeader>
            <AlertDialogTitle>確認執行 AI 建議的訂單</AlertDialogTitle>
            <AlertDialogDescription className="text-base text-foreground mt-4 space-y-2">
              {pending && (
                <>
                  <div>跟隨 <strong>{pending.rec.providerLabel}</strong> 在 <strong>{pending.instId}</strong> 上：</div>
                  {(pending.rec.action === "buy" || pending.rec.action === "sell") && (
                    <div className="font-mono">{actionLabel(pending.rec.action)} {pending.rec.sizeUsdt?.toFixed(2)} USDT</div>
                  )}
                  {(pending.rec.action === "long" || pending.rec.action === "short") && (
                    <>
                      <div className="font-mono">{actionLabel(pending.rec.action)} 保證金 {pending.rec.marginUsdt} USDT @ {pending.rec.leverage}x</div>
                      <div className="font-mono text-xs">名目價值 ~${((pending.rec.marginUsdt ?? 0) * (pending.rec.leverage ?? 0)).toFixed(2)}</div>
                    </>
                  )}
                  {pending.rec.action === "close" && (
                    <div className="font-mono">以市價平掉 {pending.instId} 倉位</div>
                  )}
                  {pending.rec.takeProfitPrice != null && <div className="font-mono text-xs">止盈: {pending.rec.takeProfitPrice}</div>}
                  {pending.rec.stopLossPrice != null && <div className="font-mono text-xs">止損: {pending.rec.stopLossPrice}</div>}
                  <div className="text-xs text-muted-foreground pt-2">這會在 OKX 真的送出市價單，確定繼續？</div>
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="bg-transparent border-border hover:bg-muted text-foreground" disabled={submitting}>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmExecute}
              disabled={submitting}
              className={cn("border-0 disabled:opacity-60", executeButtonClass(pending?.rec.action))}
            >
              {submitting ? "送出中..." : `確認 ${actionLabel(pending?.rec.action)}`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
