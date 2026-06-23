import React from 'react';
import { TradingViewWidget } from './TradingViewWidget';

interface AdvancedChartProps {
  symbol: string;
}

export const AdvancedChart: React.FC<AdvancedChartProps> = ({ symbol }) => {
  return (
    <div className="w-full h-[600px] border border-border rounded-lg overflow-hidden bg-card">
      <TradingViewWidget
        src="https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js"
        containerId={`tv-advanced-chart-${symbol}`}
        config={{
          autosize: true,
          symbol,
          interval: "D",
          timezone: "Etc/UTC",
          theme: "dark",
          style: "1",
          locale: "zh_TW",
          enable_publishing: false,
          backgroundColor: "rgba(10, 10, 10, 1)",
          gridColor: "rgba(30, 30, 30, 1)",
          hide_top_toolbar: false,
          hide_legend: false,
          save_image: false,
          container_id: `tv-advanced-chart-${symbol}`
        }}
        className="w-full h-full"
      />
    </div>
  );
};
