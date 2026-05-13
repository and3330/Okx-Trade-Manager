import { useState } from "react";
import AccountOverview from "@/components/AccountOverview";
import MarketTickers from "@/components/MarketTickers";
import PerpTickers from "@/components/PerpTickers";
import PriceChart from "@/components/PriceChart";
import OrderForm from "@/components/OrderForm";
import PerpOrderForm from "@/components/PerpOrderForm";
import AiBattle from "@/components/AiBattle";
import RecentOrders from "@/components/RecentOrders";
import RecentFills from "@/components/RecentFills";
import HoldingsList from "@/components/HoldingsList";
import PositionsList from "@/components/PositionsList";
import { cn } from "@/lib/utils";

type Mode = "spot" | "perp";

export default function Dashboard() {
  const [mode, setMode] = useState<Mode>("spot");
  const [spotInstId, setSpotInstId] = useState<string>("BTC-USDT");
  const [perpInstId, setPerpInstId] = useState<string>("BTC-USDT-SWAP");
  const selectedInstId = mode === "spot" ? spotInstId : perpInstId;
  const setSelectedInstId = mode === "spot" ? setSpotInstId : setPerpInstId;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-card px-4">
        <div className="flex items-center gap-4">
          <div className="text-xl font-bold tracking-tight text-primary">
            OKX<span className="text-foreground">TRADER</span>
          </div>
          <div className="h-4 w-px bg-border"></div>
          <div className="flex rounded-md border border-border p-0.5 bg-muted/30">
            <button
              type="button"
              onClick={() => setMode("spot")}
              className={cn(
                "px-4 py-1 text-xs font-bold uppercase rounded transition-colors tracking-wider",
                mode === "spot" ? "bg-[#00e59b] text-[#003d29]" : "text-muted-foreground hover:text-foreground",
              )}
            >Spot</button>
            <button
              type="button"
              onClick={() => setMode("perp")}
              className={cn(
                "px-4 py-1 text-xs font-bold uppercase rounded transition-colors tracking-wider",
                mode === "perp" ? "bg-[#00e59b] text-[#003d29]" : "text-muted-foreground hover:text-foreground",
              )}
            >Perp</button>
          </div>
          <div className="text-sm text-muted-foreground font-medium">
            {mode === "spot" ? "Spot Terminal" : "USDT-Margined Perpetuals"}
          </div>
        </div>
        <AccountOverview />
      </header>

      <main className="flex flex-1 overflow-hidden">
        <aside className="flex w-[320px] shrink-0 flex-col border-r border-border bg-background">
          <div className="flex flex-1 flex-col overflow-hidden">
            {mode === "spot" ? (
              <MarketTickers selectedInstId={spotInstId} onSelectInstId={setSpotInstId} />
            ) : (
              <PerpTickers selectedInstId={perpInstId} onSelectInstId={setPerpInstId} />
            )}
          </div>
          <div className="h-px bg-border"></div>
          <div className="flex h-[40%] flex-col overflow-hidden">
            {mode === "spot" ? (
              <HoldingsList />
            ) : (
              <PositionsList onSelectInstId={setPerpInstId} />
            )}
          </div>
        </aside>

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

        <aside className="flex w-[400px] shrink-0 flex-col border-l border-border bg-card overflow-y-auto">
          <AiBattle instId={selectedInstId} mode={mode} />
          <div className="flex-1">
            {mode === "spot" ? (
              <OrderForm instId={spotInstId} />
            ) : (
              <PerpOrderForm instId={perpInstId} />
            )}
          </div>
        </aside>
      </main>
    </div>
  );
}
