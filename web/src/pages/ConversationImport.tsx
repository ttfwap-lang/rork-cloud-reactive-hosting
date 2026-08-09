import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowDown, ArrowUp, Check, CheckCircle2, EyeOff, ImagePlus, Loader2, LockKeyhole, ScanLine, Sparkles, Trash2, UploadCloud, WandSparkles, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { api, type ConversationAnalysis, type TriggerMode, type WorkflowStep } from "@/lib/api";
import { applyRedactions, preprocessConversationImages, type ProcessedImage, type RedactionRegion } from "@/lib/conversation-images";
import { useEngine } from "@/lib/engine-store";
import { blankStep, blankWorkflow } from "@/pages/Workflows";

type DragState = { imageId: string; startX: number; startY: number; currentX: number; currentY: number };

function confidenceTone(confidence: "high" | "medium" | "low"): string {
  return confidence === "high" ? "text-primary bg-primary/10" : confidence === "medium" ? "text-amber-300 bg-amber-400/10" : "text-destructive bg-destructive/10";
}

export default function ConversationImport() {
  const navigate = useNavigate();
  const { snapshot, analyzeConversation, saveWorkflow, previewWorkflow } = useEngine();
  const fileInput = useRef<HTMLInputElement | null>(null);
  const [images, setImages] = useState<ProcessedImage[]>([]);
  const [redactions, setRedactions] = useState<Record<string, RedactionRegion[]>>({});
  const [drag, setDrag] = useState<DragState | null>(null);
  const [ownerSide, setOwnerSide] = useState<"left" | "right" | null>(null);
  const [analysis, setAnalysis] = useState<ConversationAnalysis | null>(null);
  const [busy, setBusy] = useState<boolean>(false);
  const [resolved, setResolved] = useState<Set<string>>(new Set());
  const [activeSource, setActiveSource] = useState<number>(0);
  const [testInput, setTestInput] = useState<string>("");
  const [preview, setPreview] = useState<{ matched: boolean; captures: string[]; output: string; note: string } | null>(null);

  const addFiles = useCallback(async (files: File[]): Promise<void> => {
    if (files.length === 0) return;
    setBusy(true);
    try {
      const processed = await preprocessConversationImages(files);
      setImages(processed);
      setRedactions({});
      setAnalysis(null);
      setPreview(null);
      toast.success(`${processed.length} safe image panel${processed.length === 1 ? "" : "s"} prepared`);
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not process screenshots."); }
    finally { setBusy(false); }
  }, []);

  const finishRedaction = (event: ReactPointerEvent<HTMLDivElement>, imageId: string): void => {
    if (!drag || drag.imageId !== imageId) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const endX = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const endY = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
    const region = { x: Math.min(drag.startX, endX), y: Math.min(drag.startY, endY), width: Math.abs(endX - drag.startX), height: Math.abs(endY - drag.startY) };
    if (region.width > 0.015 && region.height > 0.01) setRedactions((current) => ({ ...current, [imageId]: [...(current[imageId] ?? []), region] }));
    setDrag(null);
  };

  const analyze = async (): Promise<void> => {
    if (!ownerSide || images.length === 0) return;
    setBusy(true);
    try {
      const payloadImages = await Promise.all(images.map((image) => applyRedactions(image, redactions[image.id] ?? [])));
      const result = await analyzeConversation({ images: payloadImages, ownerSide, localeHint: navigator.language });
      setAnalysis(result);
      setResolved(new Set());
      setActiveSource(0);
      setTestInput(result.workflowSteps[0]?.trigger ?? "");
      setPreview(null);
      toast.success("AI transcript and disabled workflow proposal are ready");
    } finally { setBusy(false); }
  };

  const updateWorkflowStep = (index: number, patch: Partial<ConversationAnalysis["workflowSteps"][number]>): void => {
    setAnalysis((current) => current ? { ...current, workflowSteps: current.workflowSteps.map((step, stepIndex) => stepIndex === index ? { ...step, ...patch } : step) } : current);
    setPreview(null);
  };

  const buildStep = (source: ConversationAnalysis["workflowSteps"][number]): WorkflowStep => ({
    ...blankStep(), trigger: source.trigger, reply: source.reply, mode: source.mode, delayMs: Math.max(0, source.delayMs), actionType: "sendText",
  });

  const runPreview = async (): Promise<void> => {
    const first = analysis?.workflowSteps[0];
    if (!first || !testInput.trim()) return;
    setBusy(true);
    try {
      const result = await previewWorkflow(buildStep(first), testInput.trim());
      setPreview(result);
      result.matched ? toast.success("Preview matched without sending to Telegram") : toast.error("The test message did not match the first trigger");
    } finally { setBusy(false); }
  };

  const saveDisabled = async (): Promise<void> => {
    if (!analysis || !preview?.matched || resolved.size !== analysis.ambiguities.length) return;
    const workflow = blankWorkflow();
    workflow.name = analysis.title.trim() || "Imported conversation";
    workflow.status = "draft";
    workflow.enabled = false;
    workflow.steps = analysis.workflowSteps.map(buildStep);
    setBusy(true);
    try {
      await saveWorkflow(workflow);
      toast.success("Disabled draft saved — enable it only after final review");
      navigate("/workflows");
    } finally { setBusy(false); }
  };

  return (
    <div className="mx-auto w-full max-w-6xl space-y-5" onPaste={(event) => {
      const files = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith("image/"));
      if (files.length > 0) { event.preventDefault(); void addFiles(files); }
    }}>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-xl font-semibold tracking-tight">Create from conversation</h1><p className="mt-1 text-sm text-muted-foreground">Real AI vision extracts evidence first. You decide roles, resolve ambiguity and test before saving.</p></div>
        <div className="flex items-center gap-2 rounded-full bg-primary/[0.07] px-3 py-1.5 text-[11px] text-primary ring-1 ring-primary/20"><Sparkles className="h-3.5 w-3.5" />Rork AI Cloud · {snapshot?.ai.model ?? "vision model"}</div>
      </header>

      {!analysis ? (
        <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
          <section className="panel p-5">
            <div className="flex items-center justify-between"><div><h2 className="text-sm font-semibold">1 · Add screenshot evidence</h2><p className="mt-1 text-[11px] text-muted-foreground">Drop, paste, or choose Telegram screenshots in reading order.</p></div><UploadCloud className="h-5 w-5 text-primary" /></div>
            <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden" onChange={(event) => void addFiles(Array.from(event.target.files ?? []))} />
            <button onClick={() => fileInput.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); void addFiles(Array.from(event.dataTransfer.files)); }} className="mt-4 grid min-h-44 w-full place-items-center rounded-2xl border border-dashed border-primary/25 bg-primary/[0.035] p-6 text-center transition-colors hover:bg-primary/[0.06]">
              {busy ? <Loader2 className="h-7 w-7 animate-spin text-primary" /> : <div><ImagePlus className="mx-auto h-7 w-7 text-primary" /><p className="mt-3 text-sm font-semibold">Choose screenshots</p><p className="mt-1 text-[11px] text-muted-foreground">JPEG, PNG or WebP · tall images become overlapping readable panels</p></div>}
            </button>
            <div className="mt-4 grid gap-2 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
              {["Metadata stripped", "32 MP decode limit", "4-panel payload cap"].map((label) => <div key={label} className="rounded-xl bg-secondary/40 p-2 text-center text-[10px] text-muted-foreground"><LockKeyhole className="mx-auto mb-1 h-3 w-3 text-primary" />{label}</div>)}
            </div>
          </section>

          <section className="panel p-5">
            <div className="flex items-center justify-between"><div><h2 className="text-sm font-semibold">2 · Map roles and redact</h2><p className="mt-1 text-[11px] text-muted-foreground">Tell AI which side is you. Drag over any private area to burn in a mask.</p></div><EyeOff className="h-5 w-5 text-accent" /></div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              {(["left", "right"] as const).map((side) => <button key={side} onClick={() => setOwnerSide(side)} className={cn("rounded-xl p-3 text-left ring-1 transition-all", ownerSide === side ? "bg-primary/10 text-primary ring-primary/30" : "bg-secondary/40 text-muted-foreground ring-white/[0.06]")}><span className="text-xs font-semibold capitalize">I am on the {side}</span><span className="mt-1 block text-[10px]">Required — bubble colors are not trusted.</span></button>)}
            </div>
            {images.length === 0 ? <div className="mt-4 grid min-h-56 place-items-center rounded-2xl bg-secondary/25 text-center text-xs text-muted-foreground">Your locally processed previews appear here.</div> : (
              <div className="mt-4 grid max-h-[520px] grid-cols-2 gap-3 overflow-y-auto pr-1">
                {images.map((image, index) => (
                  <div key={image.id} className="rounded-xl bg-background/50 p-2">
                    <div className="mb-2 flex items-center gap-1"><span className="min-w-0 flex-1 truncate text-[10px] text-muted-foreground">{index + 1} · {image.name}</span><button disabled={index === 0} onClick={() => setImages((current) => { const next = [...current]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; return next; })} className="p-1 disabled:opacity-20"><ArrowUp className="h-3 w-3" /></button><button disabled={index === images.length - 1} onClick={() => setImages((current) => { const next = [...current]; [next[index + 1], next[index]] = [next[index], next[index + 1]]; return next; })} className="p-1 disabled:opacity-20"><ArrowDown className="h-3 w-3" /></button><button onClick={() => setImages((current) => current.filter((item) => item.id !== image.id))} className="p-1 text-destructive"><Trash2 className="h-3 w-3" /></button></div>
                    <div className="relative cursor-crosshair select-none overflow-hidden rounded-lg" onPointerDown={(event) => { const rect = event.currentTarget.getBoundingClientRect(); const x = (event.clientX - rect.left) / rect.width; const y = (event.clientY - rect.top) / rect.height; event.currentTarget.setPointerCapture(event.pointerId); setDrag({ imageId: image.id, startX: x, startY: y, currentX: x, currentY: y }); }} onPointerMove={(event) => { if (!drag || drag.imageId !== image.id) return; const rect = event.currentTarget.getBoundingClientRect(); setDrag({ ...drag, currentX: (event.clientX - rect.left) / rect.width, currentY: (event.clientY - rect.top) / rect.height }); }} onPointerUp={(event) => finishRedaction(event, image.id)}>
                      <img src={image.dataUri} alt={`Processed screenshot ${index + 1}`} className="block h-auto w-full" draggable={false} />
                      {(redactions[image.id] ?? []).map((region, regionIndex) => <span key={regionIndex} className="absolute bg-background" style={{ left: `${region.x * 100}%`, top: `${region.y * 100}%`, width: `${region.width * 100}%`, height: `${region.height * 100}%` }} />)}
                      {drag?.imageId === image.id ? <span className="absolute border border-primary bg-background/90" style={{ left: `${Math.min(drag.startX, drag.currentX) * 100}%`, top: `${Math.min(drag.startY, drag.currentY) * 100}%`, width: `${Math.abs(drag.currentX - drag.startX) * 100}%`, height: `${Math.abs(drag.currentY - drag.startY) * 100}%` }} /> : null}
                    </div>
                    {(redactions[image.id]?.length ?? 0) > 0 ? <button className="mt-2 text-[9px] text-primary" onClick={() => setRedactions((current) => ({ ...current, [image.id]: [] }))}>Clear {redactions[image.id]?.length} mask(s)</button> : null}
                  </div>
                ))}
              </div>
            )}
            <Button className="mt-4 h-11 w-full gap-2 rounded-xl" disabled={busy || images.length === 0 || !ownerSide || !snapshot?.ai.enabled} onClick={() => void analyze()}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <WandSparkles className="h-4 w-4" />}Extract transcript with real AI credits</Button>
            <p className="mt-2 text-center text-[10px] text-muted-foreground">Image text is treated as untrusted conversation data. Links are never opened. Raw images are not stored by ReplyFlow.</p>
          </section>
        </div>
      ) : (
        <div className="space-y-4">
          <section className="panel overflow-hidden">
            <div className="border-b border-white/[0.06] px-5 py-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-sm font-semibold">{analysis.title}</h2><p className="mt-1 max-w-2xl text-[11px] leading-relaxed text-muted-foreground">{analysis.summary}</p></div><Button variant="ghost" size="sm" className="rounded-full" onClick={() => { setAnalysis(null); setResolved(new Set()); setPreview(null); }}><X className="mr-1.5 h-3.5 w-3.5" />Start over</Button></div></div>
            <div className="grid lg:grid-cols-[0.8fr_1.2fr]">
              <div className="border-b border-white/[0.06] p-4 lg:border-b-0 lg:border-r">
                <p className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Source evidence · panel {activeSource + 1}</p>
                {images[activeSource] ? <img src={images[activeSource].dataUri} alt={`Evidence panel ${activeSource + 1}`} className="mx-auto max-h-[620px] rounded-xl object-contain ring-1 ring-white/10" /> : null}
                <div className="mt-3 flex flex-wrap gap-1">{images.map((image, index) => <button key={image.id} onClick={() => setActiveSource(index)} className={cn("rounded-md px-2 py-1 font-mono text-[9px]", activeSource === index ? "bg-primary/15 text-primary" : "bg-secondary text-muted-foreground")}>{index + 1}</button>)}</div>
              </div>
              <div className="max-h-[700px] overflow-y-auto p-4">
                <div className="mb-3 flex items-center justify-between"><p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Faithful transcript</p><span className="text-[10px] text-muted-foreground">{analysis.messages.length} extracted items</span></div>
                <div className="space-y-2">
                  {analysis.messages.map((message) => <button key={message.id} onClick={() => setActiveSource(Math.max(0, Math.min(images.length - 1, message.sourceImage)))} className={cn("block max-w-[88%] rounded-2xl p-3 text-left ring-1", message.side === "owner" ? "ml-auto bg-primary/10 ring-primary/20" : message.side === "system" ? "mx-auto bg-secondary/50 ring-white/10" : "bg-secondary/60 ring-white/[0.07]")}><div className="mb-1 flex items-center gap-2"><span className="text-[10px] font-semibold uppercase tracking-wide">{message.side}</span><span className={cn("rounded px-1.5 py-0.5 text-[8px] uppercase", confidenceTone(message.confidence))}>{message.confidence} · {message.basis}</span></div><p className="whitespace-pre-wrap text-xs leading-relaxed">{message.text || `[${message.mediaType}]`}</p>{message.buttons.length > 0 ? <div className="mt-2 flex flex-wrap gap-1">{message.buttons.map((button) => <span key={button} className="rounded-md bg-background/50 px-2 py-1 text-[9px] text-accent">{button}</span>)}</div> : null}</button>)}
                </div>
              </div>
            </div>
          </section>

          <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
            <section className="panel p-5"><div className="flex items-center justify-between"><div><h2 className="text-sm font-semibold">Proposed disabled workflow</h2><p className="mt-1 text-[11px] text-muted-foreground">Edit every trigger and reply. Nothing here is enabled automatically.</p></div><ScanLine className="h-5 w-5 text-primary" /></div>
              <div className="mt-4 space-y-3">{analysis.workflowSteps.map((step, index) => <div key={`${index}-${step.evidenceIds.join("-")}`} className="rounded-2xl bg-secondary/35 p-3 ring-1 ring-white/[0.06]"><div className="mb-2 flex items-center gap-2"><span className="grid h-5 w-5 place-items-center rounded-md bg-primary/15 font-mono text-[9px] text-primary">{index + 1}</span><span className={cn("rounded px-1.5 py-0.5 text-[8px] uppercase", confidenceTone(step.confidence))}>{step.confidence} · {step.basis}</span><select value={step.mode} onChange={(event) => updateWorkflowStep(index, { mode: event.target.value as TriggerMode })} className="ml-auto h-7 rounded-lg border border-white/[0.06] bg-input px-2 text-[10px]"><option value="exact">exact</option><option value="contains">contains</option><option value="starts">starts</option><option value="ends">ends</option><option value="regex">pattern</option></select></div><Input value={step.trigger} onChange={(event) => updateWorkflowStep(index, { trigger: event.target.value })} className="h-9 rounded-xl bg-background/60 font-mono text-xs" /><Textarea value={step.reply} onChange={(event) => updateWorkflowStep(index, { reply: event.target.value })} className="mt-2 rounded-xl bg-background/60 text-xs" rows={2} /><div className="mt-2 flex items-center justify-between text-[9px] text-muted-foreground"><span>Evidence: {step.evidenceIds.join(", ") || "inferred"}</span><label className="flex items-center gap-1">delay<Input type="number" value={Math.round(step.delayMs / 1000)} min={0} onChange={(event) => updateWorkflowStep(index, { delayMs: Math.max(0, Number(event.target.value)) * 1000 })} className="h-6 w-14 rounded-md bg-background/60 px-1.5 font-mono text-[9px]" />s</label></div></div>)}</div>
            </section>

            <div className="space-y-4">
              <section className="panel p-5"><h2 className="text-sm font-semibold">Resolve ambiguity</h2><p className="mt-1 text-[11px] text-muted-foreground">Every uncertainty requires an explicit acknowledgment.</p><div className="mt-3 space-y-2">{analysis.ambiguities.length === 0 ? <div className="flex items-center gap-2 rounded-xl bg-primary/[0.06] p-3 text-xs text-primary"><CheckCircle2 className="h-4 w-4" />No unresolved ambiguities reported.</div> : analysis.ambiguities.map((item) => <label key={item.id} className="flex items-start gap-2 rounded-xl bg-secondary/35 p-3 text-xs leading-relaxed"><Checkbox checked={resolved.has(item.id)} onCheckedChange={(checked) => setResolved((current) => { const next = new Set(current); checked ? next.add(item.id) : next.delete(item.id); return next; })} className="mt-0.5" /><span><span className={item.severity === "blocking" ? "font-semibold text-destructive" : "font-semibold text-amber-300"}>{item.severity}</span><span className="ml-1 text-muted-foreground">{item.question}</span></span></label>)}</div></section>

              <section className="panel p-5"><h2 className="text-sm font-semibold">Mandatory no-send preview</h2><p className="mt-1 text-[11px] text-muted-foreground">Test the first trigger and substitution without contacting Telegram.</p><Input value={testInput} onChange={(event) => { setTestInput(event.target.value); setPreview(null); }} placeholder="Sample incoming message" className="mt-3 h-10 rounded-xl bg-input/60" /><Button variant="secondary" className="mt-2 h-10 w-full rounded-xl" disabled={busy || !testInput.trim() || analysis.workflowSteps.length === 0} onClick={() => void runPreview()}>{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}Run safe preview</Button>{preview ? <div className={cn("mt-3 rounded-xl p-3 text-xs ring-1", preview.matched ? "bg-primary/[0.06] text-primary ring-primary/20" : "bg-destructive/[0.06] text-destructive ring-destructive/20")}><p className="font-semibold">{preview.matched ? "Matched" : "Did not match"}</p><p className="mt-1 whitespace-pre-wrap text-muted-foreground">Output: {preview.output || "[no text action]"}</p>{preview.captures.length ? <p className="mt-1 font-mono text-[9px]">Captures: {preview.captures.join(", ")}</p> : null}</div> : null}</section>

              <Button className="h-12 w-full gap-2 rounded-xl font-semibold" disabled={busy || !preview?.matched || resolved.size !== analysis.ambiguities.length || analysis.workflowSteps.length === 0} onClick={() => void saveDisabled()}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}Approve revision and save disabled</Button>
              <p className="text-center text-[10px] text-muted-foreground">You must enable the saved draft separately in Workflow Studio.</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
