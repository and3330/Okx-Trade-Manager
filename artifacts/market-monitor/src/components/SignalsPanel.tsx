import React from 'react';
import { useListSignals, getListSignalsQueryKey } from '@workspace/api-client-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Activity } from 'lucide-react';

function actionColor(action: string | null | undefined): string {
  const a = (action ?? '').toLowerCase();
  if (a.includes('buy') || a.includes('long') || a.includes('買')) return 'text-emerald-400';
  if (a.includes('sell') || a.includes('short') || a.includes('賣')) return 'text-red-400';
  return 'text-muted-foreground';
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('zh-TW', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export const SignalsPanel: React.FC = () => {
  const { data: signals, isLoading } = useListSignals({
    query: { queryKey: getListSignalsQueryKey(), refetchInterval: 30000 },
  });

  return (
    <Card className="bg-card/50 border-border">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <Activity className="h-5 w-5 text-primary" />
          每日監測
        </CardTitle>
        <CardDescription>來自 TradingView 警報的策略訊號（每 30 秒更新）</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">載入中…</p>
        ) : !signals || signals.length === 0 ? (
          <div className="h-[160px] flex items-center justify-center text-center bg-muted/20 rounded-md border border-border/50 px-4">
            <p className="text-sm text-muted-foreground">
              尚未收到任何訊號。到「交易策略」分頁取得 Webhook 網址，貼進 TradingView 警報後，訊號會顯示在這裡。
            </p>
          </div>
        ) : (
          <div className="max-h-[320px] overflow-y-auto divide-y divide-border/40">
            {signals.map((s) => (
              <div key={s.id} className="py-2.5 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground">
                      {s.symbol ?? '未指定標的'}
                    </span>
                    {s.action && (
                      <span className={`text-xs font-semibold uppercase ${actionColor(s.action)}`}>
                        {s.action}
                      </span>
                    )}
                  </div>
                  {s.message && (
                    <p className="text-xs text-muted-foreground mt-0.5 break-words">{s.message}</p>
                  )}
                </div>
                <div className="text-right shrink-0">
                  {s.price && <div className="text-sm tabular-nums text-foreground">{s.price}</div>}
                  <div className="text-xs text-muted-foreground">{formatTime(s.receivedAt)}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
