/**
 * Pure account rules: what a username may look like, how a name's availability is
 * described, and how repeated failed sign-ins escalate into a lockout. Kept apart
 * from the registry so each rule can be exercised without a database behind it.
 */

/** Three to twenty characters, letters, numbers and underscores only. */
export const USERNAME_PATTERN = /^[a-zA-Z0-9_]{3,20}$/;
/** Consecutive wrong passwords before a name is locked out. */
export const MAX_SIGNIN_FAILS = 5;
/** How long that lockout lasts. */
export const LOCKOUT_MS = 60_000;

export type AvailabilityState = "available" | "taken" | "reserved" | "invalid" | "unknown";
export type AvailabilityView = { state: AvailabilityState; detail: string };

export type UsernameCheck = { username: string } | { error: string };

/**
 * Checks a candidate username's shape. Trimmed first, because a trailing space is
 * a typo rather than a different name.
 */
export function validateUsername(raw: unknown): UsernameCheck {
  const username = String(raw ?? "").trim();
  if (!USERNAME_PATTERN.test(username)) {
    return { error: "Usernames are 3-20 characters: letters, numbers and underscores." };
  }
  return { username };
}

/**
 * Describes whether a name can be taken. The owner name is never simply "free":
 * it is reserved until claimed, and taken afterwards, so the form can explain the
 * passcode step instead of letting someone try and fail.
 *
 * This reveals no more than pressing the button would; the caller is responsible
 * for the lookup budget that stops it being used to enumerate names.
 */
export function availabilityFor(input: { raw: string; ownerUsername: string; exists: boolean }): AvailabilityView {
  const raw = input.raw.trim();
  if (raw.length === 0) return { state: "invalid", detail: "Pick a username." };

  const parsed = validateUsername(raw);
  if ("error" in parsed) return { state: "invalid", detail: parsed.error };

  if (parsed.username.toLowerCase() === input.ownerUsername) {
    return input.exists
      ? { state: "taken", detail: "The owner account has already been claimed." }
      : { state: "reserved", detail: "Reserved for the console owner — claimable with the existing passcode." };
  }

  return input.exists
    ? { state: "taken", detail: "That username is already taken." }
    : { state: "available", detail: "That name is free." };
}

export type SigninGuard = { fails: number; lockedUntil: number };

/** A guard with nothing held against it. */
export const CLEAR_GUARD: SigninGuard = { fails: 0, lockedUntil: 0 };

/** Whole seconds left on a lockout, or 0 when the name is not locked out. */
export function lockoutSecondsRemaining(guard: SigninGuard, now: number): number {
  return guard.lockedUntil > now ? Math.ceil((guard.lockedUntil - now) / 1000) : 0;
}

/**
 * Advances the guard after a failed attempt. Reaching the limit starts a lockout
 * and resets the counter, so a lockout is served once rather than compounding
 * with every further attempt made during it.
 */
export function registerFailure(guard: SigninGuard, now: number): SigninGuard {
  const fails = guard.fails + 1;
  return fails >= MAX_SIGNIN_FAILS ? { fails: 0, lockedUntil: now + LOCKOUT_MS } : { fails, lockedUntil: 0 };
}
