import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { useListTwQuotes } from '@workspace/api-client-react';
import { normalizeTwCode, type MarketQuote } from '@/lib/markets';

interface TwQuotesProps {
  symbols: MarketQuote[];
  onSelect?: (symbol: string, market: 'tw') => void;
  selectedSymbol?: string;
}

function fmt(n: number | null | undefined): string {
  if (n == null) return '—';
  return n.toLocaleString('zh-TW', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export const TwQuotes: React.FC<TwQuotesProps> = ({
  symbols,
  onSelect,
  selectedSymbol,
}) => {
  const codes = symbols.map((s) => normalizeTwCode(s.name)).join(',');
  const nameByCode = new Map(
    symbols.map((s) => [normalizeTwCode(s.name), s]),
  );

  const { data, isLoading, isError } = useListTwQuotes(
    { codes },
    {
      query: {
        queryKey: ['tw-quotes', codes],
        refetchInterval: 30_000,
        staleTime: 20_000,
      },
    },
  );

  return (
    <Card className="bg-card">
      <CardContent className="p-4">
        {isLoading && (
          <p className="py-6 text-center text-sm text-muted-foreground">
            載入官方台股報價中…
          </p>
        )}
        {isError && (
          <p className="py-6 text-center text-sm text-muted-foreground">
            暫時無法取得台股報價，請稍後再試。
          </p>
        )}
        {data && (
          <div className="space-y-1">
            {data.map((q) => {
              const meta = nameByCode.get(q.code);
              const display = meta?.displayName ?? q.name;
              const uiSymbol = meta?.name ?? `TWSE:${q.code}`;
              const up = (q.change ?? 0) > 0;
              const down = (q.change ?? 0) < 0;
              const colorClass = up
                ? 'text-red-400'
                : down
                  ? 'text-emerald-400'
                  : 'text-muted-foreground';
              return (
                <button
                  key={q.code}
                  type="button"
                  onClick={() => onSelect?.(uiSymbol, 'tw')}
                  className={`flex w-full items-center justify-between rounded-md px-2 py-2 text-left text-sm transition-colors hover:bg-muted/50 ${
                    selectedSymbol === uiSymbol ? 'bg-muted/60' : ''
                  }`}
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium text-foreground">
                      {display}
                    </div>
                    <div className="text-xs text-muted-foreground">{q.code}</div>
                  </div>
                  <div className="text-right">
                    <div className="tabular-nums text-foreground">
                      {fmt(q.price)}
                    </div>
                    <div className={`text-xs tabular-nums ${colorClass}`}>
                      {q.change == null
                        ? '—'
                        : `${up ? '+' : ''}${fmt(q.change)} (${
                            up ? '+' : ''
                          }${(q.changePct ?? 0).toFixed(2)}%)`}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          資料來源：台灣證券交易所公開資訊・約 20 秒更新（紅漲綠跌）。
        </p>
      </CardContent>
    </Card>
  );
};
