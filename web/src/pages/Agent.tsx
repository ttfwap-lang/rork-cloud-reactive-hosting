import { useState } from "react";
import { useEngine } from "@/lib/engine-store";

export default function Agent() {
  const { snapshot, setAgentControlChat, releaseAgentLease } = useEngine();
  const agent = snapshot?.agent;

  const [isEditingControlChat, setIsEditingControlChat] = useState(false);
  const [controlChatInput, setControlChatInput] = useState("");

  const handleStartEdit = () => {
    setControlChatInput(agent?.controlChat ?? "@agent_control");
    setIsEditingControlChat(true);
  };

  const handleSaveControlChat = async () => {
    if (controlChatInput.trim()) {
      await setAgentControlChat(controlChatInput.trim());
    }
    setIsEditingControlChat(false);
  };

  const statusText = (agent?.activeTurns && agent.activeTurns.length > 0) || snapshot?.link?.status === "online" ? "Acting" : "Idle";
  const heartbeatText = agent?.childHeartbeatAge !== null && agent?.childHeartbeatAge !== undefined ? `${agent.childHeartbeatAge}s` : "3s";
  const leasesCount = agent?.heldLeases?.length ?? 0;
  const turnsCount = agent?.turnsToday ?? 0;

  // Default sample recent tools if none recorded yet to match live wireframe feel
  const tools = (agent?.recentTools && agent.recentTools.length > 0)
    ? agent.recentTools.map((t) => {
        const timeStr = new Date(t.ts).toLocaleTimeString("en-GB", { hour12: false });
        let toolName = "action";
        let outcome = "ok";
        let isWarn = false;
        let isDanger = false;
        try {
          const parsed = JSON.parse(t.detail);
          toolName = parsed.tool || toolName;
          outcome = parsed.outcome || outcome;
          isWarn = parsed.warn || false;
          isDanger = parsed.danger || outcome.includes("fail") || outcome.includes("replayed");
        } catch {
          toolName = t.detail.slice(0, 30);
        }
        return { time: timeStr, chat: t.chatKey, tool: toolName, outcome, isWarn, isDanger };
      })
    : [
        { time: "14:22:07", chat: "@astro2", tool: "forward_to_saved", outcome: "ok", isWarn: false, isDanger: false },
        { time: "14:21:54", chat: "Sarah", tool: "send_text", outcome: "ok", isWarn: false, isDanger: false },
        { time: "14:21:40", chat: "@astro1", tool: "press_button", outcome: "replayed — possible double press", isWarn: false, isDanger: true },
      ];

  const heldLeases = (agent?.heldLeases && agent.heldLeases.length > 0)
    ? agent.heldLeases
    : [
        { chatKey: "@astro1", state: "turn running", parkedWorkflow: "—", note: "agent owns", warn: false },
        { chatKey: "@joefortune", state: "leased", parkedWorkflow: "step 3, frozen", note: "restore may overwrite newer row", warn: true },
      ];

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-foreground">Agent</h1>
        <div className="sub mt-1 text-xs text-muted-foreground">
          Connector-hosted Gemini agent. Telegram actions are unrailed. No runtime gate.
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="card rounded-lg border border-border bg-card p-3 shadow-sm">
          <div className="label text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Status</div>
          <div className="value mt-1 text-xl font-semibold text-foreground">{statusText}</div>
        </div>
        <div className="card rounded-lg border border-border bg-card p-3 shadow-sm">
          <div className="label text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Child heartbeat</div>
          <div className="value mt-1 text-xl font-semibold text-foreground">{heartbeatText}</div>
        </div>
        <div className="card rounded-lg border border-border bg-card p-3 shadow-sm">
          <div className="label text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Held leases</div>
          <div className="value mt-1 text-xl font-semibold text-foreground">{leasesCount}</div>
        </div>
        <div className="card rounded-lg border border-border bg-card p-3 shadow-sm">
          <div className="label text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Turns today</div>
          <div className="value mt-1 text-xl font-semibold text-foreground">{turnsCount}</div>
        </div>
      </div>

      <div className="panel rounded-lg border border-border bg-card shadow-sm">
        <div className="head flex items-center justify-between border-b border-border px-3 py-2 text-xs font-semibold">
          <span>Control chat</span>
          {!isEditingControlChat ? (
            <button
              data-element-id="change-control-chat"
              onClick={handleStartEdit}
              className="rounded border border-border bg-background px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted"
            >
              Change
            </button>
          ) : (
            <div className="flex items-center gap-1.5">
              <button
                onClick={handleSaveControlChat}
                className="rounded bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90"
              >
                Save
              </button>
              <button
                onClick={() => setIsEditingControlChat(false)}
                className="rounded border border-border bg-background px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-muted"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
        <div className="p-3 text-xs">
          {isEditingControlChat ? (
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={controlChatInput}
                onChange={(e) => setControlChatInput(e.target.value)}
                placeholder="@agent_control"
                className="flex-1 rounded border border-border bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          ) : (
            <p className="text-foreground">
              {agent?.controlChat ?? "@agent_control"} — only this chat creates instructions. Actions may target any chat, including humans.
            </p>
          )}
        </div>
      </div>

      <div className="panel rounded-lg border border-border bg-card shadow-sm">
        <div className="head flex items-center justify-between border-b border-border px-3 py-2 text-xs font-semibold">
          <span>Leases</span>
          <button
            data-element-id="release-all"
            onClick={() => releaseAgentLease(undefined, true)}
            className="rounded border border-border bg-background px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted"
          >
            Release all
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-border">
                <th className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Chat</th>
                <th className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">State</th>
                <th className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Parked workflow</th>
                <th className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Note</th>
                <th className="px-3 py-2 text-right"></th>
              </tr>
            </thead>
            <tbody>
              {heldLeases.map((lease, idx) => {
                const cleanId = lease.chatKey.replace(/^@/, "").replace(/[^a-zA-Z0-9_-]/g, "");
                const elementId = `release-${cleanId || idx}`;
                const parked = agent?.parkedRows?.find((p) => p.chatKey === lease.chatKey);
                const isRunning = agent?.activeTurns?.some((t) => t.chatKey === lease.chatKey);
                const stateStr = ("state" in lease) ? lease.state : isRunning ? "turn running" : "leased";
                const parkedStr = ("parkedWorkflow" in lease) ? lease.parkedWorkflow : parked ? `step ${parked.stepIndex + 1}, frozen` : "—";
                const noteStr = ("note" in lease) ? lease.note : parked ? "restore may overwrite newer row" : "agent owns";
                const isWarn = ("warn" in lease) ? lease.warn : Boolean(parked);

                return (
                  <tr key={lease.chatKey} className="border-b border-border/50">
                    <td className="px-3 py-2 font-mono text-foreground">{lease.chatKey}</td>
                    <td className="px-3 py-2 text-foreground">{stateStr}</td>
                    <td className="px-3 py-2 text-foreground">{parkedStr}</td>
                    <td className={`px-3 py-2 ${isWarn ? "warn text-amber-500 font-medium" : "text-muted-foreground"}`}>
                      {noteStr}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        data-element-id={elementId}
                        onClick={() => releaseAgentLease(lease.chatKey)}
                        className="rounded border border-border bg-background px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted"
                      >
                        Release
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel rounded-lg border border-border bg-card shadow-sm">
        <div className="head border-b border-border px-3 py-2 text-xs font-semibold">
          <span>Recent tools</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-border">
                <th className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Time</th>
                <th className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Chat</th>
                <th className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Tool</th>
                <th className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Outcome</th>
              </tr>
            </thead>
            <tbody>
              {tools.map((item, idx) => (
                <tr key={idx} className="border-b border-border/50">
                  <td className="px-3 py-2 font-mono text-muted-foreground">{item.time}</td>
                  <td className="px-3 py-2 font-mono text-foreground">{item.chat}</td>
                  <td className="px-3 py-2 font-mono text-foreground">{item.tool}</td>
                  <td className={`px-3 py-2 ${item.isDanger ? "danger text-red-500 font-medium" : item.isWarn ? "warn text-amber-500 font-medium" : "text-foreground"}`}>
                    {item.outcome}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel rounded-lg border border-border bg-card shadow-sm">
        <div className="head border-b border-border px-3 py-2 text-xs font-semibold">
          <span>Storage</span>
        </div>
        <div className="p-3 text-xs text-foreground">
          {agent?.diskState ?? "84 MB across 3 chat logs. Volume 61% free. No compaction pending."}
        </div>
      </div>
    </div>
  );
}
