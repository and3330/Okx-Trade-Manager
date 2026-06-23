import React from 'react';
import { Link, useLocation } from 'wouter';
import {
  useListHoldings,
  useListWatchlist,
  getListHoldingsQueryKey,
} from '@workspace/api-client-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { SignalsPanel } from '@/components/SignalsPanel';
import {
  MARKET_LABELS,
  MARKET_CCY,
  fmt,
  plClass,
  plLabel,
  buildRow,
  summarizeByMarket,
} from '@/lib/holdings';
import { useSelection } from '@/lib/selection';
import { Wallet, LineChart, ListChecks, ArrowRight } from 'lucide-react';

export default function Overview() {
  const [, navigate] = useLocation();
  const { select } = useSelection();
  const { data: holdings } = useListHoldings({
    query: { queryKey: getListHoldingsQueryKey(), refetchInterval: 30000 },
  });
  const { data: watchlist } = useListWatchlist();

  const rows = (holdings ?? []).map(buildRow);
  const summaries = summarizeByMarket(rows);
  const items = watchlist ?? [];

  const openSymbol = (symbol: string, market: string) => {
    select(symbol, market);
    navigate('/markets');
  };

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <div className="flex items-center justify-between px-1">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Wallet className="h-5 w-5 text-primary" />
            投資組合總覽
          </h2>
          <Button asChild variant="ghost" size="sm" className="text-muted-foreground">
            <Link href="/holdings">
              管理持倉 <ArrowRight className="ml-1 h-4 w-4" />
            </Link>
          </Button>
        </div>

        {summaries.length === 0 ? (
          <Card className="border-dashed border-muted-foreground/30 bg-card/50">
            <CardContent className="flex flex-col items-center justify-center gap-3 py-10 text-center">
              <Wallet className="h-8 w-8 text-muted-foreground" />
              <p className="text-base font-medium text-foreground">尚未記錄任何持倉</p>
              <p className="max-w-md text-sm text-muted-foreground">
                到「持倉管理」記下每一筆買入（在哪買、成本、數量），系統會自動幫你算出市值與損益。
              </p>
              <Button asChild className="mt-1">
                <Link href="/holdings">新增第一筆持倉</Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {summaries.map((s) => (
              <Card key={s.market} className="bg-card/50">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-foreground">
                      {MARKET_LABELS[s.market] ?? s.market}
                    </span>
                    <span className="text-xs text-muted-foreground">{MARKET_CCY[s.market]}</span>
                  </div>
                  <div className="mt-3 space-y-1.5">
                    <div className="flex items-baseline justify-between">
                      <span className="text-xs text-muted-foreground">市值</span>
                      <span className="text-lg font-semibold tabular-nums text-foreground">
                        {s.marketValue != null ? fmt(s.marketValue) : '—'}
                      </span>
                    </div>
                    <div className="flex items-baseline justify-between text-xs">
                      <span className="text-muted-foreground">總成本</span>
                      <span className="tabular-nums text-muted-foreground">{fmt(s.totalCost)}</span>
                    </div>
                    <div className="flex items-baseline justify-between text-xs">
                      <span className="text-muted-foreground">未實現損益</span>
                      <span className={`tabular-nums font-medium ${plClass(s.pl)}`}>
                        {plLabel(s.pl, s.plPct)}
                      </span>
                    </div>
                  </div>
                  {s.unpriced > 0 && (
                    <p className="mt-2 text-[11px] text-amber-400/90">
                      有 {s.unpriced} 筆尚未設定現價
                    </p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <SignalsPanel />

        <Card className="bg-card/50">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-xl">
              <ListChecks className="h-5 w-5 text-primary" />
              我的追蹤清單
            </CardTitle>
            <CardDescription>點任一標的即可跳到市場行情看走勢圖與報價。</CardDescription>
          </CardHeader>
          <CardContent>
            {items.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-8 text-center">
                <LineChart className="h-7 w-7 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">還沒有追蹤的標的。</p>
                <Button asChild variant="outline" size="sm">
                  <Link href="/markets">前往市場行情新增</Link>
                </Button>
              </div>
            ) : (
              <div className="divide-y divide-border/40">
                {items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => openSymbol(item.symbol, item.market)}
                    className="flex w-full items-center justify-between py-2.5 text-left transition-colors hover:text-primary"
                  >
                    <span className="text-sm font-medium text-foreground">{item.displayName}</span>
                    <span className="text-xs text-muted-foreground">
                      {MARKET_LABELS[item.market] ?? item.market} · {item.symbol}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
