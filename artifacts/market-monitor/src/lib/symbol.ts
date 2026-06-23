export type MonitorMarket = 'tw' | 'us' | 'crypto';

export const SYMBOL_INPUT: Record<
  MonitorMarket,
  { label: string; placeholder: string; hint: string; currency: string }
> = {
  tw: {
    label: '股票代號',
    placeholder: '2330',
    hint: '輸入台股代號，例如 2330（台積電）。報價單位為 TWD。',
    currency: 'TWD',
  },
  us: {
    label: '股票代號',
    placeholder: 'AAPL',
    hint: '輸入美股代號，例如 AAPL（蘋果）、TSLA（特斯拉）。報價單位為 USD。',
    currency: 'USD',
  },
  crypto: {
    label: '幣別',
    placeholder: 'BTC',
    hint: '輸入幣別，例如 BTC、ETH，系統自動對 USDT。報價單位為 USDT。',
    currency: 'USDT',
  },
};

// Turn a simple, user-friendly input into a full TradingView symbol.
// Escape hatch: if the user already typed a full "EXCHANGE:SYMBOL", keep it as-is.
export function buildSymbol(market: MonitorMarket, raw: string): string {
  const s = raw.trim().toUpperCase();
  if (!s) return s;
  if (s.includes(':')) return s;
  if (market === 'tw') return `TWSE:${s}`;
  if (market === 'crypto') {
    const coin = s.endsWith('USDT') ? s : `${s}USDT`;
    return `BINANCE:${coin}`;
  }
  return s;
}
