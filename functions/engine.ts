import { DurableObject } from "cloudflare:workers";

/** Env visible to the engine. `DO` carries the platform alarm RPC methods. */
type Env = {
  DO: Fetcher & {
    setAlarm(className: string, id: string, scheduledTime: number | Date): Promise<void>;
    getAlarm(className: string, id: string): Promise<number | null>;
    deleteAlarm(className: string, id: string): Promise<void>;
  };
};

export type TriggerMode = "exact" | "contains" | "starts" | "regex";

export type WorkflowStep = {
  id: string;
  trigger: string;
  mode: TriggerMode;
  caseSensitive: boolean;
  reply: string;
  delayMs: number;
  timeoutMs: number;
  loopTo: number | null;
};

export type Workflow = {
  id: string;
  name: string;
  target: string;
  enabled: boolean;
  steps: WorkflowStep[];
  createdAt: number;
  updatedAt: number;
};

export type Settings = {
  killSwitch: boolean;
  minGapMs: number;
  perMinuteCap: number;
  dedupeWindowMs: number;
  autoPauseOnFlood: boolean;
};

type LinkMode = "none" | "bot";

type LinkState = {
  mode: LinkMode;
  status: "offline" | "connecting" | "online" | "paused" | "error";
  identity: string | null;
  since: number | null;
  lastEventAt: number | null;
  detail: string | null;
  pausedUntil: number | null;
};

const DEFAULT_SETTINGS: Settings = {
  killSwitch: false,
  minGapMs: 1500,
  perMinuteCap: 20,
  dedupeWindowMs: 60_000,
  autoPauseOnFlood: true,
};

const WATCHDOG_MS = 60_000;
const MAX_EVENTS = 4000;

type EventLevel = "info" | "success" | "warn" | "error";

/**
 * Always-on automation engine. Owns persistent state (workflows, runtime
 * positions, logs, retry queue), the Telegram link, and a watchdog alarm that
 * keeps everything alive with zero inbound traffic.
 */
export class AutomationEngine extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const sql = this.ctx.storage.sql;
    sql.exec(`CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL)`);
    sql.exec(`CREATE TABLE IF NOT EXISTS workflows (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, target TEXT NOT NULL,
      enabled INTEGER NOT NULL, steps TEXT NOT NULL,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    )`);
    sql.exec(`CREATE TABLE IF NOT EXISTS runtime (
      chat_key TEXT PRIMARY KEY, workflow_id TEXT NOT NULL,
      step_index INTEGER NOT NULL, updated_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
    )`);
    sql.exec(`CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, level TEXT NOT NULL,
      type TEXT NOT NULL, workflow_id TEXT, chat_key TEXT, detail TEXT NOT NULL
    )`);
    sql.exec(`CREATE TABLE IF NOT EXISTS failed_jobs (
      id TEXT PRIMARY KEY, ts INTEGER NOT NULL, workflow_id TEXT, chat_key TEXT NOT NULL,
      reason TEXT NOT NULL, payload TEXT NOT NULL, attempts INTEGER NOT NULL, status TEXT NOT NULL
    )`);
    sql.exec(`CREATE TABLE IF NOT EXISTS dedupe (h TEXT PRIMARY KEY, ts INTEGER NOT NULL)`);
    sql.exec(`CREATE TABLE IF NOT EXISTS sends (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL)`);
  }

  // ---------------------------------------------------------------- storage

  private kvGet<T>(key: string, fallback: T): T {
    const row = this.ctx.storage.sql
      .exec<{ v: string }>("SELECT v FROM kv WHERE k = ?", key)
      .toArray()[0];
    if (!row) return fallback;
    try {
      return JSON.parse(row.v) as T;
    } catch {
      return fallback;
    }
  }

  private kvPut(key: string, value: unknown): void {
    this.ctx.storage.sql.exec(
      "INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v",
      key,
      JSON.stringify(value),
    );
  }

  private settings(): Settings {
    return { ...DEFAULT_SETTINGS, ...this.kvGet<Partial<Settings>>("settings", {}) };
  }

  private link(): LinkState {
    return this.kvGet<LinkState>("link", {
      mode: "none",
      status: "offline",
      identity: null,
      since: null,
      lastEventAt: null,
      detail: null,
      pausedUntil: null,
    });
  }

  private setLink(patch: Partial<LinkState>): LinkState {
    const next = { ...this.link(), ...patch };
    this.kvPut("link", next);
    return next;
  }

  private workflows(): Workflow[] {
    return this.ctx.storage.sql
      .exec<{
        id: string; name: string; target: string; enabled: number;
        steps: string; created_at: number; updated_at: number;
      }>("SELECT * FROM workflows ORDER BY created_at DESC")
      .toArray()
      .map((r) => ({
        id: r.id,
        name: r.name,
        target: r.target,
        enabled: r.enabled === 1,
        steps: JSON.parse(r.steps) as WorkflowStep[],
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      }));
  }

  // ------------------------------------------------------------------ logs

  private log(
    level: EventLevel,
    type: string,
    detail: string,
    workflowId?: string | null,
    chatKey?: string | null,
  ): void {
    const ts = Date.now();
    this.ctx.storage.sql.exec(
      "INSERT INTO events (ts, level, type, workflow_id, chat_key, detail) VALUES (?, ?, ?, ?, ?, ?)",
      ts,
      level,
      type,
      workflowId ?? null,
      chatKey ?? null,
      detail,
    );
    this.broadcast({ kind: "event", event: { ts, level, type, workflowId: workflowId ?? null, chatKey: chatKey ?? null, detail } });
  }

  private pruneEvents(): void {
    this.ctx.storage.sql.exec(
      "DELETE FROM events WHERE id NOT IN (SELECT id FROM events ORDER BY id DESC LIMIT ?)",
      MAX_EVENTS,
    );
  }

  private broadcast(payload: unknown): void {
    const text = JSON.stringify(payload);
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(text);
      } catch {
        try {
          ws.close(1011, "send failed");
        } catch {
          /* peer already gone */
        }
      }
    }
  }

  // ------------------------------------------------------------------ auth

  /** Length-and-content comparison that does not short-circuit on first mismatch. */
  private safeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
  }

  private tokenValid(request: Request): boolean {
    const token = this.kvGet<string | null>("token", null);
    if (!token) return false;
    const header = request.headers.get("Authorization") ?? "";
    const query = new URL(request.url).searchParams.get("token") ?? "";
    return this.safeEqual(header, `Bearer ${token}`) || this.safeEqual(query, token);
  }

  private async hash(input: string): Promise<string> {
    const bytes = new TextEncoder().encode(input);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  // --------------------------------------------------------------- routing

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    const origin = request.headers.get("X-Public-Origin");
    if (origin && this.kvGet<string | null>("publicOrigin", null) !== origin) {
      this.kvPut("publicOrigin", origin);
    }

    if (path === "/stream" && request.headers.get("Upgrade") === "websocket") {
      if (!this.tokenValid(request)) return new Response("unauthorized", { status: 401 });
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
      this.ctx.acceptWebSocket(server);
      this.ctx.waitUntil(this.ensureWatchdog());
      return new Response(null, { status: 101, webSocket: client });
    }

    if (path === "/webhook" && request.method === "POST") {
      return this.handleWebhook(request);
    }

    if (path === "/auth" && request.method === "POST") {
      return this.handleAuth(request);
    }

    if (!this.tokenValid(request)) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }

    switch (path) {
      case "/state":
        return Response.json(await this.snapshot());
      case "/settings":
        return this.handleSettings(request);
      case "/workflow":
        return this.handleWorkflow(request);
      case "/workflow/delete":
        return this.handleWorkflowDelete(request);
      case "/link/connect":
        return this.handleConnect(request);
      case "/link/disconnect":
        return this.handleDisconnect();
      case "/logs":
        return Response.json({ events: this.readEvents(Number(url.searchParams.get("limit") ?? 200)) });
      case "/job/retry":
        return this.handleRetry(request);
      case "/simulate":
        return this.handleSimulate(request);
      default:
        return Response.json({ error: "not found" }, { status: 404 });
    }
  }

  override webSocketMessage(ws: WebSocket): void {
    try {
      ws.send(JSON.stringify({ kind: "pong", ts: Date.now() }));
    } catch {
      /* peer gone */
    }
  }

  override webSocketClose(): void {
    /* hibernation-managed: the runtime owns socket teardown */
  }

  override webSocketError(): void {
    /* hibernation-managed: the runtime owns socket teardown */
  }

  // ----------------------------------------------------------------- auth

  private async handleAuth(request: Request): Promise<Response> {
    const now = Date.now();
    const guard = this.kvGet<{ fails: number; lockedUntil: number }>("authGuard", { fails: 0, lockedUntil: 0 });
    if (guard.lockedUntil > now) {
      const seconds = Math.ceil((guard.lockedUntil - now) / 1000);
      return Response.json({ error: `Too many attempts. Try again in ${seconds}s.` }, { status: 429 });
    }

    const body = (await request.json().catch(() => ({}))) as { passcode?: string };
    const passcode = (body.passcode ?? "").trim();
    if (passcode.length < 6) {
      return Response.json({ error: "Passcode must be at least 6 characters." }, { status: 400 });
    }
    const stored = this.kvGet<string | null>("passcode", null);
    const digest = await this.hash(passcode);

    if (!stored) {
      this.kvPut("passcode", digest);
      const token = crypto.randomUUID().replace(/-/g, "");
      this.kvPut("token", token);
      this.log("success", "console.claim", "Console claimed and owner passcode set.");
      await this.ensureWatchdog();
      return Response.json({ token, claimed: true });
    }

    if (!this.safeEqual(stored, digest)) {
      const fails = guard.fails + 1;
      const lockedUntil = fails >= 5 ? now + 60_000 : 0;
      this.kvPut("authGuard", { fails: lockedUntil > 0 ? 0 : fails, lockedUntil });
      this.log("warn", "console.denied", "Rejected sign-in attempt with a bad passcode.");
      return Response.json({ error: "Incorrect passcode." }, { status: 403 });
    }

    this.kvPut("authGuard", { fails: 0, lockedUntil: 0 });
    let token = this.kvGet<string | null>("token", null);
    if (!token) {
      token = crypto.randomUUID().replace(/-/g, "");
      this.kvPut("token", token);
    }
    await this.ensureWatchdog();
    return Response.json({ token, claimed: false });
  }

  // ------------------------------------------------------------- snapshot

  private readEvents(requested: number): unknown[] {
    const limit = Number.isFinite(requested) ? Math.max(1, Math.min(Math.floor(requested), 1000)) : 200;
    return this.ctx.storage.sql
      .exec<{
        ts: number; level: string; type: string;
        workflow_id: string | null; chat_key: string | null; detail: string;
      }>("SELECT ts, level, type, workflow_id, chat_key, detail FROM events ORDER BY id DESC LIMIT ?", limit)
      .toArray()
      .map((r) => ({
        ts: r.ts,
        level: r.level,
        type: r.type,
        workflowId: r.workflow_id,
        chatKey: r.chat_key,
        detail: r.detail,
      }));
  }

  private async snapshot(): Promise<unknown> {
    const workflows = this.workflows();
    const dayAgo = Date.now() - 86_400_000;
    const sentToday = this.ctx.storage.sql
      .exec<{ n: number }>("SELECT COUNT(*) AS n FROM sends WHERE ts > ?", dayAgo)
      .toArray()[0]?.n ?? 0;
    const jobs = this.ctx.storage.sql
      .exec<{
        id: string; ts: number; workflow_id: string | null; chat_key: string;
        reason: string; payload: string; attempts: number; status: string;
      }>("SELECT * FROM failed_jobs ORDER BY ts DESC LIMIT 100")
      .toArray()
      .map((r) => ({
        id: r.id,
        ts: r.ts,
        workflowId: r.workflow_id,
        chatKey: r.chat_key,
        reason: r.reason,
        attempts: r.attempts,
        status: r.status,
      }));
    const active = this.ctx.storage.sql
      .exec<{ n: number }>("SELECT COUNT(*) AS n FROM runtime WHERE expires_at > ?", Date.now())
      .toArray()[0]?.n ?? 0;

    return {
      link: this.link(),
      settings: this.settings(),
      workflows,
      events: this.readEvents(150),
      jobs,
      stats: {
        sentToday,
        activeConversations: active,
        workflowCount: workflows.length,
        webhookPath: this.kvGet<string | null>("webhookSecret", null),
      },
    };
  }

  // ------------------------------------------------------------- settings

  private async handleSettings(request: Request): Promise<Response> {
    const previous = this.settings();
    const patch = (await request.json().catch(() => ({}))) as Partial<Settings>;
    const next: Settings = { ...previous, ...patch };
    next.killSwitch = Boolean(next.killSwitch);
    next.autoPauseOnFlood = Boolean(next.autoPauseOnFlood);
    next.minGapMs = Math.max(0, Math.min(Number(next.minGapMs) || 0, 600_000));
    next.perMinuteCap = Math.max(1, Math.min(Number(next.perMinuteCap) || 1, 60));
    next.dedupeWindowMs = Math.max(0, Math.min(Number(next.dedupeWindowMs) || 0, 3_600_000));
    this.kvPut("settings", next);

    if (next.killSwitch !== previous.killSwitch) {
      this.log(
        next.killSwitch ? "warn" : "success",
        "settings.kill",
        next.killSwitch
          ? "Global kill switch engaged — all sending halted."
          : "Kill switch released — sending resumed.",
      );
    } else {
      this.log("info", "settings.update", "Safety settings updated.");
    }
    this.broadcast({ kind: "settings", settings: next });
    return Response.json({ settings: next });
  }

  // ------------------------------------------------------------ workflows

  /** Normalise and hard-validate a step so a malformed one can never wedge the engine. */
  private sanitizeStep(raw: Partial<WorkflowStep>, index: number): WorkflowStep | { error: string } {
    const modes: TriggerMode[] = ["exact", "contains", "starts", "regex"];
    const trigger = String(raw.trigger ?? "").slice(0, 400).trim();
    const reply = String(raw.reply ?? "").slice(0, 4096).trim();
    if (trigger.length === 0) return { error: `Step ${index + 1} needs a trigger.` };
    if (reply.length === 0) return { error: `Step ${index + 1} needs a reply.` };

    const mode: TriggerMode = modes.includes(raw.mode as TriggerMode) ? (raw.mode as TriggerMode) : "contains";
    if (mode === "regex") {
      try {
        new RegExp(trigger);
      } catch {
        return { error: `Step ${index + 1} has an invalid pattern.` };
      }
    }

    const loop = typeof raw.loopTo === "number" && raw.loopTo >= 0 ? Math.floor(raw.loopTo) : null;
    return {
      id: typeof raw.id === "string" && raw.id.length > 0 ? raw.id.slice(0, 64) : crypto.randomUUID(),
      trigger,
      mode,
      caseSensitive: Boolean(raw.caseSensitive),
      reply,
      delayMs: Math.max(0, Math.min(Number(raw.delayMs) || 0, 300_000)),
      timeoutMs: Math.max(10_000, Math.min(Number(raw.timeoutMs) || 300_000, 86_400_000)),
      loopTo: loop,
    };
  }

  private async handleWorkflow(request: Request): Promise<Response> {
    const wf = (await request.json().catch(() => null)) as Workflow | null;
    if (!wf || typeof wf.name !== "string" || !Array.isArray(wf.steps)) {
      return Response.json({ error: "Invalid workflow payload." }, { status: 400 });
    }
    if (wf.name.trim().length === 0) {
      return Response.json({ error: "Give the workflow a name." }, { status: 400 });
    }
    if (wf.steps.length === 0) {
      return Response.json({ error: "A workflow needs at least one step." }, { status: 400 });
    }

    const steps: WorkflowStep[] = [];
    for (const [index, raw] of wf.steps.slice(0, 40).entries()) {
      const result = this.sanitizeStep(raw, index);
      if ("error" in result) return Response.json({ error: result.error }, { status: 400 });
      steps.push(result);
    }

    const now = Date.now();
    const id = wf.id && wf.id.length > 0 ? wf.id : crypto.randomUUID();
    const existing = this.ctx.storage.sql
      .exec<{ created_at: number }>("SELECT created_at FROM workflows WHERE id = ?", id)
      .toArray()[0];

    this.ctx.storage.sql.exec(
      `INSERT INTO workflows (id, name, target, enabled, steps, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name, target = excluded.target, enabled = excluded.enabled,
         steps = excluded.steps, updated_at = excluded.updated_at`,
      id,
      wf.name.trim().slice(0, 80),
      (wf.target ?? "").trim().slice(0, 80),
      wf.enabled ? 1 : 0,
      JSON.stringify(steps),
      existing?.created_at ?? now,
      now,
    );
    this.log("info", "workflow.save", `Workflow "${wf.name.trim()}" saved with ${steps.length} step(s).`, id);
    this.broadcast({ kind: "workflows", workflows: this.workflows() });
    return Response.json({ workflows: this.workflows() });
  }

  private async handleWorkflowDelete(request: Request): Promise<Response> {
    const { id } = (await request.json().catch(() => ({}))) as { id?: string };
    if (!id) return Response.json({ error: "Missing id." }, { status: 400 });
    this.ctx.storage.sql.exec("DELETE FROM workflows WHERE id = ?", id);
    this.ctx.storage.sql.exec("DELETE FROM runtime WHERE workflow_id = ?", id);
    this.log("warn", "workflow.delete", "Workflow deleted.", id);
    this.broadcast({ kind: "workflows", workflows: this.workflows() });
    return Response.json({ workflows: this.workflows() });
  }

  // ----------------------------------------------------------------- link

  private async handleConnect(request: Request): Promise<Response> {
    const body = (await request.json().catch(() => ({}))) as { mode?: LinkMode; botToken?: string };
    if (body.mode !== "bot") {
      return Response.json({ error: "Unsupported link mode." }, { status: 400 });
    }
    const token = (body.botToken ?? "").trim();
    if (!/^\d+:[\w-]{20,}$/.test(token)) {
      return Response.json({ error: "That does not look like a bot token." }, { status: 400 });
    }

    this.setLink({ mode: "bot", status: "connecting", detail: "Verifying token with Telegram…" });
    this.broadcast({ kind: "link", link: this.link() });

    const me = await fetch(`https://api.telegram.org/bot${token}/getMe`).then(
      (r) => r.json() as Promise<{ ok: boolean; result?: { username?: string }; description?: string }>,
    ).catch(() => null);

    if (!me?.ok) {
      const detail = me?.description ?? "Telegram rejected the token.";
      this.setLink({ status: "error", detail });
      this.log("error", "link.error", `Connection failed: ${detail}`);
      this.broadcast({ kind: "link", link: this.link() });
      return Response.json({ error: detail }, { status: 400 });
    }

    let secret = this.kvGet<string | null>("webhookSecret", null);
    if (!secret) {
      secret = crypto.randomUUID().replace(/-/g, "");
      this.kvPut("webhookSecret", secret);
    }
    this.kvPut("botToken", token);

    const origin = this.kvGet<string | null>("publicOrigin", null);
    if (!origin) {
      const detail = "Could not determine this engine's public address.";
      this.setLink({ status: "error", detail });
      this.log("error", "link.error", detail);
      this.broadcast({ kind: "link", link: this.link() });
      return Response.json({ error: detail }, { status: 500 });
    }

    // A silent webhook failure would leave the console claiming "online" while
    // nothing ever arrives, so the result is checked rather than fire-and-forget.
    const hook = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: `${origin}/tg/${secret}`,
        allowed_updates: ["message"],
        drop_pending_updates: true,
      }),
    })
      .then((r) => r.json() as Promise<{ ok: boolean; description?: string }>)
      .catch(() => null);

    if (!hook?.ok) {
      const detail = hook?.description ?? "Telegram would not accept the webhook address.";
      this.setLink({ status: "error", detail });
      this.log("error", "link.error", `Webhook registration failed: ${detail}`);
      this.broadcast({ kind: "link", link: this.link() });
      return Response.json({ error: detail }, { status: 400 });
    }

    const identity = me.result?.username ? `@${me.result.username}` : "connected";
    this.setLink({
      mode: "bot",
      status: "online",
      identity,
      since: Date.now(),
      detail: "Live webhook link established.",
      pausedUntil: null,
    });
    this.log("success", "link.online", `Telegram link online as ${identity}.`);
    this.broadcast({ kind: "link", link: this.link() });
    await this.ensureWatchdog();
    return Response.json({ link: this.link() });
  }

  private async handleDisconnect(): Promise<Response> {
    const token = this.kvGet<string | null>("botToken", null);
    if (token) {
      await fetch(`https://api.telegram.org/bot${token}/deleteWebhook`).catch(() => null);
    }
    this.setLink({ status: "offline", identity: null, since: null, detail: "Emergency disconnect." });
    this.log("warn", "link.offline", "Emergency disconnect — link dropped by operator.");
    this.broadcast({ kind: "link", link: this.link() });
    return Response.json({ link: this.link() });
  }

  // -------------------------------------------------------------- ingress

  private async handleWebhook(request: Request): Promise<Response> {
    const secret = this.kvGet<string | null>("webhookSecret", null);
    const provided = new URL(request.url).searchParams.get("s");
    if (!secret || provided !== secret) return new Response("no", { status: 403 });

    const update = (await request.json().catch(() => null)) as {
      message?: { text?: string; chat?: { id?: number; username?: string }; from?: { username?: string } };
    } | null;

    const text = update?.message?.text;
    const chatId = update?.message?.chat?.id;
    if (typeof text === "string" && typeof chatId === "number") {
      const from = update?.message?.from?.username ?? update?.message?.chat?.username ?? String(chatId);
      this.ctx.waitUntil(this.ingest(String(chatId), from, text));
    }
    return Response.json({ ok: true });
  }

  private async handleSimulate(request: Request): Promise<Response> {
    const body = (await request.json().catch(() => ({}))) as { chatKey?: string; from?: string; text?: string };
    const text = (body.text ?? "").trim();
    if (text.length === 0) return Response.json({ error: "Missing text." }, { status: 400 });
    // Pacing can hold a reply for up to a minute; that must not hold the HTTP
    // response open, so the run continues on the engine's own clock.
    this.ctx.waitUntil(this.ingest(body.chatKey ?? "sim-console", body.from ?? "simulator", text));
    return Response.json({ ok: true });
  }

  // ---------------------------------------------------------------- engine

  private matches(step: WorkflowStep, text: string): boolean {
    const haystack = step.caseSensitive ? text : text.toLowerCase();
    const needle = step.caseSensitive ? step.trigger : step.trigger.toLowerCase();
    if (needle.length === 0 || needle.length > 400) return false;
    switch (step.mode) {
      case "exact":
        return haystack.trim() === needle.trim();
      case "contains":
        return haystack.includes(needle);
      case "starts":
        return haystack.startsWith(needle);
      case "regex":
        try {
          return new RegExp(step.trigger, step.caseSensitive ? "" : "i").test(text);
        } catch {
          return false;
        }
      default:
        return false;
    }
  }

  /** Core reactive path: an inbound message becomes at most one outbound reply. */
  private async ingest(chatKey: string, from: string, text: string): Promise<void> {
    const settings = this.settings();
    const link = this.link();
    this.setLink({ lastEventAt: Date.now() });

    if (settings.killSwitch) {
      this.log("warn", "skip.kill", "Message ignored — global kill switch is on.", null, chatKey);
      return;
    }
    if (link.pausedUntil && link.pausedUntil > Date.now()) {
      this.log("warn", "skip.paused", "Message ignored — link paused after a Telegram slow-down.", null, chatKey);
      return;
    }

    const fingerprint = await this.hash(`${chatKey}:${text}`);
    this.ctx.storage.sql.exec("DELETE FROM dedupe WHERE ts < ?", Date.now() - settings.dedupeWindowMs);
    const dup = this.ctx.storage.sql
      .exec<{ h: string }>("SELECT h FROM dedupe WHERE h = ?", fingerprint)
      .toArray()[0];
    if (dup) {
      this.log("warn", "skip.duplicate", "Duplicate message inside the dedupe window — no reply sent.", null, chatKey);
      return;
    }

    const now = Date.now();
    this.ctx.storage.sql.exec("DELETE FROM runtime WHERE expires_at <= ?", now);
    const position = this.ctx.storage.sql
      .exec<{ workflow_id: string; step_index: number }>(
        "SELECT workflow_id, step_index FROM runtime WHERE chat_key = ?",
        chatKey,
      )
      .toArray()[0];

    const all = this.workflows().filter((w) => w.enabled);
    const scoped = all.filter((w) => {
      const t = w.target.trim().replace(/^@/, "").toLowerCase();
      if (t.length === 0) return true;
      return t === from.replace(/^@/, "").toLowerCase() || t === chatKey;
    });

    let workflow: Workflow | undefined;
    let stepIndex = 0;

    if (position) {
      const held = scoped.find((w) => w.id === position.workflow_id);
      if (held && held.steps[position.step_index] && this.matches(held.steps[position.step_index], text)) {
        workflow = held;
        stepIndex = position.step_index;
      }
    }

    if (!workflow) {
      for (const candidate of scoped) {
        if (candidate.steps[0] && this.matches(candidate.steps[0], text)) {
          workflow = candidate;
          stepIndex = 0;
          break;
        }
      }
    }

    if (!workflow) {
      this.log("info", "match.none", `No workflow step matched a message from ${from}.`, null, chatKey);
      return;
    }

    const step = workflow.steps[stepIndex];
    this.ctx.storage.sql.exec(
      "INSERT INTO dedupe (h, ts) VALUES (?, ?) ON CONFLICT(h) DO UPDATE SET ts = excluded.ts",
      fingerprint,
      now,
    );
    this.log("info", "match.hit", `Matched "${workflow.name}" step ${stepIndex + 1} (${step.mode}).`, workflow.id, chatKey);

    const slot = this.reserveSlot(settings, step.delayMs);
    if ("blocked" in slot) {
      this.queueJob(workflow.id, chatKey, slot.blocked, { text: step.reply });
      this.log("warn", "limit.cap", `${slot.blocked} — reply held in the retry queue.`, workflow.id, chatKey);
      this.broadcast({ kind: "refresh" });
      return;
    }

    const wait = Math.min(Math.max(0, slot.at - Date.now()), 60_000);
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));

    const ok = await this.send(chatKey, step.reply, workflow.id, slot.id);
    if (!ok) return;

    const nextIndex = step.loopTo !== null && step.loopTo >= 0 ? step.loopTo : stepIndex + 1;
    if (nextIndex < workflow.steps.length) {
      this.ctx.storage.sql.exec(
        `INSERT INTO runtime (chat_key, workflow_id, step_index, updated_at, expires_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(chat_key) DO UPDATE SET
           workflow_id = excluded.workflow_id, step_index = excluded.step_index,
           updated_at = excluded.updated_at, expires_at = excluded.expires_at`,
        chatKey,
        workflow.id,
        nextIndex,
        Date.now(),
        Date.now() + Math.max(step.timeoutMs, 10_000),
      );
      this.log("info", "step.advance", `Conversation advanced to step ${nextIndex + 1}.`, workflow.id, chatKey);
    } else {
      this.ctx.storage.sql.exec("DELETE FROM runtime WHERE chat_key = ?", chatKey);
      this.log("success", "workflow.complete", `Workflow "${workflow.name}" completed.`, workflow.id, chatKey);
    }
    await this.ensureWatchdog();
  }

  /**
   * Claim the next permitted send time and persist the claim immediately. Writing
   * the reservation *before* the pacing await is what stops two messages arriving
   * together from both passing the gap check and bursting past the limits.
   */
  private reserveSlot(settings: Settings, delayMs: number): { id: number; at: number } | { blocked: string } {
    const sql = this.ctx.storage.sql;
    const now = Date.now();
    sql.exec("DELETE FROM sends WHERE ts < ?", now - 172_800_000);

    const recent = sql
      .exec<{ n: number }>("SELECT COUNT(*) AS n FROM sends WHERE ts > ?", now - 60_000)
      .toArray()[0]?.n ?? 0;
    if (recent >= settings.perMinuteCap) {
      return { blocked: `Per-minute send cap (${settings.perMinuteCap}) reached` };
    }

    const last = sql.exec<{ ts: number }>("SELECT ts FROM sends ORDER BY ts DESC LIMIT 1").toArray()[0];
    const earliest = now + Math.max(0, Math.min(delayMs, 300_000));
    const at = Math.max(earliest, (last?.ts ?? 0) + settings.minGapMs);

    sql.exec("INSERT INTO sends (ts) VALUES (?)", at);
    const id = sql.exec<{ id: number }>("SELECT last_insert_rowid() AS id").toArray()[0]?.id ?? 0;
    return { id, at };
  }

  private releaseSlot(slotId: number): void {
    this.ctx.storage.sql.exec("DELETE FROM sends WHERE id = ?", slotId);
  }

  private async send(chatKey: string, text: string, workflowId: string, slotId: number): Promise<boolean> {
    const link = this.link();
    const token = this.kvGet<string | null>("botToken", null);

    // Re-checked at the moment of sending: the operator may have hit Halt or
    // Disconnect while this reply was waiting out its pacing delay.
    if (this.settings().killSwitch) {
      this.releaseSlot(slotId);
      this.log("warn", "skip.kill", "Reply dropped — kill switch engaged while it was waiting.", workflowId, chatKey);
      return false;
    }

    if (!token || link.mode === "none" || link.status === "offline") {
      this.releaseSlot(slotId);
      this.queueJob(workflowId, chatKey, "Telegram link is disconnected", { text });
      this.log("error", "send.fail", "Reply not sent — the Telegram link is disconnected. Held for replay.", workflowId, chatKey);
      this.broadcast({ kind: "refresh" });
      return false;
    }

    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatKey, text }),
    })
      .then((r) => r.json() as Promise<{ ok: boolean; description?: string; parameters?: { retry_after?: number } }>)
      .catch(() => null);

    if (!res?.ok) {
      const retryAfter = res?.parameters?.retry_after;
      if (retryAfter && this.settings().autoPauseOnFlood) {
        const until = Date.now() + retryAfter * 1000;
        this.setLink({ status: "paused", pausedUntil: until, detail: `Telegram asked us to slow down for ${retryAfter}s.` });
        this.log("warn", "limit.flood", `Telegram slow-down for ${retryAfter}s — link paused and will auto-resume.`, workflowId, chatKey);
        this.broadcast({ kind: "link", link: this.link() });
      }
      const reason = res?.description ?? "Telegram send failed";
      this.releaseSlot(slotId);
      this.queueJob(workflowId, chatKey, reason, { text });
      this.log("error", "send.fail", `Send failed: ${reason}`, workflowId, chatKey);
      this.broadcast({ kind: "refresh" });
      return false;
    }

    this.setLink({ lastEventAt: Date.now() });
    this.log("success", "send.ok", `Reply delivered (${text.length} chars).`, workflowId, chatKey);
    this.broadcast({ kind: "refresh" });
    return true;
  }

  private queueJob(workflowId: string | null, chatKey: string, reason: string, payload: unknown): void {
    this.ctx.storage.sql.exec(
      "INSERT INTO failed_jobs (id, ts, workflow_id, chat_key, reason, payload, attempts, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      crypto.randomUUID(),
      Date.now(),
      workflowId,
      chatKey,
      reason,
      JSON.stringify(payload),
      0,
      "pending",
    );
  }

  private async handleRetry(request: Request): Promise<Response> {
    const { id } = (await request.json().catch(() => ({}))) as { id?: string };
    if (!id) return Response.json({ error: "Missing id." }, { status: 400 });
    const job = this.ctx.storage.sql
      .exec<{
        id: string; workflow_id: string | null; chat_key: string;
        payload: string; attempts: number; status: string;
      }>(
        "SELECT * FROM failed_jobs WHERE id = ?",
        id,
      )
      .toArray()[0];
    if (!job) return Response.json({ error: "Job not found." }, { status: 404 });
    if (job.status === "resolved") {
      return Response.json({ error: "That job was already replayed." }, { status: 409 });
    }

    // Replays go through the same pacing gate as live traffic.
    const slot = this.reserveSlot(this.settings(), 0);
    if ("blocked" in slot) return Response.json({ error: slot.blocked }, { status: 429 });
    const wait = Math.min(Math.max(0, slot.at - Date.now()), 60_000);
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));

    const payload = JSON.parse(job.payload) as { text?: string };
    const ok = await this.send(job.chat_key, payload.text ?? "", job.workflow_id ?? "", slot.id);
    this.ctx.storage.sql.exec(
      "UPDATE failed_jobs SET attempts = ?, status = ? WHERE id = ?",
      job.attempts + 1,
      ok ? "resolved" : "pending",
      id,
    );
    this.log(ok ? "success" : "error", "job.retry", ok ? "Queued job replayed successfully." : "Replay failed again.", job.workflow_id, job.chat_key);
    return Response.json(await this.snapshot());
  }

  // -------------------------------------------------------------- watchdog

  private async ensureWatchdog(): Promise<void> {
    const pending = await this.env.DO.getAlarm("AutomationEngine", this.ctx.id.name ?? "primary").catch(() => null);
    if (pending === null || pending === undefined) {
      await this.env.DO
        .setAlarm("AutomationEngine", this.ctx.id.name ?? "primary", Date.now() + WATCHDOG_MS)
        .catch(() => undefined);
    }
  }

  /** Runs every minute with zero inbound traffic — this is what "always-on" means. */
  async onAlarm(): Promise<void> {
    const now = Date.now();
    const link = this.link();

    if (link.pausedUntil && link.pausedUntil <= now) {
      this.setLink({ status: "online", pausedUntil: null, detail: "Slow-down expired — sending resumed." });
      this.log("success", "link.resume", "Telegram slow-down expired — automation resumed.");
      this.broadcast({ kind: "link", link: this.link() });
    }

    const expired = this.ctx.storage.sql
      .exec<{ chat_key: string; workflow_id: string }>(
        "SELECT chat_key, workflow_id FROM runtime WHERE expires_at <= ?",
        now,
      )
      .toArray();
    for (const row of expired) {
      this.log("warn", "step.timeout", "Conversation timed out waiting for the next message.", row.workflow_id, row.chat_key);
    }
    this.ctx.storage.sql.exec("DELETE FROM runtime WHERE expires_at <= ?", now);
    this.ctx.storage.sql.exec("DELETE FROM dedupe WHERE ts < ?", now - this.settings().dedupeWindowMs);
    this.pruneEvents();

    if (link.mode === "bot" && link.status === "online") {
      const token = this.kvGet<string | null>("botToken", null);
      if (token) {
        const info = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`)
          .then((r) => r.json() as Promise<{ ok: boolean; result?: { url?: string } }>)
          .catch(() => null);
        const origin = this.kvGet<string | null>("publicOrigin", null);
        const secret = this.kvGet<string | null>("webhookSecret", null);
        const expected = origin && secret ? `${origin}/tg/${secret}` : null;
        if (info?.ok && expected && info.result?.url !== expected) {
          await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url: expected, allowed_updates: ["message"] }),
          }).catch(() => null);
          this.log("warn", "link.repair", "Webhook drifted — watchdog re-registered it automatically.");
        }
      }
    }

    this.broadcast({ kind: "heartbeat", ts: now, link: this.link() });
    await this.env.DO
      .setAlarm("AutomationEngine", this.ctx.id.name ?? "primary", now + WATCHDOG_MS)
      .catch(() => undefined);
  }

}
