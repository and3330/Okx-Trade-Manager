import { useGetAccountBalance, getGetAccountBalanceQueryKey } from "@workspace/api-client-react";
import { ScrollArea } from "@/components/ui/scroll-area";

export default function HoldingsList() {
  const { data: balance, isLoading } = useGetAccountBalance({
    query: { refetchInterval: 5000, queryKey: getGetAccountBalanceQueryKey() }
  });

  return (
    <div className="flex h-full flex-col">
      <div className="px-4 py-2 text-xs font-semibold text-muted-foreground tracking-wider uppercase border-b border-border bg-card">
        現貨持倉
      </div>
      <ScrollArea className="flex-1">
        {isLoading ? (
          <div className="p-4 text-center text-sm text-muted-foreground">載入中...</div>
        ) : balance?.assets.length === 0 ? (
          <div className="p-4 text-center text-sm text-muted-foreground">尚無持倉</div>
        ) : (
          <div className="divide-y divide-border">
            {balance?.assets.map((asset) => (
              <div key={asset.ccy} className="flex items-center justify-between p-3 hover:bg-muted/50 transition-colors">
                <div>
                  <div className="font-bold text-foreground">{asset.ccy}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">可用: {asset.available}</div>
                </div>
                <div className="text-right">
                  <div className="font-mono text-sm text-foreground">
                    ${asset.equityUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                  {asset.frozen > 0 && (
                    <div className="text-xs text-muted-foreground font-mono mt-0.5">凍結: {asset.frozen}</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
