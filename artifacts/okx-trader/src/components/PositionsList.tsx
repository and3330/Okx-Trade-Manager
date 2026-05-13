import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  useListPerpPositions,
  getListPerpPositionsQueryKey,
  useClosePerpPosition,
  getGetAccountBalanceQueryKey,
  getGetAccountSummaryQueryKey,
} from "@workspace/api-client-react";
import { ScrollArea } from "@/components/ui/scroll-area";
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

type PendingClose = { instId: string; posSide: "long" | "short" | "net"; baseCcy: string };

export default function PositionsList({ onSelectInstId }: { onSelectInstId?: (instId: string) => void }) {
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<PendingClose | null>(null);
  const { data: positions, isLoading } = useListPerpPositions({
    query: { refetchInterval: 3000, queryKey: getListPerpPositionsQueryKey() },
  });
  const closeMut = useClosePerpPosition();

  const handleConfirmClose = () => {
    if (!pending) return;
    closeMut.mutate(
      { data: { instId: pending.instId, posSide: pending.posSide, marginMode: "isolated" } },
      {
        onSuccess: () => {
          toast.success(`已平倉：${pending.baseCcy} ${pending.posSide === "long" ? "多" : "空"}`);
          setPending(null);
          queryClient.invalidateQueries({ queryKey: getListPerpPositionsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetAccountBalanceQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetAccountSummaryQueryKey() });
        },
        onError: (err: any) => {
          const msg = err?.data?.error || err.message || "平倉失敗";
          toast.error(`平倉失敗：${msg}`);
        },
      },
    );
  };

  return (
    <div className="flex h-full flex-col">
      <div className="px-4 py-2 text-xs font-semibold text-muted-foreground tracking-wider uppercase border-b border-border bg-card">
        合約持倉
      </div>
      <ScrollArea className="flex-1">
        {isLoading ? (
          <div className="p-4 text-center text-sm text-muted-foreground">載入中...</div>
        ) : !positions || positions.length === 0 ? (
          <div className="p-4 text-center text-sm text-muted-foreground">尚無持倉</div>
        ) : (
          <div className="divide-y divide-border">
            {positions.map((p) => {
              const baseCcy = p.instId.replace("-USDT-SWAP", "");
              const sideLabel = p.posSide === "net" ? (p.contracts >= 0 ? "多" : "空") : p.posSide === "long" ? "多" : "空";
              const isLong = sideLabel === "多";
              const pnlPositive = p.unrealizedPnlUsd >= 0;
              return (
                <div key={`${p.instId}-${p.posSide}`} className="p-3 hover:bg-muted/50 transition-colors">
                  <div className="flex items-start justify-between gap-2">
                    <button
                      onClick={() => onSelectInstId?.(p.instId)}
                      className="text-left"
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-foreground">{baseCcy}</span>
                        <span className={cn(
                          "text-[10px] font-bold uppercase px-1.5 py-0.5 rounded",
                          isLong ? "bg-[#00e59b]/15 text-[#00e59b]" : "bg-[#ff4d4d]/15 text-[#ff4d4d]",
                        )}>
                          {sideLabel} {p.leverage}x
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5 font-mono">
                        {Math.abs(p.baseQty).toFixed(4)} @ {p.avgEntryPx}
                      </div>
                    </button>
                    <div className="text-right">
                      <div className={cn(
                        "font-mono text-sm font-bold",
                        pnlPositive ? "text-[#00e59b]" : "text-[#ff4d4d]",
                      )}>
                        {pnlPositive ? "+" : ""}{p.unrealizedPnlUsd.toFixed(2)}
                      </div>
                      <div className={cn(
                        "text-xs font-mono",
                        pnlPositive ? "text-[#00e59b]" : "text-[#ff4d4d]",
                      )}>
                        {pnlPositive ? "+" : ""}{p.unrealizedPnlPct.toFixed(2)}%
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center justify-between mt-2 text-[11px] text-muted-foreground font-mono">
                    <span>標記 {p.markPx} {p.liquidationPx ? `· 強平 ${p.liquidationPx.toFixed(4)}` : ""}</span>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-6 px-2 text-[10px] uppercase"
                      onClick={() => setPending({ instId: p.instId, posSide: p.posSide, baseCcy })}
                    >
                      平倉
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </ScrollArea>

      <AlertDialog open={!!pending} onOpenChange={(o) => !o && setPending(null)}>
        <AlertDialogContent className="bg-card border-border">
          <AlertDialogHeader>
            <AlertDialogTitle>確定平倉？</AlertDialogTitle>
            <AlertDialogDescription className="text-foreground mt-2">
              將以市價平掉你的 {pending?.baseCcy} {pending?.posSide === "long" ? "多" : "空"} 倉，會立即實現當前盈虧。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={closeMut.isPending} className="bg-transparent border-border hover:bg-muted text-foreground">取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmClose}
              disabled={closeMut.isPending}
              className="bg-[#ff4d4d] hover:bg-[#e63939] text-white border-0"
            >
              {closeMut.isPending ? "平倉中..." : "確認平倉"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
