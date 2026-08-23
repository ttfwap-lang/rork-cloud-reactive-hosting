import { useEffect, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Clock, Loader2, LogIn, TimerReset } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AuthBackdrop } from "@/components/AuthBackdrop";
import { useEngine } from "@/lib/engine-store";
import { ApiError } from "@/lib/api";

type LocationState = { from?: string };

export default function SignIn() {
  const { signIn, sessionExpired, dismissExpiry } = useEngine();
  const navigate = useNavigate();
  const location = useLocation();
  const intended = (location.state as LocationState | null)?.from ?? "/";

  const [username, setUsername] = useState<string>("");
  const [password, setPassword] = useState<string>("");
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [lockedFor, setLockedFor] = useState<number>(0);

  // A lockout is a wait, not a failure, so it counts down in front of you.
  useEffect(() => {
    if (lockedFor <= 0) return;
    const handle = setTimeout(() => setLockedFor((seconds) => Math.max(0, seconds - 1)), 1000);
    return () => clearTimeout(handle);
  }, [lockedFor]);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (busy || lockedFor > 0) return;
    setBusy(true);
    setError(null);
    try {
      await signIn({ username: username.trim(), password });
      dismissExpiry();
      navigate(intended, { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.retryAfterSeconds !== null) {
        setLockedFor(err.retryAfterSeconds);
        setError(null);
      } else {
        setError(err instanceof Error ? err.message : "Could not sign in.");
      }
      setBusy(false);
    }
  };

  const blocked = busy || lockedFor > 0 || username.trim().length < 3 || password.length < 1;

  return (
    <AuthBackdrop title="Sign in" caption="replyflow cloud">
      {sessionExpired ? (
        <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-accent/25 bg-accent/[0.06] px-3 py-2.5">
          <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Your session expired, so you were signed out. Sign in again and you will land back where you were.
          </p>
        </div>
      ) : null}

      <form onSubmit={submit} className="space-y-4">
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

        {lockedFor > 0 ? (
          <div className="flex items-center gap-2.5 rounded-xl border border-amber-400/25 bg-amber-400/[0.07] px-3 py-2.5">
            <TimerReset className="h-3.5 w-3.5 shrink-0 text-amber-400" />
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Too many attempts. Try again in{" "}
              <span className="font-mono font-semibold tabular-nums text-amber-400">{lockedFor}s</span>.
            </p>
          </div>
        ) : null}

        {error ? (
          <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs leading-relaxed text-destructive">{error}</p>
        ) : null}

        <Button type="submit" disabled={blocked} className="h-11 w-full gap-2 rounded-xl text-sm font-semibold">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
          Sign in
        </Button>
      </form>

      <p className="mt-5 text-center text-xs text-muted-foreground">
        No account yet?{" "}
        <Link to="/signup" className="font-medium text-primary underline-offset-4 hover:underline">Create one</Link>
      </p>
    </AuthBackdrop>
  );
}
