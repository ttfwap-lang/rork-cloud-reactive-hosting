import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";

import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { EngineProvider, useEngine } from "@/lib/engine-store";
import { Shell } from "@/components/Shell";
import { AuthChecking, ServiceUnreachable } from "@/components/AuthGate";
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

/** Console routes. Following one while signed out remembers it through sign-in. */
const CONSOLE_PATHS = ["/connection", "/workflows", "/import", "/logs", "/jobs", "/settings", "/owner"] as const;

/**
 * Sends someone who asked for a console page to the sign-in form carrying where
 * they were headed, so signing in resumes the journey instead of dumping them on
 * the overview. Anything else is not a real page, so it goes to the front door.
 */
function PublicFallback() {
  const location = useLocation();
  const wanted = CONSOLE_PATHS.some((path) => location.pathname === path || location.pathname.startsWith(`${path}/`));
  if (!wanted) return <Navigate to="/" replace />;
  return <Navigate to="/signin" replace state={{ from: `${location.pathname}${location.search}` }} />;
}

function Routed() {
  const { authStatus, isOwner, retryAuth, signOut } = useEngine();

  // A saved token is not proof. Until the service has vouched for it, neither the
  // console nor the sign-in form is correct to show, so neither is rendered.
  if (authStatus === "checking") return <AuthChecking />;
  if (authStatus === "offline") return <ServiceUnreachable onRetry={retryAuth} onSignOut={signOut} />;

  if (authStatus === "anonymous") {
    return (
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/signin" element={<SignIn />} />
        <Route path="/signup" element={<SignUp />} />
        <Route path="*" element={<PublicFallback />} />
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
