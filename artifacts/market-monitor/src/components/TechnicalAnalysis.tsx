import React from 'react';
import { TradingViewWidget } from './TradingViewWidget';

interface TechnicalAnalysisProps {
  symbol: string;
}

export const TechnicalAnalysis: React.FC<TechnicalAnalysisProps> = ({ symbol }) => {
  return (
    <div className="w-full h-[450px] border border-border rounded-lg overflow-hidden bg-card">
      <TradingViewWidget
        src="https://s3.tradingview.com/external-embedding/embed-widget-technical-analysis.js"
        containerId={`tv-technical-analysis-${symbol}`}
        config={{
          interval: "1D",
          width: "100%",
          isTransparent: true,
          height: "100%",
          symbol,
          showIntervalTabs: true,
          displayMode: "single",
          locale: "zh_TW",
          colorTheme: "dark"
        }}
        className="w-full h-full"
      />
    </div>
  );
};
