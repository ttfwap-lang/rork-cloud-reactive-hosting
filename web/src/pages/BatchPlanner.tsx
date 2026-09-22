import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock, Layers, Loader2, Play, RefreshCw, Send, Sparkles, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { api, type BatchPlan, type BatchRunInfo } from "@/lib/api";

const PRESET_EXAMPLES = [
  { label: "3 bots × 12 signs", prompt: "Send /start and all horoscope signs (Aries through Pisces) to @astro1, @astro2, and @astro3" },
  { label: "Check status on 2 bots", prompt: "Send /status to @bot1 and @bot2" },
  { label: "Daily probe on Joe Fortune", prompt: "Send /start and /daily to @joefortune" },
];

export default function BatchPlanner() {
  const [prompt, setPrompt] = useState<string>("");
  const [plan, setPlan] = useState<BatchPlan | null>(null);
  const [planning, setPlanning] = useState<boolean>(false);
  const [approving, setApproving] = useState<boolean>(false);
  const [runs, setRuns] = useState<BatchRunInfo[]>([]);
  const [loadingRuns, setLoadingRuns] = useState<boolean>(false);

  const refreshRuns = async () => {
    try {
      setLoadingRuns(true);
      const res = await api.getBatchRuns();
      setRuns(res.runs ?? []);
    } catch {
      // silent refresh fail
    } finally {
      setLoadingRuns(false);
    }
  };

  useEffect(() => {
    void refreshRuns();
    const interval = setInterval(refreshRuns, 8000);
    return () => clearInterval(interval);
  }, []);

  const handleGeneratePlan = async () => {
    if (!prompt.trim()) {
      toast.error("Please enter a natural language request.");
      return;
    }
    setPlanning(true);
    try {
      const res = await api.planBatch(prompt.trim());
      if (res.ok && res.plan) {
        setPlan(res.plan);
        toast.success(`Generated plan: ${res.plan.summary}`);
      } else {
        throw new Error("Could not generate batch plan.");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Planning failed.");
    } finally {
      setPlanning(false);
    }
  };

  const handleApproveAndStart = async () => {
    if (!plan || plan.items.length === 0) return;
    setApproving(true);
    try {
      const res = await api.startBatchRun({
        name: plan.name,
        items: plan.items,
      });
      if (res.ok) {
        toast.success(`Batch run "${plan.name}" approved and started (${res.totalItems} items)!`);
        setPlan(null);
        setPrompt("");
        void refreshRuns();
      } else {
        throw new Error("Failed to start batch run.");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not start batch run.");
    } finally {
      setApproving(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Batch Orchestrator & NL Planner</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Convert plain English requests into rate-limit-safe batch runs. Mandatory preview and approval before unattended execution.
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-full bg-primary/[0.07] px-3 py-1.5 text-[11px] text-primary ring-1 ring-primary/20">
          <Layers className="h-3.5 w-3.5" />Self-Pacing Orchestrator
        </div>
      </header>

      {/* Natural Language Input Panel */}
      <section className="panel p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold">1 · Plain English Instruction</h2>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Describe what you want to execute across multiple bots or chats. The planner expands all steps into a verifiable Cartesian plan.
            </p>
          </div>
          <Sparkles className="h-5 w-5 text-primary" />
        </div>

        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="e.g. Send /start and 12 horoscope signs (Aries through Pisces) to @astro1, @astro2, and @astro3"
          rows={3}
          className="rounded-xl bg-background/60 text-sm font-sans"
        />

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] text-muted-foreground">Presets:</span>
          {PRESET_EXAMPLES.map((ex) => (
            <button
              key={ex.label}
              onClick={() => setPrompt(ex.prompt)}
              className="rounded-lg bg-secondary/50 px-2.5 py-1 text-[11px] text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
            >
              {ex.label}
            </button>
          ))}
        </div>

        <div className="flex justify-end pt-1">
          <Button
            onClick={() => void handleGeneratePlan()}
            disabled={planning || !prompt.trim()}
            className="gap-2 rounded-xl"
          >
            {planning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Generate Execution Plan
          </Button>
        </div>
      </section>

      {/* Mandatory Preview and Approve Section */}
      {plan ? (
        <section className="panel p-5 border border-primary/30 bg-primary/[0.02] space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="rounded-md bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-400 ring-1 ring-amber-500/20">
                  Mandatory Preview & Approve
                </span>
                <h2 className="text-sm font-semibold">{plan.name}</h2>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Review the expanded item list. Once approved, the orchestrator executes unattended under rate-limit caps.
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setPlan(null)}
              className="rounded-full h-8 w-8 p-0"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="rounded-xl bg-background/60 p-3 border border-white/[0.06]">
              <p className="text-[10px] text-muted-foreground uppercase">Summary</p>
              <p className="mt-1 text-xs font-semibold text-foreground">{plan.summary}</p>
            </div>
            <div className="rounded-xl bg-background/60 p-3 border border-white/[0.06]">
              <p className="text-[10px] text-muted-foreground uppercase">Total Items</p>
              <p className="mt-1 text-sm font-semibold font-mono text-primary">{plan.totalItems}</p>
            </div>
            <div className="rounded-xl bg-background/60 p-3 border border-white/[0.06]">
              <p className="text-[10px] text-muted-foreground uppercase">Estimated Runtime</p>
              <p className="mt-1 text-xs font-semibold text-foreground flex items-center gap-1">
                <Clock className="h-3 w-3 text-muted-foreground" />
                ~{Math.ceil(plan.estimatedSeconds / 60)} min ({plan.estimatedSeconds}s)
              </p>
            </div>
            <div className="rounded-xl bg-background/60 p-3 border border-white/[0.06]">
              <p className="text-[10px] text-muted-foreground uppercase">Pacing Policy</p>
              <p className="mt-1 text-xs font-semibold text-emerald-400">Under perMinuteCap</p>
            </div>
          </div>

          <div className="rounded-xl border border-white/[0.08] overflow-hidden">
            <div className="bg-secondary/40 px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground flex justify-between">
              <span>Expanded Items ({plan.items.length})</span>
              <span>Rate-limit safe sequence</span>
            </div>
            <div className="max-h-72 overflow-y-auto divide-y divide-white/[0.04]">
              {plan.items.map((item, idx) => (
                <div key={idx} className="px-3 py-2 text-xs flex items-center justify-between hover:bg-white/[0.02]">
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-[10px] text-muted-foreground w-6 text-right">#{idx + 1}</span>
                    <span className="font-mono text-primary font-medium">{item.target}</span>
                    <span className="text-muted-foreground">·</span>
                    <span className="text-foreground">{item.description}</span>
                  </div>
                  <span className="rounded bg-secondary/60 px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground">
                    {item.actionType}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
            <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
              Deliberate gate: Conversational agent acts directly; batch planner requires this single approval.
            </p>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => setPlan(null)} className="rounded-xl">
                Discard
              </Button>
              <Button
                data-element-id="approve-batch-run"
                onClick={() => void handleApproveAndStart()}
                disabled={approving}
                className="gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold"
              >
                {approving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4 fill-current" />}
                Approve & Start Unattended Execution
              </Button>
            </div>
          </div>
        </section>
      ) : null}

      {/* Batch Runs History and Monitor */}
      <section className="panel p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold">Batch Runs & Execution Monitor</h2>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Live status of unattended batch orchestrator runs.
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={() => void refreshRuns()} className="rounded-full h-8 w-8 p-0">
            <RefreshCw className={cn("h-4 w-4", loadingRuns && "animate-spin")} />
          </Button>
        </div>

        {runs.length === 0 ? (
          <div className="rounded-xl bg-secondary/20 p-6 text-center text-xs text-muted-foreground">
            No batch runs executed yet. Generate a plan above to start a batch run.
          </div>
        ) : (
          <div className="divide-y divide-white/[0.06] rounded-xl border border-white/[0.08] overflow-hidden">
            {runs.map((r) => {
              const pct = r.total_items > 0 ? Math.round((r.completed_items / r.total_items) * 100) : 0;
              return (
                <div key={r.id} className="p-4 space-y-2 hover:bg-white/[0.01]">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs font-semibold text-foreground">{r.name}</p>
                      <p className="text-[10px] text-muted-foreground font-mono">
                        ID: {r.id.slice(0, 8)} · Started: {r.started_at ? new Date(r.started_at).toLocaleTimeString() : "—"}
                      </p>
                    </div>
                    <span
                      className={cn(
                        "rounded-full px-2.5 py-0.5 text-[10px] font-semibold capitalize",
                        r.status === "completed" ? "bg-emerald-500/10 text-emerald-400" :
                        r.status === "running" ? "bg-primary/15 text-primary animate-pulse" :
                        r.status === "failed" ? "bg-destructive/15 text-destructive" :
                        "bg-secondary text-muted-foreground"
                      )}
                    >
                      {r.status}
                    </span>
                  </div>

                  <div className="space-y-1">
                    <div className="flex justify-between text-[10px] text-muted-foreground font-mono">
                      <span>Progress: {r.completed_items} / {r.total_items} items ({pct}%)</span>
                      {r.failed_items > 0 ? <span className="text-destructive">{r.failed_items} failed</span> : null}
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-secondary/50 overflow-hidden">
                      <div
                        className={cn("h-full transition-all duration-300", r.status === "completed" ? "bg-emerald-500" : "bg-primary")}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
