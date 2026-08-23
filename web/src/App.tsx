import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { EngineProvider, useEngine } from "@/lib/engine-store";
import { Shell } from "@/components/Shell";
import Landing from "./pages/Landing";
import SignIn from "./pages/SignIn";
import SignUp from "./pages/SignUp";
import Overview from "./pages/Overview";
import Connection from "./pages/Connection";
import Workflows from "./pages/Workflows";
import ConversationImport from "./pages/ConversationImport";
import Logs from "./pages/Logs";
import Jobs from "./pages/Jobs";
import SettingsPage from "./pages/SettingsPage";
import Owner from "./pages/Owner";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false } } });

function Routed() {
  const { authed, isOwner } = useEngine();

  // Signed out: the public front door. Signed in: the console, with the marketing
  // routes redirecting straight through so nobody lands back on a sales page.
  if (!authed) {
    return (
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/signin" element={<SignIn />} />
        <Route path="/signup" element={<SignUp />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route element={<Shell />}>
        <Route path="/" element={<Overview />} />
        <Route path="/connection" element={<Connection />} />
        <Route path="/workflows" element={<Workflows />} />
        <Route path="/import" element={<ConversationImport />} />
        <Route path="/logs" element={<Logs />} />
        <Route path="/jobs" element={<Jobs />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/owner" element={isOwner ? <Owner /> : <Navigate to="/" replace />} />
      </Route>
      <Route path="/signin" element={<Navigate to="/" replace />} />
      <Route path="/signup" element={<Navigate to="/" replace />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster position="top-right" theme="dark" />
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <EngineProvider>
          <Routed />
        </EngineProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);
export default App;
