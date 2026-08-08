import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import {
  api,
  getToken,
  setToken,
  streamUrl,
  type EngineEvent,
  type Settings,
  type Snapshot,
  type Workflow,
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
  connect: (botToken: string) => Promise<void>;
  disconnect: () => void;
  retryJob: (id: string) => void;
  simulate: (input: { chatKey?: string; from?: string; text: string }) => Promise<void>;
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
    refetchInterval: 20_000,
    retry: 1,
  });

  useEffect(() => {
    const failure = query.error as { status?: number } | null;
    if (failure?.status === 401) {
      setToken(null);
      setAuthed(false);
    }
  }, [query.error]);

  // Live push channel — the engine emits events the moment they happen.
  useEffect(() => {
    if (!authed) return;
    let cancelled = false;
    let retryHandle: ReturnType<typeof setTimeout> | null = null;

    const open = (): void => {
      const url = streamUrl();
      if (!url || cancelled) return;
      const socket = new WebSocket(url);
      socketRef.current = socket;

      socket.onopen = () => setStreamOnline(true);
      socket.onclose = () => {
        setStreamOnline(false);
        if (!cancelled) retryHandle = setTimeout(open, 4000);
      };
      socket.onerror = () => socket.close();
      socket.onmessage = (message: MessageEvent<string>) => {
        try {
          const payload = JSON.parse(message.data) as { kind: string; event?: EngineEvent };
          if (payload.kind === "event" && payload.event) {
            const incoming = payload.event;
            setLiveEvents((prev) => [incoming, ...prev].slice(0, 200));
          }
          if (payload.kind === "refresh" || payload.kind === "link" || payload.kind === "heartbeat") {
            queryClient.invalidateQueries({ queryKey: QUERY_KEY });
          }
        } catch {
          /* ignore malformed frames */
        }
      };
    };

    open();
    return () => {
      cancelled = true;
      if (retryHandle) clearTimeout(retryHandle);
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [authed, queryClient]);

  const invalidate = (): void => {
    queryClient.invalidateQueries({ queryKey: QUERY_KEY });
  };

  const settingsMutation = useMutation({
    mutationFn: (patch: Partial<Settings>) => api.saveSettings(patch),
    onSuccess: () => invalidate(),
    onError: (err: Error) => toast.error(err.message),
  });

  const workflowMutation = useMutation({
    mutationFn: (workflow: Partial<Workflow>) => api.saveWorkflow(workflow),
    onSuccess: () => {
      invalidate();
      toast.success("Workflow saved");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteWorkflow(id),
    onSuccess: () => {
      invalidate();
      toast.success("Workflow deleted");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const connectMutation = useMutation({
    mutationFn: (botToken: string) => api.connect(botToken),
    onSuccess: () => {
      invalidate();
      toast.success("Telegram link is live");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const disconnectMutation = useMutation({
    mutationFn: () => api.disconnect(),
    onSuccess: () => {
      invalidate();
      toast("Link dropped", { description: "Automation is no longer connected." });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const retryMutation = useMutation({
    mutationFn: (id: string) => api.retryJob(id),
    onSuccess: () => invalidate(),
    onError: (err: Error) => toast.error(err.message),
  });

  const simulateMutation = useMutation({
    mutationFn: (input: { chatKey?: string; from?: string; text: string }) => api.simulate(input),
    onSuccess: () => invalidate(),
    onError: (err: Error) => toast.error(err.message),
  });

  const value = useMemo<EngineContextValue>(
    () => ({
      authed,
      signIn: async (passcode: string) => {
        const result = await api.authenticate(passcode);
        setToken(result.token);
        setAuthed(true);
        queryClient.invalidateQueries({ queryKey: QUERY_KEY });
        toast.success(result.claimed ? "Console claimed — you are the owner" : "Welcome back");
      },
      signOut: () => {
        setToken(null);
        setAuthed(false);
        setLiveEvents([]);
      },
      snapshot: query.data,
      isLoading: query.isLoading,
      error: (query.error as Error | null) ?? null,
      liveEvents,
      streamOnline,
      saveSettings: (patch) => settingsMutation.mutate(patch),
      saveWorkflow: async (workflow) => {
        await workflowMutation.mutateAsync(workflow);
      },
      deleteWorkflow: (id) => deleteMutation.mutate(id),
      connect: async (botToken) => {
        await connectMutation.mutateAsync(botToken);
      },
      disconnect: () => disconnectMutation.mutate(),
      retryJob: (id) => retryMutation.mutate(id),
      simulate: async (input) => {
        await simulateMutation.mutateAsync(input);
      },
    }),
    [
      authed,
      query.data,
      query.isLoading,
      query.error,
      liveEvents,
      streamOnline,
      queryClient,
      settingsMutation,
      workflowMutation,
      deleteMutation,
      connectMutation,
      disconnectMutation,
      retryMutation,
      simulateMutation,
    ],
  );

  return <EngineContext.Provider value={value}>{children}</EngineContext.Provider>;
}

export function useEngine(): EngineContextValue {
  const context = useContext(EngineContext);
  if (!context) throw new Error("useEngine must be used inside EngineProvider");
  return context;
}
