import { useListRecentFills, getListRecentFillsQueryKey } from "@workspace/api-client-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

export default function RecentFills() {
  const { data: fills, isLoading } = useListRecentFills({
    query: { refetchInterval: 5000, queryKey: getListRecentFillsQueryKey() }
  });

  return (
    <div className="flex h-full flex-col">
      <div className="px-4 py-2 border-b border-border bg-card">
        <span className="text-xs font-semibold text-muted-foreground tracking-wider uppercase">Market Fills</span>
      </div>
      <ScrollArea className="flex-1">
        {isLoading ? (
          <div className="p-4 text-center text-sm text-muted-foreground">Loading fills...</div>
        ) : fills?.length === 0 ? (
          <div className="p-4 text-center text-sm text-muted-foreground">No recent fills</div>
        ) : (
          <div className="divide-y divide-border">
            {fills?.map((fill) => (
              <div key={fill.tradeId} className="flex justify-between items-center p-2 px-4 hover:bg-muted/30 transition-colors text-sm">
                <div className="flex flex-col">
                  <span className="font-mono text-xs text-muted-foreground">
                    {format(new Date(fill.ts), "HH:mm:ss")}
                  </span>
                </div>
                <span className={cn(
                  "font-mono font-medium",
                  fill.side === "buy" ? "text-[#00e59b]" : "text-[#ff4d4d]"
                )}>
                  {fill.fillPx.toLocaleString()}
                </span>
                <span className="font-mono text-foreground text-right w-20">
                  {fill.fillSz}
                </span>
              </div>
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
