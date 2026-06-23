import React from 'react';
import { SignalsPanel } from '@/components/SignalsPanel';
import { StrategyPanel } from '@/components/StrategyPanel';

export default function Strategy() {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <SignalsPanel />
      <StrategyPanel />
    </div>
  );
}
