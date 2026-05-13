import { useGetAccountSummary, getGetAccountSummaryQueryKey } from "@workspace/api-client-react";

export default function AccountOverview() {
  const { data: summary, isLoading, isError } = useGetAccountSummary({
    query: { refetchInterval: 5000, queryKey: getGetAccountSummaryQueryKey() }
  });

  if (isLoading) {
    return <div className="text-sm text-muted-foreground font-mono">Loading balances...</div>;
  }

  if (isError || !summary) {
    return <div className="text-sm text-destructive font-mono">Failed to load balance</div>;
  }

  return (
    <div className="flex items-center gap-6 text-sm">
      <div className="flex flex-col items-end">
        <span className="text-xs text-muted-foreground uppercase tracking-wider">Total Equity</span>
        <span className="font-mono font-bold text-foreground">
          ${summary.totalEquityUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </span>
      </div>
      <div className="flex flex-col items-end">
        <span className="text-xs text-muted-foreground uppercase tracking-wider">Open Orders</span>
        <span className="font-mono font-medium text-foreground">{summary.openOrderCount}</span>
      </div>
    </div>
  );
}
