/**
 * Pure pacing arithmetic and rate-limit calculations.
 */

export type PacingConfig = {
  minGapMs: number;
  perMinuteCap: number;
  dailyCap: number;
};

export type SlotReservationResult =
  | { allowed: true; at: number }
  | { allowed: false; blocked: string };

export function checkRateLimits(
  minuteCount: number,
  perMinuteCap: number,
  dayCount: number,
  dailyCap: number,
): { allowed: boolean; blocked?: string } {
  if (minuteCount >= perMinuteCap) {
    return { allowed: false, blocked: `Per-minute cap (${perMinuteCap}) reached` };
  }
  if (dayCount >= dailyCap) {
    return { allowed: false, blocked: `Daily cap (${dailyCap}) reached` };
  }
  return { allowed: true };
}

export function calculateSlotTime(
  now: number,
  delayMs: number,
  lastSendTs: number | null,
  minGapMs: number,
): number {
  const boundedDelay = Math.max(0, Math.min(delayMs, 300_000));
  const earliestGap = (lastSendTs ?? 0) + minGapMs;
  return Math.max(now + boundedDelay, earliestGap);
}

export function evaluateReserveSlot(params: {
  now: number;
  delayMs: number;
  lastSendTs: number | null;
  minGapMs: number;
  minuteCount: number;
  perMinuteCap: number;
  dayCount: number;
  dailyCap: number;
}): SlotReservationResult {
  const limits = checkRateLimits(params.minuteCount, params.perMinuteCap, params.dayCount, params.dailyCap);
  if (!limits.allowed) {
    return { allowed: false, blocked: limits.blocked ?? "Rate limit reached" };
  }

  const at = calculateSlotTime(params.now, params.delayMs, params.lastSendTs, params.minGapMs);
  return { allowed: true, at };
}

export function calculateFloodWaitResume(now: number, retryAfterSeconds: number, maxWaitSeconds = 3600): number {
  const boundedSeconds = Math.max(0, Math.min(retryAfterSeconds, maxWaitSeconds));
  return now + boundedSeconds * 1000;
}
