import { useState } from "react";
import {
  useRecommendTrade,
  usePlaceOrder,
  getListOrdersQueryKey,
  getListRecentFillsQueryKey,
  getGetAccountBalanceQueryKey,
  getGetAccountSummaryQueryKey,
} from "@workspace/api-client-react";

type AiRecommendation = {
  providerId: string;
  providerLabel: string;
  model: string;
  latencyMs: number;
  ok: boolean;
  error?: string | null;
  action?: "buy" | "sell" | "hold" | null;
  sizeUsdt?: number | null;
  stopLossPrice?: number | null;
  confidence?: number | null;
  reasoning?: string | null;
};
type AiRecommendationsResponse = {
  instId: string;
  generatedAt: string;
  lastPrice: number;
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
  if (action === "buy") return "bg-[#00e59b]/15 text-[#00e59b] border-[#00e59b]/40";
  if (action === "sell") return "bg-[#ff4d4d]/15 text-[#ff4d4d] border-[#ff4d4d]/40";
  return "bg-muted text-muted-foreground border-border";
}

function executeButtonClass(action: string | null | undefined) {
  if (action === "buy")
    return "bg-[#00e59b] text-[#003d29] hover:bg-[#00cc8a]";
  if (action === "sell")
    return "bg-[#ff4d4d] text-white hover:bg-[#e63939]";
  return "bg-muted text-muted-foreground";
}

export default function AiBattle({ instId }: { instId: string }) {
  const queryClient = useQueryClient();
  const [data, setData] = useState<AiRecommendationsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<{ rec: Rec; instId: string } | null>(null);

  const recommend = useRecommendTrade();
  const placeOrder = usePlaceOrder();

  const onRun = () => {
    setError(null);
    recommend.mutate(
      { data: { instId } },
      {
        onSuccess: (res) => setData(res as AiRecommendationsResponse),
        onError: (err: unknown) => {
          const e = err as { data?: { error?: string }; message?: string };
          setError(e?.data?.error || e?.message || "AI battle failed");
        },
      },
    );
  };

  const stale = !!(data && data.instId !== instId);
  const recs = data?.recommendations ?? [];
  const recsInstId = data?.instId ?? instId;
  const pendingBaseAsset = pending?.instId.split("-")[0] ?? "";

  const handleConfirmExecute = () => {
    if (!pending || !pending.rec.action || pending.rec.action === "hold" || !pending.rec.sizeUsdt) {
      setPending(null);
      return;
    }
    const { rec, instId: pendingInstId } = pending;
    placeOrder.mutate(
      {
        data: {
          instId: pendingInstId,
          side: rec.action as "buy" | "sell",
          notionalUsd: rec.sizeUsdt!,
          stopLossPrice: rec.stopLossPrice ?? undefined,
        },
      },
      {
        onSuccess: (r) => {
          toast.success(`Order placed via ${rec.providerLabel}: ${r.ordId}`);
          setPending(null);
          queryClient.invalidateQueries({ queryKey: getListOrdersQueryKey() });
          queryClient.invalidateQueries({ queryKey: getListRecentFillsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetAccountBalanceQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetAccountSummaryQueryKey() });
        },
        onError: (err: unknown) => {
          const e = err as { data?: { error?: string }; message?: string };
          toast.error(`Order failed: ${e?.data?.error || e?.message}`);
          setPending(null);
        },
      },
    );
  };

  return (
    <div className="border-b border-border">
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-card">
        <div className="flex flex-col">
          <span className="text-xs font-semibold text-muted-foreground tracking-wider uppercase">
            AI Trade Battle
          </span>
          {data && !stale && (
            <span className="text-[10px] text-muted-foreground mt-0.5">
              {format(new Date(data.generatedAt), "HH:mm:ss")} · last {data.lastPrice}
            </span>
          )}
        </div>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          onClick={onRun}
          disabled={recommend.isPending}
        >
          {recommend.isPending
            ? "Running..."
            : data && !stale
              ? "Re-run"
              : `Battle on ${instId}`}
        </Button>
      </div>

      <div className="p-3 max-h-[420px] overflow-y-auto space-y-2">
        {error && (
          <div className="text-xs text-destructive font-mono whitespace-pre-wrap">
            {error}
          </div>
        )}
        {!error && !data && !recommend.isPending && (
          <p className="text-xs text-muted-foreground leading-relaxed px-1 py-2">
            Click the button to ask 4 AI models in parallel — Claude, GPT, Gemini, and DeepSeek — for a concrete trade idea on {instId}. You stay in control: nothing trades unless you click Execute on the one you like.
          </p>
        )}
        {recommend.isPending && (
          <div className="text-xs text-muted-foreground font-mono px-1 py-2">
            Polling 4 models in parallel...
          </div>
        )}
        {stale && (
          <div className="text-xs text-amber-400 px-1">
            Showing results for {data?.instId}. Click Re-run to update for {instId}.
          </div>
        )}

        {recs.map((r) => (
          <div
            key={r.providerId}
            className="border border-border rounded-md p-3 bg-background/40"
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-xs font-semibold text-foreground truncate">
                  {r.providerLabel}
                </span>
                <span className="text-[10px] text-muted-foreground font-mono shrink-0">
                  {r.latencyMs}ms
                </span>
              </div>
              {r.ok && r.action && (
                <span
                  className={cn(
                    "text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded border",
                    actionStyles(r.action),
                  )}
                >
                  {r.action}
                  {r.confidence != null && (
                    <span className="ml-1 opacity-70">· {r.confidence}/10</span>
                  )}
                </span>
              )}
              {!r.ok && (
                <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded border border-destructive/40 bg-destructive/15 text-destructive">
                  error
                </span>
              )}
            </div>

            {r.ok ? (
              <>
                {r.action !== "hold" && (
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-mono mb-2">
                    {r.sizeUsdt != null && (
                      <span>
                        <span className="text-muted-foreground">size:</span>{" "}
                        <span className="text-foreground">
                          {r.sizeUsdt.toFixed(2)} USDT
                        </span>
                      </span>
                    )}
                    {r.stopLossPrice != null && (
                      <span>
                        <span className="text-muted-foreground">SL:</span>{" "}
                        <span className="text-foreground">
                          {r.stopLossPrice}
                        </span>
                      </span>
                    )}
                  </div>
                )}
                {r.reasoning && (
                  <p className="text-[11px] text-muted-foreground leading-snug whitespace-pre-wrap mb-2">
                    {r.reasoning}
                  </p>
                )}
                {r.action !== "hold" && r.sizeUsdt != null && r.sizeUsdt > 0 && (
                  <Button
                    size="sm"
                    className={cn(
                      "h-7 text-[11px] uppercase font-bold tracking-wider w-full",
                      executeButtonClass(r.action),
                      stale && "opacity-50 cursor-not-allowed",
                    )}
                    disabled={stale}
                    onClick={() => setPending({ rec: r, instId: recsInstId })}
                  >
                    {stale
                      ? `Stale — re-run for ${instId}`
                      : `Execute ${r.action} ${r.sizeUsdt.toFixed(2)} USDT`}
                  </Button>
                )}
              </>
            ) : (
              <p className="text-[11px] text-destructive/80 font-mono whitespace-pre-wrap break-all">
                {r.error}
              </p>
            )}
          </div>
        ))}
      </div>

      <AlertDialog open={!!pending} onOpenChange={(o) => !o && setPending(null)}>
        <AlertDialogContent className="bg-card border-border">
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm AI-suggested order</AlertDialogTitle>
            <AlertDialogDescription className="text-base text-foreground mt-4">
              {pending && (
                <>
                  Following <strong>{pending.rec.providerLabel}</strong>'s
                  recommendation on <strong>{pending.instId}</strong>:
                  <br />
                  <br />
                  <span className="font-mono">
                    {pending.rec.action?.toUpperCase()} {pending.rec.sizeUsdt?.toFixed(2)} USDT
                    {" "}of {pendingBaseAsset}
                  </span>
                  {pending.rec.stopLossPrice != null && (
                    <>
                      <br />
                      <span className="font-mono">
                        Stop loss: {pending.rec.stopLossPrice}
                      </span>
                    </>
                  )}
                  <br />
                  <br />
                  This places a real OKX market order. Continue?
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              className="bg-transparent border-border hover:bg-muted text-foreground"
              disabled={placeOrder.isPending}
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmExecute}
              disabled={placeOrder.isPending}
              className={cn(
                "border-0 disabled:opacity-60",
                executeButtonClass(pending?.rec.action),
              )}
            >
              {placeOrder.isPending
                ? "Placing..."
                : `Confirm ${pending?.rec.action ?? ""}`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
