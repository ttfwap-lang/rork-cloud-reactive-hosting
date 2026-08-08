export { AutomationEngine } from "./engine";

type Env = { DO: Fetcher };

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const ENGINE_ID = "primary";

function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(CORS)) headers.set(key, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

/** Dispatch into the single always-on engine instance. */
function toEngine(request: Request, path: string, origin: string): Request {
  const url = new URL(request.url);
  url.pathname = path;
  const wrapped = new Request(url.toString(), request);
  wrapped.headers.set("X-Rork-DO-Class", "AutomationEngine");
  wrapped.headers.set("X-Rork-DO-Id", ENGINE_ID);
  wrapped.headers.set("X-Public-Origin", origin);
  return wrapped;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const origin = `${url.protocol}//${url.host}`;

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    if (path === "/ping") {
      return withCors(Response.json({ ok: true, now: new Date().toISOString() }));
    }

    // Telegram webhook ingress: /tg/<secret>
    if (path.startsWith("/tg/") && request.method === "POST") {
      const secret = path.slice("/tg/".length);
      const target = new URL(request.url);
      target.pathname = "/webhook";
      target.searchParams.set("s", secret);
      const wrapped = new Request(target.toString(), request);
      wrapped.headers.set("X-Rork-DO-Class", "AutomationEngine");
      wrapped.headers.set("X-Rork-DO-Id", ENGINE_ID);
      wrapped.headers.set("X-Public-Origin", origin);
      return env.DO.fetch(wrapped);
    }

    if (path.startsWith("/api/")) {
      const inner = path.slice("/api".length);
      const response = await env.DO.fetch(toEngine(request, inner, origin));
      // WebSocket upgrades must pass through untouched.
      if (response.status === 101) return response;
      return withCors(response);
    }

    return withCors(Response.json({ error: "not found" }, { status: 404 }));
  },
} satisfies ExportedHandler<Env>;
