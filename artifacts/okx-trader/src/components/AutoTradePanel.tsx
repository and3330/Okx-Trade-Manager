import { useEffect, useState } from "react";
import {
  useGetAutoTradeConfig,
  useUpdateAutoTradeConfig,
  useGetAutoTradeStatus,
  useKillAutoTrade,
  useRunAutoTradeCycleNow,
  getGetAutoTradeStatusQueryKey,
  getGetAutoTradeConfigQueryKey,
  getListAutoTradeDecisionsQueryKey,
  getListAutoTradeExecutionsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { format } from "date-fns";

type Cfg = {
  enabled: boolean;
  whitelist: string[];
  scannerEnabled: boolean;
  scannerPickCount: number;
  scannerMinVolUsd24h: number;
  maxMarginPctPerTrade: number;
  maxDailyLossPct: number;
  maxConcurrentPositions: number;
  maxLeverage: number;
  minConsensusCount: number;
  minAvgConfidence: number;
  cooldownMinutes: number;
  rulesOnlyMode: boolean;
  cycleIntervalMinutes: number;
  slPct: number;
  tpPct: number;
  reverseCooldownHours: number;
  blockPyramiding: boolean;
  killUntil: string | null;
  updatedAt: string;
};

export default function AutoTradePanel() {
  const qc = useQueryClient();
  const { data: cfgData } = useGetAutoTradeConfig({ query: { queryKey: getGetAutoTradeConfigQueryKey(), refetchInterval: 30_000 } });
  const { data: statusData } = useGetAutoTradeStatus({ query: { queryKey: getGetAutoTradeStatusQueryKey(), refetchInterval: 5_000 } });
  const updateMut = useUpdateAutoTradeConfig();
  const killMut = useKillAutoTrade();
  const runNowMut = useRunAutoTradeCycleNow();

  const [draft, setDraft] = useState<Cfg | null>(null);
  useEffect(() => {
    if (cfgData && !draft) setDraft(cfgData as Cfg);
  }, [cfgData, draft]);

  if (!draft) return <div className="p-4 text-xs text-muted-foreground">載入設定中...</div>;

  const status = statusData as
    | {
        enabled: boolean;
        killed: boolean;
        killUntil: string | null;
        lastCycleAt: string | null;
        nextCycleAt: string | null;
        recentExecutionCount: number;
        openPositionCount: number;
        dailyRealizedPnlUsdt: number;
        currentEquityUsdt: number;
        message: string | null;
      }
    | undefined;

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: getGetAutoTradeConfigQueryKey() });
    qc.invalidateQueries({ queryKey: getGetAutoTradeStatusQueryKey() });
    qc.invalidateQueries({ queryKey: getListAutoTradeDecisionsQueryKey() });
    qc.invalidateQueries({ queryKey: getListAutoTradeExecutionsQueryKey() });
  };

  const save = () => {
    updateMut.mutate(
      {
        data: {
          enabled: draft.enabled,
          whitelist: draft.whitelist,
          scannerEnabled: draft.scannerEnabled,
          scannerPickCount: Number(draft.scannerPickCount),
          scannerMinVolUsd24h: Number(draft.scannerMinVolUsd24h),
          maxMarginPctPerTrade: Number(draft.maxMarginPctPerTrade),
          maxDailyLossPct: Number(draft.maxDailyLossPct),
          maxConcurrentPositions: Number(draft.maxConcurrentPositions),
          maxLeverage: Number(draft.maxLeverage),
          minConsensusCount: Number(draft.minConsensusCount),
          minAvgConfidence: Number(draft.minAvgConfidence),
          cooldownMinutes: Number(draft.cooldownMinutes),
          rulesOnlyMode: draft.rulesOnlyMode,
          cycleIntervalMinutes: Number(draft.cycleIntervalMinutes),
          slPct: Number(draft.slPct),
          tpPct: Number(draft.tpPct),
          reverseCooldownHours: Number(draft.reverseCooldownHours),
          blockPyramiding: draft.blockPyramiding,
        },
      },
      {
        onSuccess: (res) => {
          setDraft(res as Cfg);
          toast.success(`自動交易已${(res as Cfg).enabled ? "啟用" : "儲存"}`);
          invalidate();
        },
        onError: (err: any) => toast.error(`儲存失敗：${err?.data?.error || err?.message}`),
      },
    );
  };

  const kill = () => {
    if (!confirm("停止自動交易引擎 24 小時？已開倉的部位不會自動平掉。")) return;
    killMut.mutate(undefined, {
      onSuccess: () => { toast.success("引擎已停止"); invalidate(); setDraft({ ...draft, enabled: false }); },
      onError: (err: any) => toast.error(`停止失敗：${err?.data?.error || err?.message}`),
    });
  };

  const runNow = () => {
    runNowMut.mutate(undefined, {
      onSuccess: (res: any) => {
        toast.success(`本輪完成：${res.perInstrument.length} 個交易對`);
        invalidate();
      },
      onError: (err: any) => toast.error(`執行失敗：${err?.data?.error || err?.message}`),
    });
  };

  const killed = status?.killed ?? false;
  const enabled = status?.enabled ?? false;

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Status */}
      <div className="px-4 py-3 border-b border-border bg-card">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className={cn(
              "h-2 w-2 rounded-full",
              killed ? "bg-[#ff4d4d]" : enabled ? "bg-[#00e59b] animate-pulse" : "bg-muted-foreground",
            )} />
            <span className="text-sm font-bold tracking-wide">
              {killed ? "已停止" : enabled ? "自動交易執行中" : "已停用"}
            </span>
          </div>
          <Button size="sm" variant="destructive" className="h-7 text-xs" onClick={kill} disabled={killMut.isPending}>
            緊急停止 (24h)
          </Button>
        </div>
        {status?.message && <div className="text-[11px] text-amber-400 mb-2">{status.message}</div>}
        <div className="grid grid-cols-2 gap-2 text-[11px] font-mono">
          <div><span className="text-muted-foreground">權益:</span> <span className="text-foreground">${status?.currentEquityUsdt?.toFixed(2) ?? "—"}</span></div>
          <div><span className="text-muted-foreground">持倉數:</span> <span className="text-foreground">{status?.openPositionCount ?? 0}</span></div>
          <div>
            <span className="text-muted-foreground">24h 盈虧:</span>{" "}
            <span className={cn((status?.dailyRealizedPnlUsdt ?? 0) >= 0 ? "text-[#00e59b]" : "text-[#ff4d4d]")}>
              {(status?.dailyRealizedPnlUsdt ?? 0).toFixed(2)} USDT
            </span>
          </div>
          <div><span className="text-muted-foreground">近期下單:</span> <span className="text-foreground">{status?.recentExecutionCount ?? 0}</span></div>
          <div className="col-span-2">
            <span className="text-muted-foreground">上次執行:</span>{" "}
            <span className="text-foreground">{status?.lastCycleAt ? format(new Date(status.lastCycleAt), "MM-dd HH:mm:ss") : "尚未執行"}</span>
          </div>
          <div className="col-span-2">
            <span className="text-muted-foreground">下次執行:</span>{" "}
            <span className="text-foreground">{status?.nextCycleAt ? format(new Date(status.nextCycleAt), "MM-dd HH:mm:ss") : "—"}</span>
          </div>
        </div>
        <Button size="sm" variant="outline" className="mt-3 h-7 text-xs w-full" onClick={runNow} disabled={runNowMut.isPending}>
          {runNowMut.isPending ? "執行中..." : "立即執行一輪（仍受風控限制）"}
        </Button>
      </div>

      {/* Config form */}
      <div className="px-4 py-3 space-y-3">
        <div className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground">設定</div>

        <div className="flex items-center justify-between border border-border rounded-md p-2 bg-background/40">
          <div>
            <div className="text-xs font-semibold">啟用自動交易</div>
            <div className="text-[10px] text-muted-foreground">依「檢測週期」設定間隔觸發 — 真實下單</div>
          </div>
          <button
            type="button"
            onClick={() => setDraft({ ...draft, enabled: !draft.enabled })}
            className={cn(
              "relative h-5 w-10 rounded-full transition-colors",
              draft.enabled ? "bg-[#00e59b]" : "bg-muted",
            )}
          >
            <span className={cn(
              "absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform",
              draft.enabled ? "translate-x-5" : "translate-x-0.5",
            )} />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <NumField label="每筆保證金 %" value={draft.maxMarginPctPerTrade} step={0.5}
            onChange={(v) => setDraft({ ...draft, maxMarginPctPerTrade: v })} />
          <NumField label="日虧損停止 %" value={draft.maxDailyLossPct} step={1}
            onChange={(v) => setDraft({ ...draft, maxDailyLossPct: v })} />
          <NumField label="最多同時持倉" value={draft.maxConcurrentPositions} step={1}
            onChange={(v) => setDraft({ ...draft, maxConcurrentPositions: v })} />
          <NumField label="最大槓桿" value={draft.maxLeverage} step={1}
            onChange={(v) => setDraft({ ...draft, maxLeverage: v })} />
          <NumField label="最少共識數 (共 4)" value={draft.minConsensusCount} step={1}
            onChange={(v) => setDraft({ ...draft, minConsensusCount: v })} />
          <NumField label="最低平均信心" value={draft.minAvgConfidence} step={1}
            onChange={(v) => setDraft({ ...draft, minAvgConfidence: v })} />
          <NumField label="冷卻時間 (分)" value={draft.cooldownMinutes} step={5}
            onChange={(v) => setDraft({ ...draft, cooldownMinutes: v })} />
        </div>

        <div>
          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">核心白名單（每輪固定跑，永續 instId 用逗號分隔）</Label>
          <Input
            className="h-8 text-xs font-mono mt-1"
            value={draft.whitelist.join(",")}
            onChange={(e) =>
              setDraft({
                ...draft,
                whitelist: e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
              })
            }
          />
        </div>

        <div className="border-t border-border pt-3 mt-3 space-y-3">
          <div className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground">機會幣掃描器（Stage 0）</div>

          <div className="flex items-center justify-between border border-border rounded-md p-2 bg-background/40">
            <div>
              <div className="text-xs font-semibold">啟用 Claude 全市場掃描</div>
              <div className="text-[10px] text-muted-foreground">每輪先從全市場挑機會幣加入分析</div>
            </div>
            <button
              type="button"
              onClick={() => setDraft({ ...draft, scannerEnabled: !draft.scannerEnabled })}
              className={cn(
                "relative h-5 w-10 rounded-full transition-colors",
                draft.scannerEnabled ? "bg-[#00e59b]" : "bg-muted",
              )}
            >
              <span className={cn(
                "absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform",
                draft.scannerEnabled ? "translate-x-5" : "translate-x-0.5",
              )} />
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <NumField label="挑選數量 (0-10)" value={draft.scannerPickCount} step={1}
              onChange={(v) => setDraft({ ...draft, scannerPickCount: v })} />
            <NumField label="最低 24h 量 (USD)" value={draft.scannerMinVolUsd24h} step={10_000_000}
              onChange={(v) => setDraft({ ...draft, scannerMinVolUsd24h: v })} />
          </div>
          <div className="text-[10px] text-muted-foreground">
            每輪總標的 = 核心 {draft.whitelist.length} + 掃描挑 {draft.scannerEnabled ? draft.scannerPickCount : 0} = 約 {draft.whitelist.length + (draft.scannerEnabled ? draft.scannerPickCount : 0)} 個
          </div>
        </div>

        <div className="border-t border-border pt-3 mt-3 space-y-3">
          <div className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground">引擎節奏與成本</div>

          <div className="flex items-center justify-between border border-border rounded-md p-2 bg-background/40">
            <div>
              <div className="text-xs font-semibold">純規則模式（不花 AI）</div>
              <div className="text-[10px] text-muted-foreground">完全跳過 AI 呼叫；用內建共振分數判斷開倉、用趨勢/反轉/動能崩潰判斷平倉</div>
            </div>
            <button
              type="button"
              onClick={() => setDraft({ ...draft, rulesOnlyMode: !draft.rulesOnlyMode })}
              className={cn(
                "relative h-5 w-10 rounded-full transition-colors",
                draft.rulesOnlyMode ? "bg-[#00e59b]" : "bg-muted",
              )}
            >
              <span className={cn(
                "absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform",
                draft.rulesOnlyMode ? "translate-x-5" : "translate-x-0.5",
              )} />
            </button>
          </div>

          <div>
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">檢測週期</Label>
            <select
              className="mt-1 w-full h-8 text-xs font-mono bg-background border border-border rounded px-2"
              value={draft.cycleIntervalMinutes}
              onChange={(e) => setDraft({ ...draft, cycleIntervalMinutes: Number(e.target.value) })}
            >
              <option value={5}>每 5 分鐘（建議搭配純規則）</option>
              <option value={10}>每 10 分鐘</option>
              <option value={15}>每 15 分鐘</option>
              <option value={30}>每 30 分鐘</option>
              <option value={60}>每 60 分鐘（預設，AI 模式）</option>
            </select>
            <div className="text-[10px] text-muted-foreground mt-1">
              {draft.rulesOnlyMode
                ? `純規則 + ${draft.cycleIntervalMinutes} 分鐘：每輪約 ${(draft.whitelist.length + (draft.scannerEnabled ? draft.scannerPickCount : 0))} 次 OKX 行情查詢，0 次 AI 呼叫`
                : `AI 模式 + ${draft.cycleIntervalMinutes} 分鐘：每輪可能呼叫 4 個 AI 模型，注意成本`}
            </div>
          </div>
        </div>

        <div className="border-t border-border pt-3 mt-3 space-y-3">
          <div className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground">止損 / 止盈 / 防洗</div>
          <div className="grid grid-cols-2 gap-2">
            <NumField label="止損 % (從進場價)" value={draft.slPct} step={0.5}
              onChange={(v) => setDraft({ ...draft, slPct: v })} />
            <NumField label="止盈 % (從進場價)" value={draft.tpPct} step={0.5}
              onChange={(v) => setDraft({ ...draft, tpPct: v })} />
          </div>
          <div className="text-[10px] text-muted-foreground">
            固定 % 止損/止盈，蓋掉 AI 和 ATR 計算。注意：止損 {draft.slPct}% × 槓桿 {draft.maxLeverage}x ≈ 保證金損失 {(draft.slPct * draft.maxLeverage).toFixed(0)}%
          </div>
          <div>
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">翻向冷卻（小時）</Label>
            <Input type="number" min={0} max={48} value={draft.reverseCooldownHours}
              onChange={(e) => setDraft({ ...draft, reverseCooldownHours: Number(e.target.value) })}
              className="h-8 text-xs font-mono mt-1" />
            <div className="text-[10px] text-muted-foreground mt-1">剛平掉 long 後 N 小時內不可開 short（反之亦然）。建議 4 小時。</div>
          </div>
          <div className="flex items-center justify-between border border-border rounded-md p-2 bg-background/40">
            <div>
              <div className="text-xs font-semibold">阻擋同向加碼</div>
              <div className="text-[10px] text-muted-foreground">已有 long 倉時不再追加 long（手動加碼會讓部分止盈失效）</div>
            </div>
            <button
              type="button"
              onClick={() => setDraft({ ...draft, blockPyramiding: !draft.blockPyramiding })}
              className={cn("relative h-5 w-10 rounded-full transition-colors", draft.blockPyramiding ? "bg-[#00e59b]" : "bg-muted")}
            >
              <span className={cn("absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform",
                draft.blockPyramiding ? "translate-x-5" : "translate-x-0.5")} />
            </button>
          </div>
        </div>

        <Button onClick={save} disabled={updateMut.isPending} className="w-full h-9 bg-[#00e59b] text-[#003d29] hover:bg-[#00cc8a] font-bold uppercase tracking-wider">
          {updateMut.isPending ? "儲存中..." : draft.enabled ? "儲存並啟用" : "儲存"}
        </Button>
      </div>
    </div>
  );
}

function NumField({ label, value, step, onChange }: { label: string; value: number; step: number; onChange: (v: number) => void }) {
  return (
    <div>
      <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</Label>
      <Input
        type="number"
        step={step}
        className="h-8 text-xs font-mono mt-1"
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
      />
    </div>
  );
}
