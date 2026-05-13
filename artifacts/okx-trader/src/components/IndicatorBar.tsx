import { Button } from "@/components/ui/button";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { useRunResearchPipeline } from "@workspace/api-client-react";

type Snapshot = {
  fundingRate?: number | null;
  longShortRatio?: number | null;
  takerBuyRatio?: number | null;
  atr1H?: number | null;
  indicatorTextByBar?: string | null;
};

function Tile({ label, value, tone }: { label: string; value: string; tone?: "pos" | "neg" | "neutral" }) {
  const colorMap: Record<string, string> = {
    pos: "text-[#00e59b]",
    neg: "text-[#ff4d4d]",
    neutral: "text-foreground",
  };
  return (
    <div className="flex flex-col px-3 py-1.5 border-r border-border last:border-r-0 min-w-[100px]">
      <span className="text-[9px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</span>
      <span className={cn("text-xs font-mono font-semibold", colorMap[tone ?? "neutral"])}>{value}</span>
    </div>
  );
}

export default function IndicatorBar({ instId, mode = "perp" }: { instId: string; mode?: "spot" | "perp" }) {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [snapInst, setSnapInst] = useState<string>(instId);
  const research = useRunResearchPipeline();

  const refresh = () => {
    research.mutate(
      { data: { instId, mode } as any },
      {
        onSuccess: (res: any) => {
          setSnap(res);
          setSnapInst(res.instId);
        },
      },
    );
  };

  const stale = snap && snapInst !== instId;
  const fr = snap?.fundingRate;
  const lsr = snap?.longShortRatio;
  const tbr = snap?.takerBuyRatio;
  const atr = snap?.atr1H;

  return (
    <div className="flex items-center justify-between border-b border-border bg-card/60">
      <div className="flex items-center overflow-x-auto">
        {snap && !stale ? (
          <>
            {fr != null && (
              <Tile label="資金費率/8H" value={`${(fr * 100).toFixed(4)}%`} tone={fr > 0.0005 ? "neg" : fr < -0.0001 ? "pos" : "neutral"} />
            )}
            {lsr != null && (
              <Tile label="多空比" value={lsr.toFixed(2)} tone={lsr > 1.5 ? "neg" : lsr < 0.7 ? "pos" : "neutral"} />
            )}
            {tbr != null && (
              <Tile label="主買佔比" value={`${(tbr * 100).toFixed(1)}%`} tone={tbr > 0.6 ? "pos" : tbr < 0.4 ? "neg" : "neutral"} />
            )}
            {atr != null && <Tile label="ATR 1H" value={atr.toFixed(2)} />}
          </>
        ) : (
          <div className="px-3 py-2 text-[11px] text-muted-foreground">
            {research.isPending ? "載入市場數據中..." : stale ? `舊資料 (${snapInst})` : "點「載入」抓取資金費率 / 持倉 / 情緒等市場數據。"}
          </div>
        )}
      </div>
      <Button size="sm" variant="ghost" className="h-7 mr-2 text-[11px]" onClick={refresh} disabled={research.isPending}>
        {research.isPending ? "..." : snap ? "重新載入" : "載入"}
      </Button>
    </div>
  );
}
