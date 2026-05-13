import { useListOrders, getListOrdersQueryKey } from "@workspace/api-client-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

export default function RecentOrders() {
  const { data: orders, isLoading } = useListOrders({
    query: { refetchInterval: 5000, queryKey: getListOrdersQueryKey() }
  });

  return (
    <div className="flex h-full flex-col">
      <div className="px-4 py-2 border-b border-border bg-card">
        <span className="text-xs font-semibold text-muted-foreground tracking-wider uppercase">近期訂單</span>
      </div>
      <ScrollArea className="flex-1">
        {isLoading ? (
          <div className="p-4 text-center text-sm text-muted-foreground">載入訂單中...</div>
        ) : orders?.length === 0 ? (
          <div className="p-4 text-center text-sm text-muted-foreground">尚無訂單</div>
        ) : (
          <div className="divide-y divide-border">
            {orders?.map((order) => (
              <div key={order.ordId} className="p-3 hover:bg-muted/30 transition-colors flex justify-between items-center text-sm">
                <div>
                  <div className="flex items-center gap-2">
                    <span className={cn(
                      "font-bold uppercase text-xs px-1.5 py-0.5 rounded",
                      order.side === "buy" ? "bg-[#00e59b]/20 text-[#00e59b]" : "bg-[#ff4d4d]/20 text-[#ff4d4d]"
                    )}>
                      {order.side === "buy" ? "買入" : "賣出"}
                    </span>
                    <span className="font-bold text-foreground">{order.instId}</span>
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {format(new Date(order.createdAt), "MMM dd, HH:mm:ss")}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-mono text-foreground">{order.sz}</div>
                  <div className="text-xs mt-1">
                    <span className={cn(
                      "font-semibold",
                      order.state === "filled" ? "text-muted-foreground" : "text-primary"
                    )}>
                      {order.state === "filled" ? "已成交" : order.state === "live" ? "掛單中" : order.state === "canceled" ? "已取消" : order.state === "partially_filled" ? "部分成交" : order.state.toUpperCase()}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
