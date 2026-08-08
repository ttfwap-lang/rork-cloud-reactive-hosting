import { useEffect, useState } from "react";
import { AlertTriangle, PauseCircle, Power, Radio, WifiOff } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useEngine } from "@/lib/engine-store";
import type { LinkState } from "@/lib/api";

function uptimeLabel(since: number | null): string {
  if (!since) return "—";
  const seconds = Math.max(0, Math.floor((Date.now() - since) / 1000));
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m ${seconds % 60}s`;
}

function agoLabel(ts: number | null): string {
  if (!ts) return "no events yet";
  const seconds = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}

const TONE: Record<LinkState["status"], { dot: string; label: string; text: string }> = {
  online: { dot: "bg-primary", label: "Connected", text: "text-primary" },
  connecting: { dot: "bg-accent", label: "Reconnecting", text: "text-accent" },
  paused: { dot: "bg-amber-400", label: "Paused", text: "text-amber-400" },
  error: { dot: "bg-destructive", label: "Error", text: "text-destructive" },
  offline: { dot: "bg-muted-foreground", label: "Offline", text: "text-muted-foreground" },
};

export function StatusStrip() {
  const { snapshot, disconnect, streamOnline, saveSettings } = useEngine();
  const [, force] = useState<number>(0);

  useEffect(() => {
    const handle = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(handle);
  }, []);

  const link = snapshot?.link;
  const status = link?.status ?? "offline";
  const tone = TONE[status];
  const killed = snapshot?.settings.killSwitch ?? false;

  return (
    <div className="sticky top-0 z-30 border-b border-white/[0.06] bg-background/80 backdrop-blur-xl">
      <div className="flex items-center gap-3 px-4 py-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            className={cn(
              "h-2.5 w-2.5 shrink-0 rounded-full",
              tone.dot,
              status === "online" && "animate-signal",
            )}
          />
          <div className="min-w-0">
            <p className={cn("truncate text-sm font-semibold leading-tight", tone.text)}>
              {killed ? "Kill switch on" : tone.label}
              {link?.identity ? <span className="text-muted-foreground"> · {link.identity}</span> : null}
            </p>
            <p className="truncate font-mono text-[11px] leading-tight text-muted-foreground">
              up {uptimeLabel(link?.since ?? null)} · last event {agoLabel(link?.lastEventAt ?? null)}
              {streamOnline ? "" : " · live feed reconnecting"}
            </p>
          </div>
        </div>

        <div className="ml-auto flex items-center gap-2">
          {status === "paused" ? (
            <span className="hidden items-center gap-1.5 rounded-full bg-amber-400/10 px-2.5 py-1 text-[11px] font-medium text-amber-400 sm:inline-flex">
              <PauseCircle className="h-3.5 w-3.5" /> auto-resume armed
            </span>
          ) : null}
          {status === "error" ? (
            <span className="hidden items-center gap-1.5 rounded-full bg-destructive/10 px-2.5 py-1 text-[11px] font-medium text-destructive sm:inline-flex">
              <AlertTriangle className="h-3.5 w-3.5" /> check connection
            </span>
          ) : null}

          <Button
            size="sm"
            variant={killed ? "default" : "outline"}
            className={cn(
              "h-8 gap-1.5 rounded-full text-xs",
              killed && "bg-primary text-primary-foreground hover:bg-primary/90",
            )}
            onClick={() => saveSettings({ killSwitch: !killed })}
          >
            <Power className="h-3.5 w-3.5" />
            {killed ? "Resume" : "Halt"}
          </Button>

          <Button
            size="sm"
            variant="ghost"
            className="h-8 gap-1.5 rounded-full text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={() => disconnect()}
          >
            {status === "offline" ? <WifiOff className="h-3.5 w-3.5" /> : <Radio className="h-3.5 w-3.5" />}
            <span className="hidden sm:inline">Disconnect</span>
          </Button>
        </div>
      </div>
    </div>
  );
}
