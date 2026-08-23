import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import {
  api,
  getToken,
  setToken,
  streamUrl,
  type AccountView,
  type ConversationAnalysis,
  type EngineEvent,
  type FlowImportPreview,
  type FlowTemplate,
  type HostingReport,
  type HostingStatus,
  type OwnerOverview,
  type PersonalStartInput,
  type Settings,
  type Snapshot,
  type Workflow,
  type WorkflowActionType,
  type WorkflowStep,
} from "./api";

type EngineContextValue = {
  authed: boolean;
  account: AccountView | undefined;
  isOwner: boolean;
  signUp: (input: { username: string; password: string; claimPasscode?: string }) => Promise<void>;
  signIn: (input: { username: string; password: string }) => Promise<void>;
  signOut: () => void;
  snapshot: Snapshot | undefined;
  isLoading: boolean;
  error: Error | null;
  liveEvents: EngineEvent[];
  streamOnline: boolean;
  saveSettings: (patch: Partial<Settings>) => void;
  saveWorkflow: (workflow: Partial<Workflow>) => Promise<void>;
  deleteWorkflow: (id: string) => void;
  importFlow: (flow: unknown, commit: boolean) => Promise<{ id?: string; name: string; preview: FlowImportPreview[]; note?: string }>;
  templates: FlowTemplate[] | undefined;
  applyTemplate: (input: { templateId: string; target?: string }) => Promise<void>;
  connectBot: (botToken: string) => Promise<void>;
  startPersonal: (input: PersonalStartInput) => Promise<void>;
  submitPersonal: (kind: "code" | "password", value: string) => Promise<void>;
  pollPersonal: () => Promise<void>;
  runWorkflow: (input: { chatKey: string; workflowId?: string }) => Promise<void>;
  checkConnector: () => Promise<void>;
  diagnoseHosting: () => Promise<HostingReport>;
  applyHosting: () => Promise<{ applied: string[]; report: HostingReport }>;
  hostingStatus: HostingStatus | undefined;
  hostingStatusUpdatedAt: number;
  refreshHostingStatus: () => void;
  setAutoDeploy: (input: { enabled: boolean; repository?: string; branch?: string }) => Promise<void>;
  forceRebuild: (input?: { branch?: string }) => Promise<void>;
  ownerOverview: OwnerOverview | undefined;
  refreshOwnerOverview: () => void;
  suspendAccount: (accountId: string, suspended: boolean) => Promise<void>;
  removeAccount: (accountId: string) => Promise<void>;
  changePassword: (input: { currentPassword: string; newPassword: string }) => Promise<void>;
  reconnect: () => Promise<void>;
  disconnect: () => void;
  forgetConnection: () => Promise<void>;
  retryJob: (id: string) => void;
  updateJob: (id: string, status: "cancelled" | "dismissed") => void;
  simulate: (input: { chatKey?: string; sender?: string; text: string }) => Promise<void>;
  previewWorkflow: (step: Partial<WorkflowStep>, text: string) => Promise<{ matched: boolean; captures: string[]; actionType: WorkflowActionType; output: string; note: string }>;
  analyzeConversation: (input: { images: string[]; ownerSide: "left" | "right"; localeHint?: string }) => Promise<ConversationAnalysis>;
};

const EngineContext = createContext<EngineContextValue | null>(null);
const QUERY_KEY = ["engine-state"] as const;
const ACCOUNT_KEY = ["account"] as const;
const HOSTING_KEY = ["hosting-status"] as const;
const OWNER_KEY = ["owner-overview"] as const;
const TEMPLATE_KEY = ["flow-templates"] as const;
/** The status dashboard refreshes on this cadence, awake or in a background tab. */
const HOSTING_POLL_MS = 30_000;

export function EngineProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [authed, setAuthed] = useState<boolean>(() => getToken() !== null);
  const [liveEvents, setLiveEvents] = useState<EngineEvent[]>([]);
  const [streamOnline, setStreamOnline] = useState<boolean>(false);
  const socketRef = useRef<WebSocket | null>(null);

  const accountQuery = useQuery({
    queryKey: ACCOUNT_KEY,
    queryFn: () => api.me().then((result) => result.account),
    enabled: authed,
    refetchInterval: 120_000,
    retry: 1,
  });
  const isOwner = accountQuery.data?.role === "owner";

  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => api.state(),
    enabled: authed,
    refetchInterval: 60_000,
    retry: 1,
  });

  const hostingQuery = useQuery({
    queryKey: HOSTING_KEY,
    queryFn: () => api.hostingStatus().then((result) => result.status),
    enabled: authed && isOwner,
    refetchInterval: HOSTING_POLL_MS,
    refetchIntervalInBackground: true,
    retry: 1,
  });

  const ownerQuery = useQuery({
    queryKey: OWNER_KEY,
    queryFn: () => api.ownerOverview().then((result) => result.overview),
    enabled: authed && isOwner,
    refetchInterval: 60_000,
    retry: 1,
  });

  const templateQuery = useQuery({
    queryKey: TEMPLATE_KEY,
    queryFn: () => api.templates().then((result) => result.templates),
    enabled: authed,
    staleTime: 10 * 60_000,
    retry: 1,
  });

  const clearSession = useCallback((): void => {
    setToken(null);
    setAuthed(false);
    setLiveEvents([]);
    queryClient.clear();
  }, [queryClient]);

  useEffect(() => {
    const failure = (query.error ?? accountQuery.error) as { status?: number } | null;
    if (failure?.status === 401) clearSession();
  }, [query.error, accountQuery.error, clearSession]);

  useEffect(() => {
    if (!authed) return;
    let cancelled = false;
    let retryHandle: ReturnType<typeof setTimeout> | null = null;

    const open = async (): Promise<void> => {
      if (cancelled) return;
      try {
        const { ticket } = await api.streamTicket();
        if (cancelled) return;
        const socket = new WebSocket(streamUrl(ticket));
        socketRef.current = socket;
        socket.onopen = () => setStreamOnline(true);
        socket.onclose = () => {
          setStreamOnline(false);
          if (!cancelled) retryHandle = setTimeout(() => void open(), 4000);
        };
        socket.onerror = () => socket.close();
        socket.onmessage = (message: MessageEvent<string>) => {
          try {
            const payload = JSON.parse(message.data) as { kind: string; event?: EngineEvent };
            if (payload.kind === "event" && payload.event) setLiveEvents((previous) => [payload.event as EngineEvent, ...previous].slice(0, 200));
            if (payload.kind !== "pong") queryClient.invalidateQueries({ queryKey: QUERY_KEY });
          } catch { /* ignore malformed frames */ }
        };
      } catch {
        setStreamOnline(false);
        if (!cancelled) retryHandle = setTimeout(() => void open(), 5000);
      }
    };

    void open();
    return () => {
      cancelled = true;
      if (retryHandle) clearTimeout(retryHandle);
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [authed, queryClient]);

  const invalidate = useCallback((): void => {
    queryClient.invalidateQueries({ queryKey: QUERY_KEY });
  }, [queryClient]);

  const settingsMutation = useMutation({ mutationFn: api.saveSettings, onSuccess: invalidate, onError: (error: Error) => toast.error(error.message) });
  const workflowMutation = useMutation({
    mutationFn: api.saveWorkflow,
    onSuccess: () => { invalidate(); toast.success("Workflow saved"); },
    onError: (error: Error) => toast.error(error.message),
  });
  const deleteMutation = useMutation({
    mutationFn: api.deleteWorkflow,
    onSuccess: () => { invalidate(); toast.success("Workflow deleted"); },
    onError: (error: Error) => toast.error(error.message),
  });
  const templateMutation = useMutation({
    mutationFn: api.applyTemplate,
    onSuccess: () => { invalidate(); toast.success("Template copied in as a draft"); },
    onError: (error: Error) => toast.error(error.message),
  });
  const botMutation = useMutation({
    mutationFn: api.connectBot,
    onSuccess: () => { invalidate(); toast.success("Bot link is live"); },
    onError: (error: Error) => toast.error(error.message),
  });
  const personalMutation = useMutation({
    mutationFn: api.startPersonal,
    onSuccess: () => { invalidate(); queryClient.invalidateQueries({ queryKey: ACCOUNT_KEY }); },
    onError: (error: Error) => toast.error(error.message),
  });
  const submitPersonalMutation = useMutation({
    mutationFn: ({ kind, value }: { kind: "code" | "password"; value: string }) => api.submitPersonal(kind, value),
    onSuccess: () => invalidate(),
    onError: (error: Error) => toast.error(error.message),
  });
  const runWorkflowMutation = useMutation({
    mutationFn: api.runWorkflow,
    onSuccess: () => { invalidate(); toast.success("Flow started"); },
    onError: (error: Error) => toast.error(error.message),
  });
  const checkConnectorMutation = useMutation({
    mutationFn: api.checkConnector,
    onSuccess: (result) => {
      invalidate();
      if (result.probe.reachable) toast.success("Connector reached", { description: result.probe.detail });
      else toast.error("Connector unreachable", { description: result.probe.detail });
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const diagnoseHostingMutation = useMutation({
    mutationFn: api.diagnoseHosting,
    onError: (error: Error) => toast.error(error.message),
  });
  const applyHostingMutation = useMutation({
    mutationFn: api.applyHosting,
    onSuccess: (result) => {
      invalidate();
      toast.success("Hosting configuration applied", { description: result.applied[result.applied.length - 1] ?? "" });
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const autoDeployMutation = useMutation({
    mutationFn: api.setAutoDeploy,
    onSuccess: (result) => {
      queryClient.setQueryData<HostingStatus>(HOSTING_KEY, result.status);
      toast.success(result.status.autoDeploy.enabled ? "Build on push is on" : "Build on push is off", {
        description: result.applied[result.applied.length - 1] ?? result.status.autoDeploy.detail,
      });
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const forceRebuildMutation = useMutation({
    mutationFn: api.forceRebuild,
    onSuccess: (result) => {
      queryClient.setQueryData<HostingStatus>(HOSTING_KEY, result.status);
      toast.success("Rebuild started", { description: result.applied[result.applied.length - 1] ?? "Railway is building the connector now." });
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const suspendMutation = useMutation({
    mutationFn: ({ accountId, suspended }: { accountId: string; suspended: boolean }) => api.suspendAccount(accountId, suspended),
    onSuccess: (result) => {
      queryClient.setQueryData<OwnerOverview>(OWNER_KEY, result.overview);
      toast.success("Account updated");
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const removeMutation = useMutation({
    mutationFn: api.removeAccount,
    onSuccess: (result) => {
      queryClient.setQueryData<OwnerOverview>(OWNER_KEY, result.overview);
      toast.success("Account removed");
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const passwordMutation = useMutation({
    mutationFn: api.changePassword,
    onSuccess: (result) => { setToken(result.token); toast.success("Password changed", { description: "Every other signed-in device was signed out." }); },
    onError: (error: Error) => toast.error(error.message),
  });
  const reconnectMutation = useMutation({
    mutationFn: api.reconnect,
    onSuccess: () => { invalidate(); toast.success("Reconnect requested"); },
    onError: (error: Error) => toast.error(error.message),
  });
  const disconnectMutation = useMutation({
    mutationFn: api.disconnect,
    onSuccess: () => { invalidate(); queryClient.invalidateQueries({ queryKey: ACCOUNT_KEY }); toast("Link disconnected", { description: "Workflows and logs were kept." }); },
    onError: (error: Error) => toast.error(error.message),
  });
  const forgetMutation = useMutation({
    mutationFn: api.forgetConnection,
    onSuccess: () => { invalidate(); queryClient.invalidateQueries({ queryKey: ACCOUNT_KEY }); toast.success("Credentials and session removed"); },
    onError: (error: Error) => toast.error(error.message),
  });
  const importMutation = useMutation({
    mutationFn: ({ flow, commit }: { flow: unknown; commit: boolean }) => api.importFlow(flow, commit),
    onSuccess: (_result, variables) => { if (variables.commit) { invalidate(); toast.success("Flow imported as a disabled draft"); } },
    onError: (error: Error) => toast.error(error.message),
  });
  const retryMutation = useMutation({ mutationFn: api.retryJob, onSuccess: invalidate, onError: (error: Error) => toast.error(error.message) });
  const jobMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "cancelled" | "dismissed" }) => api.updateJob(id, status),
    onSuccess: invalidate,
    onError: (error: Error) => toast.error(error.message),
  });
  const simulateMutation = useMutation({ mutationFn: api.simulate, onSuccess: invalidate, onError: (error: Error) => toast.error(error.message) });
  const analysisMutation = useMutation({
    mutationFn: api.analyzeConversation,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ACCOUNT_KEY }),
    onError: (error: Error) => toast.error(error.message),
  });

  const adopt = useCallback((token: string, account: AccountView, welcome: string): void => {
    setToken(token);
    queryClient.setQueryData<AccountView>(ACCOUNT_KEY, account);
    setAuthed(true);
    invalidate();
    toast.success(welcome);
  }, [invalidate, queryClient]);

  const signIn = useCallback(async (input: { username: string; password: string }): Promise<void> => {
    const result = await api.signIn(input);
    adopt(result.token, result.account, `Welcome back, ${result.account.username}`);
  }, [adopt]);

  const signUp = useCallback(async (input: { username: string; password: string; claimPasscode?: string }): Promise<void> => {
    const result = await api.signUp(input);
    adopt(
      result.token,
      result.account,
      result.account.role === "owner" ? `Owner account ${result.account.username} claimed` : `Account ${result.account.username} created`,
    );
  }, [adopt]);

  const signOut = useCallback((): void => {
    void api.signOutServer().catch(() => undefined);
    clearSession();
  }, [clearSession]);

  const value = useMemo<EngineContextValue>(() => ({
    authed,
    account: accountQuery.data,
    isOwner,
    signUp,
    signIn,
    signOut,
    snapshot: query.data,
    isLoading: query.isLoading,
    error: (query.error as Error | null) ?? null,
    liveEvents,
    streamOnline,
    saveSettings: (patch) => settingsMutation.mutate(patch),
    saveWorkflow: async (workflow) => { await workflowMutation.mutateAsync(workflow); },
    deleteWorkflow: (id) => deleteMutation.mutate(id),
    importFlow: async (flow, commit) => importMutation.mutateAsync({ flow, commit }),
    templates: templateQuery.data,
    applyTemplate: async (input) => { await templateMutation.mutateAsync(input); },
    connectBot: async (botToken) => { await botMutation.mutateAsync(botToken); },
    startPersonal: async (input) => { await personalMutation.mutateAsync(input); },
    submitPersonal: async (kind, inputValue) => { await submitPersonalMutation.mutateAsync({ kind, value: inputValue }); },
    pollPersonal: async () => {
      const result = await api.pollPersonal();
      queryClient.setQueryData<Snapshot>(QUERY_KEY, (previous) => (previous ? { ...previous, link: result.link } : previous));
    },
    runWorkflow: async (input) => { await runWorkflowMutation.mutateAsync(input); },
    checkConnector: async () => { await checkConnectorMutation.mutateAsync(); },
    diagnoseHosting: async () => (await diagnoseHostingMutation.mutateAsync()).report,
    applyHosting: async () => applyHostingMutation.mutateAsync(),
    hostingStatus: hostingQuery.data,
    hostingStatusUpdatedAt: hostingQuery.dataUpdatedAt,
    refreshHostingStatus: () => { queryClient.invalidateQueries({ queryKey: HOSTING_KEY }); },
    setAutoDeploy: async (input) => { await autoDeployMutation.mutateAsync(input); },
    forceRebuild: async (input) => { await forceRebuildMutation.mutateAsync(input ?? {}); },
    ownerOverview: ownerQuery.data,
    refreshOwnerOverview: () => { queryClient.invalidateQueries({ queryKey: OWNER_KEY }); },
    suspendAccount: async (accountId, suspended) => { await suspendMutation.mutateAsync({ accountId, suspended }); },
    removeAccount: async (accountId) => { await removeMutation.mutateAsync(accountId); },
    changePassword: async (input) => { await passwordMutation.mutateAsync(input); },
    reconnect: async () => { await reconnectMutation.mutateAsync(); },
    disconnect: () => disconnectMutation.mutate(),
    forgetConnection: async () => { await forgetMutation.mutateAsync(); },
    retryJob: (id) => retryMutation.mutate(id),
    updateJob: (id, status) => jobMutation.mutate({ id, status }),
    simulate: async (input) => { await simulateMutation.mutateAsync(input); },
    previewWorkflow: async (step, text) => api.previewWorkflow(step, text),
    analyzeConversation: async (input) => (await analysisMutation.mutateAsync(input)).analysis,
  }), [
    authed, accountQuery.data, isOwner, signUp, signIn, signOut, query.data, query.isLoading, query.error, liveEvents, streamOnline, queryClient,
    settingsMutation, workflowMutation, deleteMutation, importMutation, botMutation, personalMutation, submitPersonalMutation,
    hostingQuery.data, hostingQuery.dataUpdatedAt, autoDeployMutation, forceRebuildMutation, templateQuery.data, templateMutation,
    ownerQuery.data, suspendMutation, removeMutation, passwordMutation,
    runWorkflowMutation, checkConnectorMutation, diagnoseHostingMutation, applyHostingMutation,
    reconnectMutation, disconnectMutation, forgetMutation, retryMutation, jobMutation, simulateMutation, analysisMutation,
  ]);

  return <EngineContext.Provider value={value}>{children}</EngineContext.Provider>;
}

export function useEngine(): EngineContextValue {
  const context = useContext(EngineContext);
  if (!context) throw new Error("useEngine must be used inside EngineProvider");
  return context;
}
