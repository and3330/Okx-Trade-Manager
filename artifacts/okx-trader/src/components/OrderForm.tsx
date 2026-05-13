import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  usePlaceOrder,
  useGetTicker,
  getGetTickerQueryKey,
  getListOrdersQueryKey,
  getListRecentFillsQueryKey,
  getGetAccountBalanceQueryKey,
  getGetAccountSummaryQueryKey,
} from "@workspace/api-client-react";

const OrderInputSide = { buy: "buy", sell: "sell" } as const;

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

const orderSchema = z.object({
  side: z.enum(["buy", "sell"]),
  notionalUsd: z.coerce.number().positive("Must be greater than 0"),
  stopLossPrice: z.coerce.number().positive().optional().or(z.literal("")),
});

type OrderFormValues = z.infer<typeof orderSchema>;

export default function OrderForm({ instId }: { instId: string }) {
  const queryClient = useQueryClient();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingValues, setPendingValues] = useState<OrderFormValues | null>(null);

  const { data: ticker } = useGetTicker(instId, {
    query: {
      enabled: !!instId,
      queryKey: getGetTickerQueryKey(instId),
      refetchInterval: 3000
    }
  });

  const placeOrder = usePlaceOrder();

  const form = useForm<OrderFormValues>({
    resolver: zodResolver(orderSchema),
    defaultValues: {
      side: OrderInputSide.buy,
      notionalUsd: 100,
      stopLossPrice: "",
    },
  });

  const onSubmit = (values: OrderFormValues) => {
    setPendingValues(values);
    setConfirmOpen(true);
  };

  const handleConfirmPlace = () => {
    if (!pendingValues) return;
    
    const payload = {
      instId,
      side: pendingValues.side,
      notionalUsd: pendingValues.notionalUsd,
      stopLossPrice: pendingValues.stopLossPrice ? Number(pendingValues.stopLossPrice) : undefined,
    };

    placeOrder.mutate({ data: payload }, {
      onSuccess: (res) => {
        toast.success(`Order placed successfully: ${res.ordId}`);
        form.reset({
          side: pendingValues.side,
          notionalUsd: 0,
          stopLossPrice: "",
        });
        setConfirmOpen(false);
        // Invalidate queries
        queryClient.invalidateQueries({ queryKey: getListOrdersQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListRecentFillsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetAccountBalanceQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetAccountSummaryQueryKey() });
      },
      onError: (err: any) => {
        const msg = err?.data?.error || err.message || "Failed to place order";
        toast.error(`Order failed: ${msg}`);
        setConfirmOpen(false);
      }
    });
  };

  const watchNotional = form.watch("notionalUsd");
  const watchSide = form.watch("side");
  
  const estimatedCrypto = ticker && watchNotional > 0 ? (watchNotional / ticker.last) : 0;
  const baseAsset = instId.split("-")[0] || "";

  return (
    <div className="flex flex-col h-full p-4">
      <h3 className="text-lg font-bold tracking-tight mb-6">Place Order</h3>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6 flex-1 flex flex-col">
          {/* Buy / Sell Toggle */}
          <FormField
            control={form.control}
            name="side"
            render={({ field }) => (
              <FormItem className="space-y-0">
                <FormControl>
                  <div className="flex rounded-md border border-border p-1 bg-muted/30">
                    <button
                      type="button"
                      onClick={() => field.onChange(OrderInputSide.buy)}
                      className={cn(
                        "flex-1 py-2 text-sm font-bold uppercase rounded transition-colors",
                        field.value === OrderInputSide.buy
                          ? "bg-[#00e59b] text-[#003d29]"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      Buy
                    </button>
                    <button
                      type="button"
                      onClick={() => field.onChange(OrderInputSide.sell)}
                      className={cn(
                        "flex-1 py-2 text-sm font-bold uppercase rounded transition-colors",
                        field.value === OrderInputSide.sell
                          ? "bg-[#ff4d4d] text-white"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      Sell
                    </button>
                  </div>
                </FormControl>
              </FormItem>
            )}
          />

          {/* Amount */}
          <FormField
            control={form.control}
            name="notionalUsd"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-xs uppercase text-muted-foreground">Amount (USDT)</FormLabel>
                <FormControl>
                  <Input 
                    type="number" 
                    step="any"
                    className="font-mono text-lg bg-background border-border h-12" 
                    {...field} 
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          {/* Stop Loss Optional */}
          <FormField
            control={form.control}
            name="stopLossPrice"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-xs uppercase text-muted-foreground">Stop Loss Price (Optional)</FormLabel>
                <FormControl>
                  <Input 
                    type="number" 
                    step="any"
                    placeholder="None"
                    className="font-mono text-lg bg-background border-border h-12" 
                    {...field} 
                    value={field.value ?? ""}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          {/* Quote Preview */}
          <div className="mt-auto bg-muted/20 border border-border rounded-md p-3">
            <div className="flex justify-between items-center text-sm mb-1">
              <span className="text-muted-foreground">Est. Fill</span>
              <span className="font-mono font-medium text-foreground">
                {estimatedCrypto > 0 ? estimatedCrypto.toFixed(6) : "0.00"} {baseAsset}
              </span>
            </div>
            <div className="flex justify-between items-center text-sm">
              <span className="text-muted-foreground">Last Price</span>
              <span className="font-mono text-foreground">
                {ticker?.last || "---"}
              </span>
            </div>
          </div>

          <Button 
            type="submit" 
            size="lg"
            className={cn(
              "w-full font-bold text-base h-14 uppercase tracking-wider",
              watchSide === OrderInputSide.buy 
                ? "bg-[#00e59b] text-[#003d29] hover:bg-[#00cc8a]" 
                : "bg-[#ff4d4d] text-white hover:bg-[#e63939]"
            )}
            disabled={placeOrder.isPending}
          >
            {placeOrder.isPending ? "Placing..." : `${watchSide} ${baseAsset}`}
          </Button>
        </form>
      </Form>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent className="bg-card border-border">
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Order</AlertDialogTitle>
            <AlertDialogDescription className="text-base text-foreground mt-4">
              Are you sure you want to {pendingValues?.side} {pendingValues?.notionalUsd} USDT worth of {baseAsset}?
              <br/><br/>
              Estimated fill: ~{estimatedCrypto.toFixed(6)} {baseAsset}
              {pendingValues?.stopLossPrice && (
                <><br/>Stop Loss: {pendingValues.stopLossPrice} USDT</>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              className="bg-transparent border-border hover:bg-muted text-foreground"
              disabled={placeOrder.isPending}
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmPlace}
              disabled={placeOrder.isPending}
              className={cn(
                "text-white border-0 disabled:opacity-60",
                pendingValues?.side === OrderInputSide.buy ? "bg-[#00e59b] hover:bg-[#00cc8a] text-[#003d29]" : "bg-[#ff4d4d] hover:bg-[#e63939]"
              )}
            >
              {placeOrder.isPending ? "Placing..." : `Confirm ${pendingValues?.side}`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
