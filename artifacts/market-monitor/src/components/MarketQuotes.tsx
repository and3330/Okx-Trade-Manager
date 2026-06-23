import React from 'react';
import { TradingViewWidget } from './TradingViewWidget';

interface MarketQuotesProps {
  symbols: Array<{ name: string; displayName: string }>;
  title: string;
}

export const MarketQuotes: React.FC<MarketQuotesProps> = ({ symbols, title }) => {
  return (
    <div className="w-full h-[400px] border border-border rounded-lg overflow-hidden bg-card flex flex-col">
      <TradingViewWidget
        src="https://s3.tradingview.com/external-embedding/embed-widget-market-quotes.js"
        containerId={`tv-market-quotes-${title}`}
        config={{
          width: "100%",
          height: "100%",
          symbolsGroups: [
            {
              name: title,
              originalName: title,
              symbols
            }
          ],
          showSymbolLogo: true,
          isTransparent: true,
          colorTheme: "dark",
          locale: "zh_TW"
        }}
        className="w-full h-full"
      />
    </div>
  );
};
