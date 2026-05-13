import { useListTopTickers, getListTopTickersQueryKey } from "@workspace/api-client-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

interface MarketTickersProps {
  selectedInstId: string;
  onSelectInstId: (instId: string) => void;
}

export default function MarketTickers({ selectedInstId, onSelectInstId }: MarketTickersProps) {
  const { data: tickers, isLoading } = useListTopTickers({
    query: { refetchInterval: 3000, queryKey: getListTopTickersQueryKey() }
  });

  return (
    <div className="flex h-full flex-col">
      <div className="px-4 py-2 flex items-center justify-between border-b border-border bg-card">
        <span className="text-xs font-semibold text-muted-foreground tracking-wider uppercase">Markets</span>
        <span className="text-xs font-semibold text-muted-foreground tracking-wider uppercase">24H Chg</span>
      </div>
      <ScrollArea className="flex-1">
        {isLoading ? (
          <div className="p-4 text-center text-sm text-muted-foreground">Loading...</div>
        ) : (
          <div className="divide-y divide-border">
            {tickers?.map((ticker) => {
              const isPositive = ticker.changePct24h >= 0;
              return (
                <button
                  key={ticker.instId}
                  onClick={() => onSelectInstId(ticker.instId)}
                  className={cn(
                    "w-full flex items-center justify-between p-3 text-left transition-colors",
                    selectedInstId === ticker.instId ? "bg-accent/50" : "hover:bg-muted/50"
                  )}
                >
                  <div className="flex flex-col">
                    <span className="font-bold text-sm text-foreground">{ticker.instId}</span>
                    <span className="text-xs text-muted-foreground mt-0.5 font-mono">Vol: {Math.floor(ticker.vol24h).toLocaleString()}</span>
                  </div>
                  <div className="flex flex-col items-end">
                    <span className="font-mono text-sm text-foreground">{ticker.last}</span>
                    <span className={cn(
                      "text-xs font-mono font-medium mt-0.5",
                      isPositive ? "text-[#00e59b]" : "text-[#ff4d4d]"
                    )}>
                      {isPositive ? "+" : ""}{ticker.changePct24h.toFixed(2)}%
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
