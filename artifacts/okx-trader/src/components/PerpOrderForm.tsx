import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  usePlacePerpOrder,
  useGetTicker,
  useGetPerpInstrument,
  getGetTickerQueryKey,
  getGetPerpInstrumentQueryKey,
  getListPerpPositionsQueryKey,
  getListOrdersQueryKey,
  getListRecentFillsQueryKey,
  getGetAccountBalanceQueryKey,
  getGetAccountSummaryQueryKey,
} from "@workspace/api-client-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";

const perpSchema = z.object({
  side: z.enum(["long", "short"]),
  marginUsdt: z.coerce.number().positive("Must be > 0"),
  leverage: z.coerce.number().int().min(1).max(125),
  takeProfitPrice: z.union([z.coerce.number().positive(), z.literal(""), z.undefined()]).optional(),
  stopLossPrice: z.union([z.coerce.number().positive(), z.literal(""), z.undefined()]).optional(),
});

type PerpFormValues = z.infer<typeof perpSchema>;

export default function PerpOrderForm({ instId }: { instId: string }) {
  const queryClient = useQueryClient();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, setPending] = useState<PerpFormValues | null>(null);

  const { data: ticker } = useGetTicker(instId, {
    query: { enabled: !!instId, queryKey: getGetTickerQueryKey(instId), refetchInterval: 3000 },
  });
  const { data: meta } = useGetPerpInstrument(instId, {
    query: { enabled: !!instId, queryKey: getGetPerpInstrumentQueryKey(instId) },
  });

  const placePerp = usePlacePerpOrder();

  const form = useForm<PerpFormValues>({
    resolver: zodResolver(perpSchema),
    defaultValues: {
      side: "long",
      marginUsdt: 50,
      leverage: 10,
      takeProfitPrice: "",
      stopLossPrice: "",
    },
  });

  const watchSide = form.watch("side");
  const watchMargin = form.watch("marginUsdt");
  const watchLev = form.watch("leverage");

  const baseCcy = instId.replace("-USDT-SWAP", "");
  const last = ticker?.last ?? 0;
  const notional = (Number(watchMargin) || 0) * (Number(watchLev) || 0);
  const ctVal = meta?.ctVal ?? 0;
  const lotSz = meta?.lotSz ?? 1;
  const rawContracts = ctVal > 0 && last > 0 ? notional / (last * ctVal) : 0;
  const contracts = lotSz > 0 ? Math.floor(rawContracts / lotSz) * lotSz : 0;
  const baseQty = contracts * ctVal;
  const maxLev = meta?.maxLeverage ?? 125;

  const onSubmit = (values: PerpFormValues) => {
    setPending(values);
    setConfirmOpen(true);
  };

  const handleConfirm = () => {
    if (!pending) return;
    const tp = pending.takeProfitPrice ? Number(pending.takeProfitPrice) : undefined;
    const sl = pending.stopLossPrice ? Number(pending.stopLossPrice) : undefined;
    placePerp.mutate(
      {
        data: {
          instId,
          side: pending.side,
          marginUsdt: Number(pending.marginUsdt),
          leverage: Number(pending.leverage),
          takeProfitPrice: tp,
          stopLossPrice: sl,
        },
      },
      {
        onSuccess: (res) => {
          toast.success(`Position opened: ${res.contracts} contracts @ ${res.markPx}`);
          setConfirmOpen(false);
          queryClient.invalidateQueries({ queryKey: getListPerpPositionsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getListOrdersQueryKey() });
          queryClient.invalidateQueries({ queryKey: getListRecentFillsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetAccountBalanceQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetAccountSummaryQueryKey() });
        },
        onError: (err: any) => {
          const msg = err?.data?.error || err.message || "Failed";
          toast.error(`Order failed: ${msg}`);
          setConfirmOpen(false);
        },
      },
    );
  };

  return (
    <div className="flex flex-col h-full p-4">
      <div className="flex items-baseline justify-between mb-4">
        <h3 className="text-lg font-bold tracking-tight">Open Perp</h3>
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{baseCcy} · max {maxLev}x</span>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 flex-1 flex flex-col">
          <FormField
            control={form.control}
            name="side"
            render={({ field }) => (
              <FormItem className="space-y-0">
                <FormControl>
                  <div className="flex rounded-md border border-border p-1 bg-muted/30">
                    <button
                      type="button"
                      onClick={() => field.onChange("long")}
                      className={cn(
                        "flex-1 py-2 text-sm font-bold uppercase rounded transition-colors",
                        field.value === "long" ? "bg-[#00e59b] text-[#003d29]" : "text-muted-foreground hover:text-foreground",
                      )}
                    >Long</button>
                    <button
                      type="button"
                      onClick={() => field.onChange("short")}
                      className={cn(
                        "flex-1 py-2 text-sm font-bold uppercase rounded transition-colors",
                        field.value === "short" ? "bg-[#ff4d4d] text-white" : "text-muted-foreground hover:text-foreground",
                      )}
                    >Short</button>
                  </div>
                </FormControl>
              </FormItem>
            )}
          />

          <div className="grid grid-cols-2 gap-3">
            <FormField
              control={form.control}
              name="marginUsdt"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-xs uppercase text-muted-foreground">Margin (USDT)</FormLabel>
                  <FormControl>
                    <Input type="number" step="any" className="font-mono text-base bg-background border-border h-11" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="leverage"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-xs uppercase text-muted-foreground">Leverage (x)</FormLabel>
                  <FormControl>
                    <Input type="number" step="1" min={1} max={maxLev} className="font-mono text-base bg-background border-border h-11" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <FormField
            control={form.control}
            name="takeProfitPrice"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-xs uppercase text-muted-foreground">Take Profit (Optional)</FormLabel>
                <FormControl>
                  <Input type="number" step="any" placeholder="None" className="font-mono text-base bg-background border-border h-11" {...field} value={field.value ?? ""} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="stopLossPrice"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-xs uppercase text-muted-foreground">Stop Loss (Optional)</FormLabel>
                <FormControl>
                  <Input type="number" step="any" placeholder="None" className="font-mono text-base bg-background border-border h-11" {...field} value={field.value ?? ""} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <div className="mt-auto bg-muted/20 border border-border rounded-md p-3 text-sm space-y-1">
            <div className="flex justify-between"><span className="text-muted-foreground">Notional</span><span className="font-mono">${notional.toFixed(2)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Est. Size</span><span className="font-mono">{contracts} ct · {baseQty.toFixed(4)} {baseCcy}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Mark</span><span className="font-mono">{last || "---"}</span></div>
          </div>

          <Button
            type="submit"
            size="lg"
            className={cn(
              "w-full font-bold text-base h-14 uppercase tracking-wider",
              watchSide === "long" ? "bg-[#00e59b] text-[#003d29] hover:bg-[#00cc8a]" : "bg-[#ff4d4d] text-white hover:bg-[#e63939]",
            )}
            disabled={placePerp.isPending}
          >
            {placePerp.isPending ? "Placing..." : `${watchSide === "long" ? "Long" : "Short"} ${baseCcy} ${watchLev}x`}
          </Button>
        </form>
      </Form>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent className="bg-card border-border">
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Perp Order</AlertDialogTitle>
            <AlertDialogDescription className="text-foreground mt-2 space-y-1">
              <div>{pending?.side === "long" ? "Long" : "Short"} <b>{baseCcy}</b> at <b>{pending?.leverage}x</b></div>
              <div>Margin: <b>{pending?.marginUsdt} USDT</b> · Notional: <b>${notional.toFixed(2)}</b></div>
              <div>Est. fill: <b>{contracts} contracts</b> (~{baseQty.toFixed(4)} {baseCcy}) @ ~{last}</div>
              {pending?.takeProfitPrice ? <div>Take Profit: <b>{pending.takeProfitPrice}</b></div> : null}
              {pending?.stopLossPrice ? <div>Stop Loss: <b>{pending.stopLossPrice}</b></div> : null}
              <div className="text-xs text-muted-foreground pt-2">Real money. {pending?.leverage}x leverage means your margin is wiped if price moves ~{(100 / (Number(pending?.leverage) || 1)).toFixed(2)}% against you.</div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={placePerp.isPending} className="bg-transparent border-border hover:bg-muted text-foreground">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirm}
              disabled={placePerp.isPending}
              className={cn(
                "text-white border-0 disabled:opacity-60",
                pending?.side === "long" ? "bg-[#00e59b] hover:bg-[#00cc8a] text-[#003d29]" : "bg-[#ff4d4d] hover:bg-[#e63939]",
              )}
            >
              {placePerp.isPending ? "Placing..." : `Confirm ${pending?.side === "long" ? "Long" : "Short"}`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
