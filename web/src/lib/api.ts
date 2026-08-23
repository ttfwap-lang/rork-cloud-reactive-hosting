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

export type ConnectorProbe = { reachable: boolean; detail: string; checkedAt: number | null; workerAgeSeconds: number | null; latencyMs: number | null };

export type HostingAutoDeploy = {
  enabled: boolean;
  repository: string | null;
  branch: string | null;
  watchPatterns: string[];
  detail: string;
};

export type HealthSample = { t: number; up: boolean; ms: number | null };

/** Plain-language cause of a failed build, derived from the log but never quoting it. */
export type BuildFailure = { code: string; hint: string };

/** Whether the repository the platform builds actually exists, with the connector in it. */
export type SourceCheckState = "ok" | "missing_connector" | "not_found" | "unverified";
export type SourceCheck = {
  repository: string;
  branch: string;
  state: SourceCheckState;
  commitSha: string | null;
  detail: string;
  checkedAt: number;
};

export type HostingStatus = {
  probe: ConnectorProbe;
  uptimePct: number | null;
  windowMs: number;
  sampleCount: number;
  onlineSince: number | null;
  lastDownAt: number | null;
  history: HealthSample[];
  build: { serviceName: string | null; status: string | null; at: number | null; refreshedAt: number | null; failure: BuildFailure | null };
  autoDeploy: HostingAutoDeploy;
  source: SourceCheck;
  repair: { attempts: number; lastAt: number | null; nextAt: number | null; lastDetail: string | null; exhausted: boolean };
  checkedAt: number;
};

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
  autoDeploy: HostingAutoDeploy;
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

export type AccountRole = "owner" | "member";
export type AccountStatus = "active" | "suspended";

export type AllowanceView = { used: number; limit: number; remaining: number; period: string };
export type CapacityView = {
  live: boolean;
  granted: boolean;
  position: number | null;
  activeCount: number;
  limit: number;
  queueLength: number;
};

export type AccountView = {
  id: string;
  username: string;
  role: AccountRole;
  status: AccountStatus;
  tenantId: string;
  createdAt: number;
  allowance: AllowanceView;
  capacity: CapacityView;
};

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

/**
 * The answer to "can I have this name?" while it is being typed. `reserved` is the
 * unclaimed owner name; `unknown` means the service declined to answer, so the form
 * stays quiet rather than showing a guess.
 */
export type AvailabilityState = "available" | "taken" | "reserved" | "invalid" | "unknown";
export type AvailabilityView = { state: AvailabilityState; detail: string };

/** Counts only, safe to show before anyone signs in. */
export type PublicStats = {
  accounts: number;
  connected: number;
  queued: number;
  capacityLimit: number;
  spotsLeft: number;
  ownerClaimed: boolean;
};

/** A starting point that can be copied into an account and pointed at any bot. */
export type FlowTemplate = {
  id: string;
  name: string;
  summary: string;
  targetHint: string;
  steps: WorkflowStep[];
};

export type Snapshot = {
  account: {
    username: string | null;
    role: AccountRole;
    isOwner: boolean;
    tenantId: string;
    riskAckAt: number | null;
  };
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
  /** Present on a rate-limited reply, so a form can count down instead of guessing. */
  readonly retryAfterSeconds: number | null;
  constructor(message: string, status: number, retryAfterSeconds: number | null = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
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
  if (!response.ok) {
    throw new ApiError(
      typeof payload.error === "string" ? payload.error : "Request failed.",
      response.status,
      typeof payload.retryAfterSeconds === "number" ? payload.retryAfterSeconds : null,
    );
  }
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
  checkUsername: (username: string) => call<AvailabilityView>("/account/available", { username }),
  signUp: (input: { username: string; password: string; claimPasscode?: string }) =>
    call<{ token: string; account: AccountView; created: boolean }>("/account/signup", input),
  signIn: (input: { username: string; password: string }) =>
    call<{ token: string; account: AccountView; created: boolean }>("/account/signin", input),
  signOutServer: () => call<{ ok: boolean }>("/account/signout", {}),
  me: () => call<{ account: AccountView }>("/account/me", {}),
  changePassword: (input: { currentPassword: string; newPassword: string }) =>
    call<{ token: string }>("/account/password", input),
  ownerOverview: () => call<{ overview: OwnerOverview }>("/owner/overview", {}),
  suspendAccount: (accountId: string, suspended: boolean) =>
    call<{ overview: OwnerOverview }>("/owner/suspend", { accountId, suspended }),
  removeAccount: (accountId: string) => call<{ overview: OwnerOverview }>("/owner/remove", { accountId }),
  acknowledgeRisk: (accepted: boolean) => call<{ riskAckAt: number | null }>("/account/risk", { accepted }),
  templates: () => call<{ templates: FlowTemplate[] }>("/workflow/templates", {}),
  applyTemplate: (input: { templateId: string; target?: string }) =>
    call<{ id: string; workflows: Workflow[] }>("/workflow/template", input),
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
  runWorkflow: (input: { chatKey: string; workflowId?: string }) => call<Snapshot>("/workflow/run", input),
  checkConnector: () => call<{ probe: ConnectorProbe }>("/connector/check", {}),
  diagnoseHosting: () => call<{ report: HostingReport }>("/hosting/diagnose", {}),
  applyHosting: () => call<{ applied: string[]; report: HostingReport }>("/hosting/apply", {}),
  hostingStatus: () => call<{ status: HostingStatus }>("/hosting/status", {}),
  setAutoDeploy: (input: { enabled: boolean; repository?: string; branch?: string }) =>
    call<{ applied: string[]; status: HostingStatus }>("/hosting/autodeploy", input),
  forceRebuild: (input: { branch?: string } = {}) =>
    call<{ applied: string[]; status: HostingStatus }>("/hosting/rebuild", input),
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

/** Unauthenticated landing-page counters. Failure is silent: the page still renders. */
export async function fetchPublicStats(): Promise<PublicStats | null> {
  try {
    const response = await fetch(`${API_BASE}/public/stats`);
    if (!response.ok) return null;
    return (await response.json()) as PublicStats;
  } catch {
    return null;
  }
}

export { ApiError };
