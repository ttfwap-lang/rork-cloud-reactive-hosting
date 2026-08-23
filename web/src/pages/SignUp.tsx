import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Activity, Crown, Loader2, UserPlus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useEngine } from "@/lib/engine-store";
import { SourceOffer } from "@/components/SourceOffer";

/** Reserved for the person who has been running this console since before accounts existed. */
const OWNER_USERNAME = "zuperman";

export default function SignUp() {
  const { signUp } = useEngine();
  const [username, setUsername] = useState<string>("");
  const [password, setPassword] = useState<string>("");
  const [claimPasscode, setClaimPasscode] = useState<string>("");
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const claimingOwner = username.trim().toLowerCase() === OWNER_USERNAME;
  const usernameValid = /^[a-zA-Z0-9_]{3,20}$/.test(username.trim());

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signUp({
        username: username.trim(),
        password,
        claimPasscode: claimingOwner ? claimPasscode : undefined,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the account.");
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
              <h1 className="text-lg font-semibold">Create account</h1>
              <p className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">replyflow cloud</p>
            </div>
          </Link>

          <form onSubmit={submit} className="space-y-3">
            <div>
              <label htmlFor="signup-username" className="mb-1.5 block text-xs font-medium text-muted-foreground">Username</label>
              <Input
                id="signup-username"
                value={username}
                autoFocus
                autoCapitalize="none"
                autoComplete="username"
                spellCheck={false}
                placeholder="yourname"
                onChange={(event) => setUsername(event.target.value)}
                className="h-11 rounded-xl bg-input/60 font-mono"
              />
              <p className="mt-1 text-[10px] text-muted-foreground">3–20 characters: letters, numbers and underscores.</p>
            </div>
            <div>
              <label htmlFor="signup-password" className="mb-1.5 block text-xs font-medium text-muted-foreground">Password</label>
              <Input
                id="signup-password"
                type="password"
                value={password}
                autoComplete="new-password"
                onChange={(event) => setPassword(event.target.value)}
                className="h-11 rounded-xl bg-input/60 font-mono"
              />
              <p className="mt-1 text-[10px] text-muted-foreground">At least 10 characters. Stored only as a salted, slow fingerprint.</p>
            </div>

            {claimingOwner ? (
              <div className="space-y-2 rounded-xl border border-accent/25 bg-accent/[0.05] p-3">
                <div className="flex items-center gap-2">
                  <Crown className="h-3.5 w-3.5 text-accent" />
                  <p className="text-xs font-semibold text-accent">Claiming the owner account</p>
                </div>
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  This name is reserved. Enter the passcode that used to unlock the console to prove it is you —
                  every existing flow, log and setting comes with it.
                </p>
                <Input
                  type="password"
                  value={claimPasscode}
                  autoComplete="off"
                  placeholder="Existing console passcode"
                  onChange={(event) => setClaimPasscode(event.target.value)}
                  className="h-10 rounded-lg bg-input/60 font-mono"
                />
              </div>
            ) : null}

            {error ? <p className="text-xs text-destructive">{error}</p> : null}
            <Button
              type="submit"
              disabled={busy || !usernameValid || password.length < 10 || (claimingOwner && claimPasscode.length < 8)}
              className="h-11 w-full gap-2 rounded-xl text-sm font-semibold"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
              {claimingOwner ? "Claim owner account" : "Create account"}
            </Button>
          </form>

          <p className="mt-5 text-center text-xs text-muted-foreground">
            Already have one?{" "}
            <Link to="/signin" className="font-medium text-primary underline-offset-4 hover:underline">Sign in</Link>
          </p>
        </div>
      </div>
      <SourceOffer compact />
    </div>
  );
}
