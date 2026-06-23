import React from 'react';
import { Link, useLocation } from 'wouter';
import { LayoutDashboard, LineChart, Wallet, Radio, Activity } from 'lucide-react';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar';
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
  { href: '/holdings', label: '持倉管理', subtitle: '記錄每一筆買入，自動算出損益', icon: Wallet },
  { href: '/strategy', label: '策略訊號', subtitle: 'TradingView 警報訊號與 Webhook 設定', icon: Radio },
];

function isActive(href: string, location: string): boolean {
  return href === '/' ? location === '/' : location.startsWith(href);
}

export const AppShell: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [location] = useLocation();
  const current = [...NAV].reverse().find((n) => isActive(n.href, location)) ?? NAV[0];

  return (
    <div className="dark">
      <SidebarProvider>
        <Sidebar collapsible="icon">
          <SidebarHeader>
            <div className="flex items-center gap-2.5 px-2 py-1.5">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/15 ring-1 ring-primary/30">
                <Activity className="h-5 w-5 text-primary" />
              </div>
              <div className="flex flex-col group-data-[collapsible=icon]:hidden">
                <span className="text-sm font-semibold leading-tight text-foreground">
                  每日市場監測
                </span>
                <span className="text-[11px] text-muted-foreground">市場監測 · 資產管理</span>
              </div>
            </div>
          </SidebarHeader>

          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupContent>
                <SidebarMenu>
                  {NAV.map((item) => (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton
                        asChild
                        isActive={isActive(item.href, location)}
                        tooltip={item.label}
                      >
                        <Link href={item.href}>
                          <item.icon className="h-4 w-4" />
                          <span>{item.label}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>

          <SidebarFooter>
            <div className="flex items-center gap-2 px-2 py-1.5 text-[11px] text-muted-foreground group-data-[collapsible=icon]:hidden">
              <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_6px] shadow-emerald-400/70" />
              即時數據連線中
            </div>
          </SidebarFooter>
        </Sidebar>

        <SidebarInset className="bg-background">
          <TickerTape symbols={ALL_TICKERS} />
          <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-border bg-background/80 px-4 py-3 backdrop-blur md:px-6">
            <SidebarTrigger className="-ml-1" />
            <div className="flex flex-col">
              <h1 className="text-lg font-semibold leading-tight tracking-tight text-foreground md:text-xl">
                {current.label}
              </h1>
              <p className="text-xs text-muted-foreground">{current.subtitle}</p>
            </div>
          </header>
          <main className="flex-1 p-4 md:p-6">
            <div className="mx-auto w-full max-w-[1600px]">{children}</div>
          </main>
        </SidebarInset>
      </SidebarProvider>
    </div>
  );
};
