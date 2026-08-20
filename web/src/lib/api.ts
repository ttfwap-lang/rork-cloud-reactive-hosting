export const API_BASE: string =
  (import.meta.env.VITE_FUNCTIONS_URL as string | undefined) ??
  "https://cloud-reactive-hosting-backend.rork.app";

const TOKEN_KEY = "replyflow.token";

export function getToken(): string | null {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}

export function setToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch { /* storage unavailable */ }
}

export type TriggerMode = "exact" | "contains" | "starts" | "ends" | "regex";
export type ConditionField =
  | "text" | "sender" | "chat" | "direction" | "chatType"
  | "isEdited" | "isReply" | "isForwarded" | "isBot" | "mediaType";
export type ConditionOperator = TriggerMode | "is" | "isNot";
export type WorkflowStatus = "draft" | "test" | "enabled" | "paused" | "attention";
export type WorkflowActionType = "sendText" | "pressButton" | "react" | "markRead" | "end";

export type WorkflowCondition = {
  id: string;
  field: ConditionField;
  operator: ConditionOperator;
  value: string;
  caseSensitive: boolean;
  negate: boolean;
};

export type WorkflowStep = {
  id: string;
  trigger: string;
  mode: TriggerMode;
  caseSensitive: boolean;
  conditionLogic: "and" | "or";
  conditions: WorkflowCondition[];
  actionType: WorkflowActionType;
  reply: string;
  buttonTarget: string;
  reaction: string;
  delayMs: number;
  timeoutMs: number;
  loopTo: number | null;
  maxLoops: number;
};

export type Workflow = {
  version: 2;
  id: string;
  name: string;
  target: string;
  targets: string[];
  enabled: boolean;
  status: WorkflowStatus;
  steps: WorkflowStep[];
  cooldownMs: number;
  maxRunsPerChat: number;
  /** Permanent flow: cannot be deleted and is restored automatically. */
  pinned: boolean;
  /** Ignores pacing, caps, cooldowns, dedupe and timeouts. Only the emergency stop applies. */
  bypassLimits: boolean;
  createdAt: number;
  updatedAt: number;
};

export type HardwiredState = {
  id: string;
  present: boolean;
  stepCount: number;
  replies: number;
  lastBot: string | null;
  lastChatKey: string | null;
  lastStep: number | null;
  lastAt: number | null;
  activeRuns: Array<{ chatKey: string; stepIndex: number }>;
};

export type FlowImportPreview = {
  index: number;
  trigger: string;
  mode: TriggerMode;
  actionType: WorkflowActionType;
  output: string;
  delayMs: number;
};

export type Settings = {
  automationEnabled: boolean;
  killSwitch: boolean;
  dryRun: boolean;
  minGapMs: number;
  perMinuteCap: number;
  dailyCap: number;
  perChatCooldownMs: number;
  dedupeWindowMs: number;
  autoPauseOnFlood: boolean;
  allowlist: string[];
  quietHours: { enabled: boolean; start: string; end: string; timeZone: string };
  alertChatId: string;
};

export type LinkState = {
  mode: "none" | "bot" | "personal";
  status:
    | "offline" | "connecting" | "awaiting_qr" | "awaiting_code"
    | "awaiting_password" | "online" | "paused" | "attention" | "error";
  identity: string | null;
  phoneMasked: string | null;
  since: number | null;
  lastEventAt: number | null;
  connectorHeartbeatAt: number | null;
  detail: string | null;
  pausedUntil: number | null;
  qrUrl: string | null;
  qrExpiresAt: number | null;
};

export type EngineEvent = {
  ts: number;
  level: "info" | "success" | "warn" | "error";
  type: string;
  workflowId: string | null;
  chatKey: string | null;
  detail: string;
};

export type ErrorCategory = "rate_limit" | "chat_rate_limit" | "authorization" | "permission" | "bad_input" | "network" | "account_risk" | "unknown";

export type FailedJob = {
  id: string;
  ts: number;
  workflowId: string | null;
  chatKey: string;
  reason: string;
  attempts: number;
  status: "pending" | "resolved" | "cancelled" | "dismissed";
  category: ErrorCategory;
  retryable: boolean;
};

export type ConversationMessage = {
  id: string;
  side: "owner" | "other" | "system" | "unknown";
  speaker: string;
  text: string;
  timestamp: string;
  mediaType: "text" | "photo" | "video" | "voice" | "document" | "sticker" | "poll" | "other";
  buttons: string[];
  confidence: "high" | "medium" | "low";
  basis: "observed" | "inferred" | "defaulted";
  sourceImage: number;
};

export type ConversationAnalysis = {
  title: string;
  summary: string;
  messages: ConversationMessage[];
  workflowSteps: Array<{
    trigger: string;
    reply: string;
    mode: TriggerMode;
    delayMs: number;
    confidence: "high" | "medium" | "low";
    basis: "observed" | "inferred" | "defaulted";
    evidenceIds: string[];
  }>;
  ambiguities: Array<{
    id: string;
    question: string;
    severity: "blocking" | "review";
    evidenceIds: string[];
  }>;
};

export type ConnectorProbe = { reachable: boolean; detail: string; checkedAt: number | null; workerAgeSeconds: number | null };

export type HostingServiceReport = {
  id: string;
  name: string;
  rootDirectory: string | null;
  builder: string | null;
  source: string | null;
  latestStatus: string | null;
  latestAt: number | null;
  domains: Array<{ domain: string; targetPort: number | null }>;
  variableKeys: string[];
  volumeMounts: string[];
};

export type HostingReport = {
  ok: boolean;
  detail: string;
  tokenKind: "project" | "account" | null;
  projectName: string | null;
  environmentName: string | null;
  services: HostingServiceReport[];
  findings: string[];
  buildLog: string[];
  checkedAt: number;
};

export type Snapshot = {
  link: LinkState;
  hardwired: HardwiredState;
  connector: { configured: boolean; deployment: string; credentialsPreset: boolean; probe: ConnectorProbe };
  ai: { enabled: boolean; model: string };
  settings: Settings;
  workflows: Workflow[];
  events: EngineEvent[];
  jobs: FailedJob[];
  stats: {
    sentToday: number;
    activeConversations: number;
    workflowCount: number;
    pendingJobs: number;
    errorCategories: Array<{ type: string; count: number }>;
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
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) throw new ApiError(typeof payload.error === "string" ? payload.error : "Request failed.", response.status);
  return payload as T;
}

export type PersonalStartInput = {
  apiId?: string;
  apiHash?: string;
  method: "qr" | "phone";
  phone?: string;
  riskAccepted: boolean;
};

export const api = {
  authenticate: (passcode: string) => call<{ token: string; claimed: boolean }>("/auth", { passcode }),
  state: () => call<Snapshot>("/state"),
  streamTicket: () => call<{ ticket: string; expiresAt: number }>("/stream/ticket", {}),
  saveSettings: (patch: Partial<Settings>) => call<{ settings: Settings }>("/settings", patch),
  saveWorkflow: (workflow: Partial<Workflow>) => call<{ workflows: Workflow[] }>("/workflow", workflow),
  deleteWorkflow: (id: string) => call<{ workflows: Workflow[] }>("/workflow/delete", { id }),
  importFlow: (flow: unknown, commit: boolean) =>
    call<{ id?: string; name: string; preview: FlowImportPreview[]; note?: string }>("/workflow/import", { flow, commit }),
  connectBot: (botToken: string) => call<{ link: LinkState }>("/link/connect", { mode: "bot", botToken }),
  startPersonal: (input: PersonalStartInput) => call<{ link: LinkState }>("/link/personal/start", input),
  submitPersonal: (kind: "code" | "password", value: string) => call<{ link: LinkState }>("/link/personal/submit", { kind, value }),
  pollPersonal: () => call<{ link: LinkState; warning?: string }>("/link/personal/poll", {}),
  runHardwired: (chatKey: string) => call<Snapshot>("/hardwired/run", { chatKey }),
  checkConnector: () => call<{ probe: ConnectorProbe }>("/connector/check", {}),
  diagnoseHosting: () => call<{ report: HostingReport }>("/hosting/diagnose", {}),
  applyHosting: () => call<{ applied: string[]; report: HostingReport }>("/hosting/apply", {}),
  reconnect: () => call<{ link: LinkState }>("/link/reconnect", {}),
  disconnect: () => call<{ link: LinkState }>("/link/disconnect", {}),
  forgetConnection: () => call<{ link: LinkState }>("/link/forget", {}),
  retryJob: (id: string) => call<Snapshot>("/job/retry", { id }),
  updateJob: (id: string, status: "cancelled" | "dismissed") => call<Snapshot>("/job/status", { id, status }),
  simulate: (input: { chatKey?: string; sender?: string; text: string }) => call<{ ok: boolean }>("/simulate", input),
  previewWorkflow: (step: Partial<WorkflowStep>, text: string) => call<{ matched: boolean; captures: string[]; actionType: WorkflowActionType; output: string; note: string }>("/workflow/preview", { step, message: { text } }),
  analyzeConversation: (input: { images: string[]; ownerSide: "left" | "right"; localeHint?: string }) =>
    call<{ analysis: ConversationAnalysis; model: string; retention: string }>("/ai/conversation", input),
};

export function streamUrl(ticket: string): string {
  return `${API_BASE.replace(/^http/, "ws")}/api/stream?ticket=${encodeURIComponent(ticket)}`;
}

export { ApiError };
