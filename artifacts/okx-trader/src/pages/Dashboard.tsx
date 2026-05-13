import { useState } from "react";
import AccountOverview from "@/components/AccountOverview";
import MarketTickers from "@/components/MarketTickers";
import PriceChart from "@/components/PriceChart";
import OrderForm from "@/components/OrderForm";
import AiAnalysis from "@/components/AiAnalysis";
import RecentOrders from "@/components/RecentOrders";
import RecentFills from "@/components/RecentFills";
import HoldingsList from "@/components/HoldingsList";

export default function Dashboard() {
  const [selectedInstId, setSelectedInstId] = useState<string>("BTC-USDT");

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      {/* Top Header */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-card px-4">
        <div className="flex items-center gap-4">
          <div className="text-xl font-bold tracking-tight text-primary">
            OKX<span className="text-foreground">TRADER</span>
          </div>
          <div className="h-4 w-px bg-border"></div>
          <div className="text-sm text-muted-foreground font-medium">Spot Terminal</div>
        </div>
        <AccountOverview />
      </header>

      {/* Main Grid */}
      <main className="flex flex-1 overflow-hidden">
        {/* Left Sidebar: Markets & Holdings */}
        <aside className="flex w-[320px] shrink-0 flex-col border-r border-border bg-background">
          <div className="flex flex-1 flex-col overflow-hidden">
            <MarketTickers
              selectedInstId={selectedInstId}
              onSelectInstId={setSelectedInstId}
            />
          </div>
          <div className="h-px bg-border"></div>
          <div className="flex h-[40%] flex-col overflow-hidden">
            <HoldingsList />
          </div>
        </aside>

        {/* Center: Chart & Activity */}
        <section className="flex flex-1 flex-col overflow-hidden bg-background">
          <div className="flex-1 overflow-hidden border-b border-border bg-card">
            <PriceChart instId={selectedInstId} />
          </div>
          <div className="flex h-[35%] shrink-0">
            <div className="flex-1 border-r border-border overflow-hidden">
              <RecentOrders />
            </div>
            <div className="flex-1 overflow-hidden">
              <RecentFills />
            </div>
          </div>
        </section>

        {/* Right Sidebar: Order Entry + AI Analysis */}
        <aside className="flex w-[360px] shrink-0 flex-col border-l border-border bg-card overflow-y-auto">
          <AiAnalysis instId={selectedInstId} />
          <div className="flex-1">
            <OrderForm instId={selectedInstId} />
          </div>
        </aside>
      </main>
    </div>
  );
}
