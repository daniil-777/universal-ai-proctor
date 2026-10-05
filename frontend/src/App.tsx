import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, HashRouter, Route, Routes } from "react-router-dom";
import { appBasePath, isStaticHosting } from "./lib/deployment";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Index from "./pages/Index.tsx";
import Share from "./pages/Share.tsx";
import NotFound from "./pages/NotFound.tsx";
import { useVisualViewport } from "./hooks/use-visual-viewport";

const queryClient = new QueryClient();

const App = () => {
  useVisualViewport();
  const staticHosting = isStaticHosting();
  const Router = staticHosting ? HashRouter : BrowserRouter;
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <Router basename={staticHosting ? "/" : appBasePath()}>
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/share/:sessionId" element={<Share />} />
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Router>
      </TooltipProvider>
    </QueryClientProvider>
  );
};

export default App;
