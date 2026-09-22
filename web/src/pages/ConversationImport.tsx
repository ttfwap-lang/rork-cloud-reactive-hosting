import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowDown, ArrowUp, Check, CheckCircle2, EyeOff, FileCode, FileJson, History, ImagePlus, Loader2, LockKeyhole, ScanLine, Sparkles, Trash2, UploadCloud, WandSparkles, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { type ConversationAnalysis, type TriggerMode, type WorkflowStep } from "@/lib/api";
import { applyRedactions, preprocessConversationImages, type ProcessedImage, type RedactionRegion } from "@/lib/conversation-images";
import { useEngine } from "@/lib/engine-store";
import { blankStep, blankWorkflow } from "@/pages/Workflows";
import {
  parseTelegramJson,
  parseTelegramHtml,
  parseMtprotoHistory,
  distilConversation,
  type DistilledSummary,
} from "../../../functions/conversation-parser";

type DragState = { imageId: string; startX: number; startY: number; currentX: number; currentY: number };
type IngestionMode = "screenshots" | "export" | "mtproto";

function confidenceTone(confidence: "high" | "medium" | "low"): string {
  return confidence === "high" ? "text-primary bg-primary/10" : confidence === "medium" ? "text-amber-300 bg-amber-400/10" : "text-destructive bg-destructive/10";
}

export default function ConversationImport() {
  const navigate = useNavigate();
  const { snapshot, analyzeConversation, saveWorkflow, previewWorkflow, pullTelegramHistory } = useEngine();

  const [mode, setMode] = useState<IngestionMode>("screenshots");
  const fileInput = useRef<HTMLInputElement | null>(null);
  const exportFileInput = useRef<HTMLInputElement | null>(null);

  // Screenshots state
  const [images, setImages] = useState<ProcessedImage[]>([]);
  const [redactions, setRedactions] = useState<Record<string, RedactionRegion[]>>({});
  const [drag, setDrag] = useState<DragState | null>(null);
  const [ownerSide, setOwnerSide] = useState<"left" | "right" | null>(null);

  // Export & MTProto state
  const [distilled, setDistilled] = useState<DistilledSummary | null>(null);
  const [ownerHint, setOwnerHint] = useState<string>("");
  const [mtprotoPeer, setMtprotoPeer] = useState<string>("");

  // Analysis & Workflow draft state
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

  const handleExportFiles = async (files: File[]): Promise<void> => {
    const file = files[0];
    if (!file) return;
    setBusy(true);
    try {
      const text = await file.text();
      let conversation;
      if (file.name.endsWith(".json")) {
        conversation = parseTelegramJson(text, ownerHint || undefined);
      } else {
        conversation = parseTelegramHtml(text, ownerHint || undefined);
      }
      const summary = distilConversation(conversation);
      setDistilled(summary);
      setAnalysis(null);
      setPreview(null);
      toast.success(`Distilled ${summary.exchangeCount} interaction exchange(s) from "${summary.chatName}"`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not parse export file.");
    } finally {
      setBusy(false);
    }
  };

  const handleMtprotoPull = async (): Promise<void> => {
    const peer = mtprotoPeer.trim();
    if (!peer) {
      toast.error("Please enter a chat username or ID (e.g. @bot or chat ID).");
      return;
    }
    setBusy(true);
    try {
      const result = await pullTelegramHistory(peer, 50, 3);
      if (!result.ok || !result.messages) {
        throw new Error("Live MTProto history pull returned empty.");
      }
      const conversation = parseMtprotoHistory(result.messages, peer);
      const summary = distilConversation(conversation);
      setDistilled(summary);
      setAnalysis(null);
      setPreview(null);
      toast.success(`Pulled ${result.count} messages and distilled ${summary.exchangeCount} exchange(s) from ${peer}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Live history pull failed.");
    } finally {
      setBusy(false);
    }
  };

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
    setBusy(true);
    try {
      if (mode === "screenshots") {
        if (!ownerSide || images.length === 0) return;
        const payloadImages = await Promise.all(images.map((image) => applyRedactions(image, redactions[image.id] ?? [])));
        const result = await analyzeConversation({ images: payloadImages, ownerSide, localeHint: navigator.language });
        setAnalysis(result);
      } else {
        if (!distilled || distilled.patterns.length === 0) return;
        const result = await analyzeConversation({ distilled, localeHint: navigator.language });
        setAnalysis(result);
      }
      setResolved(new Set());
      setActiveSource(0);
      setTestInput("");
      setPreview(null);
      toast.success("AI transcript and proposed workflow are ready");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Conversation analysis failed.");
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
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The preview could not be run.");
    } finally { setBusy(false); }
  };

  const saveDisabled = async (): Promise<void> => {
    if (!analysis || !preview?.matched || resolved.size !== analysis.ambiguities.length) return;
    const workflow = blankWorkflow();
    workflow.name = analysis.title.trim() || (distilled?.chatName ? `Imported: ${distilled.chatName}` : "Imported conversation");
    workflow.status = "draft";
    workflow.enabled = false;
    workflow.steps = analysis.workflowSteps.map(buildStep);
    setBusy(true);
    try {
      await saveWorkflow(workflow);
      toast.success("Disabled draft saved — enable it only after final review");
      navigate("/workflows");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The draft could not be saved.");
    } finally { setBusy(false); }
  };

  return (
    <div className="mx-auto w-full max-w-6xl space-y-5" onPaste={(event) => {
      if (mode !== "screenshots") return;
      const files = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith("image/"));
      if (files.length > 0) { event.preventDefault(); void addFiles(files); }
    }}>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Create from conversation</h1>
          <p className="mt-1 text-sm text-muted-foreground">Import real Telegram evidence. Parse and distil locally — only summarized patterns reach the model.</p>
        </div>
        <div className="flex items-center gap-2 rounded-full bg-primary/[0.07] px-3 py-1.5 text-[11px] text-primary ring-1 ring-primary/20">
          <Sparkles className="h-3.5 w-3.5" />Rork AI Cloud · {snapshot?.ai.model ?? "vision & language"}
        </div>
      </header>

      {/* Mode Switcher */}
      {!analysis && (
        <div className="flex flex-wrap gap-2 border-b border-white/[0.08] pb-3">
          <Button
            variant={mode === "screenshots" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setMode("screenshots")}
            className="gap-2 rounded-xl text-xs"
          >
            <ImagePlus className="h-3.5 w-3.5" />Screenshots (Vision)
          </Button>
          <Button
            variant={mode === "export" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setMode("export")}
            className="gap-2 rounded-xl text-xs"
          >
            <FileJson className="h-3.5 w-3.5" />Telegram Desktop Export (JSON / HTML)
          </Button>
          <Button
            variant={mode === "mtproto" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setMode("mtproto")}
            className="gap-2 rounded-xl text-xs"
          >
            <History className="h-3.5 w-3.5" />Live MTProto Pull
          </Button>
        </div>
      )}

      {!analysis ? (
        mode === "screenshots" ? (
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
        ) : mode === "export" ? (
          <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
            <section className="panel p-5">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold">1 · Upload Telegram Export</h2>
                  <p className="mt-1 text-[11px] text-muted-foreground">Telegram Desktop export: upload result.json or messages.html.</p>
                </div>
                <FileCode className="h-5 w-5 text-primary" />
              </div>
              <div className="mt-3">
                <label className="text-[11px] text-muted-foreground">My name / username in export (optional hint):</label>
                <Input
                  value={ownerHint}
                  onChange={(e) => setOwnerHint(e.target.value)}
                  placeholder="e.g. John Doe or username"
                  className="mt-1 h-9 rounded-xl bg-input/60 text-xs"
                />
              </div>
              <input
                ref={exportFileInput}
                type="file"
                accept=".json,.html,.htm"
                className="hidden"
                onChange={(e) => void handleExportFiles(Array.from(e.target.files ?? []))}
              />
              <button
                onClick={() => exportFileInput.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); void handleExportFiles(Array.from(e.dataTransfer.files)); }}
                className="mt-4 grid min-h-44 w-full place-items-center rounded-2xl border border-dashed border-primary/25 bg-primary/[0.035] p-6 text-center transition-colors hover:bg-primary/[0.06]"
              >
                {busy ? <Loader2 className="h-7 w-7 animate-spin text-primary" /> : (
                  <div>
                    <FileJson className="mx-auto h-7 w-7 text-primary" />
                    <p className="mt-3 text-sm font-semibold">Select result.json or messages.html</p>
                    <p className="mt-1 text-[11px] text-muted-foreground">Parsed and distilled completely in your browser</p>
                  </div>
                )}
              </button>
            </section>

            <section className="panel p-5">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold">2 · Distilled Patterns</h2>
                  <p className="mt-1 text-[11px] text-muted-foreground">Raw chat is never sent to the model. Only recurring interaction patterns are extracted.</p>
                </div>
                <ScanLine className="h-5 w-5 text-accent" />
              </div>

              {!distilled ? (
                <div className="mt-4 grid min-h-56 place-items-center rounded-2xl bg-secondary/25 text-center text-xs text-muted-foreground">
                  Upload an export file on the left to inspect distilled patterns.
                </div>
              ) : (
                <div className="mt-4 space-y-3">
                  <div className="rounded-xl bg-secondary/30 p-3 text-xs">
                    <p className="font-semibold text-primary">{distilled.chatName}</p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {distilled.totalMessages} total messages parsed · {distilled.exchangeCount} interaction exchange(s) · {distilled.patterns.length} unique pattern(s)
                    </p>
                  </div>
                  <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
                    {distilled.patterns.map((p, i) => (
                      <div key={i} className="rounded-xl border border-white/[0.06] bg-background/50 p-2.5 text-xs">
                        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                          <span className="font-mono text-primary">#{i + 1}</span>
                          <span className="rounded bg-primary/10 px-1.5 py-0.5 text-primary">observed {p.occurrences}x</span>
                        </div>
                        <p className="mt-1 font-medium text-foreground">Trigger: "{p.trigger}"</p>
                        <p className="mt-0.5 text-muted-foreground">Reply: "{p.reply}"</p>
                      </div>
                    ))}
                  </div>
                  <Button
                    className="mt-4 h-11 w-full gap-2 rounded-xl"
                    disabled={busy || distilled.patterns.length === 0 || !snapshot?.ai.enabled}
                    onClick={() => void analyze()}
                  >
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <WandSparkles className="h-4 w-4" />}
                    Generate Automation Workflow from Distilled Patterns
                  </Button>
                </div>
              )}
            </section>
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
            <section className="panel p-5">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold">1 · Pull Live MTProto History</h2>
                  <p className="mt-1 text-[11px] text-muted-foreground">Uses connector MTProto messages.getHistory with pagination and safe cap.</p>
                </div>
                <History className="h-5 w-5 text-primary" />
              </div>
              <div className="mt-4 space-y-3">
                <div>
                  <label className="text-[11px] text-muted-foreground">Target Chat Peer (e.g. @bot, channel, or user ID):</label>
                  <Input
                    value={mtprotoPeer}
                    onChange={(e) => setMtprotoPeer(e.target.value)}
                    placeholder="@astro1 or 12345678"
                    className="mt-1 h-10 rounded-xl bg-input/60 text-xs"
                  />
                </div>
                <Button
                  className="h-10 w-full gap-2 rounded-xl"
                  disabled={busy || !mtprotoPeer.trim()}
                  onClick={() => void handleMtprotoPull()}
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <History className="h-4 w-4" />}
                  Fetch History & Distil Locally
                </Button>
              </div>
            </section>

            <section className="panel p-5">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold">2 · Distilled Patterns</h2>
                  <p className="mt-1 text-[11px] text-muted-foreground">Local aggregation extracts recurring patterns before calling the AI model.</p>
                </div>
                <ScanLine className="h-5 w-5 text-accent" />
              </div>

              {!distilled ? (
                <div className="mt-4 grid min-h-56 place-items-center rounded-2xl bg-secondary/25 text-center text-xs text-muted-foreground">
                  Fetch live MTProto history on the left to extract interaction patterns.
                </div>
              ) : (
                <div className="mt-4 space-y-3">
                  <div className="rounded-xl bg-secondary/30 p-3 text-xs">
                    <p className="font-semibold text-primary">{distilled.chatName}</p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {distilled.totalMessages} messages pulled · {distilled.exchangeCount} interaction exchange(s)
                    </p>
                  </div>
                  <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
                    {distilled.patterns.map((p, i) => (
                      <div key={i} className="rounded-xl border border-white/[0.06] bg-background/50 p-2.5 text-xs">
                        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                          <span className="font-mono text-primary">#{i + 1}</span>
                          <span className="rounded bg-primary/10 px-1.5 py-0.5 text-primary">observed {p.occurrences}x</span>
                        </div>
                        <p className="mt-1 font-medium text-foreground">Trigger: "{p.trigger}"</p>
                        <p className="mt-0.5 text-muted-foreground">Reply: "{p.reply}"</p>
                      </div>
                    ))}
                  </div>
                  <Button
                    className="mt-4 h-11 w-full gap-2 rounded-xl"
                    disabled={busy || distilled.patterns.length === 0 || !snapshot?.ai.enabled}
                    onClick={() => void analyze()}
                  >
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <WandSparkles className="h-4 w-4" />}
                    Generate Automation Workflow from Distilled Patterns
                  </Button>
                </div>
              )}
            </section>
          </div>
        )
      ) : (
        <div className="space-y-4">
          <section className="panel overflow-hidden">
            <div className="border-b border-white/[0.06] px-5 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold">{analysis.title}</h2>
                  <p className="mt-1 max-w-2xl text-[11px] leading-relaxed text-muted-foreground">{analysis.summary}</p>
                </div>
                <Button variant="ghost" size="sm" className="rounded-full" onClick={() => { setAnalysis(null); setResolved(new Set()); setPreview(null); }}>
                  <X className="mr-1.5 h-3.5 w-3.5" />Start over
                </Button>
              </div>
            </div>
            <div className="grid lg:grid-cols-[0.8fr_1.2fr]">
              <div className="border-b border-white/[0.06] p-4 lg:border-b-0 lg:border-r">
                <p className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                  {images.length > 0 ? `Source evidence · panel ${activeSource + 1}` : "Distilled Source"}
                </p>
                {images[activeSource] ? (
                  <img src={images[activeSource].dataUri} alt={`Evidence panel ${activeSource + 1}`} className="mx-auto max-h-[620px] rounded-xl object-contain ring-1 ring-white/10" />
                ) : distilled ? (
                  <div className="rounded-xl bg-secondary/30 p-4 text-xs space-y-2">
                    <p className="font-semibold text-primary">{distilled.chatName}</p>
                    <p className="text-[11px] text-muted-foreground">{distilled.totalMessages} messages distilled into {distilled.patterns.length} patterns.</p>
                    <div className="space-y-1.5 pt-2">
                      {distilled.patterns.slice(0, 5).map((p, i) => (
                        <div key={i} className="rounded-lg bg-background/50 p-2 text-[11px]">
                          <span className="text-primary font-mono">#{i + 1}</span> {p.trigger} &rarr; {p.reply}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
                {images.length > 0 ? (
                  <div className="mt-3 flex flex-wrap gap-1">
                    {images.map((image, index) => (
                      <button key={image.id} onClick={() => setActiveSource(index)} className={cn("rounded-md px-2 py-1 font-mono text-[9px]", activeSource === index ? "bg-primary/15 text-primary" : "bg-secondary text-muted-foreground")}>{index + 1}</button>
                    ))}
                  </div>
                ) : null}
              </div>
              <div className="max-h-[700px] overflow-y-auto p-4">
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Faithful transcript</p>
                  <span className="text-[10px] text-muted-foreground">{analysis.messages.length} extracted items</span>
                </div>
                <div className="space-y-2">
                  {analysis.messages.map((message) => (
                    <button key={message.id} onClick={() => images.length > 0 ? setActiveSource(Math.max(0, Math.min(images.length - 1, message.sourceImage))) : undefined} className={cn("block max-w-[88%] rounded-2xl p-3 text-left ring-1", message.side === "owner" ? "ml-auto bg-primary/10 ring-primary/20" : message.side === "system" ? "mx-auto bg-secondary/50 ring-white/10" : "bg-secondary/60 ring-white/[0.07]")}>
                      <div className="mb-1 flex items-center gap-2">
                        <span className="text-[10px] font-semibold uppercase tracking-wide">{message.side}</span>
                        <span className={cn("rounded px-1.5 py-0.5 text-[8px] uppercase", confidenceTone(message.confidence))}>{message.confidence} · {message.basis}</span>
                      </div>
                      <p className="whitespace-pre-wrap text-xs leading-relaxed">{message.text || `[${message.mediaType}]`}</p>
                      {message.buttons.length > 0 ? (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {message.buttons.map((button) => <span key={button} className="rounded-md bg-background/50 px-2 py-1 text-[9px] text-accent">{button}</span>)}
                        </div>
                      ) : null}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </section>

          <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
            <section className="panel p-5">
              <div className="flex items-center justify-between"><div><h2 className="text-sm font-semibold">Proposed disabled workflow</h2><p className="mt-1 text-[11px] text-muted-foreground">Edit every trigger and reply. Nothing here is enabled automatically.</p></div><ScanLine className="h-5 w-5 text-primary" /></div>
              <div className="mt-4 space-y-3">
                {analysis.workflowSteps.map((step, index) => (
                  <div key={`${index}-${step.evidenceIds.join("-")}`} className="rounded-2xl bg-secondary/35 p-3 ring-1 ring-white/[0.06]">
                    <div className="mb-2 flex items-center gap-2">
                      <span className="grid h-5 w-5 place-items-center rounded-md bg-primary/15 font-mono text-[9px] text-primary">{index + 1}</span>
                      <span className={cn("rounded px-1.5 py-0.5 text-[8px] uppercase", confidenceTone(step.confidence))}>{step.confidence} · {step.basis}</span>
                      <select value={step.mode} onChange={(event) => updateWorkflowStep(index, { mode: event.target.value as TriggerMode })} className="ml-auto h-7 rounded-lg border border-white/[0.06] bg-input px-2 text-[10px]">
                        <option value="exact">exact</option><option value="contains">contains</option><option value="starts">starts</option><option value="ends">ends</option><option value="regex">pattern</option>
                      </select>
                    </div>
                    <Input value={step.trigger} onChange={(event) => updateWorkflowStep(index, { trigger: event.target.value })} className="h-9 rounded-xl bg-background/60 font-mono text-xs" />
                    <Textarea value={step.reply} onChange={(event) => updateWorkflowStep(index, { reply: event.target.value })} className="mt-2 rounded-xl bg-background/60 text-xs" rows={2} />
                    <div className="mt-2 flex items-center justify-between text-[9px] text-muted-foreground">
                      <span>Evidence: {step.evidenceIds.join(", ") || "inferred"}</span>
                      <label className="flex items-center gap-1">delay<Input type="number" value={Math.round(step.delayMs / 1000)} min={0} onChange={(event) => updateWorkflowStep(index, { delayMs: Math.max(0, Number(event.target.value)) * 1000 })} className="h-6 w-14 rounded-md bg-background/60 px-1.5 font-mono text-[9px]" />s</label>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <div className="space-y-4">
              <section className="panel p-5">
                <h2 className="text-sm font-semibold">Resolve ambiguity</h2>
                <p className="mt-1 text-[11px] text-muted-foreground">Every uncertainty requires an explicit acknowledgment.</p>
                <div className="mt-3 space-y-2">
                  {analysis.ambiguities.length === 0 ? (
                    <div className="flex items-center gap-2 rounded-xl bg-primary/[0.06] p-3 text-xs text-primary"><CheckCircle2 className="h-4 w-4" />No unresolved ambiguities reported.</div>
                  ) : analysis.ambiguities.map((item) => (
                    <label key={item.id} className="flex items-start gap-2 rounded-xl bg-secondary/35 p-3 text-xs leading-relaxed">
                      <Checkbox checked={resolved.has(item.id)} onCheckedChange={(checked) => setResolved((current) => { const next = new Set(current); checked ? next.add(item.id) : next.delete(item.id); return next; })} className="mt-0.5" />
                      <span><span className={item.severity === "blocking" ? "font-semibold text-destructive" : "font-semibold text-amber-300"}>{item.severity}</span><span className="ml-1 text-muted-foreground">{item.question}</span></span>
                    </label>
                  ))}
                </div>
              </section>

              <section className="panel p-5">
                <h2 className="text-sm font-semibold">Mandatory no-send preview</h2>
                <p className="mt-1 text-[11px] text-muted-foreground">Test the first trigger and substitution without contacting Telegram.</p>
                <Input value={testInput} onChange={(event) => { setTestInput(event.target.value); setPreview(null); }} placeholder="Sample incoming message" className="mt-3 h-10 rounded-xl bg-input/60" />
                <Button variant="secondary" className="mt-2 h-10 w-full rounded-xl" disabled={busy || !testInput.trim() || analysis.workflowSteps.length === 0} onClick={() => void runPreview()}>
                  {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}Run safe preview
                </Button>
                {preview ? (
                  <div className={cn("mt-3 rounded-xl p-3 text-xs ring-1", preview.matched ? "bg-primary/[0.06] text-primary ring-primary/20" : "bg-destructive/[0.06] text-destructive ring-destructive/20")}>
                    <p className="font-semibold">{preview.matched ? "Matched" : "Did not match"}</p>
                    <p className="mt-1 whitespace-pre-wrap text-muted-foreground">Output: {preview.output || "[no text action]"}</p>
                    {preview.captures.length ? <p className="mt-1 font-mono text-[9px]">Captures: {preview.captures.join(", ")}</p> : null}
                  </div>
                ) : null}
              </section>

              <Button
                className="h-12 w-full gap-2 rounded-xl font-semibold"
                disabled={busy || !preview?.matched || resolved.size !== analysis.ambiguities.length || analysis.workflowSteps.length === 0}
                onClick={() => void saveDisabled()}
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                Approve revision and save disabled
              </Button>
              <p className="text-center text-[10px] text-muted-foreground">You must enable the saved draft separately in Workflow Studio.</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
