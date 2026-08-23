/**
 * The reserved owner username. Claiming it requires proof of the existing console
 * passcode, and it inherits the original tenant, so nothing has to be migrated.
 */
export const OWNER_USERNAME = "zuperman";
/** The Durable Object that already holds every flow, log and setting built so far. */
export const OWNER_TENANT_ID = "primary";

const SESSION_TTL_MS = 30 * 86_400_000;
/** Each live Telegram session is a real supervised process, so the ceiling is honest. */
const MAX_LIVE_CONNECTIONS = 5;
/** Screenshot import runs on paid AI credits, so it is metered per account per month. */
const AI_IMPORTS_PER_MONTH = 20;
/** A live slot is surrendered when its account has not been seen for this long. */
const SLOT_STALE_MS = 7 * 86_400_000;
const MAX_SIGNUPS_PER_HOUR = 12;
/** Name lookups are cheap, but not free: a sweep of the whole namespace is refused. */
const MAX_LOOKUPS_PER_HOUR = 600;
/** The most this runtime accepts in a single PBKDF2 call. */
const PBKDF2_ITERATIONS = 100_000;
/** Chained rounds, so the total cost is 200k without exceeding the per-call cap. */
const PBKDF2_ROUNDS = 2;

export type AccountRole = "owner" | "member";
export type AccountStatus = "active" | "suspended";

export type AccountIdentity = {
  id: string;
  username: string;
  role: AccountRole;
  status: AccountStatus;
  tenantId: string;
  createdAt: number;
};

/**
 * The answer to "can I have this name?". `reserved` means the owner name is still
 * unclaimed and can be taken by proving the old console passcode; once claimed it
 * reads as `taken` like any other. `unknown` is returned when the lookup budget is
 * spent, so the form simply stays quiet rather than guessing.
 */
export type AvailabilityState = "available" | "taken" | "reserved" | "invalid" | "unknown";
export type AvailabilityView = { state: AvailabilityState; detail: string };

export type AllowanceView = { used: number; limit: number; remaining: number; period: string };
export type CapacityView = {
  live: boolean;
  granted: boolean;
  position: number | null;
  activeCount: number;
  limit: number;
  queueLength: number;
};

export type AccountView = AccountIdentity & { allowance: AllowanceView; capacity: CapacityView };

export type OwnerOverview = {
  accounts: number;
  active: number;
  suspended: number;
  connected: number;
  queued: number;
  capacityLimit: number;
  rows: Array<{
    id: string;
    username: string;
    role: AccountRole;
    status: AccountStatus;
    createdAt: number;
    lastSeenAt: number | null;
    live: boolean;
    queued: boolean;
    aiUsed: number;
  }>;
};

type AccountRow = {
  id: string;
  username: string;
  username_lower: string;
  salt: string;
  hash: string;
  role: AccountRole;
  status: AccountStatus;
  tenant_id: string;
  created_at: number;
  last_seen_at: number | null;
};

function periodKey(now: number): string {
  const date = new Date(now);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * The account registry: who exists, who is signed in, who holds a live connection
 * slot and how much of the monthly AI allowance each account has spent. It never
 * stores flows, messages or Telegram material — those live in each tenant engine.
 *
 * It runs inside one dedicated engine instance rather than a class of its own, so
 * the platform only ever has a single Durable Object class to know about.
 */
export class AccountRegistry {
  private readonly sql: SqlStorage;

  constructor(sql: SqlStorage) {
    this.sql = sql;
    sql.exec(`CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY, username TEXT NOT NULL, username_lower TEXT NOT NULL UNIQUE,
      salt TEXT NOT NULL, hash TEXT NOT NULL, role TEXT NOT NULL, status TEXT NOT NULL,
      tenant_id TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL, last_seen_at INTEGER
    )`);
    sql.exec(`CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY, account_id TEXT NOT NULL,
      created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
    )`);
    sql.exec(`CREATE TABLE IF NOT EXISTS allowance (
      account_id TEXT NOT NULL, period TEXT NOT NULL, kind TEXT NOT NULL,
      used INTEGER NOT NULL, PRIMARY KEY (account_id, period, kind)
    )`);
    sql.exec(`CREATE TABLE IF NOT EXISTS slots (
      account_id TEXT PRIMARY KEY, state TEXT NOT NULL, requested_at INTEGER NOT NULL, renewed_at INTEGER NOT NULL
    )`);
    sql.exec("CREATE TABLE IF NOT EXISTS guard (k TEXT PRIMARY KEY, v TEXT NOT NULL)");
  }

  private hex(bytes: Uint8Array): string {
    return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  private base64(bytes: Uint8Array): string {
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  private fromBase64(value: string): Uint8Array {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
    return Uint8Array.from(atob(normalized), (char) => char.charCodeAt(0));
  }

  private safeEqual(a: string, b: string): boolean {
    const length = Math.max(a.length, b.length);
    let diff = a.length ^ b.length;
    for (let index = 0; index < length; index += 1) diff |= (a.charCodeAt(index) || 0) ^ (b.charCodeAt(index) || 0);
    return diff === 0;
  }

  /**
   * Deliberately slow, so a stolen table is not a password list. This runtime
   * refuses more than 100k PBKDF2 rounds in one call, so the work is stretched
   * across two chained rounds: 200k in total, each within the allowed budget.
   */
  private async passwordHash(password: string, salt: Uint8Array): Promise<string> {
    let material = new TextEncoder().encode(password) as Uint8Array;
    for (let round = 0; round < PBKDF2_ROUNDS; round += 1) {
      const key = await crypto.subtle.importKey("raw", material, "PBKDF2", false, ["deriveBits"]);
      const bits = await crypto.subtle.deriveBits(
        { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
        key,
        256,
      );
      material = new Uint8Array(bits);
    }
    return this.hex(material);
  }

  private async sha256(value: string): Promise<string> {
    return this.hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));
  }

  private guardGet<T>(key: string, fallback: T): T {
    const row = this.sql.exec<{ v: string }>("SELECT v FROM guard WHERE k = ?", key).toArray()[0];
    if (!row) return fallback;
    try {
      return JSON.parse(row.v) as T;
    } catch {
      return fallback;
    }
  }

  private guardPut(key: string, value: unknown): void {
    this.sql.exec("INSERT INTO guard (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v", key, JSON.stringify(value));
  }

  private accountById(id: string): AccountRow | null {
    return this.sql.exec<AccountRow>("SELECT * FROM accounts WHERE id = ?", id).toArray()[0] ?? null;
  }

  private accountByUsername(usernameLower: string): AccountRow | null {
    return this.sql.exec<AccountRow>("SELECT * FROM accounts WHERE username_lower = ?", usernameLower).toArray()[0] ?? null;
  }

  private identity(row: AccountRow): AccountIdentity {
    return { id: row.id, username: row.username, role: row.role, status: row.status, tenantId: row.tenant_id, createdAt: row.created_at };
  }

  private allowance(accountId: string, now: number): AllowanceView {
    const period = periodKey(now);
    const used = this.sql
      .exec<{ used: number }>("SELECT used FROM allowance WHERE account_id = ? AND period = ? AND kind = 'aiImport'", accountId, period)
      .toArray()[0]?.used ?? 0;
    return { used, limit: AI_IMPORTS_PER_MONTH, remaining: Math.max(0, AI_IMPORTS_PER_MONTH - used), period };
  }

  /** Drops slots whose account has gone quiet, so a ceiling is never held by a ghost. */
  private sweepSlots(now: number): void {
    this.sql.exec("DELETE FROM slots WHERE state = 'live' AND renewed_at < ?", now - SLOT_STALE_MS);
  }

  private capacity(accountId: string | null, now: number): CapacityView {
    this.sweepSlots(now);
    const sql = this.sql;
    const activeCount = sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM slots WHERE state = 'live'").toArray()[0]?.n ?? 0;
    const queue = sql
      .exec<{ account_id: string }>("SELECT account_id FROM slots WHERE state = 'queued' ORDER BY requested_at ASC")
      .toArray()
      .map((row) => row.account_id);
    const own = accountId ? sql.exec<{ state: string }>("SELECT state FROM slots WHERE account_id = ?", accountId).toArray()[0]?.state ?? null : null;
    const index = accountId ? queue.indexOf(accountId) : -1;
    return {
      live: own === "live",
      granted: own === "live",
      position: index >= 0 ? index + 1 : null,
      activeCount,
      limit: MAX_LIVE_CONNECTIONS,
      queueLength: queue.length,
    };
  }

  private view(row: AccountRow, now: number): AccountView {
    return { ...this.identity(row), allowance: this.allowance(row.id, now), capacity: this.capacity(row.id, now) };
  }

  /** Routed from the gateway worker only; never reachable from a browser. */
  async handle(path: string, body: Record<string, unknown>): Promise<Response> {
    switch (path) {
      case "/signup": return this.handleSignup(body);
      case "/availability": return this.handleAvailability(body);
      case "/signin": return this.handleSignin(body);
      case "/signout": return this.handleSignout(body);
      case "/resolve": return this.handleResolve(body);
      case "/me": return this.handleMe(body);
      case "/password": return this.handlePassword(body);
      case "/allowance/consume": return this.handleAllowance(body);
      case "/capacity/claim": return this.handleCapacityClaim(body);
      case "/capacity/release": return this.handleCapacityRelease(body);
      case "/owner/overview": return this.handleOverview();
      case "/owner/suspend": return this.handleSuspend(body);
      case "/owner/remove": return this.handleRemove(body);
      case "/public/stats": return this.handlePublicStats();
      default: return Response.json({ error: "not found" }, { status: 404 });
    }
  }

  private validateUsername(raw: unknown): { username: string } | { error: string } {
    const username = String(raw ?? "").trim();
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
      return { error: "Usernames are 3-20 characters: letters, numbers and underscores." };
    }
    return { username };
  }

  /**
   * Answers whether a name can be taken, so the form can say so while it is being
   * typed instead of failing at the final step. It reveals no more than pressing
   * the button would, and the lookup budget stops it being used to enumerate names.
   */
  private handleAvailability(body: Record<string, unknown>): Response {
    const now = Date.now();
    const raw = String(body.username ?? "").trim();
    if (raw.length === 0) return Response.json({ state: "invalid", detail: "Pick a username." } satisfies AvailabilityView);

    const window = this.guardGet<{ since: number; count: number }>("lookupWindow", { since: now, count: 0 });
    const fresh = now - window.since > 3_600_000 ? { since: now, count: 0 } : window;
    if (fresh.count >= MAX_LOOKUPS_PER_HOUR) {
      return Response.json({ state: "unknown", detail: "" } satisfies AvailabilityView);
    }
    this.guardPut("lookupWindow", { since: fresh.since, count: fresh.count + 1 });

    const parsed = this.validateUsername(raw);
    if ("error" in parsed) return Response.json({ state: "invalid", detail: parsed.error } satisfies AvailabilityView);

    const lower = parsed.username.toLowerCase();
    const existing = this.accountByUsername(lower);
    if (lower === OWNER_USERNAME) {
      return Response.json(
        existing
          ? ({ state: "taken", detail: "The owner account has already been claimed." } satisfies AvailabilityView)
          : ({ state: "reserved", detail: "Reserved for the console owner — claimable with the existing passcode." } satisfies AvailabilityView),
      );
    }
    return Response.json(
      existing
        ? ({ state: "taken", detail: "That username is already taken." } satisfies AvailabilityView)
        : ({ state: "available", detail: "That name is free." } satisfies AvailabilityView),
    );
  }

  private async handleSignup(body: Record<string, unknown>): Promise<Response> {
    const now = Date.now();
    const parsed = this.validateUsername(body.username);
    if ("error" in parsed) return Response.json({ error: parsed.error }, { status: 400 });
    const password = String(body.password ?? "");
    if (password.length < 10) return Response.json({ error: "Passwords must be at least 10 characters." }, { status: 400 });
    if (password.length > 200) return Response.json({ error: "That password is too long." }, { status: 400 });

    const lower = parsed.username.toLowerCase();
    const ownerClaim = body.ownerClaim === true;
    if (lower === OWNER_USERNAME && !ownerClaim) {
      return Response.json({ error: "That username is reserved for the console owner." }, { status: 403 });
    }
    if (this.accountByUsername(lower)) return Response.json({ error: "That username is already taken." }, { status: 409 });

    const window = this.guardGet<{ since: number; count: number }>("signupWindow", { since: now, count: 0 });
    const fresh = now - window.since > 3_600_000 ? { since: now, count: 0 } : window;
    if (fresh.count >= MAX_SIGNUPS_PER_HOUR) {
      return Response.json({ error: "Too many new accounts right now. Try again shortly." }, { status: 429 });
    }
    this.guardPut("signupWindow", { since: fresh.since, count: fresh.count + 1 });

    const role: AccountRole = ownerClaim && lower === OWNER_USERNAME ? "owner" : "member";
    const tenantId = role === "owner" ? OWNER_TENANT_ID : `t-${this.hex(crypto.getRandomValues(new Uint8Array(8)))}`;
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const id = crypto.randomUUID();
    this.sql.exec(
      `INSERT INTO accounts (id, username, username_lower, salt, hash, role, status, tenant_id, created_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
      id, parsed.username, lower, this.base64(salt), await this.passwordHash(password, salt), role, tenantId, now, now,
    );
    const row = this.accountById(id);
    if (!row) return Response.json({ error: "The account could not be created." }, { status: 500 });
    const token = await this.issueSession(id, now);
    return Response.json({ token, account: this.view(row, now), created: true });
  }

  private async issueSession(accountId: string, now: number): Promise<string> {
    const token = `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, "");
    this.sql.exec("DELETE FROM sessions WHERE expires_at < ?", now);
    this.sql.exec(
      "INSERT INTO sessions (token_hash, account_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
      await this.sha256(token), accountId, now, now + SESSION_TTL_MS,
    );
    return token;
  }

  private async handleSignin(body: Record<string, unknown>): Promise<Response> {
    const now = Date.now();
    const username = String(body.username ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");
    const guardKey = `fail:${username}`;
    const guard = this.guardGet<{ fails: number; lockedUntil: number }>(guardKey, { fails: 0, lockedUntil: 0 });
    if (guard.lockedUntil > now) {
      const retryAfterSeconds = Math.ceil((guard.lockedUntil - now) / 1000);
      return Response.json(
        { error: `Too many attempts. Try again in ${retryAfterSeconds}s.`, retryAfterSeconds },
        { status: 429 },
      );
    }
    const row = username ? this.accountByUsername(username) : null;
    // Always spend the hashing cost so a missing username is not measurably faster.
    const salt = row ? this.fromBase64(row.salt) : new Uint8Array(16);
    const candidate = await this.passwordHash(password, salt);
    if (!row || !this.safeEqual(row.hash, candidate)) {
      const fails = guard.fails + 1;
      this.guardPut(guardKey, fails >= 5 ? { fails: 0, lockedUntil: now + 60_000 } : { fails, lockedUntil: 0 });
      return Response.json({ error: "Incorrect username or password." }, { status: 403 });
    }
    if (row.status === "suspended") return Response.json({ error: "This account is suspended." }, { status: 403 });
    this.guardPut(guardKey, { fails: 0, lockedUntil: 0 });
    this.sql.exec("UPDATE accounts SET last_seen_at = ? WHERE id = ?", now, row.id);
    const token = await this.issueSession(row.id, now);
    return Response.json({ token, account: this.view(row, now), created: false });
  }

  private async handleSignout(body: Record<string, unknown>): Promise<Response> {
    const token = String(body.token ?? "");
    if (token) this.sql.exec("DELETE FROM sessions WHERE token_hash = ?", await this.sha256(token));
    return Response.json({ ok: true });
  }

  private async resolveToken(token: string, now: number): Promise<AccountRow | null> {
    if (!token) return null;
    const row = this.sql
      .exec<{ account_id: string; expires_at: number }>("SELECT account_id, expires_at FROM sessions WHERE token_hash = ?", await this.sha256(token))
      .toArray()[0];
    if (!row || row.expires_at <= now) return null;
    const account = this.accountById(row.account_id);
    if (!account || account.status === "suspended") return null;
    return account;
  }

  private async handleResolve(body: Record<string, unknown>): Promise<Response> {
    const now = Date.now();
    const account = await this.resolveToken(String(body.token ?? ""), now);
    if (!account) return Response.json({ error: "unauthorized" }, { status: 401 });
    if (!account.last_seen_at || now - account.last_seen_at > 300_000) {
      this.sql.exec("UPDATE accounts SET last_seen_at = ? WHERE id = ?", now, account.id);
      this.sql.exec("UPDATE slots SET renewed_at = ? WHERE account_id = ? AND state = 'live'", now, account.id);
    }
    return Response.json({ account: this.identity(account) });
  }

  private async handleMe(body: Record<string, unknown>): Promise<Response> {
    const now = Date.now();
    const account = await this.resolveToken(String(body.token ?? ""), now);
    if (!account) return Response.json({ error: "unauthorized" }, { status: 401 });
    return Response.json({ account: this.view(account, now) });
  }

  private async handlePassword(body: Record<string, unknown>): Promise<Response> {
    const now = Date.now();
    const account = await this.resolveToken(String(body.token ?? ""), now);
    if (!account) return Response.json({ error: "unauthorized" }, { status: 401 });
    const current = String(body.currentPassword ?? "");
    const next = String(body.newPassword ?? "");
    if (next.length < 10) return Response.json({ error: "Passwords must be at least 10 characters." }, { status: 400 });
    if (!this.safeEqual(account.hash, await this.passwordHash(current, this.fromBase64(account.salt)))) {
      return Response.json({ error: "That is not your current password." }, { status: 403 });
    }
    const salt = crypto.getRandomValues(new Uint8Array(16));
    this.sql.exec(
      "UPDATE accounts SET salt = ?, hash = ? WHERE id = ?",
      this.base64(salt), await this.passwordHash(next, salt), account.id,
    );
    // Every other device is signed out, which is the point of changing a password.
    this.sql.exec("DELETE FROM sessions WHERE account_id = ?", account.id);
    const token = await this.issueSession(account.id, now);
    return Response.json({ token });
  }

  private handleAllowance(body: Record<string, unknown>): Response {
    const now = Date.now();
    const accountId = String(body.accountId ?? "");
    const account = this.accountById(accountId);
    if (!account) return Response.json({ error: "unauthorized" }, { status: 401 });
    const period = periodKey(now);
    const current = this.allowance(accountId, now);
    if (body.peek === true) return Response.json({ ok: current.remaining > 0, allowance: current });
    if (current.remaining <= 0) {
      return Response.json({ error: `You have used all ${current.limit} screenshot imports for this month.`, allowance: current }, { status: 429 });
    }
    this.sql.exec(
      `INSERT INTO allowance (account_id, period, kind, used) VALUES (?, ?, 'aiImport', 1)
       ON CONFLICT(account_id, period, kind) DO UPDATE SET used = used + 1`,
      accountId, period,
    );
    return Response.json({ ok: true, allowance: this.allowance(accountId, now) });
  }

  private handleCapacityClaim(body: Record<string, unknown>): Response {
    const now = Date.now();
    const accountId = String(body.accountId ?? "");
    const account = this.accountById(accountId);
    if (!account) return Response.json({ error: "unauthorized" }, { status: 401 });
    this.sweepSlots(now);
    const sql = this.sql;
    const existing = sql.exec<{ state: string }>("SELECT state FROM slots WHERE account_id = ?", accountId).toArray()[0];
    if (existing?.state === "live") {
      sql.exec("UPDATE slots SET renewed_at = ? WHERE account_id = ?", now, accountId);
      return Response.json({ capacity: this.capacity(accountId, now) });
    }
    const activeCount = sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM slots WHERE state = 'live'").toArray()[0]?.n ?? 0;
    // The owner is never queued behind members on their own hosting.
    const state = activeCount < MAX_LIVE_CONNECTIONS || account.role === "owner" ? "live" : "queued";
    sql.exec(
      `INSERT INTO slots (account_id, state, requested_at, renewed_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(account_id) DO UPDATE SET state = excluded.state, renewed_at = excluded.renewed_at`,
      accountId, state, existing ? now : now, now,
    );
    return Response.json({ capacity: this.capacity(accountId, now) });
  }

  /** Releasing a slot promotes the account that has waited longest. */
  private handleCapacityRelease(body: Record<string, unknown>): Response {
    const now = Date.now();
    const accountId = String(body.accountId ?? "");
    const sql = this.sql;
    sql.exec("DELETE FROM slots WHERE account_id = ?", accountId);
    const activeCount = sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM slots WHERE state = 'live'").toArray()[0]?.n ?? 0;
    if (activeCount < MAX_LIVE_CONNECTIONS) {
      const next = sql
        .exec<{ account_id: string }>("SELECT account_id FROM slots WHERE state = 'queued' ORDER BY requested_at ASC LIMIT 1")
        .toArray()[0];
      if (next) sql.exec("UPDATE slots SET state = 'live', renewed_at = ? WHERE account_id = ?", now, next.account_id);
    }
    return Response.json({ capacity: this.capacity(accountId, now) });
  }

  private handleOverview(): Response {
    const now = Date.now();
    this.sweepSlots(now);
    const sql = this.sql;
    const accounts = sql.exec<AccountRow>("SELECT * FROM accounts ORDER BY created_at ASC").toArray();
    const slots = new Map(
      sql.exec<{ account_id: string; state: string }>("SELECT account_id, state FROM slots").toArray().map((row) => [row.account_id, row.state]),
    );
    const period = periodKey(now);
    const usage = new Map(
      sql
        .exec<{ account_id: string; used: number }>("SELECT account_id, used FROM allowance WHERE period = ? AND kind = 'aiImport'", period)
        .toArray()
        .map((row) => [row.account_id, row.used]),
    );
    const rows = accounts.map((row) => ({
      id: row.id,
      username: row.username,
      role: row.role,
      status: row.status,
      createdAt: row.created_at,
      lastSeenAt: row.last_seen_at,
      live: slots.get(row.id) === "live",
      queued: slots.get(row.id) === "queued",
      aiUsed: usage.get(row.id) ?? 0,
    }));
    const overview: OwnerOverview = {
      accounts: rows.length,
      active: rows.filter((row) => row.status === "active").length,
      suspended: rows.filter((row) => row.status === "suspended").length,
      connected: rows.filter((row) => row.live).length,
      queued: rows.filter((row) => row.queued).length,
      capacityLimit: MAX_LIVE_CONNECTIONS,
      rows,
    };
    return Response.json({ overview });
  }

  private handleSuspend(body: Record<string, unknown>): Response {
    const accountId = String(body.accountId ?? "");
    const suspended = body.suspended === true;
    const account = this.accountById(accountId);
    if (!account) return Response.json({ error: "No such account." }, { status: 404 });
    if (account.role === "owner") return Response.json({ error: "The owner account cannot be suspended." }, { status: 409 });
    this.sql.exec("UPDATE accounts SET status = ? WHERE id = ?", suspended ? "suspended" : "active", accountId);
    if (suspended) {
      this.sql.exec("DELETE FROM sessions WHERE account_id = ?", accountId);
      this.sql.exec("DELETE FROM slots WHERE account_id = ?", accountId);
    }
    return this.handleOverview();
  }

  /**
   * Erases a suspended account from the registry. Their engine, with its flows and
   * logs, is left untouched: the tenant handle is random and unreachable once the
   * account is gone, so nothing of theirs is exposed by keeping it.
   */
  private handleRemove(body: Record<string, unknown>): Response {
    const accountId = String(body.accountId ?? "");
    const account = this.accountById(accountId);
    if (!account) return Response.json({ error: "No such account." }, { status: 404 });
    if (account.role === "owner") return Response.json({ error: "The owner account cannot be removed." }, { status: 409 });
    if (account.status !== "suspended") {
      return Response.json({ error: "Suspend the account first, so nothing is removed by accident." }, { status: 409 });
    }
    this.sql.exec("DELETE FROM sessions WHERE account_id = ?", accountId);
    this.sql.exec("DELETE FROM slots WHERE account_id = ?", accountId);
    this.sql.exec("DELETE FROM allowance WHERE account_id = ?", accountId);
    this.sql.exec("DELETE FROM accounts WHERE id = ?", accountId);

    return this.handleOverview();
  }

  /** Counts only — safe to render on the unauthenticated landing page. */
  private handlePublicStats(): Response {
    const now = Date.now();
    this.sweepSlots(now);
    const sql = this.sql;
    const accounts = sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM accounts").toArray()[0]?.n ?? 0;
    const connected = sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM slots WHERE state = 'live'").toArray()[0]?.n ?? 0;
    const queued = sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM slots WHERE state = 'queued'").toArray()[0]?.n ?? 0;
    return Response.json({
      accounts,
      connected,
      queued,
      capacityLimit: MAX_LIVE_CONNECTIONS,
      spotsLeft: Math.max(0, MAX_LIVE_CONNECTIONS - connected),
      ownerClaimed: (sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM accounts WHERE role = 'owner'").toArray()[0]?.n ?? 0) > 0,
    });
  }
}
