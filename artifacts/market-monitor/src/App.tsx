import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SelectionProvider } from "@/lib/selection";
import { AppShell } from "@/components/AppShell";
import NotFound from "@/pages/not-found";
import Overview from "@/pages/Overview";
import Markets from "@/pages/Markets";
import Holdings from "@/pages/Holdings";
import Strategy from "@/pages/Strategy";

const queryClient = new QueryClient();

function Router() {
  return (
    <Switch>
      <Route path="/" component={Overview} />
      <Route path="/markets" component={Markets} />
      <Route path="/holdings" component={Holdings} />
      <Route path="/strategy" component={Strategy} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <SelectionProvider>
            <AppShell>
              <Router />
            </AppShell>
          </SelectionProvider>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
