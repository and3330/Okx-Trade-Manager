export interface MarketQuote {
  name: string;
  displayName: string;
}

export interface MarketConfig {
  id: 'tw' | 'us' | 'crypto';
  label: string;
  embeddable: boolean;
  defaultSymbol: string;
  quotes: MarketQuote[];
}

export const MARKETS: Record<'TW' | 'US' | 'CRYPTO', MarketConfig> = {
  TW: {
    id: 'tw',
    label: '台股',
    embeddable: false,
    defaultSymbol: 'TWSE:2330',
    quotes: [
      { name: 'TWSE:TAIEX', displayName: '加權指數' },
      { name: 'TWSE:2330', displayName: '台積電' },
      { name: 'TWSE:2317', displayName: '鴻海' },
      { name: 'TWSE:2454', displayName: '聯發科' },
      { name: 'TWSE:2603', displayName: '長榮' },
      { name: 'TWSE:2412', displayName: '中華電' },
    ],
  },
  US: {
    id: 'us',
    label: '美股',
    embeddable: true,
    defaultSymbol: 'NASDAQ:IXIC',
    quotes: [
      { name: 'FOREXCOM:SPXUSD', displayName: 'S&P 500' },
      { name: 'NASDAQ:IXIC', displayName: '那斯達克' },
      { name: 'NASDAQ:AAPL', displayName: '蘋果' },
      { name: 'NASDAQ:NVDA', displayName: '輝達' },
      { name: 'NASDAQ:TSLA', displayName: '特斯拉' },
      { name: 'NASDAQ:MSFT', displayName: '微軟' },
      { name: 'NASDAQ:AMZN', displayName: '亞馬遜' },
    ],
  },
  CRYPTO: {
    id: 'crypto',
    label: '虛擬貨幣',
    embeddable: true,
    defaultSymbol: 'BINANCE:BTCUSDT',
    quotes: [
      { name: 'BINANCE:BTCUSDT', displayName: '比特幣' },
      { name: 'BINANCE:ETHUSDT', displayName: '以太坊' },
      { name: 'BINANCE:SOLUSDT', displayName: 'SOL' },
      { name: 'BINANCE:BNBUSDT', displayName: 'BNB' },
      { name: 'BINANCE:DOGEUSDT', displayName: 'DOGE' },
      { name: 'BINANCE:XRPUSDT', displayName: 'XRP' },
    ],
  },
};

export const MARKET_LIST: MarketConfig[] = [MARKETS.TW, MARKETS.US, MARKETS.CRYPTO];

export const ALL_TICKERS = [
  ...MARKETS.US.quotes.map((q) => ({ proName: q.name, title: q.displayName })),
  ...MARKETS.CRYPTO.quotes.map((q) => ({ proName: q.name, title: q.displayName })),
];

export function marketById(id: string): MarketConfig | undefined {
  return MARKET_LIST.find((m) => m.id === id);
}

// Map a UI symbol like "TWSE:2330" / "TWSE:TAIEX" to the TWSE code the
// backend expects ("2330" / "t00"). Kept in sync with the server normalizer.
export function normalizeTwCode(raw: string): string {
  const c = raw.replace(/^TWSE:/i, '').trim();
  if (/^taiex$/i.test(c)) return 't00';
  return c.toLowerCase();
}
