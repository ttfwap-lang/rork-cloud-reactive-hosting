import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";

import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { EngineProvider, useEngine } from "@/lib/engine-store";
import { Shell } from "@/components/Shell";
import { Gate } from "@/components/Gate";
import Overview from "./pages/Overview";
import Connection from "./pages/Connection";
import Workflows from "./pages/Workflows";
import ConversationImport from "./pages/ConversationImport";
import Logs from "./pages/Logs";
import Jobs from "./pages/Jobs";
import SettingsPage from "./pages/SettingsPage";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false } } });

function Routed() {
  const { authed } = useEngine();
  if (!authed) return <Gate />;
  return <Routes><Route element={<Shell />}><Route path="/" element={<Overview />} /><Route path="/connection" element={<Connection />} /><Route path="/workflows" element={<Workflows />} /><Route path="/import" element={<ConversationImport />} /><Route path="/logs" element={<Logs />} /><Route path="/jobs" element={<Jobs />} /><Route path="/settings" element={<SettingsPage />} /></Route><Route path="*" element={<NotFound />} /></Routes>;
}

const App = () => <QueryClientProvider client={queryClient}><TooltipProvider><Toaster position="top-right" theme="dark" /><BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><EngineProvider><Routed /></EngineProvider></BrowserRouter></TooltipProvider></QueryClientProvider>;
export default App;
