import { useState } from "react";
import { ArrowDown, GitBranch, Plus, RotateCw, Trash2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useEngine } from "@/lib/engine-store";
import type { TriggerMode, Workflow, WorkflowStep } from "@/lib/api";

const MODES: { id: TriggerMode; label: string }[] = [
  { id: "exact", label: "is exactly" },
  { id: "contains", label: "contains" },
  { id: "starts", label: "starts with" },
  { id: "regex", label: "matches pattern" },
];

function blankStep(): WorkflowStep {
  return {
    id: crypto.randomUUID(),
    trigger: "",
    mode: "contains",
    caseSensitive: false,
    reply: "",
    delayMs: 1200,
    timeoutMs: 300_000,
    loopTo: null,
  };
}

function blankWorkflow(): Workflow {
  return {
    id: "",
    name: "",
    target: "",
    enabled: true,
    steps: [blankStep()],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

export default function Workflows() {
  const { snapshot, saveWorkflow, deleteWorkflow } = useEngine();
  const [draft, setDraft] = useState<Workflow | null>(null);

  const workflows = snapshot?.workflows ?? [];

  const patchStep = (index: number, patch: Partial<WorkflowStep>): void => {
    setDraft((current) => {
      if (!current) return current;
      const steps = current.steps.map((step, i) => (i === index ? { ...step, ...patch } : step));
      return { ...current, steps };
    });
  };

  return (
    <div className="mx-auto w-full max-w-4xl space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Workflows</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Each workflow walks one conversation through ordered steps.
          </p>
        </div>
        <Button className="h-9 gap-1.5 rounded-full" onClick={() => setDraft(blankWorkflow())}>
          <Plus className="h-4 w-4" /> New workflow
        </Button>
      </header>

      {workflows.length === 0 ? (
        <div className="panel px-4 py-14 text-center">
          <GitBranch className="mx-auto h-6 w-6 text-muted-foreground" />
          <p className="mt-3 text-sm font-medium">No workflows yet</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Create one and the engine starts matching incoming messages immediately.
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {workflows.map((workflow, index) => (
            <div
              key={workflow.id}
              className="panel animate-row-in p-4"
              style={{ animationDelay: `${Math.min(index, 8) * 30}ms` }}
            >
              <div className="flex items-center gap-3">
                <button
                  className="min-w-0 flex-1 text-left"
                  onClick={() => setDraft(JSON.parse(JSON.stringify(workflow)) as Workflow)}
                >
                  <p className="truncate text-sm font-semibold">{workflow.name}</p>
                  <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                    {workflow.steps.length} step{workflow.steps.length === 1 ? "" : "s"}
                    {workflow.target ? ` · target ${workflow.target}` : " · any sender"}
                  </p>
                </button>
                <Switch
                  checked={workflow.enabled}
                  onCheckedChange={(checked) => saveWorkflow({ ...workflow, enabled: checked })}
                />
                <button
                  className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => deleteWorkflow(workflow.id)}
                  aria-label="Delete workflow"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={draft !== null} onOpenChange={(open) => !open && setDraft(null)}>
        <DialogContent className="max-h-[88vh] max-w-lg overflow-y-auto border-white/[0.08] bg-card">
          <DialogHeader>
            <DialogTitle className="text-base">
              {draft?.id ? "Edit workflow" : "New workflow"}
            </DialogTitle>
          </DialogHeader>

          {draft ? (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Name</label>
                  <Input
                    value={draft.name}
                    placeholder="Daily check-in"
                    onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                    className="h-10 rounded-xl bg-input/60"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                    Only from (optional)
                  </label>
                  <Input
                    value={draft.target}
                    placeholder="@somebot"
                    onChange={(event) => setDraft({ ...draft, target: event.target.value })}
                    className="h-10 rounded-xl bg-input/60 font-mono text-sm"
                  />
                </div>
              </div>

              <div className="space-y-3">
                {draft.steps.map((step, index) => (
                  <div key={step.id} className="relative rounded-2xl bg-secondary/40 p-3.5 ring-1 ring-white/[0.05]">
                    <div className="mb-2.5 flex items-center gap-2">
                      <span className="grid h-5 w-5 place-items-center rounded-md bg-primary/15 font-mono text-[10px] text-primary">
                        {index + 1}
                      </span>
                      <span className="text-xs font-medium text-muted-foreground">Step</span>
                      {draft.steps.length > 1 ? (
                        <button
                          className="ml-auto rounded-md p-1 text-muted-foreground hover:text-destructive"
                          onClick={() =>
                            setDraft({ ...draft, steps: draft.steps.filter((_, i) => i !== index) })
                          }
                          aria-label="Remove step"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      ) : null}
                    </div>

                    <div className="flex flex-wrap gap-1.5">
                      {MODES.map((mode) => (
                        <button
                          key={mode.id}
                          onClick={() => patchStep(index, { mode: mode.id })}
                          className={cn(
                            "rounded-full px-2.5 py-1 text-[11px] transition-colors",
                            step.mode === mode.id
                              ? "bg-primary/15 text-primary ring-1 ring-primary/30"
                              : "bg-background/60 text-muted-foreground hover:text-foreground",
                          )}
                        >
                          {mode.label}
                        </button>
                      ))}
                    </div>

                    <Input
                      value={step.trigger}
                      placeholder="Incoming message trigger"
                      onChange={(event) => patchStep(index, { trigger: event.target.value })}
                      className="mt-2 h-10 rounded-xl bg-background/60 font-mono text-sm"
                    />

                    <div className="my-2 flex items-center gap-2 pl-1 text-muted-foreground">
                      <ArrowDown className="h-3.5 w-3.5" />
                      <span className="text-[11px]">reply with</span>
                    </div>

                    <Textarea
                      value={step.reply}
                      placeholder="Your reply"
                      rows={2}
                      onChange={(event) => patchStep(index, { reply: event.target.value })}
                      className="rounded-xl bg-background/60 text-sm"
                    />

                    <div className="mt-2.5 flex flex-wrap items-center gap-3">
                      <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        delay
                        <Input
                          type="number"
                          value={Math.round(step.delayMs / 100) / 10}
                          step={0.5}
                          min={0}
                          onChange={(event) =>
                            patchStep(index, { delayMs: Math.max(0, Number(event.target.value) * 1000) })
                          }
                          className="h-7 w-16 rounded-lg bg-background/60 px-2 font-mono text-[11px]"
                        />
                        s
                      </label>
                      <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        <Switch
                          checked={step.caseSensitive}
                          onCheckedChange={(checked) => patchStep(index, { caseSensitive: checked })}
                        />
                        case sensitive
                      </label>
                      <label className="ml-auto flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        <RotateCw className="h-3 w-3" />
                        loop to
                        <Input
                          type="number"
                          value={step.loopTo === null ? "" : step.loopTo + 1}
                          placeholder="—"
                          min={1}
                          max={draft.steps.length}
                          onChange={(event) => {
                            const raw = event.target.value.trim();
                            patchStep(index, { loopTo: raw === "" ? null : Math.max(0, Number(raw) - 1) });
                          }}
                          className="h-7 w-14 rounded-lg bg-background/60 px-2 font-mono text-[11px]"
                        />
                      </label>
                    </div>
                  </div>
                ))}
              </div>

              <Button
                variant="secondary"
                className="h-9 w-full gap-1.5 rounded-xl text-xs"
                onClick={() => setDraft({ ...draft, steps: [...draft.steps, blankStep()] })}
              >
                <Plus className="h-3.5 w-3.5" /> Add step
              </Button>

              <Button
                className="h-11 w-full rounded-xl font-semibold"
                disabled={draft.name.trim().length === 0}
                onClick={() => {
                  saveWorkflow(draft).then(() => setDraft(null));
                }}
              >
                Save workflow
              </Button>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
