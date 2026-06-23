import React, { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { TickerTape } from '@/components/TickerTape';
import { AdvancedChart } from '@/components/AdvancedChart';
import { MarketQuotes } from '@/components/MarketQuotes';
import { TechnicalAnalysis } from '@/components/TechnicalAnalysis';
import { Activity, Target } from 'lucide-react';

const MARKETS = {
  TW: {
    id: 'tw',
    label: '台股',
    embeddable: false,
    defaultSymbol: 'TWSE:2330',
    quotes: [
      { name: "TWSE:TAIEX", displayName: "加權指數" },
      { name: "TWSE:2330", displayName: "台積電" },
      { name: "TWSE:2317", displayName: "鴻海" },
      { name: "TWSE:2454", displayName: "聯發科" },
      { name: "TWSE:2603", displayName: "長榮" },
      { name: "TWSE:2412", displayName: "中華電" }
    ]
  },
  US: {
    id: 'us',
    label: '美股',
    embeddable: true,
    defaultSymbol: 'NASDAQ:IXIC',
    quotes: [
      { name: "FOREXCOM:SPXUSD", displayName: "S&P 500" },
      { name: "NASDAQ:IXIC", displayName: "那斯達克" },
      { name: "NASDAQ:AAPL", displayName: "蘋果" },
      { name: "NASDAQ:NVDA", displayName: "輝達" },
      { name: "NASDAQ:TSLA", displayName: "特斯拉" },
      { name: "NASDAQ:MSFT", displayName: "微軟" },
      { name: "NASDAQ:AMZN", displayName: "亞馬遜" }
    ]
  },
  CRYPTO: {
    id: 'crypto',
    label: '虛擬貨幣',
    embeddable: true,
    defaultSymbol: 'BINANCE:BTCUSDT',
    quotes: [
      { name: "BINANCE:BTCUSDT", displayName: "比特幣" },
      { name: "BINANCE:ETHUSDT", displayName: "以太坊" },
      { name: "BINANCE:SOLUSDT", displayName: "SOL" },
      { name: "BINANCE:BNBUSDT", displayName: "BNB" },
      { name: "BINANCE:DOGEUSDT", displayName: "DOGE" },
      { name: "BINANCE:XRPUSDT", displayName: "XRP" }
    ]
  }
};

const ALL_TICKERS = [
  ...MARKETS.US.quotes.map(q => ({ proName: q.name, title: q.displayName })),
  ...MARKETS.CRYPTO.quotes.map(q => ({ proName: q.name, title: q.displayName }))
];

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState<string>('tw');
  const [selectedSymbol, setSelectedSymbol] = useState<string>(MARKETS.TW.defaultSymbol);

  const handleTabChange = (val: string) => {
    setActiveTab(val);
    const market = Object.values(MARKETS).find(m => m.id === val);
    if (market) {
      setSelectedSymbol(market.defaultSymbol);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col font-sans dark">
      {/* Ticker Tape at the very top */}
      <TickerTape symbols={ALL_TICKERS} />

      <div className="flex-1 p-4 md:p-6 space-y-6 max-w-[1600px] mx-auto w-full">
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-border pb-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-white">每日市場監測</h1>
            <p className="text-muted-foreground mt-1">戰情室儀表板 • 即時數據</p>
          </div>
        </header>

        <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
          <TabsList className="grid w-full md:w-[400px] grid-cols-3 bg-muted/50 p-1 rounded-md">
            {Object.values(MARKETS).map(market => (
              <TabsTrigger 
                key={market.id} 
                value={market.id}
                className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground font-medium"
              >
                {market.label}
              </TabsTrigger>
            ))}
          </TabsList>

          {Object.values(MARKETS).map(market => (
            <TabsContent key={market.id} value={market.id} className="mt-6 space-y-6 outline-none">
              
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                
                {/* Main Chart Column */}
                <div className="lg:col-span-2 space-y-6">
                  <div className="flex flex-col space-y-2">
                    <h2 className="text-xl font-semibold px-1">{market.label} 走勢圖</h2>
                    {market.embeddable ? (
                      <AdvancedChart symbol={selectedSymbol} />
                    ) : (
                      <Card className="bg-card/50 border-dashed border-muted-foreground/30">
                        <CardContent className="h-[400px] flex flex-col items-center justify-center text-center gap-3 p-6">
                          <Activity className="h-8 w-8 text-muted-foreground" />
                          <p className="text-base font-medium text-foreground">台股資料來源建置中</p>
                          <p className="text-sm text-muted-foreground max-w-md">
                            TradingView 的免費圖表受交易所授權限制，無法顯示台股即時報價。待接上官方台股資料來源後，這裡會顯示完整走勢圖與報價。美股與虛擬貨幣分頁皆為即時資料。
                          </p>
                        </CardContent>
                      </Card>
                    )}
                  </div>
                  
                  {/* Placeholder Panels Row */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <Card className="bg-card/50 border-dashed border-muted-foreground/30">
                      <CardHeader className="pb-3">
                        <CardTitle className="text-lg flex items-center gap-2">
                          <Activity className="h-5 w-5 text-primary" />
                          每日監測
                        </CardTitle>
                        <CardDescription>即時監測摘要與訊號</CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="h-[120px] flex items-center justify-center bg-muted/20 rounded-md border border-border/50">
                          <p className="text-sm text-muted-foreground">此區塊即將載入每日監測數據與自動訊號。</p>
                        </div>
                      </CardContent>
                    </Card>

                    <Card className="bg-card/50 border-dashed border-muted-foreground/30">
                      <CardHeader className="pb-3">
                        <CardTitle className="text-lg flex items-center gap-2">
                          <Target className="h-5 w-5 text-primary" />
                          交易策略
                        </CardTitle>
                        <CardDescription>自訂策略規則與警示</CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="h-[120px] flex items-center justify-center bg-muted/20 rounded-md border border-border/50">
                          <p className="text-sm text-muted-foreground">此區塊即將載入您的專屬交易策略配置。</p>
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                </div>

                {/* Sidebar Column */}
                <div className="space-y-6">
                  <div className="flex flex-col space-y-2">
                    <h2 className="text-xl font-semibold px-1">觀察名單</h2>
                    {market.embeddable ? (
                      <MarketQuotes symbols={market.quotes} title={market.label} />
                    ) : (
                      <Card className="bg-card/50 border-dashed border-muted-foreground/30">
                        <CardContent className="p-4 space-y-2">
                          <p className="text-sm text-muted-foreground mb-3">監測標的（資料待接）</p>
                          {market.quotes.map(q => (
                            <div key={q.name} className="flex items-center justify-between text-sm border-b border-border/40 py-2 last:border-0">
                              <span className="text-foreground">{q.displayName}</span>
                              <span className="text-muted-foreground tabular-nums">—</span>
                            </div>
                          ))}
                        </CardContent>
                      </Card>
                    )}
                  </div>

                  {market.embeddable && (
                    <div className="flex flex-col space-y-2">
                      <h2 className="text-xl font-semibold px-1">技術分析</h2>
                      <TechnicalAnalysis symbol={selectedSymbol} />
                    </div>
                  )}
                </div>
              </div>

            </TabsContent>
          ))}
        </Tabs>
      </div>
    </div>
  );
}
