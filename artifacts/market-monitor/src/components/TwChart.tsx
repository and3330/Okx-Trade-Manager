import React from 'react';
import {
  createChart,
  CandlestickSeries,
  ColorType,
  type IChartApi,
  type ISeriesApi,
} from 'lightweight-charts';
import { Card, CardContent } from '@/components/ui/card';
import { useListTwCandles } from '@workspace/api-client-react';
import { normalizeTwCode } from '@/lib/markets';
import { Activity } from 'lucide-react';

interface TwChartProps {
  symbol: string;
}

export const TwChart: React.FC<TwChartProps> = ({ symbol }) => {
  const code = normalizeTwCode(symbol);
  const isIndex = code === 't00';

  const { data, isLoading, isError } = useListTwCandles(
    { code },
    {
      query: {
        queryKey: ['tw-candles', code],
        enabled: !isIndex,
        staleTime: 5 * 60 * 1000,
      },
    },
  );

  const containerRef = React.useRef<HTMLDivElement>(null);
  const chartRef = React.useRef<IChartApi | null>(null);
  const seriesRef = React.useRef<ISeriesApi<'Candlestick'> | null>(null);

  React.useEffect(() => {
    if (isIndex || !containerRef.current) return;
    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#9ca3af',
        fontFamily: 'inherit',
      },
      grid: {
        vertLines: { color: 'rgba(148,163,184,0.08)' },
        horzLines: { color: 'rgba(148,163,184,0.08)' },
      },
      rightPriceScale: { borderColor: 'rgba(148,163,184,0.15)' },
      timeScale: { borderColor: 'rgba(148,163,184,0.15)' },
      autoSize: true,
      crosshair: { mode: 0 },
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: '#ef4444',
      downColor: '#22c55e',
      borderUpColor: '#ef4444',
      borderDownColor: '#22c55e',
      wickUpColor: '#ef4444',
      wickDownColor: '#22c55e',
    });
    chartRef.current = chart;
    seriesRef.current = series;
    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [isIndex]);

  React.useEffect(() => {
    if (!seriesRef.current || !data) return;
    seriesRef.current.setData(
      data.map((c) => ({
        time: c.time,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      })),
    );
    chartRef.current?.timeScale().fitContent();
  }, [data]);

  if (isIndex) {
    return (
      <Card className="border-dashed border-muted-foreground/30 bg-card/50">
        <CardContent className="flex h-[400px] flex-col items-center justify-center gap-3 p-6 text-center">
          <Activity className="h-8 w-8 text-muted-foreground" />
          <p className="text-base font-medium text-foreground">加權指數無個股日線</p>
          <p className="max-w-md text-sm text-muted-foreground">
            指數本身沒有單一個股的日 K 線資料。請在右側報價或追蹤清單選擇個股（例如台積電
            2330），即可看到完整日 K 走勢圖。
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-card">
      <CardContent className="p-3">
        <div className="relative h-[400px] w-full">
          <div ref={containerRef} className="h-full w-full" />
          {isLoading && (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
              載入官方台股日線資料中…
            </div>
          )}
          {isError && (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
              暫時無法取得台股資料，請稍後再試。
            </div>
          )}
          {!isLoading && !isError && data && data.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
              查無此代號的日線資料。
            </div>
          )}
        </div>
        <p className="mt-2 px-1 text-xs text-muted-foreground">
          資料來源：台灣證券交易所公開資訊・日 K 線（紅漲綠跌）。
        </p>
      </CardContent>
    </Card>
  );
};
