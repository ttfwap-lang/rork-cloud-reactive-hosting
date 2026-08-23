import { useEffect, useMemo, useRef, useState } from "react";
import { Bot, CornerDownRight, MousePointerClick, Zap } from "lucide-react";

import { cn } from "@/lib/utils";

type Beat =
  | { kind: "bot"; text: string; buttons?: string[]; hold: number }
  | { kind: "match"; label: string; hold: number }
  | { kind: "press"; button: string; hold: number }
  | { kind: "send"; text: string; hold: number }
  | { kind: "rest"; hold: number };

/**
 * One full turn of a real flow: the bot speaks, a rule matches, a button is pressed,
 * the bot answers, and a reply goes back. Timed to read in about six seconds.
 */
const SCRIPT: Beat[] = [
  { kind: "rest", hold: 700 },
  { kind: "bot", text: "Welcome back. What would you like to do?", buttons: ["Daily bonus", "Balance"], hold: 1100 },
  { kind: "match", label: 'contains "what would you like"', hold: 850 },
  { kind: "press", button: "Daily bonus", hold: 1100 },
  { kind: "bot", text: "Bonus claimed — 50 free spins added.", hold: 1100 },
  { kind: "match", label: 'contains "bonus claimed"', hold: 850 },
  { kind: "send", text: "thanks 🙏", hold: 2100 },
];

type Line = { id: number; side: "in" | "out"; text: string; buttons?: string[]; pressed: string | null };

const STATUS: Record<Beat["kind"], string> = {
  rest: "listening",
  bot: "message received",
  match: "rule matched",
  press: "pressing button",
  send: "sending reply",
};

/** The still frame shown to anyone who has asked for reduced motion. */
const RESTING: Line[] = [
  { id: 0, side: "in", text: "Welcome back. What would you like to do?", buttons: ["Daily bonus", "Balance"], pressed: "Daily bonus" },
  { id: 1, side: "in", text: "Bonus claimed — 50 free spins added.", pressed: null },
  { id: 2, side: "out", text: "thanks 🙏", pressed: null },
];

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * A self-contained, looping demonstration of a flow answering a bot. It is drawn in
 * the page rather than recorded, so it stays sharp at any size, costs no bandwidth,
 * and can hold still for anyone who prefers reduced motion.
 */
export function FlowDemo() {
  const reduced = useMemo(prefersReducedMotion, []);
  const [beat, setBeat] = useState<number>(0);
  const [lines, setLines] = useState<Line[]>([]);
  const counter = useRef<number>(0);

  useEffect(() => {
    if (reduced) return;
    const current = SCRIPT[beat];
    if (!current) return;

    if (current.kind === "bot") {
      counter.current += 1;
      const id = counter.current;
      setLines((previous) => [...previous, { id, side: "in", text: current.text, buttons: current.buttons, pressed: null }]);
    }
    if (current.kind === "send") {
      counter.current += 1;
      const id = counter.current;
      setLines((previous) => [...previous, { id, side: "out", text: current.text, pressed: null }]);
    }
    if (current.kind === "press") {
      setLines((previous) =>
        previous.map((line) => (line.buttons?.includes(current.button) ? { ...line, pressed: current.button } : line)),
      );
    }

    const handle = setTimeout(() => {
      const next = beat + 1;
      if (next >= SCRIPT.length) {
        setLines([]);
        setBeat(0);
      } else {
        setBeat(next);
      }
    }, current.hold);
    return () => clearTimeout(handle);
  }, [beat, reduced]);

  const active = reduced ? null : SCRIPT[beat];
  const visible = reduced ? RESTING : lines;
  const status = active ? STATUS[active.kind] : "flow complete";
  const matchLabel = active?.kind === "match" ? active.label : null;

  return (
    <div className="panel relative overflow-hidden">
      <div className="flex items-center gap-2.5 border-b border-white/[0.06] px-4 py-3">
        <div className="grid h-8 w-8 place-items-center rounded-lg bg-secondary/70 ring-1 ring-white/[0.06]">
          <Bot className="h-4 w-4 text-muted-foreground" />
        </div>
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-[13px] font-medium">@rewards_bot</p>
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">bot chat</p>
        </div>
        <span className="flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 font-mono text-[9px] uppercase tracking-widest text-primary ring-1 ring-primary/25">
          <span className={cn("h-1.5 w-1.5 rounded-full bg-primary", !reduced && "animate-signal")} />
          flow live
        </span>
      </div>

      <div className="flex h-[19rem] flex-col justify-end gap-2.5 p-4 sm:h-[21rem]">
        {visible.map((line) => (
          <div key={line.id} className={cn("animate-bubble-in flex", line.side === "out" ? "justify-end" : "justify-start")}>
            <div
              className={cn(
                "max-w-[85%] rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed",
                line.side === "out"
                  ? "rounded-br-md bg-primary/15 text-foreground ring-1 ring-primary/25"
                  : "rounded-bl-md bg-secondary/60 text-foreground/90 ring-1 ring-white/[0.05]",
              )}
            >
              <p>{line.text}</p>
              {line.buttons ? (
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {line.buttons.map((button) => {
                    const hit = line.pressed === button;
                    return (
                      <span
                        key={button}
                        className={cn(
                          "inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 font-mono text-[10px] transition-colors",
                          hit
                            ? "border-primary/70 bg-primary/25 text-primary"
                            : "border-white/[0.07] bg-background/40 text-muted-foreground",
                          hit && !reduced && "animate-press-flash",
                        )}
                      >
                        {hit ? <MousePointerClick className="h-2.5 w-2.5" /> : null}
                        {button}
                      </span>
                    );
                  })}
                </div>
              ) : null}
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2 border-t border-white/[0.06] bg-background/40 px-4 py-2.5">
        <Zap className={cn("h-3 w-3 shrink-0", matchLabel ? "text-primary" : "text-muted-foreground/60")} />
        <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{status}</span>
        {matchLabel ? (
          <span className="flex min-w-0 items-center gap-1 font-mono text-[10px] text-primary">
            <CornerDownRight className="h-2.5 w-2.5 shrink-0" />
            <span className="truncate">{matchLabel}</span>
          </span>
        ) : (
          <span className={cn("h-3 w-1 bg-primary/70", !reduced && "animate-caret")} />
        )}
      </div>
    </div>
  );
}
