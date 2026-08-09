import { useState, type FormEvent } from "react";
import { Activity, Loader2, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useEngine } from "@/lib/engine-store";

export function Gate() {
  const { signIn } = useEngine();
  const [passcode, setPasscode] = useState<string>("");
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signIn(passcode);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sign in.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid-noise flex min-h-full items-center justify-center px-5 py-16">
      <div className="panel w-full max-w-sm p-7">
        <div className="mb-6 flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-2xl bg-primary/15 ring-1 ring-primary/30">
            <Activity className="h-5 w-5 text-primary" />
          </div>
          <div className="leading-tight">
            <h1 className="text-lg font-semibold">ReplyFlow Cloud</h1>
            <p className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
              private console
            </p>
          </div>
        </div>

        <p className="mb-5 text-sm leading-relaxed text-muted-foreground">
          The first passcode you enter claims this console and becomes the owner key. After that, only
          that passcode opens it.
        </p>

        <form onSubmit={submit} className="space-y-3">
          <Input
            type="password"
            value={passcode}
            autoFocus
            placeholder="Owner passcode"
            onChange={(event) => setPasscode(event.target.value)}
            className="h-11 rounded-xl bg-input/60 font-mono"
          />
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
          <Button
            type="submit"
            disabled={busy || passcode.length < 8}
            className="h-11 w-full gap-2 rounded-xl text-sm font-semibold"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
            Unlock console
          </Button>
        </form>

        <p className="mt-5 font-mono text-[11px] leading-relaxed text-muted-foreground">
          Minimum 8 characters. Protected with a salted, deliberately slow hash inside your cloud engine.
        </p>
      </div>
    </div>
  );
}
