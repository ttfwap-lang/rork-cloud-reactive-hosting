import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, GitBranch, MessagesSquare, Radio, Timer } from "lucide-react";

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
    if (from === target) {
      setValue(target);
      return;
    }
    const start = performance.now();
    const duration = 640;
    let frame = 0;

    const step = (now: number): void => {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(Math.round(from + (target - from) * eased));
      if (progress < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target]);

  return value;
}

function StatCard({
  icon: Icon,
  label,
  value,
  hint,
  accent,
}: {
  icon: typeof Radio;
  label: string;
  value: number;
  hint: string;
  accent: string;
}) {
  const animated = useCountUp(value);
  return (
    <div className="panel relative overflow-hidden p-4">
      <div className={cn("absolute -right-6 -top-6 h-20 w-20 rounded-full opacity-20 blur-2xl", accent)} />
      <Icon className="h-4 w-4 text-muted-foreground" />
      <p className="mt-3 font-mono text-3xl font-semibold tabular-nums leading-none">{animated}</p>
      <p className="mt-1.5 text-sm font-medium">{label}</p>
      <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>
    </div>
  );
}

export default function Overview() {
  const { snapshot, liveEvents, isLoading } = useEngine();

  const events = useMemo<EngineEvent[]>(() => {
    const merged = [...liveEvents, ...(snapshot?.events ?? [])];
    const seen = new Set<string>();
    return merged
      .filter((event) => {
        const key = `${event.ts}:${event.type}:${event.detail}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => b.ts - a.ts)
      .slice(0, 12);
  }, [liveEvents, snapshot?.events]);

  const stats = snapshot?.stats;
  const enabled = snapshot?.workflows.filter((w) => w.enabled).length ?? 0;

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Overview</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your engine runs in the cloud on a one-minute watchdog. Closing this tab changes nothing.
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          icon={MessagesSquare}
          label="Replies sent"
          value={stats?.sentToday ?? 0}
          hint="last 24 hours"
          accent="bg-primary"
        />
        <StatCard
          icon={Timer}
          label="Live conversations"
          value={stats?.activeConversations ?? 0}
          hint="mid-workflow right now"
          accent="bg-accent"
        />
        <StatCard
          icon={GitBranch}
          label="Active workflows"
          value={enabled}
          hint={`${stats?.workflowCount ?? 0} total`}
          accent="bg-primary"
        />
        <StatCard
          icon={Radio}
          label="Queued failures"
          value={snapshot?.jobs.filter((j) => j.status === "pending").length ?? 0}
          hint="awaiting replay"
          accent="bg-destructive"
        />
      </div>

      <section className="panel overflow-hidden">
        <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold">Live activity</h2>
            <p className="text-[11px] text-muted-foreground">Streamed from the engine as it happens</p>
          </div>
          <Link
            to="/logs"
            className="inline-flex items-center gap-1 text-xs text-primary transition-opacity hover:opacity-80"
          >
            All logs <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        </div>

        <div className="divide-y divide-white/[0.04]">
          {isLoading ? (
            <div className="relative h-24 overflow-hidden">
              <div className="animate-sweep absolute inset-0" />
            </div>
          ) : events.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <p className="text-sm text-muted-foreground">No events yet.</p>
              <Link to="/connection" className="mt-1 inline-block text-xs text-primary">
                Connect Telegram to start the stream
              </Link>
            </div>
          ) : (
            events.map((event, index) => <EventRow key={`${event.ts}-${index}`} event={event} index={index} />)
          )}
        </div>
      </section>
    </div>
  );
}
