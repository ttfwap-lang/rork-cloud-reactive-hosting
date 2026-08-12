import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, Bot, CirclePause, GitBranch, MessagesSquare, OctagonX, Pin, Radio, ShieldCheck, Timer, UserRound, Zap } from "lucide-react";

import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { useEngine } from "@/lib/engine-store";
import type { EngineEvent } from "@/lib/api";
import { EventRow } from "@/components/EventRow";

function useCountUp(target: number): number {
  const [value, setValue] = useState<number>(0);
  const previous = useRef<number>(0);
  useEffect(() => {
    const from = previous.current;
    previous.current = target;
    const start = performance.now();
    let frame = 0;
    const step = (now: number): void => {
      const progress = Math.min(1, (now - start) / 600);
      setValue(Math.round(from + (target - from) * (1 - Math.pow(1 - progress, 3))));
      if (progress < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target]);
  return value;
}

function StatCard({ icon: Icon, label, value, hint, accent }: { icon: typeof Radio; label: string; value: number; hint: string; accent: string }) {
  const animated = useCountUp(value);
  return <div className="panel relative overflow-hidden p-4"><div className={cn("absolute -right-6 -top-6 h-20 w-20 rounded-full opacity-20 blur-2xl", accent)} /><Icon className="h-4 w-4 text-muted-foreground" /><p className="mt-3 font-mono text-3xl font-semibold tabular-nums leading-none">{animated}</p><p className="mt-1.5 text-sm font-medium">{label}</p><p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p></div>;
}

export default function Overview() {
  const { snapshot, liveEvents, isLoading, saveSettings } = useEngine();
  const events = useMemo<EngineEvent[]>(() => {
    const seen = new Set<string>();
    return [...liveEvents, ...(snapshot?.events ?? [])].filter((event) => { const key = `${event.ts}:${event.type}:${event.detail}`; if (seen.has(key)) return false; seen.add(key); return true; }).sort((a, b) => b.ts - a.ts).slice(0, 12);
  }, [liveEvents, snapshot?.events]);
  const stats = snapshot?.stats;
  const settings = snapshot?.settings;
  const enabled = snapshot?.workflows.filter((workflow) => workflow.status === "enabled").length ?? 0;
  const automationOn = settings?.automationEnabled ?? false;
  const killed = settings?.killSwitch ?? false;
  const hardwired = snapshot?.hardwired;
  const pinnedFlow = snapshot?.workflows.find((workflow) => workflow.pinned);
  const running = (hardwired?.activeRuns.length ?? 0) > 0;

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5">
      <header><h1 className="text-xl font-semibold tracking-tight">Operations overview</h1><p className="mt-1 text-sm text-muted-foreground">The control plane and connector run without this browser tab.</p></header>

      <section className={cn("panel relative overflow-hidden p-5 transition-all", automationOn ? "ring-1 ring-primary/25" : "ring-1 ring-amber-400/20")}>
        <div className={cn("absolute inset-y-0 left-0 w-1", automationOn ? "bg-primary" : "bg-amber-400")} />
        <div className="flex flex-wrap items-center gap-4">
          <div className={cn("grid h-12 w-12 place-items-center rounded-2xl", automationOn ? "bg-primary/15 text-primary" : "bg-amber-400/10 text-amber-300")}>{automationOn ? <ShieldCheck className="h-5 w-5" /> : <CirclePause className="h-5 w-5" />}</div>
          <div className="min-w-0 flex-1"><p className="text-base font-semibold">Automation {automationOn ? "enabled" : "disabled"}</p><p className="mt-0.5 text-xs text-muted-foreground">{automationOn ? `${enabled} enabled workflow${enabled === 1 ? "" : "s"} may act within every safety limit.` : "All workflows are paused globally. The Telegram connection stays online."}</p></div>
          <div className="flex items-center gap-3 rounded-full bg-background/50 px-4 py-2"><span className="text-xs font-semibold">{automationOn ? "On" : "Off"}</span><Switch checked={automationOn} onCheckedChange={(checked) => saveSettings({ automationEnabled: checked })} aria-label="Enable all automated workflows" /></div>
        </div>
      </section>

      {pinnedFlow ? (
        <section className={cn("panel relative overflow-hidden p-5", killed ? "ring-1 ring-destructive/30" : "ring-1 ring-accent/25")}>
          <div className={cn("absolute inset-y-0 left-0 w-1", killed ? "bg-destructive" : "bg-accent")} />
          <div className="flex flex-wrap items-center gap-4 pl-2">
            <div className={cn("grid h-12 w-12 place-items-center rounded-2xl", killed ? "bg-destructive/10 text-destructive" : "bg-accent/12 text-accent")}><Zap className="h-5 w-5" /></div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-base font-semibold">{pinnedFlow.name}</p>
                <span className="inline-flex items-center gap-1 rounded-full bg-accent/10 px-2 py-0.5 font-mono text-[9px] uppercase text-accent ring-1 ring-accent/25"><Pin className="h-2.5 w-2.5" />permanent</span>
                {running ? <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2 py-0.5 font-mono text-[9px] uppercase text-primary"><span className="h-1.5 w-1.5 animate-signal rounded-full bg-primary" />running</span> : null}
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {killed
                  ? "Halted by the emergency stop — its only brake."
                  : running
                    ? `Mid-run at step ${(hardwired?.activeRuns[0]?.stepIndex ?? 0) + 1} of ${hardwired?.stepCount ?? pinnedFlow.steps.length}.`
                    : `Idle — waiting for “${pinnedFlow.steps[0]?.trigger ?? "joefortune"}”. Every limit is bypassed.`}
                {hardwired?.lastBot ? ` Last answered ${hardwired.lastBot}.` : ""}
              </p>
            </div>
            <div className="text-right"><p className="font-mono text-2xl font-semibold tabular-nums leading-none">{hardwired?.replies ?? 0}</p><p className="mt-0.5 text-[10px] text-muted-foreground">replies sent</p></div>
            <button
              onClick={() => saveSettings({ killSwitch: !killed })}
              className={cn("inline-flex h-11 items-center gap-2 rounded-full px-5 text-sm font-semibold transition-all active:scale-[0.97]",
                killed ? "bg-primary text-primary-foreground" : "bg-destructive text-destructive-foreground shadow-[0_0_24px_-6px_hsl(var(--destructive))]")}
            >
              <OctagonX className="h-4 w-4" />{killed ? "Release stop" : "Emergency stop"}
            </button>
          </div>
        </section>
      ) : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard icon={MessagesSquare} label="Actions sent" value={stats?.sentToday ?? 0} hint={`of ${settings?.dailyCap ?? 0} daily cap`} accent="bg-primary" />
        <StatCard icon={Timer} label="Live conversations" value={stats?.activeConversations ?? 0} hint="mid-workflow right now" accent="bg-accent" />
        <StatCard icon={GitBranch} label="Active workflows" value={enabled} hint={`${stats?.workflowCount ?? 0} total versions`} accent="bg-primary" />
        <StatCard icon={Radio} label="Queued failures" value={stats?.pendingJobs ?? 0} hint="safe replay candidates" accent="bg-destructive" />
      </div>

      <div className="grid gap-3 lg:grid-cols-[1.15fr_0.85fr]">
        <section className="panel p-4">
          <div className="flex items-center justify-between"><div><h2 className="text-sm font-semibold">Telegram data plane</h2><p className="text-[11px] text-muted-foreground">Connection identity, mode and recovery state</p></div>{snapshot?.link.mode === "personal" ? <UserRound className="h-4 w-4 text-primary" /> : <Bot className="h-4 w-4 text-accent" />}</div>
          <div className="mt-4 flex items-center gap-3 rounded-xl bg-secondary/35 p-3"><span className={cn("h-2.5 w-2.5 rounded-full", snapshot?.link.status === "online" ? "animate-signal bg-primary" : snapshot?.link.status === "paused" ? "bg-amber-400" : "bg-destructive")} /><div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold capitalize">{snapshot?.link.mode ?? "none"} · {snapshot?.link.status.replace(/_/g, " ") ?? "offline"}</p><p className="truncate text-[10px] text-muted-foreground">{snapshot?.link.identity ?? snapshot?.link.detail ?? "Connect Telegram to begin"}</p></div><Link to="/connection" className="text-[11px] text-primary">Manage</Link></div>
          <div className="mt-3 grid grid-cols-2 gap-2"><div className="rounded-xl bg-secondary/25 p-3"><p className="font-mono text-sm font-semibold">{snapshot?.connector.configured ? "Ready" : "Pending"}</p><p className="mt-0.5 text-[10px] text-muted-foreground">Railway connector</p></div><div className="rounded-xl bg-secondary/25 p-3"><p className="truncate font-mono text-sm font-semibold">{snapshot?.ai.model.split("/")[1] ?? "—"}</p><p className="mt-0.5 text-[10px] text-muted-foreground">AI screenshot model</p></div></div>
        </section>
        <section className="panel p-4"><h2 className="text-sm font-semibold">Top warnings · 24h</h2><p className="text-[11px] text-muted-foreground">Redacted operational categories only</p><div className="mt-3 space-y-2">{stats?.errorCategories.length ? stats.errorCategories.map((item) => <div key={item.type} className="flex items-center gap-3 rounded-xl bg-secondary/30 px-3 py-2"><span className="h-1.5 w-1.5 rounded-full bg-amber-400" /><span className="min-w-0 flex-1 truncate font-mono text-[10px]">{item.type}</span><span className="font-mono text-xs font-semibold">{item.count}</span></div>) : <div className="grid h-28 place-items-center text-xs text-muted-foreground">No warnings in the current window.</div>}</div></section>
      </div>

      <section className="panel overflow-hidden">
        <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3"><div><h2 className="text-sm font-semibold">Live activity</h2><p className="text-[11px] text-muted-foreground">No message contents are written to this stream</p></div><Link to="/logs" className="inline-flex items-center gap-1 text-xs text-primary">All logs <ArrowUpRight className="h-3.5 w-3.5" /></Link></div>
        <div className="divide-y divide-white/[0.04]">{isLoading ? <div className="relative h-24 overflow-hidden"><div className="animate-sweep absolute inset-0" /></div> : events.length === 0 ? <div className="px-4 py-10 text-center text-sm text-muted-foreground">No events yet.</div> : events.map((event, index) => <EventRow key={`${event.ts}-${index}`} event={event} index={index} />)}</div>
      </section>
    </div>
  );
}
