import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Check, Crown, Loader2, ShieldQuestion, UserPlus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AuthBackdrop } from "@/components/AuthBackdrop";
import { useEngine } from "@/lib/engine-store";
import { api, type AvailabilityState } from "@/lib/api";
import { cn } from "@/lib/utils";

/** Reserved for the person who has been running this console since before accounts existed. */
const OWNER_USERNAME = "zuperman";
const MIN_PASSWORD = 10;
const USERNAME_SHAPE = /^[a-zA-Z0-9_]{3,20}$/;
/** Long enough that a name is not looked up on every keystroke, short enough to feel instant. */
const LOOKUP_DEBOUNCE_MS = 380;

type Availability = { state: AvailabilityState | "idle" | "checking"; detail: string };

function AvailabilityMark({ state }: { state: Availability["state"] }) {
  if (state === "checking") return <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />;
  if (state === "available") return <Check className="h-3.5 w-3.5 text-primary" />;
  if (state === "reserved") return <ShieldQuestion className="h-3.5 w-3.5 text-accent" />;
  if (state === "taken" || state === "invalid") return <X className="h-3.5 w-3.5 text-destructive" />;
  return null;
}

export default function SignUp() {
  const { signUp } = useEngine();
  const [username, setUsername] = useState<string>("");
  const [password, setPassword] = useState<string>("");
  const [claimPasscode, setClaimPasscode] = useState<string>("");
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [availability, setAvailability] = useState<Availability>({ state: "idle", detail: "" });

  const trimmed = username.trim();
  const claimingOwner = trimmed.toLowerCase() === OWNER_USERNAME;
  const shapeOk = USERNAME_SHAPE.test(trimmed);

  // Asks the service whether the name can be had, once typing settles. Out-of-order
  // answers are discarded, so a slow early reply cannot overwrite a fast later one.
  useEffect(() => {
    if (trimmed.length === 0) {
      setAvailability({ state: "idle", detail: "" });
      return;
    }
    if (!shapeOk) {
      setAvailability({ state: "invalid", detail: "3–20 characters: letters, numbers and underscores." });
      return;
    }
    setAvailability({ state: "checking", detail: "" });
    let cancelled = false;
    const handle = setTimeout(() => {
      void api
        .checkUsername(trimmed)
        .then((result) => { if (!cancelled) setAvailability({ state: result.state, detail: result.detail }); })
        .catch(() => { if (!cancelled) setAvailability({ state: "unknown", detail: "" }); });
    }, LOOKUP_DEBOUNCE_MS);
    return () => { cancelled = true; clearTimeout(handle); };
  }, [trimmed, shapeOk]);

  const nameBlocked = availability.state === "taken" || availability.state === "invalid";
  const passcodeNeeded = claimingOwner && claimPasscode.length < 8;

  /** The single reason the button is not ready, shown against the field that owns it. */
  const blocker = useMemo<string | null>(() => {
    if (trimmed.length === 0) return "Pick a username to continue.";
    if (!shapeOk) return "3–20 characters: letters, numbers and underscores.";
    if (availability.state === "taken") return availability.detail;
    if (password.length === 0) return `Choose a password of at least ${MIN_PASSWORD} characters.`;
    if (password.length < MIN_PASSWORD) return `${MIN_PASSWORD - password.length} more character${MIN_PASSWORD - password.length === 1 ? "" : "s"} needed.`;
    if (passcodeNeeded) return "Enter the existing console passcode to claim this name.";
    return null;
  }, [trimmed, shapeOk, availability.state, availability.detail, password.length, passcodeNeeded]);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (blocker !== null || busy) return;
    setBusy(true);
    setError(null);
    try {
      await signUp({ username: trimmed, password, claimPasscode: claimingOwner ? claimPasscode : undefined });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the account.");
      setBusy(false);
    }
  };

  return (
    <AuthBackdrop title="Create account" caption="replyflow cloud">
      <form onSubmit={submit} className="space-y-4">
        <div>
          <div className="mb-1.5 flex items-baseline justify-between gap-2">
            <label htmlFor="signup-username" className="text-xs font-medium text-muted-foreground">Username</label>
            {availability.state !== "idle" && availability.state !== "unknown" ? (
              <span
                className={cn(
                  "flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest",
                  availability.state === "available" && "text-primary",
                  availability.state === "reserved" && "text-accent",
                  (availability.state === "taken" || availability.state === "invalid") && "text-destructive",
                  availability.state === "checking" && "text-muted-foreground",
                )}
              >
                <AvailabilityMark state={availability.state} />
                {availability.state === "checking" ? "checking" : availability.state}
              </span>
            ) : null}
          </div>
          <Input
            id="signup-username"
            value={username}
            autoFocus
            autoCapitalize="none"
            autoComplete="username"
            spellCheck={false}
            placeholder="yourname"
            aria-invalid={nameBlocked}
            onChange={(event) => setUsername(event.target.value)}
            className={cn(
              "h-11 rounded-xl bg-input/60 font-mono transition-shadow",
              availability.state === "available" && "ring-1 ring-primary/40",
              nameBlocked && "ring-1 ring-destructive/50",
            )}
          />
          <p className={cn("mt-1.5 text-[11px] leading-relaxed", nameBlocked ? "text-destructive" : "text-muted-foreground")}>
            {availability.detail.length > 0 ? availability.detail : "3–20 characters: letters, numbers and underscores."}
          </p>
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
          <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
            At least {MIN_PASSWORD} characters. Stored only as a salted, slow fingerprint.
          </p>
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

        {error ? (
          <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs leading-relaxed text-destructive">{error}</p>
        ) : null}

        <div className="space-y-2">
          <Button
            type="submit"
            disabled={busy || blocker !== null}
            className="h-11 w-full gap-2 rounded-xl text-sm font-semibold"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
            {claimingOwner ? "Claim owner account" : "Create account"}
          </Button>
          {blocker !== null && !busy ? (
            <p className="text-center text-[11px] text-muted-foreground">{blocker}</p>
          ) : null}
        </div>
      </form>

      <p className="mt-5 text-center text-xs text-muted-foreground">
        Already have one?{" "}
        <Link to="/signin" className="font-medium text-primary underline-offset-4 hover:underline">Sign in</Link>
      </p>
    </AuthBackdrop>
  );
}
