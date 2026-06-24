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
import IndicatorBar from "@/components/IndicatorBar";
import AutoTradePanel from "@/components/AutoTradePanel";
import AutoTradeHistory from "@/components/AutoTradeHistory";
import { cn } from "@/lib/utils";

type Mode = "spot" | "perp";
type RightTab = "battle" | "auto" | "history";
type Exchange = "okx" | "pionex";

const EXCHANGES: { id: Exchange; label: string; enabled: boolean }[] = [
  { id: "okx", label: "OKX", enabled: true },
  { id: "pionex", label: "派網 Pionex", enabled: false },
];

export default function Trade() {
  const [exchange, setExchange] = useState<Exchange>("okx");
  const [mode, setMode] = useState<Mode>("spot");
  const [spotInstId, setSpotInstId] = useState<string>("BTC-USDT");
  const [perpInstId, setPerpInstId] = useState<string>("BTC-USDT-SWAP");
  const selectedInstId = mode === "spot" ? spotInstId : perpInstId;
  const [rightTab, setRightTab] = useState<RightTab>("battle");

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-card px-4">
        <div className="flex items-center gap-4">
          <div className="flex rounded-md border border-border p-0.5 bg-muted/30">
            {EXCHANGES.map((ex) => (
              <button
                key={ex.id}
                type="button"
                disabled={!ex.enabled}
                onClick={() => ex.enabled && setExchange(ex.id)}
                title={ex.enabled ? undefined : "尚未綁定，敬請期待"}
                className={cn(
                  "px-3 py-1 text-xs font-bold rounded transition-colors tracking-wide",
                  exchange === ex.id
                    ? "bg-[#00e59b] text-[#003d29]"
                    : ex.enabled
                      ? "text-muted-foreground hover:text-foreground"
                      : "text-muted-foreground/40 cursor-not-allowed",
                )}
              >
                {ex.label}
                {!ex.enabled && <span className="ml-1 text-[10px] font-normal">待綁定</span>}
              </button>
            ))}
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
            >現貨</button>
            <button
              type="button"
              onClick={() => setMode("perp")}
              className={cn(
                "px-4 py-1 text-xs font-bold uppercase rounded transition-colors tracking-wider",
                mode === "perp" ? "bg-[#00e59b] text-[#003d29]" : "text-muted-foreground hover:text-foreground",
              )}
            >合約</button>
          </div>
          <div className="hidden text-sm text-muted-foreground font-medium md:block">
            {mode === "spot" ? "現貨交易台" : "USDT 本位永續合約"}
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
          {mode === "perp" && <IndicatorBar instId={perpInstId} mode="perp" />}
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

        <aside className="flex w-[420px] shrink-0 flex-col border-l border-border bg-card overflow-hidden">
          <div className="flex border-b border-border shrink-0">
            {(["battle", "auto", "history"] as RightTab[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setRightTab(t)}
                className={cn(
                  "flex-1 px-3 py-2 text-[11px] font-bold uppercase tracking-wider transition-colors",
                  rightTab === t
                    ? "bg-card text-[#00e59b] border-b-2 border-[#00e59b]"
                    : "text-muted-foreground hover:text-foreground border-b-2 border-transparent",
                )}
              >
                {t === "battle" ? "AI 對戰" : t === "auto" ? "自動交易" : "歷史紀錄"}
              </button>
            ))}
          </div>
          <div className="flex-1 overflow-hidden">
            {rightTab === "battle" && (
              <div className="flex flex-col h-full overflow-y-auto">
                <AiBattle instId={selectedInstId} mode={mode} />
                <div className="flex-1">
                  {mode === "spot" ? <OrderForm instId={spotInstId} /> : <PerpOrderForm instId={perpInstId} />}
                </div>
              </div>
            )}
            {rightTab === "auto" && <AutoTradePanel />}
            {rightTab === "history" && <AutoTradeHistory />}
          </div>
        </aside>
      </main>
    </div>
  );
}
