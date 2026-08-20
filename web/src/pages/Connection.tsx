import { useEffect, useRef, useState, type FormEvent } from "react";
import { QRCodeSVG } from "qrcode.react";
import { AlertTriangle, Bot, CheckCircle2, KeyRound, Loader2, Phone, PlugZap, QrCode, RefreshCw, Send, Server, ShieldAlert, Trash2, TrainFront, UserRound, Wrench } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { useEngine } from "@/lib/engine-store";
import type { HostingReport } from "@/lib/api";

export default function Connection() {
  const { snapshot, connectBot, startPersonal, submitPersonal, pollPersonal, checkConnector, diagnoseHosting, applyHosting, reconnect, forgetConnection, simulate } = useEngine();
  const [mode, setMode] = useState<"personal" | "bot">("personal");
  const [loginMethod, setLoginMethod] = useState<"qr" | "phone">("qr");
  const [apiId, setApiId] = useState<string>("");
  const [apiHash, setApiHash] = useState<string>("");
  const [phone, setPhone] = useState<string>("");
  const [riskAccepted, setRiskAccepted] = useState<boolean>(false);
  const [loginValue, setLoginValue] = useState<string>("");
  const [token, setTokenValue] = useState<string>("");
  const [busy, setBusy] = useState<boolean>(false);
  const [checking, setChecking] = useState<boolean>(false);
  const [probe, setProbe] = useState<string>("");
  const [hosting, setHosting] = useState<HostingReport | null>(null);
  const [hostingBusy, setHostingBusy] = useState<"read" | "fix" | null>(null);
  const [applied, setApplied] = useState<string[]>([]);

  const link = snapshot?.link;
  const connector = snapshot?.connector;
  const presetCredentials = connector?.credentialsPreset ?? false;
  const serviceUp = connector?.probe.reachable ?? false;
  const isPersonalFlow = link?.mode === "personal" && ["awaiting_qr", "awaiting_code", "awaiting_password", "connecting"].includes(link.status);
  const linkStatus = link?.status;

  // Someone has to hold the connection open for Telegram to deliver the scanned
  // login token, so the console keeps polling for as long as a code is on screen.
  const pollRef = useRef(pollPersonal);
  useEffect(() => { pollRef.current = pollPersonal; });
  useEffect(() => {
    if (linkStatus !== "awaiting_qr") return;
    let cancelled = false;
    const loop = async (): Promise<void> => {
      while (!cancelled) {
        try {
          await pollRef.current();
        } catch {
          if (cancelled) return;
          await new Promise((resolve) => setTimeout(resolve, 3000));
        }
      }
    };
    void loop();
    return () => { cancelled = true; };
  }, [linkStatus]);

  const beginPersonal = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    try {
      await startPersonal({
        apiId: presetCredentials ? undefined : apiId.trim(),
        apiHash: presetCredentials ? undefined : apiHash.trim(),
        method: loginMethod,
        phone: loginMethod === "phone" ? phone.trim() : undefined,
        riskAccepted,
      });
      setApiHash("");
    } finally { setBusy(false); }
  };

  const beginBot = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    try { await connectBot(token.trim()); setTokenValue(""); } finally { setBusy(false); }
  };

  const submitLoginValue = async (): Promise<void> => {
    const kind = link?.status === "awaiting_password" ? "password" : "code";
    setBusy(true);
    try { await submitPersonal(kind, loginValue); setLoginValue(""); } finally { setBusy(false); }
  };

  return (
    <div className="mx-auto w-full max-w-4xl space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Telegram connection</h1>
          <p className="mt-1 text-sm text-muted-foreground">Choose a personal account for full bot conversations, or keep a bot webhook.</p>
        </div>
        {link?.mode !== "none" ? (
          <div className="flex items-center gap-2 rounded-full bg-secondary/60 px-3 py-1.5 text-xs">
            {link.status === "online" ? <CheckCircle2 className="h-3.5 w-3.5 text-primary" /> : <RefreshCw className="h-3.5 w-3.5 text-amber-400" />}
            <span className="font-medium capitalize">{link.mode}</span>
            <span className="text-muted-foreground">{link.identity ?? link.phoneMasked ?? link.status.replace(/_/g, " ")}</span>
          </div>
        ) : null}
      </header>

      <div className="grid gap-2 rounded-2xl bg-secondary/40 p-1.5 sm:grid-cols-2">
        <button onClick={() => setMode("personal")} className={cn("flex items-center gap-3 rounded-xl p-3 text-left transition-all", mode === "personal" ? "bg-card shadow-lg ring-1 ring-primary/25" : "text-muted-foreground hover:text-foreground")}>
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary/12"><UserRound className="h-4 w-4 text-primary" /></span>
          <span><span className="block text-sm font-semibold">Personal account</span><span className="block text-[11px]">Bots, buttons, reactions and persistent sessions</span></span>
        </button>
        <button onClick={() => setMode("bot")} className={cn("flex items-center gap-3 rounded-xl p-3 text-left transition-all", mode === "bot" ? "bg-card shadow-lg ring-1 ring-accent/25" : "text-muted-foreground hover:text-foreground")}>
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-accent/10"><Bot className="h-4 w-4 text-accent" /></span>
          <span><span className="block text-sm font-semibold">Bot token</span><span className="block text-[11px]">Telegram webhook with Bot API limitations</span></span>
        </button>
      </div>

      {mode === "personal" ? (
        <section className="panel overflow-hidden">
          <div className="border-b border-white/[0.06] bg-gradient-to-r from-primary/[0.08] to-transparent p-5">
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-xl bg-primary/15 ring-1 ring-primary/30"><QrCode className="h-5 w-5 text-primary" /></div>
              <div><h2 className="text-sm font-semibold">QR-first personal login</h2><p className="text-[11px] text-muted-foreground">Credentials and the authenticated session stay inside the isolated connector.</p></div>
            </div>
          </div>

          {!connector?.configured ? (
            <div className="m-5 flex gap-3 rounded-2xl border border-amber-400/20 bg-amber-400/[0.05] p-4">
              <TrainFront className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
              <div><p className="text-sm font-semibold text-amber-300">Railway connector package is ready</p><p className="mt-1 text-xs leading-relaxed text-muted-foreground">Deploy the included connector with an encrypted persistent volume, then add its URL and shared secret to activate live personal login. The dashboard and signed protocol are already wired.</p></div>
            </div>
          ) : (
            <div className={cn("m-5 flex flex-wrap items-center gap-3 rounded-2xl border p-4", serviceUp ? "border-primary/20 bg-primary/[0.05]" : "border-destructive/25 bg-destructive/[0.05]")}>
              {serviceUp ? <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" /> : <TrainFront className="h-4 w-4 shrink-0 text-destructive" />}
              <div className="min-w-0 flex-1">
                <p className={cn("text-sm font-semibold", serviceUp ? "text-primary" : "text-destructive")}>{serviceUp ? "Always-on service reachable" : "Always-on service not reachable"}</p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{connector.probe.detail}{connector.probe.checkedAt ? ` Checked ${new Date(connector.probe.checkedAt).toLocaleTimeString()}.` : ""}</p>
              </div>
              <Button size="sm" variant="secondary" className="shrink-0 rounded-full" disabled={checking} onClick={() => { setChecking(true); checkConnector().finally(() => setChecking(false)); }}>
                {checking ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}Test service
              </Button>
            </div>
          )}

          {isPersonalFlow && link?.status === "awaiting_qr" && link.qrUrl ? (
            <div className="grid gap-6 p-5 sm:grid-cols-[220px_1fr] sm:items-center">
              <div className="mx-auto rounded-2xl bg-white p-4 shadow-[0_0_50px_hsl(168_82%_44%/0.16)]"><QRCodeSVG value={link.qrUrl} size={188} level="M" /></div>
              <div><p className="text-sm font-semibold">Scan with your Telegram app</p><ol className="mt-3 space-y-2 text-xs text-muted-foreground"><li>1. Open Telegram Settings.</li><li>2. Choose Devices → Link Desktop Device.</li><li>3. Scan this code before it refreshes.</li></ol><p className="mt-3 flex items-center gap-1.5 text-[11px] text-primary"><Loader2 className="h-3 w-3 animate-spin" />Waiting for the scan — this page refreshes the code automatically.</p><p className="mt-3 text-[11px] text-amber-300">Telegram may ask for your two-step password next. It is sent once and never stored.</p></div>
            </div>
          ) : link?.status === "awaiting_code" || link?.status === "awaiting_password" ? (
            <div className="p-5">
              <div className="mx-auto max-w-md space-y-3">
                <div className="text-center"><KeyRound className="mx-auto h-5 w-5 text-primary" /><p className="mt-2 text-sm font-semibold">{link.status === "awaiting_password" ? "Two-step password" : "Telegram login code"}</p><p className="mt-1 text-xs text-muted-foreground">{link.detail}</p></div>
                <Input type={link.status === "awaiting_password" ? "password" : "text"} autoComplete="one-time-code" value={loginValue} onChange={(event) => setLoginValue(event.target.value)} className="h-11 rounded-xl bg-input/60 text-center font-mono" placeholder={link.status === "awaiting_password" ? "Your Telegram 2FA password" : "12345"} />
                <Button className="h-11 w-full rounded-xl" disabled={busy || !loginValue.trim()} onClick={() => void submitLoginValue()}>{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Continue securely</Button>
              </div>
            </div>
          ) : link?.mode === "personal" && ["online", "offline", "paused", "attention"].includes(link.status) ? (
            <div className="p-5">
              <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-secondary/40 p-4">
                <div className="grid h-10 w-10 place-items-center rounded-full bg-primary/15"><UserRound className="h-4 w-4 text-primary" /></div>
                <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{link.identity ?? "Saved personal account"}</p><p className="text-[11px] text-muted-foreground">{link.phoneMasked ?? "Phone hidden"} · {link.detail}</p></div>
                <Button size="sm" variant="secondary" className="rounded-full" disabled={busy || link.status === "online"} onClick={() => { setBusy(true); reconnect().finally(() => setBusy(false)); }}><RefreshCw className="mr-1.5 h-3.5 w-3.5" />Reconnect</Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild><Button size="sm" variant="ghost" className="rounded-full text-destructive hover:bg-destructive/10 hover:text-destructive"><Trash2 className="mr-1.5 h-3.5 w-3.5" />Forget</Button></AlertDialogTrigger>
                  <AlertDialogContent className="border-white/[0.08] bg-card"><AlertDialogHeader><AlertDialogTitle>Revoke and delete this session?</AlertDialogTitle><AlertDialogDescription>This logs out the Telegram API session and removes encrypted credentials and session files from the connector volume. It cannot be undone.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel className="rounded-xl">Keep session</AlertDialogCancel><AlertDialogAction className="rounded-xl bg-destructive text-white" onClick={() => void forgetConnection()}>Revoke and delete</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
          ) : (
            <form onSubmit={beginPersonal} className="space-y-4 p-5">
              {presetCredentials ? (
                <div className="flex items-center gap-3 rounded-xl border border-primary/20 bg-primary/[0.05] p-3">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" />
                  <p className="text-[11px] leading-relaxed text-muted-foreground">Your Telegram app ID and hash are stored as server-only secrets. They go straight to the isolated connector and are never sent to this browser.</p>
                </div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div><label className="mb-1.5 block text-xs font-medium text-muted-foreground">Telegram API ID</label><Input inputMode="numeric" value={apiId} onChange={(event) => setApiId(event.target.value.replace(/\D/g, ""))} placeholder="12345678" className="h-11 rounded-xl bg-input/60 font-mono" /></div>
                  <div><label className="mb-1.5 block text-xs font-medium text-muted-foreground">Telegram API hash</label><Input type="password" value={apiHash} onChange={(event) => setApiHash(event.target.value)} placeholder="32-character hash" className="h-11 rounded-xl bg-input/60 font-mono" /></div>
                </div>
              )}
              <div className="flex items-center justify-between rounded-xl bg-secondary/40 px-3 py-2.5"><div><p className="text-xs font-medium">Use phone-code fallback</p><p className="text-[10px] text-muted-foreground">QR is recommended and selected by default.</p></div><Switch checked={loginMethod === "phone"} onCheckedChange={(checked) => setLoginMethod(checked ? "phone" : "qr")} /></div>
              {loginMethod === "phone" ? <div><label className="mb-1.5 block text-xs font-medium text-muted-foreground">Phone number</label><div className="relative"><Phone className="absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" /><Input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="+1 555 123 4567" className="h-11 rounded-xl bg-input/60 pl-10" /></div></div> : null}
              <label className="flex items-start gap-3 rounded-xl border border-amber-400/20 bg-amber-400/[0.04] p-3 text-xs leading-relaxed text-muted-foreground"><Checkbox checked={riskAccepted} onCheckedChange={(checked) => setRiskAccepted(checked === true)} className="mt-0.5" /><span>I understand Telegram monitors API-client activity and may restrict or ban accounts. I will only automate consent-based existing conversations and accept the MadelineProto AGPL notice.</span></label>
              <Button type="submit" disabled={busy || !serviceUp || (!presetCredentials && (apiId.length < 4 || apiHash.length !== 32)) || !riskAccepted || (loginMethod === "phone" && !phone.trim())} className="h-11 w-full gap-2 rounded-xl font-semibold">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : loginMethod === "qr" ? <QrCode className="h-4 w-4" /> : <Phone className="h-4 w-4" />}{loginMethod === "qr" ? "Generate secure QR" : "Send login code"}</Button>
              <p className="text-center text-[10px] text-muted-foreground">One-time codes and two-step passwords are never persisted or returned after use.</p>
            </form>
          )}
        </section>
      ) : (
        <section className="panel p-5">
          <div className="mb-4 flex items-center gap-2.5"><div className="grid h-9 w-9 place-items-center rounded-xl bg-accent/10 ring-1 ring-accent/20"><Bot className="h-4 w-4 text-accent" /></div><div><h2 className="text-sm font-semibold">Telegram Bot API</h2><p className="text-[11px] text-muted-foreground">Useful for user-to-bot workflows; bots cannot receive messages from other bots.</p></div></div>
          <form onSubmit={beginBot} className="space-y-3"><Input type="password" value={token} placeholder="123456789:AA..." onChange={(event) => setTokenValue(event.target.value)} className="h-11 rounded-xl bg-input/60 font-mono text-sm" /><Button type="submit" disabled={busy || token.trim().length < 20} className="h-11 w-full gap-2 rounded-xl font-semibold">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlugZap className="h-4 w-4" />}Encrypt token and connect</Button></form>
        </section>
      )}

      <section className="panel overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-white/[0.06] p-5">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent/10 ring-1 ring-accent/20"><Server className="h-5 w-5 text-accent" /></div>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold">Hosting inspector</h2>
            <p className="text-[11px] leading-relaxed text-muted-foreground">Reads your Railway project with the server-only token and reports exactly why the service is or is not answering. Nothing secret is shown here.</p>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button size="sm" variant="secondary" className="rounded-full" disabled={hostingBusy !== null} onClick={() => {
              setHostingBusy("read");
              setApplied([]);
              diagnoseHosting().then(setHosting).catch(() => undefined).finally(() => setHostingBusy(null));
            }}>
              {hostingBusy === "read" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}Read status
            </Button>
            <Button size="sm" className="rounded-full" disabled={hostingBusy !== null} onClick={() => {
              setHostingBusy("fix");
              applyHosting().then((result) => { setApplied(result.applied); setHosting(result.report); }).catch(() => undefined).finally(() => setHostingBusy(null));
            }}>
              {hostingBusy === "fix" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Wrench className="mr-1.5 h-3.5 w-3.5" />}Fix and redeploy
            </Button>
          </div>
        </div>

        {hosting === null ? (
          <p className="p-5 text-xs text-muted-foreground">Press <span className="font-medium text-foreground">Read status</span> to pull the live picture from Railway, or <span className="font-medium text-foreground">Fix and redeploy</span> to push every setting, create the persistent disk, point the address at port 8080 and start a build.</p>
        ) : (
          <div className="space-y-4 p-5">
            <div className={cn("flex gap-3 rounded-2xl border p-4", hosting.ok ? "border-primary/20 bg-primary/[0.05]" : "border-amber-400/20 bg-amber-400/[0.05]")}>
              {hosting.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />}
              <div className="min-w-0">
                <p className={cn("text-sm font-semibold", hosting.ok ? "text-primary" : "text-amber-300")}>{hosting.detail}</p>
                {hosting.projectName ? <p className="mt-0.5 text-[11px] text-muted-foreground">Project {hosting.projectName} · environment {hosting.environmentName} · {hosting.tokenKind} token</p> : null}
              </div>
            </div>

            {applied.length > 0 ? (
              <ul className="space-y-1.5 rounded-2xl bg-secondary/40 p-4 text-[11px] text-muted-foreground">
                {applied.map((line) => <li key={line} className="flex gap-2"><CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-primary" />{line}</li>)}
              </ul>
            ) : null}

            {hosting.findings.length > 0 ? (
              <div>
                <p className="mb-2 text-xs font-semibold">What is wrong</p>
                <ul className="space-y-1.5">
                  {hosting.findings.map((finding) => (
                    <li key={finding} className="flex gap-2 rounded-xl bg-destructive/[0.06] px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
                      <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-destructive" />{finding}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {hosting.services.length > 0 ? (
              <div>
                <p className="mb-2 text-xs font-semibold">Services</p>
                <div className="space-y-2">
                  {hosting.services.map((service) => (
                    <div key={service.id} className="rounded-xl bg-secondary/40 px-3 py-2.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-semibold">{service.name}</span>
                        <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", service.latestStatus === "SUCCESS" ? "bg-primary/15 text-primary" : "bg-destructive/15 text-destructive")}>{service.latestStatus ?? "never deployed"}</span>
                        {service.latestAt ? <span className="text-[10px] text-muted-foreground">{new Date(service.latestAt).toLocaleString()}</span> : null}
                      </div>
                      <dl className="mt-1.5 grid gap-x-4 gap-y-0.5 text-[10px] text-muted-foreground sm:grid-cols-2">
                        <div>Root folder: <span className="text-foreground">{service.rootDirectory ?? "repository root"}</span></div>
                        <div>Builder: <span className="text-foreground">{service.builder ?? "unknown"}</span></div>
                        <div>Disks: <span className="text-foreground">{service.volumeMounts.length > 0 ? service.volumeMounts.join(", ") : "none"}</span></div>
                        <div>Addresses: <span className="text-foreground">{service.domains.length > 0 ? service.domains.map((entry) => `${entry.domain} → ${entry.targetPort ?? "auto"}`).join(", ") : "none"}</span></div>
                        <div className="sm:col-span-2">Settings present: <span className="text-foreground">{service.variableKeys.length > 0 ? service.variableKeys.join(", ") : "none"}</span></div>
                      </dl>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {hosting.buildLog.length > 0 ? (
              <div>
                <p className="mb-2 text-xs font-semibold">Build log tail</p>
                <pre className="max-h-72 overflow-auto rounded-xl bg-black/40 p-3 font-mono text-[10px] leading-relaxed text-muted-foreground">{hosting.buildLog.join("\n")}</pre>
              </div>
            ) : null}
          </div>
        )}
      </section>

      <section className="panel p-5">
        <h2 className="text-sm font-semibold">Live engine test</h2><p className="mt-1 text-[11px] text-muted-foreground">Push a synthetic inbound message through matching, captures, variables and safety checks.</p>
        <div className="mt-3 flex gap-2"><Input value={probe} placeholder="Message your workflow should match" onChange={(event) => setProbe(event.target.value)} className="h-10 rounded-xl bg-input/60 text-sm" /><Button variant="secondary" className="h-10 shrink-0 gap-1.5 rounded-xl" disabled={!probe.trim()} onClick={() => { simulate({ text: probe.trim() }).then(() => { setProbe(""); toast.success("Sent through the engine"); }); }}><Send className="h-3.5 w-3.5" />Fire</Button></div>
      </section>

      <section className="panel flex gap-3 border-amber-400/20 bg-amber-400/[0.04] p-5"><ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" /><div className="text-[12px] leading-relaxed text-muted-foreground"><p className="font-semibold text-amber-300">Use personal automation carefully</p><p className="mt-1">ReplyFlow excludes scraping, cold outreach, account farming, payments, contact importing and destructive account controls. Session theft can grant account access, so personal sessions stay isolated from the dashboard service.</p></div></section>
    </div>
  );
}
