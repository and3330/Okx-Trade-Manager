import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { AdvancedChart } from '@/components/AdvancedChart';
import { MarketQuotes } from '@/components/MarketQuotes';
import { TechnicalAnalysis } from '@/components/TechnicalAnalysis';
import { WatchlistManager } from '@/components/WatchlistManager';
import { MARKET_LIST, marketById } from '@/lib/markets';
import { useSelection } from '@/lib/selection';
import { Activity } from 'lucide-react';

export default function Markets() {
  const { symbol, market, select } = useSelection();
  const active = marketById(market) ?? MARKET_LIST[0];

  return (
    <div className="space-y-6">
      <div className="inline-flex rounded-md bg-muted/50 p-1">
        {MARKET_LIST.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => select(m.defaultSymbol, m.id)}
            className={`rounded px-4 py-1.5 text-sm font-medium transition-colors ${
              m.id === market
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <div className="space-y-2">
            <h2 className="px-1 text-lg font-semibold">{active.label} 走勢圖</h2>
            {active.embeddable ? (
              <AdvancedChart symbol={symbol} />
            ) : (
              <Card className="border-dashed border-muted-foreground/30 bg-card/50">
                <CardContent className="flex h-[400px] flex-col items-center justify-center gap-3 p-6 text-center">
                  <Activity className="h-8 w-8 text-muted-foreground" />
                  <p className="text-base font-medium text-foreground">台股資料來源建置中</p>
                  <p className="max-w-md text-sm text-muted-foreground">
                    TradingView 的免費圖表受交易所授權限制，無法顯示台股即時報價。待接上官方台股資料來源後，這裡會顯示完整走勢圖與報價。美股與虛擬貨幣皆為即時資料。
                  </p>
                </CardContent>
              </Card>
            )}
          </div>

          {active.embeddable && (
            <div className="space-y-2">
              <h2 className="px-1 text-lg font-semibold">技術分析</h2>
              <TechnicalAnalysis symbol={symbol} />
            </div>
          )}
        </div>

        <div className="space-y-6">
          <div className="space-y-2">
            <h2 className="px-1 text-lg font-semibold">我的追蹤清單</h2>
            <WatchlistManager onSelect={select} selectedSymbol={symbol} />
          </div>

          <div className="space-y-2">
            <h2 className="px-1 text-lg font-semibold">{active.label} 報價</h2>
            {active.embeddable ? (
              <MarketQuotes symbols={active.quotes} title={active.label} />
            ) : (
              <Card className="border-dashed border-muted-foreground/30 bg-card/50">
                <CardContent className="space-y-2 p-4">
                  <p className="mb-3 text-sm text-muted-foreground">監測標的（資料待接）</p>
                  {active.quotes.map((q) => (
                    <div
                      key={q.name}
                      className="flex items-center justify-between border-b border-border/40 py-2 text-sm last:border-0"
                    >
                      <span className="text-foreground">{q.displayName}</span>
                      <span className="tabular-nums text-muted-foreground">—</span>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
