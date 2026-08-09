import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowDown, Bot, Braces, GitBranch, ImagePlus, Plus, RotateCw, Sparkles, Timer, Trash2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useEngine } from "@/lib/engine-store";
import type {
  ConditionField, ConditionOperator, TriggerMode, Workflow, WorkflowActionType,
  WorkflowCondition, WorkflowStatus, WorkflowStep,
} from "@/lib/api";

const MODES: Array<{ id: TriggerMode; label: string }> = [
  { id: "exact", label: "exactly" }, { id: "contains", label: "contains" },
  { id: "starts", label: "starts" }, { id: "ends", label: "ends" }, { id: "regex", label: "pattern" },
];
const ACTIONS: Array<{ id: WorkflowActionType; label: string }> = [
  { id: "sendText", label: "Send text" }, { id: "pressButton", label: "Press button" },
  { id: "react", label: "React" }, { id: "markRead", label: "Mark read" }, { id: "end", label: "End" },
];
const FIELDS: Array<{ id: ConditionField; label: string }> = [
  { id: "text", label: "Message text" }, { id: "sender", label: "Sender" }, { id: "chat", label: "Chat" },
  { id: "direction", label: "Direction" }, { id: "chatType", label: "Chat type" }, { id: "isEdited", label: "Edited" },
  { id: "isReply", label: "Reply" }, { id: "isForwarded", label: "Forwarded" }, { id: "isBot", label: "Sender is bot" },
  { id: "mediaType", label: "Media type" },
];
const OPERATORS: Array<{ id: ConditionOperator; label: string }> = [
  { id: "exact", label: "equals" }, { id: "contains", label: "contains" }, { id: "starts", label: "starts with" },
  { id: "ends", label: "ends with" }, { id: "regex", label: "pattern" }, { id: "is", label: "is" }, { id: "isNot", label: "is not" },
];
const STATUSES: WorkflowStatus[] = ["draft", "test", "enabled", "paused"];
const VARIABLES = ["{1}", "{sender}", "{chat}", "{text}", "{time}"];

function blankCondition(): WorkflowCondition {
  return { id: crypto.randomUUID(), field: "sender", operator: "exact", value: "", caseSensitive: false, negate: false };
}

export function blankStep(): WorkflowStep {
  return {
    id: crypto.randomUUID(), trigger: "", mode: "contains", caseSensitive: false,
    conditionLogic: "and", conditions: [], actionType: "sendText", reply: "", buttonTarget: "", reaction: "",
    delayMs: 1200, timeoutMs: 300_000, loopTo: null, maxLoops: 3,
  };
}

export function blankWorkflow(): Workflow {
  return {
    version: 2, id: "", name: "", target: "", targets: [], enabled: false, status: "draft",
    steps: [blankStep()], cooldownMs: 0, maxRunsPerChat: 0, createdAt: Date.now(), updatedAt: Date.now(),
  };
}

function statusTone(status: WorkflowStatus): string {
  if (status === "enabled") return "bg-primary/12 text-primary ring-primary/25";
  if (status === "test") return "bg-accent/10 text-accent ring-accent/20";
  if (status === "attention") return "bg-destructive/10 text-destructive ring-destructive/20";
  return "bg-secondary text-muted-foreground ring-white/10";
}

export default function Workflows() {
  const { snapshot, saveWorkflow, deleteWorkflow } = useEngine();
  const [draft, setDraft] = useState<Workflow | null>(null);
  const [saving, setSaving] = useState<boolean>(false);
  const workflows = snapshot?.workflows ?? [];

  const problem = useMemo<string | null>(() => {
    if (!draft) return null;
    if (!draft.name.trim()) return "Give the workflow a name.";
    for (const [index, step] of draft.steps.entries()) {
      if (!step.trigger.trim()) return `Step ${index + 1} needs a trigger.`;
      if (step.actionType === "sendText" && !step.reply.trim()) return `Step ${index + 1} needs reply text.`;
      if (step.actionType === "pressButton" && !step.buttonTarget.trim()) return `Step ${index + 1} needs a button label or row,column.`;
      if (step.actionType === "react" && !step.reaction.trim()) return `Step ${index + 1} needs an emoji.`;
      const patterns = [step.mode === "regex" ? step.trigger : "", ...step.conditions.filter((condition) => condition.operator === "regex").map((condition) => condition.value)].filter(Boolean);
      for (const pattern of patterns) {
        try { new RegExp(pattern); } catch { return `Step ${index + 1} has an invalid pattern.`; }
      }
      if (step.conditions.some((condition) => !condition.value.trim())) return `Step ${index + 1} has an empty condition.`;
    }
    return null;
  }, [draft]);

  const patchStep = (index: number, patch: Partial<WorkflowStep>): void => {
    setDraft((current) => current ? { ...current, steps: current.steps.map((step, stepIndex) => stepIndex === index ? { ...step, ...patch } : step) } : current);
  };

  const patchCondition = (stepIndex: number, conditionIndex: number, patch: Partial<WorkflowCondition>): void => {
    setDraft((current) => {
      if (!current) return current;
      const steps = current.steps.map((step, index) => index === stepIndex ? { ...step, conditions: step.conditions.map((condition, innerIndex) => innerIndex === conditionIndex ? { ...condition, ...patch } : condition) } : step);
      return { ...current, steps };
    });
  };

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-xl font-semibold tracking-tight">Workflow studio</h1><p className="mt-1 text-sm text-muted-foreground">Build capture-aware, filtered conversation flows with guarded personal-account actions.</p></div>
        <div className="flex gap-2">
          <Button asChild variant="secondary" className="h-9 gap-1.5 rounded-full"><Link to="/import"><ImagePlus className="h-4 w-4" />Create from conversation</Link></Button>
          <Button className="h-9 gap-1.5 rounded-full" onClick={() => setDraft(blankWorkflow())}><Plus className="h-4 w-4" />New workflow</Button>
        </div>
      </header>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="panel p-4"><Braces className="h-4 w-4 text-primary" /><p className="mt-2 text-xs font-semibold">Captures + variables</p><p className="mt-1 text-[11px] text-muted-foreground">Reuse pattern groups with {'{1}'}, plus sender, chat, text and time.</p></div>
        <div className="panel p-4"><GitBranch className="h-4 w-4 text-accent" /><p className="mt-2 text-xs font-semibold">AND / OR / NOT</p><p className="mt-1 text-[11px] text-muted-foreground">Filter direction, peer type, replies, edits, forwards, bots and media.</p></div>
        <div className="panel p-4"><Bot className="h-4 w-4 text-amber-300" /><p className="mt-2 text-xs font-semibold">Personal actions</p><p className="mt-1 text-[11px] text-muted-foreground">Press buttons, react and mark read through the isolated connector.</p></div>
      </div>

      {workflows.length === 0 ? (
        <div className="panel px-4 py-14 text-center"><GitBranch className="mx-auto h-6 w-6 text-muted-foreground" /><p className="mt-3 text-sm font-medium">No workflows yet</p><p className="mt-1 text-xs text-muted-foreground">Start manually or turn screenshots into a disabled, reviewable draft.</p></div>
      ) : (
        <div className="space-y-2.5">
          {workflows.map((workflow, index) => (
            <div key={workflow.id} className="panel animate-row-in p-4" style={{ animationDelay: `${Math.min(index, 8) * 30}ms` }}>
              <div className="flex items-center gap-3">
                <button className="min-w-0 flex-1 text-left" onClick={() => setDraft(structuredClone(workflow))}>
                  <div className="flex items-center gap-2"><p className="truncate text-sm font-semibold">{workflow.name}</p><span className={cn("rounded-full px-2 py-0.5 font-mono text-[9px] uppercase ring-1", statusTone(workflow.status))}>{workflow.status}</span></div>
                  <p className="mt-1 font-mono text-[10px] text-muted-foreground">{workflow.steps.length} step{workflow.steps.length === 1 ? "" : "s"} · {workflow.targets.length ? workflow.targets.join(", ") : "any allowed sender"} · v{workflow.version}</p>
                </button>
                <Switch checked={workflow.status === "enabled"} onCheckedChange={(checked) => { void saveWorkflow({ ...workflow, status: checked ? "enabled" : "paused", enabled: checked }); }} />
                <button className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive" onClick={() => deleteWorkflow(workflow.id)} aria-label="Delete workflow"><Trash2 className="h-4 w-4" /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={draft !== null} onOpenChange={(open) => !open && setDraft(null)}>
        <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto border-white/[0.08] bg-card">
          <DialogHeader><DialogTitle className="text-base">{draft?.id ? "Edit workflow" : "New workflow"}</DialogTitle></DialogHeader>
          {draft ? (
            <div className="space-y-5">
              <div className="grid gap-3 sm:grid-cols-2">
                <div><label className="mb-1.5 block text-xs font-medium text-muted-foreground">Workflow name</label><Input value={draft.name} placeholder="Onboarding concierge" onChange={(event) => setDraft({ ...draft, name: event.target.value })} className="h-10 rounded-xl bg-input/60" /></div>
                <div><label className="mb-1.5 block text-xs font-medium text-muted-foreground">Allowed senders or chats</label><Input value={draft.targets.join(", ")} placeholder="@somebot, @customer, -100…" onChange={(event) => setDraft({ ...draft, targets: event.target.value.split(",").map((value) => value.trim()).filter(Boolean), target: event.target.value.split(",")[0]?.trim() ?? "" })} className="h-10 rounded-xl bg-input/60 font-mono text-xs" /></div>
              </div>

              <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-secondary/35 p-3">
                <span className="mr-1 text-[11px] font-medium text-muted-foreground">State</span>
                {STATUSES.map((status) => <button key={status} onClick={() => setDraft({ ...draft, status, enabled: status === "enabled" || status === "test" })} className={cn("rounded-full px-2.5 py-1 text-[10px] uppercase ring-1 transition-colors", draft.status === status ? statusTone(status) : "text-muted-foreground ring-white/10 hover:text-foreground")}>{status}</button>)}
                <label className="ml-auto flex items-center gap-1.5 text-[11px] text-muted-foreground">cooldown<Input type="number" min={0} value={Math.round(draft.cooldownMs / 60_000)} onChange={(event) => setDraft({ ...draft, cooldownMs: Math.max(0, Number(event.target.value)) * 60_000 })} className="h-7 w-16 rounded-lg bg-background/60 px-2 font-mono text-[11px]" />min</label>
                <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">max runs<Input type="number" min={0} value={draft.maxRunsPerChat} onChange={(event) => setDraft({ ...draft, maxRunsPerChat: Math.max(0, Number(event.target.value)) })} className="h-7 w-14 rounded-lg bg-background/60 px-2 font-mono text-[11px]" /></label>
              </div>

              <div className="space-y-4">
                {draft.steps.map((step, stepIndex) => (
                  <div key={step.id} className="relative rounded-2xl bg-secondary/35 p-4 ring-1 ring-white/[0.06]">
                    <div className="mb-3 flex items-center gap-2"><span className="grid h-6 w-6 place-items-center rounded-lg bg-primary/15 font-mono text-[10px] text-primary">{stepIndex + 1}</span><span className="text-xs font-semibold">Incoming condition group</span>{draft.steps.length > 1 ? <button className="ml-auto rounded-md p-1 text-muted-foreground hover:text-destructive" onClick={() => setDraft({ ...draft, steps: draft.steps.filter((_, index) => index !== stepIndex) })}><X className="h-3.5 w-3.5" /></button> : null}</div>

                    <div className="grid gap-2 sm:grid-cols-[auto_1fr]">
                      <div className="flex flex-wrap gap-1.5">{MODES.map((mode) => <button key={mode.id} onClick={() => patchStep(stepIndex, { mode: mode.id })} className={cn("rounded-full px-2.5 py-1 text-[10px]", step.mode === mode.id ? "bg-primary/15 text-primary ring-1 ring-primary/30" : "bg-background/60 text-muted-foreground")}>{mode.label}</button>)}</div>
                      <Input value={step.trigger} placeholder={step.mode === "regex" ? "Order #(\\d+)" : "Incoming message"} onChange={(event) => patchStep(stepIndex, { trigger: event.target.value })} className="h-9 rounded-xl bg-background/60 font-mono text-xs" />
                    </div>

                    {step.conditions.length > 0 ? <div className="my-3 flex items-center gap-2"><span className="h-px flex-1 bg-white/[0.06]" /><button onClick={() => patchStep(stepIndex, { conditionLogic: step.conditionLogic === "and" ? "or" : "and" })} className="rounded-full bg-accent/10 px-2.5 py-1 font-mono text-[10px] uppercase text-accent ring-1 ring-accent/20">{step.conditionLogic}</button><span className="h-px flex-1 bg-white/[0.06]" /></div> : null}

                    <div className="space-y-2">
                      {step.conditions.map((condition, conditionIndex) => (
                        <div key={condition.id} className="grid gap-2 rounded-xl bg-background/35 p-2 sm:grid-cols-[auto_1fr_1fr_1.4fr_auto] sm:items-center">
                          <button onClick={() => patchCondition(stepIndex, conditionIndex, { negate: !condition.negate })} className={cn("rounded-lg px-2 py-2 font-mono text-[10px] ring-1", condition.negate ? "bg-destructive/10 text-destructive ring-destructive/20" : "text-muted-foreground ring-white/10")}>NOT</button>
                          <select value={condition.field} onChange={(event) => patchCondition(stepIndex, conditionIndex, { field: event.target.value as ConditionField })} className="h-9 rounded-lg border border-white/[0.06] bg-input px-2 text-xs outline-none">{FIELDS.map((field) => <option key={field.id} value={field.id}>{field.label}</option>)}</select>
                          <select value={condition.operator} onChange={(event) => patchCondition(stepIndex, conditionIndex, { operator: event.target.value as ConditionOperator })} className="h-9 rounded-lg border border-white/[0.06] bg-input px-2 text-xs outline-none">{OPERATORS.map((operator) => <option key={operator.id} value={operator.id}>{operator.label}</option>)}</select>
                          <Input value={condition.value} placeholder={condition.field.startsWith("is") ? "true" : "value"} onChange={(event) => patchCondition(stepIndex, conditionIndex, { value: event.target.value })} className="h-9 rounded-lg bg-input text-xs" />
                          <button onClick={() => patchStep(stepIndex, { conditions: step.conditions.filter((_, index) => index !== conditionIndex) })} className="p-2 text-muted-foreground hover:text-destructive"><X className="h-3.5 w-3.5" /></button>
                        </div>
                      ))}
                    </div>
                    <Button variant="ghost" size="sm" className="mt-2 h-8 gap-1.5 rounded-lg text-[11px] text-muted-foreground" onClick={() => patchStep(stepIndex, { conditions: [...step.conditions, blankCondition()] })}><Plus className="h-3 w-3" />Add sender, chat or message filter</Button>

                    <div className="my-3 flex items-center gap-2 text-muted-foreground"><ArrowDown className="h-3.5 w-3.5" /><span className="text-[11px]">then</span></div>
                    <div className="flex flex-wrap gap-1.5">{ACTIONS.map((action) => <button key={action.id} onClick={() => patchStep(stepIndex, { actionType: action.id })} className={cn("rounded-full px-2.5 py-1 text-[10px]", step.actionType === action.id ? "bg-accent/10 text-accent ring-1 ring-accent/25" : "bg-background/60 text-muted-foreground")}>{action.label}</button>)}</div>
                    {step.actionType === "sendText" ? <><Textarea value={step.reply} placeholder="Reply — use {1}, {sender}, {chat}, {text} or {time}" rows={2} onChange={(event) => patchStep(stepIndex, { reply: event.target.value })} className="mt-2 rounded-xl bg-background/60 text-sm" /><div className="mt-1.5 flex flex-wrap gap-1">{VARIABLES.map((variable) => <button key={variable} onClick={() => patchStep(stepIndex, { reply: `${step.reply}${step.reply ? " " : ""}${variable}` })} className="rounded-md bg-background/50 px-1.5 py-1 font-mono text-[9px] text-muted-foreground hover:text-primary">{variable}</button>)}</div></> : null}
                    {step.actionType === "pressButton" ? <Input value={step.buttonTarget} placeholder="Button label or coordinates, e.g. 2,1" onChange={(event) => patchStep(stepIndex, { buttonTarget: event.target.value })} className="mt-2 h-10 rounded-xl bg-background/60 text-sm" /> : null}
                    {step.actionType === "react" ? <Input value={step.reaction} placeholder="👍" maxLength={16} onChange={(event) => patchStep(stepIndex, { reaction: event.target.value })} className="mt-2 h-10 rounded-xl bg-background/60 text-sm" /> : null}

                    <div className="mt-3 flex flex-wrap items-center gap-3">
                      <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">delay<Input type="number" value={Math.round(step.delayMs / 100) / 10} step={0.5} min={0} onChange={(event) => patchStep(stepIndex, { delayMs: Math.max(0, Number(event.target.value)) * 1000 })} className="h-7 w-16 rounded-lg bg-background/60 px-2 font-mono text-[11px]" />s</label>
                      <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><Switch checked={step.caseSensitive} onCheckedChange={(checked) => patchStep(stepIndex, { caseSensitive: checked })} />case-sensitive</label>
                      <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><Timer className="h-3 w-3" />wait<Input type="number" value={Math.round(step.timeoutMs / 60_000)} min={1} onChange={(event) => patchStep(stepIndex, { timeoutMs: Math.max(1, Number(event.target.value)) * 60_000 })} className="h-7 w-14 rounded-lg bg-background/60 px-2 font-mono text-[11px]" />min</label>
                      <label className="ml-auto flex items-center gap-1.5 text-[11px] text-muted-foreground"><RotateCw className="h-3 w-3" />loop<Input type="number" value={step.loopTo === null ? "" : step.loopTo + 1} placeholder="—" min={1} max={draft.steps.length} onChange={(event) => patchStep(stepIndex, { loopTo: event.target.value === "" ? null : Math.max(0, Number(event.target.value) - 1) })} className="h-7 w-14 rounded-lg bg-background/60 px-2 font-mono text-[11px]" /><Input type="number" value={step.maxLoops} min={1} max={20} onChange={(event) => patchStep(stepIndex, { maxLoops: Math.max(1, Number(event.target.value)) })} className="h-7 w-12 rounded-lg bg-background/60 px-2 font-mono text-[11px]" />×</label>
                    </div>
                  </div>
                ))}
              </div>

              <Button variant="secondary" className="h-9 w-full gap-1.5 rounded-xl text-xs" onClick={() => setDraft({ ...draft, steps: [...draft.steps, blankStep()] })}><Plus className="h-3.5 w-3.5" />Add next conversation step</Button>
              <div className="rounded-xl border border-primary/15 bg-primary/[0.04] p-3 text-[11px] leading-relaxed text-muted-foreground"><Sparkles className="mr-1.5 inline h-3.5 w-3.5 text-primary" />Pattern captures are stored only as workflow runtime variables. Operational logs never contain message text or captured values.</div>
              {problem ? <p className="text-center text-[11px] text-amber-400">{problem}</p> : null}
              <Button className="h-11 w-full rounded-xl font-semibold" disabled={problem !== null || saving} onClick={() => { setSaving(true); saveWorkflow(draft).then(() => setDraft(null)).finally(() => setSaving(false)); }}>{saving ? "Saving…" : `Save ${draft.status} workflow`}</Button>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
