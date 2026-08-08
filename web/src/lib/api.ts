export const API_BASE: string =
  (import.meta.env.VITE_FUNCTIONS_URL as string | undefined) ??
  "https://cloud-reactive-hosting-backend.rork.app";

const TOKEN_KEY = "replyflow.token";

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable */
  }
}

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

export type LinkState = {
  mode: "none" | "bot";
  status: "offline" | "connecting" | "online" | "paused" | "error";
  identity: string | null;
  since: number | null;
  lastEventAt: number | null;
  detail: string | null;
  pausedUntil: number | null;
};

export type EngineEvent = {
  ts: number;
  level: "info" | "success" | "warn" | "error";
  type: string;
  workflowId: string | null;
  chatKey: string | null;
  detail: string;
};

export type FailedJob = {
  id: string;
  ts: number;
  workflowId: string | null;
  chatKey: string;
  reason: string;
  attempts: number;
  status: string;
};

export type Snapshot = {
  link: LinkState;
  settings: Settings;
  workflows: Workflow[];
  events: EngineEvent[];
  jobs: FailedJob[];
  stats: {
    sentToday: number;
    activeConversations: number;
    workflowCount: number;
    webhookPath: string | null;
  };
};

class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function call<T>(path: string, body?: unknown): Promise<T> {
  const token = getToken();
  const response = await fetch(`${API_BASE}/api${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const message = typeof payload.error === "string" ? payload.error : "Request failed.";
    throw new ApiError(message, response.status);
  }
  return payload as T;
}

export const api = {
  authenticate: (passcode: string) => call<{ token: string; claimed: boolean }>("/auth", { passcode }),
  state: () => call<Snapshot>("/state"),
  saveSettings: (patch: Partial<Settings>) => call<{ settings: Settings }>("/settings", patch),
  saveWorkflow: (workflow: Partial<Workflow>) => call<{ workflows: Workflow[] }>("/workflow", workflow),
  deleteWorkflow: (id: string) => call<{ workflows: Workflow[] }>("/workflow/delete", { id }),
  connect: (botToken: string) => call<{ link: LinkState }>("/link/connect", { mode: "bot", botToken }),
  disconnect: () => call<{ link: LinkState }>("/link/disconnect", {}),
  retryJob: (id: string) => call<Snapshot>("/job/retry", { id }),
  simulate: (input: { chatKey?: string; from?: string; text: string }) => call<{ ok: boolean }>("/simulate", input),
};

export function streamUrl(): string | null {
  const token = getToken();
  if (!token) return null;
  const base = API_BASE.replace(/^http/, "ws");
  return `${base}/api/stream?token=${encodeURIComponent(token)}`;
}

export { ApiError };
