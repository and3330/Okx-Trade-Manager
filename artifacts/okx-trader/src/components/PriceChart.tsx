import { useMemo } from "react";
import { useGetCandles, useGetTicker, getGetCandlesQueryKey, getGetTickerQueryKey } from "@workspace/api-client-react";
import {
  ComposedChart,
  Line,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  LineChart
} from "recharts";
import { format } from "date-fns";

export default function PriceChart({ instId }: { instId: string }) {
  const { data: ticker } = useGetTicker(instId, {
    query: {
      enabled: !!instId,
      queryKey: getGetTickerQueryKey(instId),
      refetchInterval: 3000
    }
  });

  const { data: candles, isLoading } = useGetCandles(instId, {
    query: {
      enabled: !!instId,
      queryKey: getGetCandlesQueryKey(instId),
      refetchInterval: 10000
    }
  });

  const chartData = useMemo(() => {
    if (!candles) return [];
    // Sort chronological for recharts
    return [...candles]
      .sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime())
      .map(c => ({
        ...c,
        isUp: c.close >= c.open,
        formattedDate: format(new Date(c.ts), "HH:mm")
      }));
  }, [candles]);

  const isPositive = ticker ? ticker.changePct24h >= 0 : true;

  return (
    <div className="flex h-full flex-col p-4 relative">
      {/* Ticker Header */}
      <div className="flex items-end justify-between mb-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-foreground">{instId}</h2>
          {ticker && (
            <div className="flex items-center gap-3 mt-1">
              <span className="text-xl font-mono">{ticker.last}</span>
              <span className={`text-sm font-mono font-medium ${isPositive ? "text-[#00e59b]" : "text-[#ff4d4d]"}`}>
                {isPositive ? "+" : ""}{ticker.changePct24h.toFixed(2)}%
              </span>
            </div>
          )}
        </div>
        {ticker && (
          <div className="flex gap-6 text-right hidden md:flex">
            <div className="flex flex-col">
              <span className="text-xs text-muted-foreground uppercase">24H High</span>
              <span className="text-sm font-mono text-foreground">{ticker.high24h}</span>
            </div>
            <div className="flex flex-col">
              <span className="text-xs text-muted-foreground uppercase">24H Low</span>
              <span className="text-sm font-mono text-foreground">{ticker.low24h}</span>
            </div>
            <div className="flex flex-col">
              <span className="text-xs text-muted-foreground uppercase">24H Vol</span>
              <span className="text-sm font-mono text-foreground">{Math.floor(ticker.vol24h).toLocaleString()}</span>
            </div>
          </div>
        )}
      </div>

      {/* Chart */}
      <div className="flex-1 min-h-[200px]">
        {isLoading ? (
          <div className="flex items-center justify-center h-full text-muted-foreground">Loading chart data...</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 5, right: 0, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis 
                dataKey="formattedDate" 
                stroke="hsl(var(--muted-foreground))" 
                fontSize={11} 
                tickLine={false}
                axisLine={false}
                minTickGap={30}
              />
              <YAxis 
                yAxisId="price"
                domain={['auto', 'auto']} 
                orientation="right" 
                stroke="hsl(var(--muted-foreground))" 
                fontSize={11}
                tickLine={false}
                axisLine={false}
                tickFormatter={(val) => val.toLocaleString()}
              />
              <Tooltip
                contentStyle={{ backgroundColor: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: '4px' }}
                itemStyle={{ color: 'hsl(var(--foreground))' }}
                labelStyle={{ color: 'hsl(var(--muted-foreground))' }}
              />
              {/* Close Price Line */}
              <Line 
                yAxisId="price"
                type="monotone" 
                dataKey="close" 
                stroke={isPositive ? "hsl(156, 72%, 51%)" : "hsl(350, 89%, 60%)"} 
                dot={false}
                strokeWidth={2}
              />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
