import {
  useListAutoTradeExecutions,
  useListAutoTradeDecisions,
  useGetModelLeaderboard,
  getListAutoTradeExecutionsQueryKey,
  getListAutoTradeDecisionsQueryKey,
  getGetModelLeaderboardQueryKey,
} from "@workspace/api-client-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

export default function AutoTradeHistory() {
  const { data: execs } = useListAutoTradeExecutions(undefined, { query: { queryKey: getListAutoTradeExecutionsQueryKey(), refetchInterval: 10_000 } });
  const { data: decisions } = useListAutoTradeDecisions(undefined, { query: { queryKey: getListAutoTradeDecisionsQueryKey(), refetchInterval: 15_000 } });
  const { data: leaderboard } = useGetModelLeaderboard({ query: { queryKey: getGetModelLeaderboardQueryKey(), refetchInterval: 30_000 } });

  const execList = (execs as any[] | undefined) ?? [];
  const decList = (decisions as any[] | undefined) ?? [];
  const lbList = (leaderboard as any[] | undefined) ?? [];

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Leaderboard */}
      <section className="px-4 py-3 border-b border-border">
        <div className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground mb-2">模型排行榜</div>
        <div className="space-y-1.5">
          {lbList.map((row) => (
            <div key={row.providerId} className="flex items-center justify-between border border-border rounded-md p-2 bg-background/40">
              <div className="min-w-0">
                <div className="text-xs font-semibold truncate">{row.providerLabel}</div>
                <div className="text-[10px] text-muted-foreground font-mono">
                  建議 {row.totalSuggestions} · 執行 {row.executedCount} · 勝/負 {row.winCount}/{row.lossCount}
                </div>
              </div>
              <div className="text-right">
                <div className={cn("text-sm font-mono font-bold", row.totalRealizedPnlUsdt >= 0 ? "text-[#00e59b]" : "text-[#ff4d4d]")}>
                  {row.totalRealizedPnlUsdt >= 0 ? "+" : ""}{row.totalRealizedPnlUsdt.toFixed(2)}
                </div>
                <div className="text-[10px] text-muted-foreground">{(row.winRate * 100).toFixed(1)}% 勝率</div>
              </div>
            </div>
          ))}
          {lbList.length === 0 && <div className="text-[11px] text-muted-foreground">尚無資料 — 等待第一筆執行。</div>}
        </div>
      </section>

      {/* Executions */}
      <section className="px-4 py-3 border-b border-border">
        <div className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground mb-2">近期執行 ({execList.length})</div>
        <div className="space-y-1">
          {execList.slice(0, 25).map((e) => (
            <div key={e.id} className="border border-border rounded-md p-2 bg-background/40">
              <div className="flex items-center justify-between text-[11px] font-mono">
                <span className={cn(
                  "px-1.5 py-0.5 rounded uppercase font-bold text-[9px]",
                  e.side === "long" ? "bg-[#00e59b]/15 text-[#00e59b]" :
                  e.side === "short" ? "bg-[#ff4d4d]/15 text-[#ff4d4d]" :
                  "bg-amber-500/15 text-amber-400",
                )}>{e.side === "long" ? "多" : e.side === "short" ? "空" : e.side === "close" ? "平倉" : e.side}</span>
                <span className="text-foreground">{e.instId}</span>
                <span className={cn(
                  "text-[10px] font-bold uppercase",
                  e.status === "submitted" ? "text-[#00e59b]" : "text-[#ff4d4d]",
                )}>{e.status === "submitted" ? "已送出" : e.status === "skipped" ? "已略過" : e.status === "rejected" ? "已拒絕" : e.status === "failed" ? "失敗" : e.status}</span>
              </div>
              <div className="flex items-center justify-between mt-1 text-[10px] text-muted-foreground font-mono">
                <span>{e.marginUsdt != null ? `${e.marginUsdt.toFixed(0)}U @${e.leverage}x` : "—"}</span>
                <span>{e.entryPrice != null ? `進場 ${e.entryPrice}` : ""}</span>
                <span>{format(new Date(e.createdAt), "MM-dd HH:mm")}</span>
              </div>
              {e.realizedPnlUsdt != null && (
                <div className={cn("text-[11px] font-mono font-bold mt-1", e.realizedPnlUsdt >= 0 ? "text-[#00e59b]" : "text-[#ff4d4d]")}>
                  盈虧: {e.realizedPnlUsdt >= 0 ? "+" : ""}{e.realizedPnlUsdt.toFixed(2)} USDT
                </div>
              )}
              {e.reason && e.status !== "submitted" && (
                <div className="text-[10px] text-destructive/80 mt-1 break-all">{e.reason}</div>
              )}
              {e.chosenProviderId && <div className="text-[9px] text-muted-foreground mt-1">由 {e.chosenProviderId} 觸發</div>}
            </div>
          ))}
          {execList.length === 0 && <div className="text-[11px] text-muted-foreground">尚無執行紀錄。</div>}
        </div>
      </section>

      {/* Recent decisions */}
      <section className="px-4 py-3">
        <div className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground mb-2">近期決策 ({decList.length})</div>
        <div className="space-y-1">
          {decList.slice(0, 15).map((d) => (
            <div key={d.id} className="border border-border rounded-md p-2 bg-background/40 text-[11px] font-mono">
              <div className="flex items-center justify-between">
                <span className="text-foreground">{d.instId}</span>
                <span className="text-muted-foreground">{format(new Date(d.createdAt), "MM-dd HH:mm")}</span>
              </div>
              <div className="flex items-center gap-2 mt-1 text-[10px]">
                <span className={cn(
                  "px-1.5 py-0.5 rounded uppercase font-bold",
                  d.consensusAction === "long" || d.consensusAction === "buy" ? "bg-[#00e59b]/15 text-[#00e59b]" :
                  d.consensusAction === "short" || d.consensusAction === "sell" ? "bg-[#ff4d4d]/15 text-[#ff4d4d]" :
                  d.consensusAction === "close" ? "bg-amber-500/15 text-amber-400" :
                  "bg-muted text-muted-foreground",
                )}>{d.consensusAction === "long" ? "做多" : d.consensusAction === "short" ? "做空" : d.consensusAction === "buy" ? "買入" : d.consensusAction === "sell" ? "賣出" : d.consensusAction === "close" ? "平倉" : "觀望"}</span>
                {d.consensusConfidence != null && <span className="text-muted-foreground">{d.consensusConfidence}/10</span>}
                <span className="text-muted-foreground">[{d.triggeredBy === "auto" ? "排程" : d.triggeredBy === "manual" ? "手動" : d.triggeredBy}]</span>
              </div>
            </div>
          ))}
          {decList.length === 0 && <div className="text-[11px] text-muted-foreground">尚無決策紀錄。</div>}
        </div>
      </section>
    </div>
  );
}
