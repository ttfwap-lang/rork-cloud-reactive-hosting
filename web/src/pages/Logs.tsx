import { useMemo, useState } from "react";
import { Radio } from "lucide-react";

import { cn } from "@/lib/utils";
import { useEngine } from "@/lib/engine-store";
import { EventRow } from "@/components/EventRow";
import type { EngineEvent } from "@/lib/api";

const FILTERS = [
  { id: "all", label: "All" },
  { id: "success", label: "Sent" },
  { id: "warn", label: "Skipped" },
  { id: "error", label: "Errors" },
] as const;

type FilterId = (typeof FILTERS)[number]["id"];

export default function Logs() {
  const { snapshot, liveEvents, streamOnline } = useEngine();
  const [filter, setFilter] = useState<FilterId>("all");

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
      .filter((event) => (filter === "all" ? true : event.level === filter))
      .sort((a, b) => b.ts - a.ts)
      .slice(0, 200);
  }, [liveEvents, snapshot?.events, filter]);

  return (
    <div className="mx-auto w-full max-w-4xl space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Execution logs</h1>
          <p className="mt-1 text-sm text-muted-foreground">Message text is never written to logs.</p>
        </div>
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider",
            streamOnline ? "bg-primary/12 text-primary" : "bg-secondary text-muted-foreground",
          )}
        >
          <Radio className={cn("h-3 w-3", streamOnline && "animate-pulse")} />
          {streamOnline ? "streaming" : "reconnecting"}
        </span>
      </header>

      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {FILTERS.map((item) => (
          <button
            key={item.id}
            onClick={() => setFilter(item.id)}
            className={cn(
              "shrink-0 rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors",
              filter === item.id
                ? "bg-primary/15 text-primary ring-1 ring-primary/30"
                : "bg-secondary/60 text-muted-foreground hover:text-foreground",
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      <section className="panel divide-y divide-white/[0.04] overflow-hidden">
        {events.length === 0 ? (
          <p className="px-4 py-12 text-center text-sm text-muted-foreground">Nothing here yet.</p>
        ) : (
          events.map((event, index) => <EventRow key={`${event.ts}-${index}`} event={event} index={index} />)
        )}
      </section>
    </div>
  );
}
