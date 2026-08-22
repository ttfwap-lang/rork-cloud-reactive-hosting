export { AutomationEngine } from "./engine";

type Env = { DO: Fetcher; DASHBOARD_ORIGIN?: string };

const ENGINE_ID = "primary";
const DEFAULT_DASHBOARD_ORIGIN = "https://69a74dtzffgz6nx9cfn77-web.rork.live";

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

function toEngine(request: Request, path: string, publicOrigin: string): Request {
  const url = new URL(request.url);
  url.pathname = path;
  const wrapped = new Request(url.toString(), request);
  wrapped.headers.set("X-Rork-DO-Class", "AutomationEngine");
  wrapped.headers.set("X-Rork-DO-Id", ENGINE_ID);
  wrapped.headers.set("X-Public-Origin", publicOrigin);
  return wrapped;
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

    // Doubles as a keep-alive: it guarantees the engine's heartbeat alarm exists so
    // automation keeps running with no console open. Returns no state of any kind.
    // Value-free operational summary: booleans, counts and engine-generated codes only.
    if (path === "/status") {
      return withCors(await env.DO.fetch(toEngine(request, "/status/public", publicOrigin)), request, env);
    }

    if (path === "/ping") {
      await env.DO.fetch(toEngine(request, "/wake", publicOrigin)).catch(() => undefined);
      return withCors(Response.json({ ok: true, now: new Date().toISOString() }), request, env);
    }

    if (path.startsWith("/tg/") && request.method === "POST") {
      const secret = path.slice("/tg/".length);
      const target = new URL(request.url);
      target.pathname = "/webhook";
      target.searchParams.set("s", secret);
      return env.DO.fetch(toEngine(new Request(target.toString(), request), "/webhook", publicOrigin));
    }

    if (path === "/connector/event" && request.method === "POST") {
      return env.DO.fetch(toEngine(request, "/connector/event", publicOrigin));
    }

    if (path.startsWith("/api/")) {
      const origin = request.headers.get("Origin");
      if (origin && !allowedOrigin(request, env)) return Response.json({ error: "origin not allowed" }, { status: 403 });
      const inner = path.slice("/api".length);
      const response = await env.DO.fetch(toEngine(request, inner, publicOrigin));
      if (response.status === 101) return response;
      return withCors(response, request, env);
    }

    return withCors(Response.json({ error: "not found" }, { status: 404 }), request, env);
  },
} satisfies ExportedHandler<Env>;
