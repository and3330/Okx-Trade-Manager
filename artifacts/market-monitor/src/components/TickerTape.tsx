import React from 'react';
import { TradingViewWidget } from './TradingViewWidget';

interface TickerTapeProps {
  symbols: Array<{ proName: string; title: string }>;
}

export const TickerTape: React.FC<TickerTapeProps> = ({ symbols }) => {
  return (
    <TradingViewWidget
      src="https://s3.tradingview.com/external-embedding/embed-widget-ticker-tape.js"
      containerId="tv-ticker-tape"
      config={{
        symbols,
        showSymbolLogo: true,
        isTransparent: false,
        displayMode: "adaptive",
        colorTheme: "dark",
        locale: "zh_TW"
      }}
      className="w-full h-12 overflow-hidden border-b border-border bg-card"
    />
  );
};
