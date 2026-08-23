import { describe, expect, it } from "vitest";

import {
  availabilityFor,
  lockoutSecondsRemaining,
  registerFailure,
  validateUsername,
  CLEAR_GUARD,
  LOCKOUT_MS,
  MAX_SIGNIN_FAILS,
  type SigninGuard,
} from "../../../functions/account-rules";

const OWNER = "zuperman";

describe("validateUsername", () => {
  it("accepts letters, numbers and underscores", () => {
    expect(validateUsername("valid_name9")).toEqual({ username: "valid_name9" });
  });

  it("trims surrounding whitespace rather than rejecting it", () => {
    expect(validateUsername("  spaced  ")).toEqual({ username: "spaced" });
  });

  it("rejects a name below three characters", () => {
    expect(validateUsername("ab")).toHaveProperty("error");
  });

  it("rejects a name above twenty characters", () => {
    expect(validateUsername("a".repeat(21))).toHaveProperty("error");
  });

  it("accepts the boundary lengths exactly", () => {
    expect(validateUsername("abc")).toEqual({ username: "abc" });
    expect(validateUsername("a".repeat(20))).toEqual({ username: "a".repeat(20) });
  });

  it("rejects spaces and punctuation inside the name", () => {
    expect(validateUsername("a b")).toHaveProperty("error");
    expect(validateUsername("no!")).toHaveProperty("error");
    expect(validateUsername("dash-ed")).toHaveProperty("error");
  });

  it("rejects nothing at all", () => {
    expect(validateUsername("")).toHaveProperty("error");
    expect(validateUsername(null)).toHaveProperty("error");
    expect(validateUsername(undefined)).toHaveProperty("error");
  });
});

describe("availabilityFor", () => {
  it("calls a free name available", () => {
    expect(availabilityFor({ raw: "newcomer", ownerUsername: OWNER, exists: false }).state).toBe("available");
  });

  it("calls an existing name taken", () => {
    expect(availabilityFor({ raw: "newcomer", ownerUsername: OWNER, exists: true }).state).toBe("taken");
  });

  it("calls an empty name invalid and asks for one", () => {
    const view = availabilityFor({ raw: "", ownerUsername: OWNER, exists: false });
    expect(view.state).toBe("invalid");
    expect(view.detail).toBe("Pick a username.");
  });

  it("calls a malformed name invalid and explains the rule", () => {
    const view = availabilityFor({ raw: "a b!", ownerUsername: OWNER, exists: false });
    expect(view.state).toBe("invalid");
    expect(view.detail).toContain("3-20 characters");
  });

  it("reserves the owner name while it is unclaimed", () => {
    expect(availabilityFor({ raw: OWNER, ownerUsername: OWNER, exists: false }).state).toBe("reserved");
  });

  it("reports the owner name as taken once it is claimed", () => {
    expect(availabilityFor({ raw: OWNER, ownerUsername: OWNER, exists: true }).state).toBe("taken");
  });

  it("reserves the owner name whatever case it is typed in", () => {
    expect(availabilityFor({ raw: "ZuperMan", ownerUsername: OWNER, exists: false }).state).toBe("reserved");
  });

  it("never reports a name as free without saying so plainly", () => {
    expect(availabilityFor({ raw: "newcomer", ownerUsername: OWNER, exists: false }).detail).toBe("That name is free.");
  });
});

describe("sign-in lockout", () => {
  const now = 1_700_000_000_000;

  it("holds nothing against a fresh guard", () => {
    expect(lockoutSecondsRemaining(CLEAR_GUARD, now)).toBe(0);
  });

  it("counts failures without locking out before the limit", () => {
    let guard: SigninGuard = CLEAR_GUARD;
    for (let attempt = 1; attempt < MAX_SIGNIN_FAILS; attempt += 1) {
      guard = registerFailure(guard, now);
      expect(guard.fails).toBe(attempt);
      expect(lockoutSecondsRemaining(guard, now)).toBe(0);
    }
  });

  it("locks out on the fifth consecutive failure", () => {
    let guard: SigninGuard = CLEAR_GUARD;
    for (let attempt = 0; attempt < MAX_SIGNIN_FAILS; attempt += 1) guard = registerFailure(guard, now);
    expect(lockoutSecondsRemaining(guard, now)).toBe(LOCKOUT_MS / 1000);
  });

  it("resets the counter when the lockout starts, so it is served once", () => {
    let guard: SigninGuard = CLEAR_GUARD;
    for (let attempt = 0; attempt < MAX_SIGNIN_FAILS; attempt += 1) guard = registerFailure(guard, now);
    expect(guard.fails).toBe(0);
  });

  it("counts the lockout down as time passes", () => {
    let guard: SigninGuard = CLEAR_GUARD;
    for (let attempt = 0; attempt < MAX_SIGNIN_FAILS; attempt += 1) guard = registerFailure(guard, now);
    expect(lockoutSecondsRemaining(guard, now + 30_000)).toBe(30);
  });

  it("releases the lockout once it has expired", () => {
    let guard: SigninGuard = CLEAR_GUARD;
    for (let attempt = 0; attempt < MAX_SIGNIN_FAILS; attempt += 1) guard = registerFailure(guard, now);
    expect(lockoutSecondsRemaining(guard, now + LOCKOUT_MS + 1)).toBe(0);
  });

  it("rounds a part-second remainder up, never down to zero", () => {
    const guard: SigninGuard = { fails: 0, lockedUntil: now + 500 };
    expect(lockoutSecondsRemaining(guard, now)).toBe(1);
  });
});
