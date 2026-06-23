import React from 'react';
import { AdvancedChart } from '@/components/AdvancedChart';
import { MarketQuotes } from '@/components/MarketQuotes';
import { TechnicalAnalysis } from '@/components/TechnicalAnalysis';
import { WatchlistManager } from '@/components/WatchlistManager';
import { TwChart } from '@/components/TwChart';
import { TwQuotes } from '@/components/TwQuotes';
import { MARKET_LIST, marketById } from '@/lib/markets';
import { useSelection } from '@/lib/selection';

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
            {active.id === 'tw' ? (
              <TwChart symbol={symbol} />
            ) : (
              <AdvancedChart symbol={symbol} />
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
            {active.id === 'tw' ? (
              <TwQuotes
                symbols={active.quotes}
                onSelect={select}
                selectedSymbol={symbol}
              />
            ) : (
              <MarketQuotes symbols={active.quotes} title={active.label} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
