import { cn } from "@/lib/utils";
import type { EngineEvent } from "@/lib/api";

const LEVEL_TONE: Record<EngineEvent["level"], string> = {
  info: "bg-accent/70",
  success: "bg-primary",
  warn: "bg-amber-400",
  error: "bg-destructive",
};

const LEVEL_TEXT: Record<EngineEvent["level"], string> = {
  info: "text-accent",
  success: "text-primary",
  warn: "text-amber-400",
  error: "text-destructive",
};

function clockLabel(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour12: false });
}

export function EventRow({ event, index }: { event: EngineEvent; index: number }) {
  return (
    <div
      className="animate-row-in flex items-start gap-3 px-4 py-2.5"
      style={{ animationDelay: `${Math.min(index, 10) * 22}ms` }}
    >
      <span className={cn("mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full", LEVEL_TONE[event.level])} />
      <span className="mt-0.5 shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
        {clockLabel(event.ts)}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm leading-snug">{event.detail}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 font-mono text-[10px] text-muted-foreground">
          <span className={LEVEL_TEXT[event.level]}>{event.type}</span>
          {event.chatKey ? <span>chat:{event.chatKey}</span> : null}
        </p>
      </div>
    </div>
  );
}
