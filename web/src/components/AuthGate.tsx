import { Activity, CloudOff, LogOut, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Shown while a saved sign-in is being verified. It exists so the console is never
 * rendered on an unproven token: previously a stale token painted the dashboard for
 * a moment before a rejection bounced it back to the sign-in form.
 */
export function AuthChecking() {
  return (
    <div className="grid-noise grid min-h-full place-items-center px-5">
      <div className="flex flex-col items-center gap-4">
        <div className="relative grid h-14 w-14 place-items-center rounded-2xl bg-primary/12 ring-1 ring-primary/25">
          <Activity className="h-6 w-6 text-primary" />
          <span className="animate-signal absolute inset-0 rounded-2xl" />
        </div>
        <div className="text-center">
          <p className="text-sm font-medium">Checking your sign-in</p>
          <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">replyflow cloud</p>
        </div>
        <div className="animate-sweep relative h-0.5 w-32 overflow-hidden rounded-full bg-secondary/70" />
      </div>
    </div>
  );
}

/**
 * The token looks fine but the service cannot be reached. Signing the person out
 * would lose their session over a dropped connection, so it offers a retry instead.
 */
export function ServiceUnreachable({ onRetry, onSignOut }: { onRetry: () => void; onSignOut: () => void }) {
  return (
    <div className="grid-noise grid min-h-full place-items-center px-5">
      <div className="panel w-full max-w-sm p-6 text-center">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-amber-400/10 ring-1 ring-amber-400/25">
          <CloudOff className="h-5 w-5 text-amber-400" />
        </div>
        <h1 className="mt-4 text-base font-semibold">Cannot reach the service</h1>
        <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
          Your sign-in is still saved — the console just could not load. This is usually a brief network
          problem. Your flows keep running either way.
        </p>
        <div className="mt-5 flex gap-2">
          <Button onClick={onRetry} className="h-10 flex-1 gap-2 rounded-xl text-sm font-semibold">
            <RefreshCw className="h-3.5 w-3.5" />Try again
          </Button>
          <Button onClick={onSignOut} variant="secondary" className="h-10 gap-2 rounded-xl text-sm">
            <LogOut className="h-3.5 w-3.5" />Sign out
          </Button>
        </div>
      </div>
    </div>
  );
}
