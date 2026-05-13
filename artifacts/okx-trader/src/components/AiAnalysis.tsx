import { useState } from "react";
import { useAnalyzeMarket } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";

export default function AiAnalysis({ instId }: { instId: string }) {
  const [result, setResult] = useState<{
    instId: string;
    analysis: string;
    generatedAt: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const analyze = useAnalyzeMarket();

  const onAnalyze = () => {
    setError(null);
    analyze.mutate(
      { data: { instId } },
      {
        onSuccess: (res) => {
          setResult({
            instId: res.instId,
            analysis: res.analysis,
            generatedAt: res.generatedAt,
          });
        },
        onError: (err: unknown) => {
          const e = err as { data?: { error?: string }; message?: string };
          setError(e?.data?.error || e?.message || "AI analysis failed");
        },
      },
    );
  };

  const stale = result && result.instId !== instId;

  return (
    <div className="border-b border-border">
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-card">
        <span className="text-xs font-semibold text-muted-foreground tracking-wider uppercase">
          AI Analysis
        </span>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          onClick={onAnalyze}
          disabled={analyze.isPending}
        >
          {analyze.isPending
            ? "Analyzing..."
            : result && !stale
              ? "Refresh"
              : `Analyze ${instId}`}
        </Button>
      </div>
      <div className="p-4 max-h-[280px] overflow-y-auto">
        {error && (
          <div className="text-xs text-destructive font-mono whitespace-pre-wrap">
            {error}
          </div>
        )}
        {!error && !result && !analyze.isPending && (
          <p className="text-xs text-muted-foreground leading-relaxed">
            Click Analyze to ask Claude for a short read on {instId} based on
            recent 1H candles, the live ticker, and your account holdings.
          </p>
        )}
        {analyze.isPending && (
          <div className="text-xs text-muted-foreground font-mono">
            Reading the chart...
          </div>
        )}
        {result && !analyze.isPending && (
          <>
            {stale && (
              <div className="mb-2 text-xs text-amber-400">
                Showing analysis for {result.instId}. Click Analyze to update for{" "}
                {instId}.
              </div>
            )}
            <div className="text-xs text-foreground whitespace-pre-wrap leading-relaxed font-sans">
              {result.analysis}
            </div>
            <div className="mt-3 text-[10px] uppercase tracking-wider text-muted-foreground">
              Generated {format(new Date(result.generatedAt), "HH:mm:ss")}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
