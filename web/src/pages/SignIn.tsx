import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Activity, Loader2, LogIn } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useEngine } from "@/lib/engine-store";
import { SourceOffer } from "@/components/SourceOffer";

export default function SignIn() {
  const { signIn } = useEngine();
  const [username, setUsername] = useState<string>("");
  const [password, setPassword] = useState<string>("");
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signIn({ username: username.trim(), password });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sign in.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid-noise flex min-h-full flex-col">
      <div className="flex flex-1 items-center justify-center px-5 py-12">
        <div className="panel w-full max-w-sm p-7">
          <Link to="/" className="mb-6 flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-2xl bg-primary/15 ring-1 ring-primary/30">
              <Activity className="h-5 w-5 text-primary" />
            </div>
            <div className="leading-tight">
              <h1 className="text-lg font-semibold">Sign in</h1>
              <p className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">replyflow cloud</p>
            </div>
          </Link>

          <form onSubmit={submit} className="space-y-3">
            <div>
              <label htmlFor="signin-username" className="mb-1.5 block text-xs font-medium text-muted-foreground">Username</label>
              <Input
                id="signin-username"
                value={username}
                autoFocus
                autoCapitalize="none"
                autoComplete="username"
                spellCheck={false}
                placeholder="yourname"
                onChange={(event) => setUsername(event.target.value)}
                className="h-11 rounded-xl bg-input/60 font-mono"
              />
            </div>
            <div>
              <label htmlFor="signin-password" className="mb-1.5 block text-xs font-medium text-muted-foreground">Password</label>
              <Input
                id="signin-password"
                type="password"
                value={password}
                autoComplete="current-password"
                onChange={(event) => setPassword(event.target.value)}
                className="h-11 rounded-xl bg-input/60 font-mono"
              />
            </div>
            {error ? <p className="text-xs text-destructive">{error}</p> : null}
            <Button
              type="submit"
              disabled={busy || username.trim().length < 3 || password.length < 1}
              className="h-11 w-full gap-2 rounded-xl text-sm font-semibold"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
              Sign in
            </Button>
          </form>

          <p className="mt-5 text-center text-xs text-muted-foreground">
            No account yet?{" "}
            <Link to="/signup" className="font-medium text-primary underline-offset-4 hover:underline">Create one</Link>
          </p>
        </div>
      </div>
      <SourceOffer compact />
    </div>
  );
}
