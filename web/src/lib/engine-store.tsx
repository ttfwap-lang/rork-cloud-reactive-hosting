import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import {
  api,
  getToken,
  setToken,
  streamUrl,
  type ConversationAnalysis,
  type EngineEvent,
  type FlowImportPreview,
  type PersonalStartInput,
  type Settings,
  type Snapshot,
  type Workflow,
  type WorkflowActionType,
  type WorkflowStep,
} from "./api";

type EngineContextValue = {
  authed: boolean;
  signIn: (passcode: string) => Promise<void>;
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
  connectBot: (botToken: string) => Promise<void>;
  startPersonal: (input: PersonalStartInput) => Promise<void>;
  submitPersonal: (kind: "code" | "password", value: string) => Promise<void>;
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

export function EngineProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [authed, setAuthed] = useState<boolean>(() => getToken() !== null);
  const [liveEvents, setLiveEvents] = useState<EngineEvent[]>([]);
  const [streamOnline, setStreamOnline] = useState<boolean>(false);
  const socketRef = useRef<WebSocket | null>(null);

  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => api.state(),
    enabled: authed,
    refetchInterval: 60_000,
    retry: 1,
  });

  useEffect(() => {
    const failure = query.error as { status?: number } | null;
    if (failure?.status === 401) {
      setToken(null);
      setAuthed(false);
    }
  }, [query.error]);

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
  const botMutation = useMutation({
    mutationFn: api.connectBot,
    onSuccess: () => { invalidate(); toast.success("Bot link is live"); },
    onError: (error: Error) => toast.error(error.message),
  });
  const personalMutation = useMutation({
    mutationFn: api.startPersonal,
    onSuccess: () => invalidate(),
    onError: (error: Error) => toast.error(error.message),
  });
  const submitPersonalMutation = useMutation({
    mutationFn: ({ kind, value }: { kind: "code" | "password"; value: string }) => api.submitPersonal(kind, value),
    onSuccess: () => invalidate(),
    onError: (error: Error) => toast.error(error.message),
  });
  const reconnectMutation = useMutation({
    mutationFn: api.reconnect,
    onSuccess: () => { invalidate(); toast.success("Reconnect requested"); },
    onError: (error: Error) => toast.error(error.message),
  });
  const disconnectMutation = useMutation({
    mutationFn: api.disconnect,
    onSuccess: () => { invalidate(); toast("Link disconnected", { description: "Workflows and logs were kept." }); },
    onError: (error: Error) => toast.error(error.message),
  });
  const forgetMutation = useMutation({
    mutationFn: api.forgetConnection,
    onSuccess: () => { invalidate(); toast.success("Credentials and session removed"); },
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
  const analysisMutation = useMutation({ mutationFn: api.analyzeConversation, onError: (error: Error) => toast.error(error.message) });

  const signIn = useCallback(async (passcode: string): Promise<void> => {
    const result = await api.authenticate(passcode);
    setToken(result.token);
    setAuthed(true);
    invalidate();
    toast.success(result.claimed ? "Console claimed — you are the owner" : "Welcome back");
  }, [invalidate]);

  const signOut = useCallback((): void => {
    setToken(null);
    setAuthed(false);
    setLiveEvents([]);
  }, []);

  const value = useMemo<EngineContextValue>(() => ({
    authed,
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
    connectBot: async (botToken) => { await botMutation.mutateAsync(botToken); },
    startPersonal: async (input) => { await personalMutation.mutateAsync(input); },
    submitPersonal: async (kind, inputValue) => { await submitPersonalMutation.mutateAsync({ kind, value: inputValue }); },
    reconnect: async () => { await reconnectMutation.mutateAsync(); },
    disconnect: () => disconnectMutation.mutate(),
    forgetConnection: async () => { await forgetMutation.mutateAsync(); },
    retryJob: (id) => retryMutation.mutate(id),
    updateJob: (id, status) => jobMutation.mutate({ id, status }),
    simulate: async (input) => { await simulateMutation.mutateAsync(input); },
    previewWorkflow: async (step, text) => api.previewWorkflow(step, text),
    analyzeConversation: async (input) => (await analysisMutation.mutateAsync(input)).analysis,
  }), [
    authed, signIn, signOut, query.data, query.isLoading, query.error, liveEvents, streamOnline,
    settingsMutation, workflowMutation, deleteMutation, importMutation, botMutation, personalMutation, submitPersonalMutation,
    reconnectMutation, disconnectMutation, forgetMutation, retryMutation, jobMutation, simulateMutation, analysisMutation,
  ]);

  return <EngineContext.Provider value={value}>{children}</EngineContext.Provider>;
}

export function useEngine(): EngineContextValue {
  const context = useContext(EngineContext);
  if (!context) throw new Error("useEngine must be used inside EngineProvider");
  return context;
}
