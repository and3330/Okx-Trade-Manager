import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useListWatchlist,
  useAddWatchlistItem,
  useRemoveWatchlistItem,
  getListWatchlistQueryKey,
  type WatchlistInputMarket,
} from '@workspace/api-client-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Trash2, Plus } from 'lucide-react';
import { buildSymbol, SYMBOL_INPUT, type MonitorMarket } from '@/lib/symbol';

const MARKET_LABELS: Record<string, string> = {
  tw: '台股',
  us: '美股',
  crypto: '虛擬貨幣',
};

interface WatchlistManagerProps {
  onSelect: (symbol: string, market: string) => void;
  selectedSymbol: string;
}

export const WatchlistManager: React.FC<WatchlistManagerProps> = ({ onSelect, selectedSymbol }) => {
  const queryClient = useQueryClient();
  const { data: items, isLoading } = useListWatchlist();
  const addMutation = useAddWatchlistItem();
  const removeMutation = useRemoveWatchlistItem();

  const [market, setMarket] = useState<WatchlistInputMarket>('us');
  const [symbol, setSymbol] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState('');

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: getListWatchlistQueryKey() });

  const handleAdd = () => {
    const raw = symbol.trim();
    if (!raw) {
      setError('請輸入代號');
      return;
    }
    const builtSymbol = buildSymbol(market as MonitorMarket, raw);
    setError('');
    addMutation.mutate(
      {
        data: {
          symbol: builtSymbol,
          market,
          displayName: displayName.trim() || raw.toUpperCase(),
        },
      },
      {
        onSuccess: () => {
          setSymbol('');
          setDisplayName('');
          invalidate();
        },
        onError: () => setError('新增失敗，請稍後再試'),
      },
    );
  };

  const handleRemove = (id: number) => {
    removeMutation.mutate({ id }, { onSuccess: invalidate });
  };

  return (
    <Card className="bg-card/60 border-border">
      <CardContent className="p-4 space-y-4">
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1 w-full">
            <label className="text-xs text-muted-foreground">市場</label>
            <Select value={market} onValueChange={(v) => setMarket(v as WatchlistInputMarket)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="tw">台股</SelectItem>
                <SelectItem value="us">美股</SelectItem>
                <SelectItem value="crypto">虛擬貨幣</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1 flex-1">
            <label className="text-xs text-muted-foreground">
              {SYMBOL_INPUT[market as MonitorMarket].label}
            </label>
            <Input
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              placeholder={SYMBOL_INPUT[market as MonitorMarket].placeholder}
              onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            />
            <span className="text-[11px] text-muted-foreground/80">
              {SYMBOL_INPUT[market as MonitorMarket].hint}
            </span>
          </div>
          <div className="flex flex-col gap-1 w-full">
            <label className="text-xs text-muted-foreground">顯示名稱（可留空）</label>
            <Input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="蘋果"
              onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            />
          </div>
          <Button onClick={handleAdd} disabled={addMutation.isPending} className="gap-1">
            <Plus className="h-4 w-4" />
            加入追蹤
          </Button>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}

        {isLoading ? (
          <p className="text-sm text-muted-foreground">載入中…</p>
        ) : !items || items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            尚未追蹤任何標的。在上方選擇市場、輸入代號加入，點清單即可立即看圖與現價。
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {items.map((item) => {
              const active = item.symbol === selectedSymbol;
              return (
                <div
                  key={item.id}
                  className={`flex items-center gap-2 rounded-md border px-3 py-2 transition-colors ${
                    active
                      ? 'border-primary bg-primary/10'
                      : 'border-border bg-muted/30 hover:bg-muted/60'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => onSelect(item.symbol, item.market)}
                    className="flex flex-col items-start text-left"
                  >
                    <span className="text-sm font-medium text-foreground">{item.displayName}</span>
                    <span className="text-xs text-muted-foreground">
                      {MARKET_LABELS[item.market] ?? item.market} · {item.symbol}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRemove(item.id)}
                    className="text-muted-foreground hover:text-destructive"
                    aria-label="移除"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
