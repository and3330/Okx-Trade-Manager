import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useListHoldings,
  useAddHolding,
  useUpdateHolding,
  useRemoveHolding,
  getListHoldingsQueryKey,
  type Holding,
  type HoldingInputMarket,
} from '@workspace/api-client-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Wallet, Trash2, Plus } from 'lucide-react';
import { buildSymbol, SYMBOL_INPUT, type MonitorMarket } from '@/lib/symbol';

const MARKET_LABELS: Record<string, string> = { tw: '台股', us: '美股', crypto: '虛擬貨幣' };
const MARKET_CCY: Record<string, string> = { tw: 'TWD', us: 'USD', crypto: 'USDT' };

function num(v: string | number | null | undefined): number {
  if (v == null) return 0;
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

function fmt(n: number): string {
  return n.toLocaleString('zh-TW', { maximumFractionDigits: 2 });
}

interface Row {
  h: Holding;
  totalCost: number;
  marketValue: number | null;
  pl: number | null;
  plPct: number | null;
}

function buildRow(h: Holding): Row {
  const qty = num(h.quantity);
  const cost = num(h.costPerUnit);
  const fee = num(h.fee);
  const totalCost = qty * cost + fee;
  const cp = h.currentPrice;
  const marketValue = cp != null ? qty * cp : null;
  const pl = marketValue != null ? marketValue - totalCost : null;
  const plPct = pl != null && totalCost > 0 ? (pl / totalCost) * 100 : null;
  return { h, totalCost, marketValue, pl, plPct };
}

function plClass(pl: number | null): string {
  if (pl == null) return 'text-muted-foreground';
  if (pl > 0) return 'text-emerald-400';
  if (pl < 0) return 'text-red-400';
  return 'text-foreground';
}

function ManualPriceCell({ holding }: { holding: Holding }) {
  const queryClient = useQueryClient();
  const update = useUpdateHolding();
  const [val, setVal] = useState(holding.manualPrice ?? '');

  const commit = () => {
    const trimmed = val.trim();
    const parsed = trimmed === '' ? null : Number(trimmed);
    if (parsed != null && !Number.isFinite(parsed)) return;
    if ((holding.manualPrice ?? '') === (trimmed === '' ? '' : String(parsed))) return;
    update.mutate(
      { id: holding.id, data: { manualPrice: parsed } },
      {
        onSuccess: () =>
          queryClient.invalidateQueries({ queryKey: getListHoldingsQueryKey() }),
      },
    );
  };

  return (
    <Input
      value={val}
      onChange={(e) => setVal(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      placeholder="輸入現價"
      className="h-8 w-24 text-right tabular-nums"
    />
  );
}

export const HoldingsPanel: React.FC = () => {
  const queryClient = useQueryClient();
  const { data: holdings, isLoading } = useListHoldings({
    query: { queryKey: getListHoldingsQueryKey(), refetchInterval: 30000 },
  });
  const addMutation = useAddHolding();
  const removeMutation = useRemoveHolding();

  const [market, setMarket] = useState<HoldingInputMarket>('crypto');
  const [symbol, setSymbol] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [exchange, setExchange] = useState('');
  const [quantity, setQuantity] = useState('');
  const [costPerUnit, setCostPerUnit] = useState('');
  const [fee, setFee] = useState('');
  const [buyDate, setBuyDate] = useState('');
  const [error, setError] = useState('');

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: getListHoldingsQueryKey() });

  const handleAdd = () => {
    const raw = symbol.trim();
    const q = Number(quantity);
    const c = Number(costPerUnit);
    if (!raw) return setError('請輸入代號');
    if (!quantity || !Number.isFinite(q) || q <= 0) return setError('請輸入有效數量');
    if (!costPerUnit || !Number.isFinite(c) || c < 0) return setError('請輸入有效買入單價');
    const builtSymbol = buildSymbol(market as MonitorMarket, raw);
    setError('');
    addMutation.mutate(
      {
        data: {
          symbol: builtSymbol,
          market,
          displayName: displayName.trim() || raw.toUpperCase(),
          exchange: exchange.trim() || null,
          quantity: q,
          costPerUnit: c,
          fee: fee.trim() === '' ? null : Number(fee),
          buyDate: buyDate ? new Date(buyDate).toISOString() : null,
        },
      },
      {
        onSuccess: () => {
          setSymbol('');
          setDisplayName('');
          setExchange('');
          setQuantity('');
          setCostPerUnit('');
          setFee('');
          setBuyDate('');
          invalidate();
        },
        onError: () => setError('新增失敗，請稍後再試'),
      },
    );
  };

  const rows = (holdings ?? []).map(buildRow);

  const marketsPresent = [...new Set(rows.map((r) => r.h.market))];
  const summaries = marketsPresent.map((mkt) => {
    const mrows = rows.filter((r) => r.h.market === mkt);
    const totalCost = mrows.reduce((a, r) => a + r.totalCost, 0);
    const priced = mrows.filter((r) => r.marketValue != null);
    const pricedCost = priced.reduce((a, r) => a + r.totalCost, 0);
    const marketValue = priced.length
      ? priced.reduce((a, r) => a + (r.marketValue ?? 0), 0)
      : null;
    const pl = marketValue != null ? marketValue - pricedCost : null;
    const plPct = pl != null && pricedCost > 0 ? (pl / pricedCost) * 100 : null;
    const unpriced = mrows.length - priced.length;
    return { mkt, totalCost, marketValue, pl, plPct, unpriced, count: mrows.length };
  });

  return (
    <Card className="bg-card/50 border-border">
      <CardHeader className="pb-3">
        <CardTitle className="text-xl flex items-center gap-2">
          <Wallet className="h-5 w-5 text-primary" />
          我的持倉與損益
        </CardTitle>
        <CardDescription>
          記錄每一筆購買（在哪買、成本、數量），自動算出損益。虛擬貨幣抓即時價，美股／台股請手動輸入現價。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Summary by market (different currencies are not mixed) */}
        {summaries.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {summaries.map((s) => (
              <div key={s.mkt} className="rounded-md border border-border bg-muted/30 p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-foreground">
                    {MARKET_LABELS[s.mkt] ?? s.mkt}
                  </span>
                  <span className="text-xs text-muted-foreground">{MARKET_CCY[s.mkt]}</span>
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <div className="text-muted-foreground">總成本</div>
                    <div className="tabular-nums text-foreground">{fmt(s.totalCost)}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">市值</div>
                    <div className="tabular-nums text-foreground">
                      {s.marketValue != null ? fmt(s.marketValue) : '—'}
                    </div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">未實現損益</div>
                    <div className={`tabular-nums ${plClass(s.pl)}`}>
                      {s.pl != null
                        ? `${s.pl >= 0 ? '+' : ''}${fmt(s.pl)}${
                            s.plPct != null ? ` (${s.plPct >= 0 ? '+' : ''}${s.plPct.toFixed(2)}%)` : ''
                          }`
                        : '—'}
                    </div>
                  </div>
                </div>
                {s.unpriced > 0 && (
                  <p className="mt-1.5 text-[11px] text-amber-400/90">
                    有 {s.unpriced} 筆尚未設定現價，未計入市值與損益。
                  </p>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Add form */}
        <div className="rounded-md border border-border bg-muted/20 p-3 space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">市場</label>
              <Select value={market} onValueChange={(v) => setMarket(v as HoldingInputMarket)}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="tw">台股</SelectItem>
                  <SelectItem value="us">美股</SelectItem>
                  <SelectItem value="crypto">虛擬貨幣</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1 col-span-2 md:col-span-1">
              <label className="text-xs text-muted-foreground">
                {SYMBOL_INPUT[market as MonitorMarket].label}
              </label>
              <Input
                value={symbol}
                onChange={(e) => setSymbol(e.target.value)}
                placeholder={SYMBOL_INPUT[market as MonitorMarket].placeholder}
                className="h-9"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">顯示名稱</label>
              <Input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="比特幣"
                className="h-9"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">在哪買</label>
              <Input
                value={exchange}
                onChange={(e) => setExchange(e.target.value)}
                placeholder="Binance / IBKR"
                className="h-9"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">數量</label>
              <Input
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                placeholder="0.5"
                inputMode="decimal"
                className="h-9"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">買入單價</label>
              <Input
                value={costPerUnit}
                onChange={(e) => setCostPerUnit(e.target.value)}
                placeholder="40000"
                inputMode="decimal"
                className="h-9"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">手續費（可留空）</label>
              <Input
                value={fee}
                onChange={(e) => setFee(e.target.value)}
                placeholder="10"
                inputMode="decimal"
                className="h-9"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">買入日期（可留空）</label>
              <Input
                type="date"
                value={buyDate}
                onChange={(e) => setBuyDate(e.target.value)}
                className="h-9"
              />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Button onClick={handleAdd} disabled={addMutation.isPending} className="gap-1">
              <Plus className="h-4 w-4" />
              新增持倉
            </Button>
            {error && <span className="text-sm text-destructive">{error}</span>}
          </div>
        </div>

        {/* Holdings table */}
        {isLoading ? (
          <p className="text-sm text-muted-foreground">載入中…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            尚未記錄任何持倉。用上方表單新增一筆購買，就會自動算出損益。
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-muted-foreground border-b border-border">
                  <th className="text-left font-medium py-2 pr-3">標的 / 在哪買</th>
                  <th className="text-right font-medium py-2 px-3">數量</th>
                  <th className="text-right font-medium py-2 px-3">買入單價</th>
                  <th className="text-right font-medium py-2 px-3">總成本</th>
                  <th className="text-right font-medium py-2 px-3">目前價格</th>
                  <th className="text-right font-medium py-2 px-3">市值</th>
                  <th className="text-right font-medium py-2 px-3">未實現損益</th>
                  <th className="py-2 pl-3"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ h, totalCost, marketValue, pl, plPct }) => (
                  <tr key={h.id} className="border-b border-border/40 last:border-0">
                    <td className="py-2.5 pr-3">
                      <div className="font-medium text-foreground">{h.displayName}</div>
                      <div className="text-xs text-muted-foreground">
                        {MARKET_LABELS[h.market] ?? h.market} · {h.symbol}
                        {h.exchange ? ` · ${h.exchange}` : ''}
                      </div>
                    </td>
                    <td className="py-2.5 px-3 text-right tabular-nums">{fmt(num(h.quantity))}</td>
                    <td className="py-2.5 px-3 text-right tabular-nums">{fmt(num(h.costPerUnit))}</td>
                    <td className="py-2.5 px-3 text-right tabular-nums">{fmt(totalCost)}</td>
                    <td className="py-2.5 px-3 text-right">
                      {h.market === 'crypto' ? (
                        <span className="tabular-nums">
                          {h.currentPrice != null ? fmt(h.currentPrice) : '—'}
                          <span className="ml-1 text-[10px] text-emerald-400/80">即時</span>
                        </span>
                      ) : (
                        <ManualPriceCell holding={h} />
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-right tabular-nums">
                      {marketValue != null ? fmt(marketValue) : '—'}
                    </td>
                    <td className={`py-2.5 px-3 text-right tabular-nums ${plClass(pl)}`}>
                      {pl != null
                        ? `${pl >= 0 ? '+' : ''}${fmt(pl)}${
                            plPct != null ? ` (${plPct >= 0 ? '+' : ''}${plPct.toFixed(2)}%)` : ''
                          }`
                        : '—'}
                    </td>
                    <td className="py-2.5 pl-3 text-right">
                      <button
                        type="button"
                        onClick={() =>
                          removeMutation.mutate({ id: h.id }, { onSuccess: invalidate })
                        }
                        className="text-muted-foreground hover:text-destructive"
                        aria-label="移除"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
