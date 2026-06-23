import type { Holding } from '@workspace/api-client-react';

export const MARKET_LABELS: Record<string, string> = {
  tw: '台股',
  us: '美股',
  crypto: '虛擬貨幣',
};

export const MARKET_CCY: Record<string, string> = {
  tw: 'TWD',
  us: 'USD',
  crypto: 'USDT',
};

export function num(v: string | number | null | undefined): number {
  if (v == null) return 0;
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

export function fmt(n: number): string {
  return n.toLocaleString('zh-TW', { maximumFractionDigits: 2 });
}

export function plClass(pl: number | null): string {
  if (pl == null) return 'text-muted-foreground';
  if (pl > 0) return 'text-emerald-400';
  if (pl < 0) return 'text-red-400';
  return 'text-foreground';
}

export interface HoldingRow {
  h: Holding;
  totalCost: number;
  marketValue: number | null;
  pl: number | null;
  plPct: number | null;
}

export function buildRow(h: Holding): HoldingRow {
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

export interface MarketSummary {
  market: string;
  totalCost: number;
  marketValue: number | null;
  pl: number | null;
  plPct: number | null;
  unpriced: number;
  count: number;
}

export function summarizeByMarket(rows: HoldingRow[]): MarketSummary[] {
  const markets = [...new Set(rows.map((r) => r.h.market))];
  return markets.map((market) => {
    const mrows = rows.filter((r) => r.h.market === market);
    const totalCost = mrows.reduce((a, r) => a + r.totalCost, 0);
    const priced = mrows.filter((r) => r.marketValue != null);
    const pricedCost = priced.reduce((a, r) => a + r.totalCost, 0);
    const marketValue = priced.length
      ? priced.reduce((a, r) => a + (r.marketValue ?? 0), 0)
      : null;
    const pl = marketValue != null ? marketValue - pricedCost : null;
    const plPct = pl != null && pricedCost > 0 ? (pl / pricedCost) * 100 : null;
    const unpriced = mrows.length - priced.length;
    return { market, totalCost, marketValue, pl, plPct, unpriced, count: mrows.length };
  });
}

export function plLabel(pl: number | null, plPct: number | null): string {
  if (pl == null) return '—';
  const sign = pl >= 0 ? '+' : '';
  const pct = plPct != null ? ` (${plPct >= 0 ? '+' : ''}${plPct.toFixed(2)}%)` : '';
  return `${sign}${fmt(pl)}${pct}`;
}
