import { useState, type FormEvent } from "react";
import { Copy, Link2, Loader2, PlugZap, Send, ShieldAlert } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { API_BASE } from "@/lib/api";
import { useEngine } from "@/lib/engine-store";

export default function Connection() {
  const { snapshot, connect, simulate } = useEngine();
  const [token, setTokenValue] = useState<string>("");
  const [busy, setBusy] = useState<boolean>(false);
  const [probe, setProbe] = useState<string>("");

  const link = snapshot?.link;
  const webhook = snapshot?.stats.webhookPath ? `${API_BASE}/tg/${snapshot.stats.webhookPath}` : null;

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    try {
      await connect(token.trim());
      setTokenValue("");
    } catch {
      /* surfaced by the store */
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Connection</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          The engine holds this link open in the cloud and repairs it automatically.
        </p>
      </header>

      <section className="panel p-5">
        <div className="mb-4 flex items-center gap-2.5">
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-primary/15 ring-1 ring-primary/30">
            <Link2 className="h-4 w-4 text-primary" />
          </div>
          <div>
            <h2 className="text-sm font-semibold">Telegram link</h2>
            <p className="text-[11px] text-muted-foreground">
              {link?.status === "online"
                ? `Live as ${link.identity ?? "connected"}`
                : (link?.detail ?? "Not connected yet")}
            </p>
          </div>
        </div>

        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Bot token</label>
            <Input
              value={token}
              placeholder="123456789:AA..."
              onChange={(event) => setTokenValue(event.target.value)}
              className="h-11 rounded-xl bg-input/60 font-mono text-sm"
            />
            <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
              Create one with @BotFather in Telegram, then paste the token here. The engine registers a
              push webhook so replies fire in about a second.
            </p>
          </div>
          <Button
            type="submit"
            disabled={busy || token.trim().length < 20}
            className="h-11 w-full gap-2 rounded-xl font-semibold"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlugZap className="h-4 w-4" />}
            {link?.status === "online" ? "Reconnect" : "Connect and go live"}
          </Button>
        </form>

        {webhook ? (
          <button
            onClick={() => {
              navigator.clipboard?.writeText(webhook).then(
                () => toast.success("Webhook URL copied"),
                () => toast.error("Could not copy"),
              );
            }}
            className="mt-4 flex w-full items-center gap-2 rounded-xl bg-secondary/50 px-3 py-2.5 text-left transition-colors hover:bg-secondary"
          >
            <Copy className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">
              {webhook}
            </span>
          </button>
        ) : null}
      </section>

      <section className="panel p-5">
        <h2 className="text-sm font-semibold">Test without Telegram</h2>
        <p className="mt-1 text-[11px] text-muted-foreground">
          Push a fake inbound message through the live engine to watch your workflow fire.
        </p>
        <div className="mt-3 flex gap-2">
          <Input
            value={probe}
            placeholder="Type a message your workflow should match"
            onChange={(event) => setProbe(event.target.value)}
            className="h-10 rounded-xl bg-input/60 text-sm"
          />
          <Button
            variant="secondary"
            className="h-10 shrink-0 gap-1.5 rounded-xl"
            disabled={probe.trim().length === 0}
            onClick={() => {
              simulate({ text: probe.trim() }).then(
                () => {
                  setProbe("");
                  toast.success("Sent through the engine");
                },
                () => undefined,
              );
            }}
          >
            <Send className="h-3.5 w-3.5" /> Fire
          </Button>
        </div>
      </section>

      <section className="panel border-amber-400/20 bg-amber-400/[0.04] p-5">
        <div className="flex gap-3">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
          <div className="space-y-2 text-[13px] leading-relaxed">
            <p className="font-semibold text-amber-400">About personal-account mode</p>
            <p className="text-muted-foreground">
              Logging in with your own phone number needs Telegram's MTProto protocol, which requires a
              native library this cloud runtime cannot load. Bot-token mode is running instead — same
              engine, same workflows, same always-on watchdog. Tell me if you want the personal-account
              path and I will wire it through a companion connector.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
