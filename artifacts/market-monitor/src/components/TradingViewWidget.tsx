import React, { useEffect, useRef } from 'react';

interface TradingViewWidgetProps {
  src: string;
  config: Record<string, any>;
  containerId: string;
  className?: string;
}

export const TradingViewWidget: React.FC<TradingViewWidgetProps> = ({ src, config, containerId, className }) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // Clear previous script if it exists
    containerRef.current.innerHTML = '';

    const script = document.createElement('script');
    script.src = src;
    script.type = 'text/javascript';
    script.async = true;
    script.innerHTML = JSON.stringify({
      isTransparent: true,
      colorTheme: 'dark',
      ...config,
    });

    containerRef.current.appendChild(script);

    return () => {
      if (containerRef.current) {
        containerRef.current.innerHTML = '';
      }
    };
  }, [src, JSON.stringify(config), containerId]);

  return (
    <div 
      id={containerId} 
      ref={containerRef} 
      className={`tradingview-widget-container ${className || ''}`}
    />
  );
};
