import React from 'react';
import { Link, useLocation } from 'wouter';
import { LayoutDashboard, LineChart, Wallet, Radio, Activity, CandlestickChart } from 'lucide-react';
import { TickerTape } from '@/components/TickerTape';
import { ALL_TICKERS } from '@/lib/markets';

interface NavItem {
  href: string;
  label: string;
  subtitle: string;
  icon: React.ComponentType<{ className?: string }>;
}

const NAV: NavItem[] = [
  { href: '/', label: '總覽', subtitle: '投資組合與市場一覽', icon: LayoutDashboard },
  { href: '/markets', label: '市場行情', subtitle: '走勢圖、技術分析與追蹤切換', icon: LineChart },
  { href: '/trade', label: '交易下單', subtitle: 'OKX 現貨／合約下單、AI 對戰與自動交易', icon: CandlestickChart },
  { href: '/holdings', label: '持倉管理', subtitle: '記錄每一筆買入，自動算出損益', icon: Wallet },
  { href: '/strategy', label: '策略訊號', subtitle: 'TradingView 警報訊號與 Webhook 設定', icon: Radio },
];

function isActive(href: string, location: string): boolean {
  return href === '/' ? location === '/' : location.startsWith(href);
}

export const AppShell: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [location] = useLocation();
  const current = [...NAV].reverse().find((n) => isActive(n.href, location)) ?? NAV[0];
  const fullBleed = isActive('/trade', location);

  return (
    <div className="dark flex h-dvh flex-col bg-background text-foreground">
      <TickerTape symbols={ALL_TICKERS} />

      <header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex w-full max-w-[1600px] items-center gap-4 px-4 py-2.5 md:px-6">
          <div className="flex shrink-0 items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/15 ring-1 ring-primary/30">
              <Activity className="h-5 w-5 text-primary" />
            </div>
            <div className="hidden flex-col sm:flex">
              <span className="text-sm font-semibold leading-tight text-foreground">
                市場監測與交易
              </span>
              <span className="text-[11px] text-muted-foreground">監測 · 下單 · 資產管理</span>
            </div>
          </div>

          <nav className="flex flex-1 items-center gap-1 overflow-x-auto">
            {NAV.map((item) => {
              const active = isActive(item.href, location);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                    active
                      ? 'bg-primary/15 text-primary'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                  }`}
                >
                  <item.icon className="h-4 w-4" />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>

          <div className="hidden shrink-0 items-center gap-2 text-[11px] text-muted-foreground lg:flex">
            <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_6px] shadow-emerald-400/70" />
            即時數據連線中
          </div>
        </div>
      </header>

      {fullBleed ? (
        <main className="flex min-h-0 flex-1 flex-col">{children}</main>
      ) : (
        <main className="flex-1 overflow-y-auto p-4 md:p-6">
          <div className="mx-auto w-full max-w-[1600px] space-y-6">
            <div>
              <h1 className="text-lg font-semibold leading-tight tracking-tight text-foreground md:text-xl">
                {current.label}
              </h1>
              <p className="text-xs text-muted-foreground">{current.subtitle}</p>
            </div>
            {children}
          </div>
        </main>
      )}
    </div>
  );
};
