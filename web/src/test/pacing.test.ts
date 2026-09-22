import { describe, expect, it } from "vitest";

import {
  calculateFloodWaitResume,
  calculateSlotTime,
  checkRateLimits,
  evaluateReserveSlot,
} from "../../../functions/pacing";

describe("checkRateLimits", () => {
  it("allows when under both caps", () => {
    expect(checkRateLimits(5, 20, 100, 500).allowed).toBe(true);
  });

  it("blocks when at or over per-minute cap", () => {
    const res = checkRateLimits(20, 20, 100, 500);
    expect(res.allowed).toBe(false);
    expect(res.blocked).toContain("Per-minute cap (20) reached");
  });

  it("blocks when at or over daily cap", () => {
    const res = checkRateLimits(5, 20, 500, 500);
    expect(res.allowed).toBe(false);
    expect(res.blocked).toContain("Daily cap (500) reached");
  });
});

describe("calculateSlotTime", () => {
  it("uses now + delay when no previous send", () => {
    const now = 1000;
    expect(calculateSlotTime(now, 500, null, 1500)).toBe(1500);
  });

  it("enforces minGap from last send if greater than now + delay", () => {
    const now = 1000;
    const lastSend = 900;
    const minGap = 1500; // lastSend + minGap = 2400
    expect(calculateSlotTime(now, 200, lastSend, minGap)).toBe(2400);
  });

  it("clamps delay at 300,000 ms", () => {
    const now = 1000;
    expect(calculateSlotTime(now, 500_000, null, 1000)).toBe(1000 + 300_000);
  });
});

describe("evaluateReserveSlot", () => {
  it("returns allowed true with calculated slot time when within caps", () => {
    const res = evaluateReserveSlot({
      now: 10_000,
      delayMs: 1_000,
      lastSendTs: 8_000,
      minGapMs: 1_500,
      minuteCount: 3,
      perMinuteCap: 20,
      dayCount: 50,
      dailyCap: 500,
    });
    expect(res.allowed).toBe(true);
    if (res.allowed) {
      expect(res.at).toBe(11_000); // max(10000 + 1000, 8000 + 1500)
    }
  });

  it("returns blocked when per-minute cap exceeded", () => {
    const res = evaluateReserveSlot({
      now: 10_000,
      delayMs: 1_000,
      lastSendTs: null,
      minGapMs: 1_500,
      minuteCount: 20,
      perMinuteCap: 20,
      dayCount: 50,
      dailyCap: 500,
    });
    expect(res.allowed).toBe(false);
    if (!res.allowed) {
      expect(res.blocked).toContain("Per-minute cap (20) reached");
    }
  });
});

describe("calculateFloodWaitResume", () => {
  it("adds seconds * 1000 to now", () => {
    expect(calculateFloodWaitResume(1000, 30)).toBe(31_000);
  });

  it("caps at maxWaitSeconds (default 3600)", () => {
    expect(calculateFloodWaitResume(1000, 10_000)).toBe(1000 + 3600 * 1000);
  });
});
