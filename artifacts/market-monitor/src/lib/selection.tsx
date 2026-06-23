import React, { createContext, useContext, useState } from 'react';

interface SelectionState {
  symbol: string;
  market: string;
}

interface SelectionContextValue extends SelectionState {
  select: (symbol: string, market: string) => void;
}

const SelectionContext = createContext<SelectionContextValue | null>(null);

export const SelectionProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, setState] = useState<SelectionState>({
    symbol: 'BINANCE:BTCUSDT',
    market: 'crypto',
  });

  const select = (symbol: string, market: string) => setState({ symbol, market });

  return (
    <SelectionContext.Provider value={{ ...state, select }}>
      {children}
    </SelectionContext.Provider>
  );
};

export function useSelection(): SelectionContextValue {
  const ctx = useContext(SelectionContext);
  if (!ctx) throw new Error('useSelection must be used within SelectionProvider');
  return ctx;
}
