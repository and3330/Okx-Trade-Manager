import React, { useState } from 'react';
import { useGetMonitorSettings } from '@workspace/api-client-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Target, Copy, Check } from 'lucide-react';

function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="flex items-center gap-2">
        <code className="flex-1 text-xs bg-muted/40 border border-border rounded px-2 py-1.5 break-all text-foreground">
          {value}
        </code>
        <Button variant="outline" size="sm" onClick={copy} className="shrink-0 gap-1">
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? '已複製' : '複製'}
        </Button>
      </div>
    </div>
  );
}

export const StrategyPanel: React.FC = () => {
  const { data: settings, isLoading } = useGetMonitorSettings();

  const webhookUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/api/monitor/webhook/tradingview`
      : '/api/monitor/webhook/tradingview';

  const passphrase = settings?.webhookPassphrase ?? '';

  const alertTemplate = JSON.stringify(
    {
      passphrase: passphrase || '你的密鑰',
      symbol: '{{ticker}}',
      action: '{{strategy.order.action}}',
      price: '{{close}}',
      message: '{{strategy.order.comment}}',
    },
    null,
    2,
  );

  return (
    <Card className="bg-card/50 border-border">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <Target className="h-5 w-5 text-primary" />
          交易策略
        </CardTitle>
        <CardDescription>把 TradingView 策略警報接進來</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">載入中…</p>
        ) : (
          <>
            <CopyRow label="Webhook 網址（貼到 TradingView 警報的「通知 → Webhook URL」）" value={webhookUrl} />
            <CopyRow label="密鑰 passphrase（已內含在下方訊息範本，請勿外流）" value={passphrase} />

            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">
                警報訊息範本（貼到 TradingView 警報的「訊息」欄）
              </p>
              <pre className="text-xs bg-muted/40 border border-border rounded px-3 py-2 overflow-x-auto text-foreground">
{alertTemplate}
              </pre>
            </div>

            <div className="text-xs text-muted-foreground space-y-1.5 border-t border-border/50 pt-3">
              <p className="font-medium text-foreground">設定步驟</p>
              <p>1. 在 TradingView 圖表上，於你的策略/指標建立「警報」。</p>
              <p>2. 在警報的「通知」分頁勾選 Webhook URL，貼上上面的網址。</p>
              <p>3. 把上面的訊息範本貼到警報「訊息」欄。</p>
              <p>4. 條件成立時，訊號會自動出現在「每日監測」面板。</p>
              <p className="text-amber-400/90">
                注意：Webhook 需要 TradingView 付費方案，且本系統需先部署（測試網址無法被 TradingView 連到）。
              </p>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
};
