export { AutomationEngine } from "./engine";

import { OWNER_TENANT_ID, OWNER_USERNAME, type AccountIdentity } from "./accounts";

type Env = { DO: Fetcher; DASHBOARD_ORIGIN?: string };

/** The one engine instance that holds the account registry instead of a tenant's flows. */
const DIRECTORY_ID = "directory";
const DEFAULT_DASHBOARD_ORIGIN = "https://69a74dtzffgz6nx9cfn77-web.rork.live";
/** Tenant ids are the original owner engine or a generated `t-<hex>` handle. */
const TENANT_PATTERN = /^(primary|t-[0-9a-f]{16})$/;
/** Routes only the owner account may reach, checked here and again inside the engine. */
const OWNER_ONLY = ["/hosting/", "/owner/"];

function allowedOrigin(request: Request, env: Env): string | null {
  const origin = request.headers.get("Origin");
  if (!origin) return null;
  const configured = (env.DASHBOARD_ORIGIN ?? DEFAULT_DASHBOARD_ORIGIN).replace(/\/$/, "");
  if (origin === configured || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return origin;
  return null;
}

function corsHeaders(request: Request, env: Env): Headers {
  const headers = new Headers({
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  });
  const origin = allowedOrigin(request, env);
  if (origin) headers.set("Access-Control-Allow-Origin", origin);
  return headers;
}

function withCors(response: Response, request: Request, env: Env): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of corsHeaders(request, env).entries()) headers.set(key, value);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "no-referrer");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

/** Builds a request aimed at one tenant's engine. */
function toEngine(request: Request, path: string, publicOrigin: string, tenantId: string, account?: AccountIdentity): Request {
  const url = new URL(request.url);
  url.pathname = path;
  const wrapped = new Request(url.toString(), request);
  wrapped.headers.set("X-Rork-DO-Class", "AutomationEngine");
  wrapped.headers.set("X-Rork-DO-Id", tenantId);
  wrapped.headers.set("X-Public-Origin", publicOrigin);
  wrapped.headers.set("X-Tenant-Id", tenantId);
  // The browser can set any header it likes, so the engine only ever trusts these
  // because they are rewritten here on every hop, after the session was resolved.
  wrapped.headers.delete("X-Account-Id");
  wrapped.headers.delete("X-Account-Name");
  wrapped.headers.delete("X-Account-Role");
  if (account) {
    wrapped.headers.set("X-Account-Id", account.id);
    wrapped.headers.set("X-Account-Name", account.username);
    wrapped.headers.set("X-Account-Role", account.role);
  }
  return wrapped;
}

function directoryRequest(path: string, body: unknown): Request {
  const request = new Request(`https://directory/registry${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  request.headers.set("X-Rork-DO-Class", "AutomationEngine");
  request.headers.set("X-Rork-DO-Id", DIRECTORY_ID);
  return request;
}

async function directory<T>(env: Env, path: string, body: unknown): Promise<{ status: number; data: T }> {
  const response = await env.DO.fetch(directoryRequest(path, body));
  const data = (await response.json().catch(() => ({}))) as T;
  return { status: response.status, data };
}

function bearer(request: Request): string {
  const header = request.headers.get("Authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
}

async function resolveAccount(request: Request, env: Env): Promise<AccountIdentity | null> {
  const token = bearer(request);
  if (!token) return null;
  const result = await directory<{ account?: AccountIdentity }>(env, "/resolve", { token });
  if (result.status !== 200 || !result.data.account) return null;
  return result.data.account;
}

/** Proof that the caller knows the original console passcode, held by the first engine. */
async function verifyOwnerPasscode(env: Env, publicOrigin: string, passcode: string): Promise<boolean> {
  const request = new Request("https://engine/internal/owner-claim", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ passcode }),
  });
  const response = await env.DO.fetch(toEngine(request, "/internal/owner-claim", publicOrigin, OWNER_TENANT_ID));
  const data = (await response.json().catch(() => ({}))) as { ok?: boolean };
  return response.status === 200 && data.ok === true;
}

async function handleSignup(request: Request, env: Env, publicOrigin: string): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as { username?: string; password?: string; claimPasscode?: string };
  const username = String(body.username ?? "").trim();
  let ownerClaim = false;
  if (username.toLowerCase() === OWNER_USERNAME) {
    const passcode = String(body.claimPasscode ?? "");
    if (!passcode) {
      return Response.json({ error: "That username is reserved. Enter the existing console passcode to claim it.", needsPasscode: true }, { status: 403 });
    }
    if (!(await verifyOwnerPasscode(env, publicOrigin, passcode))) {
      return Response.json({ error: "That is not the console passcode." }, { status: 403 });
    }
    ownerClaim = true;
  }
  const result = await directory<unknown>(env, "/signup", { username, password: body.password, ownerClaim });
  return Response.json(result.data, { status: result.status });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const publicOrigin = `${url.protocol}//${url.host}`;

    if (request.method === "OPTIONS") {
      if (request.headers.get("Origin") && !allowedOrigin(request, env)) return new Response(null, { status: 403 });
      return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    }

    // Value-free operational summary: booleans, counts and engine-generated codes only.
    if (path === "/status") {
      return withCors(await env.DO.fetch(toEngine(request, "/status/public", publicOrigin, OWNER_TENANT_ID)), request, env);
    }

    // Landing-page counters. Nothing here identifies an account.
    // The connector's reachability is merged in so the page can say plainly that
    // nobody can connect while the service is down, rather than advertising free
    // slots that cannot actually be taken. Both reads are cached-only.
    if (path === "/public/stats") {
      const stats = await directory<Record<string, unknown>>(env, "/public/stats", {});
      let serviceUp = false;
      try {
        const health = await env.DO.fetch(toEngine(request, "/status/public", publicOrigin, OWNER_TENANT_ID));
        const payload = (await health.json()) as { reachable?: unknown; configured?: unknown };
        // Answering is not the same as usable: a service still missing its settings
        // can never take a connection, so it must not be advertised as having free
        // slots. `null` means readiness is simply unknown, which is not a failure.
        serviceUp = payload.reachable === true && payload.configured !== false;
      } catch {
        // An unreachable engine is itself a service that cannot take connections,
        // so the default of `false` is already the honest answer.
      }
      const counts = (stats.data ?? {}) as Record<string, unknown>;
      const connected = typeof counts.connected === "number" ? counts.connected : 0;
      const capacityLimit = typeof counts.capacityLimit === "number" ? counts.capacityLimit : 0;
      return withCors(
        Response.json(
          { ...counts, serviceUp, spotsLeft: serviceUp ? Math.max(0, capacityLimit - connected) : 0 },
          { status: stats.status },
        ),
        request,
        env,
      );
    }

    // Doubles as a keep-alive: it guarantees the heartbeat alarm exists so automation
    // keeps running with no console open. Returns no state of any kind.
    if (path === "/ping") {
      await env.DO.fetch(toEngine(request, "/wake", publicOrigin, OWNER_TENANT_ID)).catch(() => undefined);
      return withCors(Response.json({ ok: true, now: new Date().toISOString() }), request, env);
    }

    // Telegram bot webhooks. The tenant is in the path; the secret is checked by the engine.
    if (path.startsWith("/tg/") && request.method === "POST") {
      const parts = path.slice("/tg/".length).split("/").filter(Boolean);
      const tenantId = parts.length > 1 && TENANT_PATTERN.test(parts[0]) ? parts[0] : OWNER_TENANT_ID;
      const secret = parts.length > 1 ? parts[1] : parts[0] ?? "";
      const target = new URL(request.url);
      target.pathname = "/webhook";
      target.searchParams.set("s", secret);
      return env.DO.fetch(toEngine(new Request(target.toString(), request), "/webhook", publicOrigin, tenantId));
    }

    // Connector callbacks carry the tenant they belong to; the signature is checked inside.
    if (path === "/connector/event" && request.method === "POST") {
      const claimed = request.headers.get("X-ReplyFlow-Tenant") ?? "";
      const tenantId = TENANT_PATTERN.test(claimed) ? claimed : OWNER_TENANT_ID;
      return env.DO.fetch(toEngine(request, "/connector/event", publicOrigin, tenantId));
    }

    if (!path.startsWith("/api/")) return withCors(Response.json({ error: "not found" }, { status: 404 }), request, env);

    const origin = request.headers.get("Origin");
    if (origin && !allowedOrigin(request, env)) return Response.json({ error: "origin not allowed" }, { status: 403 });
    const inner = path.slice("/api".length);

    // Engine-internal routes are reachable from this worker only, never from a browser.
    if (inner.startsWith("/internal") || inner.startsWith("/registry")) {
      return withCors(Response.json({ error: "not found" }, { status: 404 }), request, env);
    }

    // Lets the create-account form say "that name is free" while it is being typed.
    // Unauthenticated by necessity, and the registry caps how often it can be asked.
    if (inner === "/account/available") {
      const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
      const result = await directory<unknown>(env, "/availability", { username: body.username });
      return withCors(Response.json(result.data, { status: result.status }), request, env);
    }
    if (inner === "/account/signup") return withCors(await handleSignup(request, env, publicOrigin), request, env);
    if (inner === "/account/signin") {
      const body = await request.json().catch(() => ({}));
      const result = await directory<unknown>(env, "/signin", body);
      return withCors(Response.json(result.data, { status: result.status }), request, env);
    }
    if (inner === "/account/signout") {
      const result = await directory<unknown>(env, "/signout", { token: bearer(request) });
      return withCors(Response.json(result.data, { status: result.status }), request, env);
    }
    if (inner === "/account/me") {
      const result = await directory<unknown>(env, "/me", { token: bearer(request) });
      return withCors(Response.json(result.data, { status: result.status }), request, env);
    }
    if (inner === "/account/password") {
      const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
      const result = await directory<unknown>(env, "/password", { ...body, token: bearer(request) });
      return withCors(Response.json(result.data, { status: result.status }), request, env);
    }

    // The websocket carries its tenant in the ticket, because headers are not available.
    if (inner === "/stream" && request.headers.get("Upgrade") === "websocket") {
      const raw = url.searchParams.get("ticket") ?? "";
      const split = raw.indexOf(".");
      const tenantId = split > 0 ? raw.slice(0, split) : "";
      if (!TENANT_PATTERN.test(tenantId)) return new Response("unauthorized", { status: 401 });
      const target = new URL(request.url);
      target.searchParams.set("ticket", raw.slice(split + 1));
      return env.DO.fetch(toEngine(new Request(target.toString(), request), "/stream", publicOrigin, tenantId));
    }

    const account = await resolveAccount(request, env);
    if (!account) return withCors(Response.json({ error: "unauthorized" }, { status: 401 }), request, env);

    if (OWNER_ONLY.some((prefix) => inner.startsWith(prefix)) && account.role !== "owner") {
      return withCors(Response.json({ error: "This area belongs to the console owner." }, { status: 403 }), request, env);
    }

    if (inner === "/owner/overview") {
      const result = await directory<unknown>(env, "/owner/overview", {});
      return withCors(Response.json(result.data, { status: result.status }), request, env);
    }
    if (inner === "/owner/suspend" || inner === "/owner/remove") {
      const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
      const result = await directory<unknown>(env, inner, body);
      return withCors(Response.json(result.data, { status: result.status }), request, env);
    }

    // Screenshot import spends real AI credits, so the monthly allowance is checked
    // before the call and only spent when the analysis actually succeeds.
    if (inner === "/ai/conversation") {
      const peek = await directory<{ ok?: boolean; error?: string; allowance?: unknown }>(env, "/allowance/consume", { accountId: account.id, peek: true });
      if (!peek.data.ok) {
        return withCors(Response.json({ error: peek.data.error ?? "Monthly screenshot allowance used up.", allowance: peek.data.allowance }, { status: 429 }), request, env);
      }
      const response = await env.DO.fetch(toEngine(request, inner, publicOrigin, account.tenantId, account));
      if (response.ok) await directory(env, "/allowance/consume", { accountId: account.id }).catch(() => undefined);
      return withCors(response, request, env);
    }

    // A live personal session is a real process on the hosting, so it needs a slot.
    if (inner === "/link/personal/start") {
      const claim = await directory<{ capacity?: { granted?: boolean; position?: number | null; limit?: number } }>(env, "/capacity/claim", { accountId: account.id });
      const capacity = claim.data.capacity;
      if (!capacity?.granted) {
        return withCors(Response.json({
          error: `All ${capacity?.limit ?? 0} live connection slots are in use. You are number ${capacity?.position ?? 1} in the queue and will be let in automatically.`,
          capacity,
        }, { status: 429 }), request, env);
      }
    }

    const response = await env.DO.fetch(toEngine(request, inner, publicOrigin, account.tenantId, account));

    if ((inner === "/link/forget" || inner === "/link/disconnect") && response.ok) {
      await directory(env, "/capacity/release", { accountId: account.id }).catch(() => undefined);
    }

    // Tickets are namespaced so the socket upgrade knows which engine to reach.
    if (inner === "/stream/ticket" && response.ok) {
      const payload = (await response.json().catch(() => ({}))) as { ticket?: string; expiresAt?: number };
      if (!payload.ticket) return withCors(Response.json({ error: "No ticket issued." }, { status: 502 }), request, env);
      return withCors(Response.json({ ticket: `${account.tenantId}.${payload.ticket}`, expiresAt: payload.expiresAt }), request, env);
    }

    if (response.status === 101) return response;
    return withCors(response, request, env);
  },
} satisfies ExportedHandler<Env>;
